import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as docker from "@pulumi/docker";
import { Cluster, Service } from "@pulumi/aws/ecs";
import { ApplicationLoadBalancer } from "@pulumi/awsx/lb";
import { FargateService } from "@pulumi/awsx/ecs";
import { Input, Output } from "@pulumi/pulumi";
import { NatGateway, RouteTable, SecurityGroup, Subnet, SubnetArgs } from "@pulumi/aws/ec2";


const vpcId = 'vpc-21bf405b'

export const createDockerImage = (repoName: string): { image: docker.Image } => {
    const repo = new aws.ecr.Repository(repoName, {
        forceDelete: true
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
    return { image: image }
}

export const buildPublicService = (
    cluster: Cluster,
    image: docker.Image,
    loadbalancer: ApplicationLoadBalancer,
    env: { name: string, value: string | Output<string>}[] = [],
    securityGroup: SecurityGroup,
    subnets: Subnet[]
): FargateService => {
    const service = new awsx.ecs.FargateService('webService', {
        cluster: cluster.arn,
        networkConfiguration:{
            assignPublicIp: true,
            subnets:subnets.map(s=>s.id),
            securityGroups:[securityGroup.id]
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
    });
    return service
}
export const createPublicSubnet = (
    name: string,
    cidrBlock: string,
    az: string
) => {
    return new aws.ec2.Subnet(name, {
        vpcId: vpcId,
        mapPublicIpOnLaunch: true,
        cidrBlock: cidrBlock,
        availabilityZone: az
    })
}

export const createRouteTable = (gw: NatGateway) => {
    let myrtb = new aws.ec2.RouteTable('myrtb', {
        vpcId: vpcId,
        routes: [{
            gatewayId: gw.id,
            cidrBlock: '0.0.0.0/0'
        }]
    })
    return myrtb
}
export const createNatGateway = (publicSubnetId: Input<string>) => {
    let eip = new aws.ec2.Eip('myeip', {})
    let gw = new aws.ec2.NatGateway('myNatGateway', {
        subnetId: publicSubnetId,
        allocationId: eip.id
    })
    return gw
}
export const createPrivateSubnet = (name: string, natGateway: NatGateway, cidrBlock:string, az:string, myrtb: RouteTable) => {
    let privatesubnet = new aws.ec2.Subnet(name, {
        vpcId: vpcId,
        mapPublicIpOnLaunch: false,
        cidrBlock: cidrBlock,
        availabilityZone: az
    })
    new aws.ec2.RouteTableAssociation(`rtb-asoc-${name}`, {
        subnetId: privatesubnet.id,
        routeTableId: myrtb.id
    })
    return privatesubnet
}

export const createPrivateLoadBalancer = (subnets:Subnet[], securityGroups: SecurityGroup[]) => {
    let privateLoadBalancer = new awsx.lb.ApplicationLoadBalancer("privateLoadBalancer", {
        internal: true,
        subnetIds:subnets.map(s=>s.id),
        securityGroups: securityGroups.map(sg=>sg.id),
        defaultTargetGroup: {
            healthCheck: {
                path: '/WeatherForecast',
                port: '5000',
            },
            port: 5000
        }
    });
    return privateLoadBalancer
}

export const createPublicLoadbalancer = (subnets: Subnet[], securityGroup: SecurityGroup) => {
    const appLoadBalancer = new awsx.lb.ApplicationLoadBalancer("webLoadBalancer", {
        subnetIds: subnets.map(s=>s.id),
        securityGroups:[securityGroup.id],
        internal:false,
        defaultTargetGroup: {
            healthCheck: {
                path: '/',
                port: '5000',
            },
            port: 5000
        }
    });
    return appLoadBalancer
}


export const createPrivateApi = (
    cluster: Cluster,
    image: docker.Image,
    privateLoadBalancer: ApplicationLoadBalancer,
    privateSubnets: Subnet[],
    securityGroups: SecurityGroup[]
) => {
    const service = new awsx.ecs.FargateService('privateApi', {
        cluster: cluster.arn,
        // assignPublicIp: false,
        networkConfiguration:{
            securityGroups:securityGroups.map(s=>s.id),
            subnets:privateSubnets.map(s=>s.id),
            assignPublicIp:false,
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
                    targetGroup: privateLoadBalancer.defaultTargetGroup,
                    containerPort: 5000,
                    hostPort: 5000
                }]
            },
        },
    });
    return service
}

