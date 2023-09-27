import * as aws from "@pulumi/aws";
import * as lib from "./lib"

const publicSubnets = lib.createPublicSubnets()
const publicSubnetToCreateNatGateway = publicSubnets[0].id
const natGateway = lib.createNatGateway(publicSubnetToCreateNatGateway)
// Use NAT gateway to create privat subnets
const privateSubnets = lib.createPrivateSubnets(natGateway)

const cluster = new aws.ecs.Cluster("cluster");
const externalSecurityGroup = lib.externalSecurityGroup()
// Create internal security group, grant access to external SG.
const internalSecurityGroup = lib.internalSecurityGroup(externalSecurityGroup)

const internalLoadBalancer = lib.createInternalLoadBalancer(privateSubnets, [internalSecurityGroup])

const internalWebService = lib.buildInternalService(
    cluster,
    privateSubnets,
    internalLoadBalancer,
    internalSecurityGroup,
)

const externalWebServiceContainerEnvironmentVariables = [{
    name: 'ApiAddress',
    value: internalLoadBalancer.loadBalancer.dnsName.apply(d => `http://${d}/WeatherForecast`)
}]
const externalWebService = lib.buildExternalWebService(
    cluster,
    lib.createDockerImage('infra-web'),
    lib.createPublicLoadbalancer(publicSubnets, externalSecurityGroup),
    externalWebServiceContainerEnvironmentVariables,
    externalSecurityGroup,
    publicSubnets
)
