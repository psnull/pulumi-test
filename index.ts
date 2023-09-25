import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as lib from "./lib"
import { FargateService } from "@pulumi/awsx/ecs";

const apiImage = lib.createDockerImage('infra-api')
const webImage = lib.createDockerImage('infra-web')

const cluster = new aws.ecs.Cluster("cluster", {});
const apiLoadBalancer = new awsx.lb.ApplicationLoadBalancer("apiLoadBalancer", {
    defaultTargetGroup: {
        healthCheck: {
            path: '/WeatherForecast',
            port: '5000',
        },
        port: 5000
    }
});
const apiService: FargateService = lib.buildService(cluster, apiImage.image, apiLoadBalancer, 5000, 'apiService')
let apiAddress = apiLoadBalancer.loadBalancer.dnsName.apply(d=>`http://${d}/WeatherForecast`)

// new aws.apigateway.VpcLink("vpclink", {
//     targetArn: apiLoadBalancer.loadBalancer.arn
// })

const appLoadBalancer = new awsx.lb.ApplicationLoadBalancer("webLoadBalancer", {
    defaultTargetGroup: {
        healthCheck: {
            path: '/',
            port: '5000',
        },
        port: 5000
    }
});
const appService: FargateService = lib.buildService(cluster, webImage.image, appLoadBalancer, 5000, 'webService',[{
    name:'ApiAddress',
    value: apiAddress
}])
