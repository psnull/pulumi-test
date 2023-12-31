import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as docker from "@pulumi/docker";
import { Cluster, Service } from "@pulumi/aws/ecs";
import { ApplicationLoadBalancer } from "@pulumi/awsx/lb";
import { FargateService } from "@pulumi/awsx/ecs";
import { Input, Output } from "@pulumi/pulumi";
import { NatGateway, RouteTable, SecurityGroup, Subnet, SubnetArgs } from "@pulumi/aws/ec2";


const vpcId = 'vpc-21bf405b'
const tags = {
    'env':'development'
}

export const buildDockerImage = (repoName: string) => {
    const repo = new aws.ecr.Repository(repoName, {
        forceDelete: true,
        tags
    });
    // Get registry info (creds and endpoint).
    const imageName = repo.repositoryUrl;
    const registryInfo = repo.registryId.apply(async id => {
        const credentials = await aws.ecr.getCredentials({ registryId: id });
        const decodedCredentials = Buffer.from(credentials.authorizationToken, "base64").toString();
        const [username, password] = decodedCredentials.split(":");
        if (!password || !username) {
            throw new Error("Invalid credentials");
        }
        return {
            server: credentials.proxyEndpoint,
            username: username,
            password: password,
        };
    });
    const image = new docker.Image(repoName, {
        build: {
            context: '.',
            dockerfile: `./${repoName}/Dockerfile`,
        },
        imageName,
        registry: registryInfo,
    });
    return image
}
export const buildExternalWebService = (
    cluster: Cluster,
    image: docker.Image,
    loadbalancer: ApplicationLoadBalancer,
    env: { name: string, value: string | Output<string> }[] = [],
    securityGroup: SecurityGroup,
    subnets: Subnet[]
): FargateService => {
    const service = new awsx.ecs.FargateService('webService', {
        cluster: cluster.arn,
        networkConfiguration: {
            assignPublicIp: true,
            subnets: subnets.map(s => s.id),
            securityGroups: [securityGroup.id]
        },
        taskDefinitionArgs: {
            runtimePlatform: {
                cpuArchitecture: "ARM64"
            },
            container: {
                name: "awsx-ecs",
                image: image.imageName,
                cpu: 128,
                memory: 512,
                essential: true,
                portMappings: [{
                    targetGroup: loadbalancer.defaultTargetGroup,
                    containerPort: 5000,
                    hostPort: 5000
                }],
                environment: env
            },
        },
        tags
    });
    return service
}

export const buildPublicSubnets = () => {
    const buildPublicSubnet = (
        name: string,
        cidrBlock: string,
        az: string
    ) => {
        return new aws.ec2.Subnet(name, {
            vpcId: vpcId,
            mapPublicIpOnLaunch: true,
            cidrBlock: cidrBlock,
            availabilityZone: az,
            tags
        })
    }
    return [
        buildPublicSubnet('pubsubnet1', '172.31.100.0/24', 'us-east-1a'),
        buildPublicSubnet('pubsubnet2', '172.31.101.0/24', 'us-east-1b')
    ]

}

export const buildNatGateway = (publicSubnetId: Input<string>) => {
    const eip = new aws.ec2.Eip('natGatewayEip', {tags})
    const gw = new aws.ec2.NatGateway('customNatGateway', {
        subnetId: publicSubnetId,
        allocationId: eip.id,
        tags
    })
    return gw
}

export const buildPrivateSubnets = (gw: NatGateway) => {
    const buildPrivateSubnet = (
        name: string,
        cidrBlock: string,
        az: string,
        myrtb: RouteTable) => {
        const privatesubnet = new aws.ec2.Subnet(name, {
            vpcId: vpcId,
            mapPublicIpOnLaunch: false,
            cidrBlock: cidrBlock,
            availabilityZone: az,
            tags
        })
        new aws.ec2.RouteTableAssociation(`rtb-asoc-${name}`, {
            subnetId: privatesubnet.id,
            routeTableId: myrtb.id,
        })
        return privatesubnet
    }
    const myrtb = new aws.ec2.RouteTable('myrtb', {
        vpcId: vpcId,
        routes: [{
            gatewayId: gw.id,
            cidrBlock: '0.0.0.0/0'
        }],
        tags
    })
    return [
        buildPrivateSubnet('privsubnet1', '172.31.200.0/24', 'us-east-1a', myrtb),
        buildPrivateSubnet('privsubnet2', '172.31.201.0/24', 'us-east-1b', myrtb)
    ]
}

export const buildInternalLoadBalancer = (subnets: Subnet[], securityGroups: SecurityGroup[]) => {
    const privateLoadBalancer = new awsx.lb.ApplicationLoadBalancer("privateLoadBalancer", {
        internal: true,
        subnetIds: subnets.map(s => s.id),
        securityGroups: securityGroups.map(sg => sg.id),
        defaultTargetGroup: {
            healthCheck: {
                path: '/WeatherForecast',
                port: '5000',
            },
            port: 5000
        },
        tags
    });
    return privateLoadBalancer
}

export const buildPublicLoadbalancer = (subnets: Subnet[], securityGroup: SecurityGroup) => {
    const appLoadBalancer = new awsx.lb.ApplicationLoadBalancer("webLoadBalancer", {
        subnetIds: subnets.map(s => s.id),
        securityGroups: [securityGroup.id],
        internal: false,
        defaultTargetGroup: {
            healthCheck: {
                path: '/',
                port: '5000',
            },
            port: 5000
        },
        tags
    });
    return appLoadBalancer
}

export const externalSecurityGroup = () => new aws.ec2.SecurityGroup('externalSg', {
    ingress: [{
        self: true,
        fromPort: 0,
        toPort: 65535,
        protocol: 'tcp',
        cidrBlocks: ['0.0.0.0/0'],
    }],
    egress: [{
        fromPort: 0,
        toPort: 65535,
        protocol: 'tcp',
        cidrBlocks: ['0.0.0.0/0'],
        ipv6CidrBlocks: ['::/0']
    }],
    tags
})

export const internalSecurityGroup = (externalSg: SecurityGroup) => new aws.ec2.SecurityGroup('internalSg', {
    ingress: [{
        self: true,
        fromPort: 0,
        toPort: 65535,
        protocol: 'tcp',
        securityGroups: [externalSg.id]
    }],
    egress: [{
        fromPort: 0,
        toPort: 65535,
        protocol: 'tcp',
        cidrBlocks: ['0.0.0.0/0'],
        ipv6CidrBlocks: ['::/0']
    }],
    tags
})

export const buildSimpleEcsExecutionRole = (name: string = "executionRole") => {
    const executionRole = new aws.iam.Role(name, {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Sid: "",
                    Effect: "Allow",
                    Principal: {
                        Service: "ecs-tasks.amazonaws.com"
                    },
                    Action: "sts:AssumeRole"
                }
            ]
        }),
        managedPolicyArns: [
            'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy'
        ],
        tags
    })
    return executionRole
}

export const buildInternalWebService = (
    cluster: Cluster,
    privateSubnets: Subnet[],
    internalLoadBalancer: ApplicationLoadBalancer,
    internalSecurityGroup: SecurityGroup
) => {
    new aws.cloudwatch.LogGroup('privateApiLogGroup', {
        name: "privateApi"
    })

    const internalApiImage = buildDockerImage('infra-api')
    const internalApiContainerDefinition = internalApiImage.imageName.apply(s => {
        return JSON.stringify([
            {
                name: "apiService",
                image: s,
                cpu: 10,
                networkMode: "awsvpc",
                memory: 512,
                essential: true,
                portMappings: [{
                    containerPort: 5000,
                    hostPort: 5000,
                }],
                logConfiguration: {
                    logDriver: "awslogs",
                    options: {
                        'awslogs-group': "privateApi",
                        'awslogs-region': "us-east-1",
                        'awslogs-stream-prefix': "awsx-ecs"
                    }
                }
            },
        ])
    })
    const internalApiTaskDefinition = new aws.ecs.TaskDefinition("service", {
        family: "service",
        containerDefinitions: internalApiContainerDefinition,
        networkMode: 'awsvpc',
        runtimePlatform: {
            cpuArchitecture: "ARM64"
        },
        cpu: '256',
        memory: '512',
        requiresCompatibilities: ['FARGATE'],
        executionRoleArn: buildSimpleEcsExecutionRole().arn,
        tags
    });

    const internalApiService = new aws.ecs.Service("apiService", {
        cluster: cluster.id,
        taskDefinition: internalApiTaskDefinition.arn,
        desiredCount: 1,
        launchType: 'FARGATE',
        networkConfiguration: {
            subnets: privateSubnets.map(s => s.id),
            assignPublicIp: false,
            securityGroups: [internalSecurityGroup.id]
        },
        loadBalancers: [{
            targetGroupArn: internalLoadBalancer.defaultTargetGroup.arn,
            containerName: "apiService",
            containerPort: 5000,
        }],
        tags
    });
    return internalApiService
}