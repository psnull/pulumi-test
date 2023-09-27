import * as aws from "@pulumi/aws";
import * as lib from "./lib"

const publicSubnets = lib.createPublicSubnets()
const publicSubnetToCreateNatGateway = publicSubnets[0].id
const natGateway = lib.createNatGateway(publicSubnetToCreateNatGateway)
const privateSubnets = lib.createPrivateSubnets(natGateway)


// Creating ECS cluster
const cluster = new aws.ecs.Cluster("cluster");

const externalSg = new aws.ec2.SecurityGroup('externalSg', {
    ingress: [{
        self: true,
        fromPort: 0,
        toPort: 65535,
        protocol: 'tcp',
        cidrBlocks:['0.0.0.0/0'],
    }],
    egress:[{
        fromPort:0,
        toPort:65535,
        protocol:'tcp',
        cidrBlocks:['0.0.0.0/0'],
        ipv6CidrBlocks:['::/0']
    }]
})
const internalSg = new aws.ec2.SecurityGroup('internalSg', {
    ingress: [{
        self: true,
        fromPort: 0,
        toPort: 65535,
        protocol: 'tcp',
        securityGroups:[externalSg.id]
    }],
    egress:[{
        fromPort:0,
        toPort:65535,
        protocol:'tcp',
        cidrBlocks:['0.0.0.0/0'],
        ipv6CidrBlocks:['::/0']
    }]
})

let privateLoadBalancer = lib.createPrivateLoadBalancer(privateSubnets, [internalSg])
let executionRole = new aws.iam.Role('executionRole', {
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
    ]
})
new aws.cloudwatch.LogGroup('privateApiLogGroup', {
    name: "privateApi"
})

const apiImage = lib.createDockerImage('infra-api')
const definition = apiImage.imageName.apply(s => {
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
const apiTaskDefinition = new aws.ecs.TaskDefinition("service", {
    family: "service",
    containerDefinitions: definition,
    networkMode: 'awsvpc',
    runtimePlatform: {
        cpuArchitecture: "ARM64"
    },
    cpu: '256',
    memory: '512',
    requiresCompatibilities: ['FARGATE'],
    executionRoleArn: executionRole.arn
});

const apiService = new aws.ecs.Service("apiService", {
    cluster: cluster.id,
    taskDefinition: apiTaskDefinition.arn,
    desiredCount: 1,
    launchType: 'FARGATE',
    networkConfiguration: {
        subnets: privateSubnets.map(s => s.id),
        assignPublicIp: false,
        securityGroups: [internalSg.id]
    },
    loadBalancers: [{
        targetGroupArn: privateLoadBalancer.defaultTargetGroup.arn,
        containerName: "apiService",
        containerPort: 5000,
    }],
});



lib.buildPublicService(
    cluster,
    lib.createDockerImage('infra-web'),
    lib.createPublicLoadbalancer([publicSubnet1, publicSubnet2], externalSg),
    [{
        name: 'ApiAddress',
        value: privateLoadBalancer.loadBalancer.dnsName.apply(d => `http://${d}/WeatherForecast`)
    }],
    externalSg,
    [publicSubnet1, publicSubnet2]
)
