import * as aws from "@pulumi/aws";
import * as lib from "./lib"

const publicSubnets = lib.buildPublicSubnets()
const publicSubnetTobuildNatGateway = publicSubnets[0].id
const natGateway = lib.buildNatGateway(publicSubnetTobuildNatGateway)
// Use NAT gateway to build privat subnets
const privateSubnets = lib.buildPrivateSubnets(natGateway)

const cluster = new aws.ecs.Cluster("cluster");
const externalSecurityGroup = lib.externalSecurityGroup()
// build internal security group, grant access to external SG.
const internalSecurityGroup = lib.internalSecurityGroup(externalSecurityGroup)

const internalLoadBalancer = lib.buildInternalLoadBalancer(privateSubnets, [internalSecurityGroup])

const internalWebService = lib.buildInternalWebService(
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
    lib.buildDockerImage('infra-web'),
    lib.buildPublicLoadbalancer(publicSubnets, externalSecurityGroup),
    externalWebServiceContainerEnvironmentVariables,
    externalSecurityGroup,
    publicSubnets
)
