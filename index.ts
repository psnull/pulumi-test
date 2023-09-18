import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as lib from "./lib"
import { FargateService } from "@pulumi/awsx/ecs";

const apiImage = lib.createDockerImage('infra-api')
const webImage = lib.createDockerImage('infra-web')

const cluster = new aws.ecs.Cluster("cluster", {});
const apiLoadBalancer = new awsx.lb.ApplicationLoadBalancer("loadbalancer", {
    defaultTargetGroup: {
        healthCheck: {
            path: '/WeatherForecast',
            port: '5000',
        },
        port: 5000
    }
});
const apiService: FargateService = lib.buildService(cluster, apiImage.image, apiLoadBalancer, 5000)
// const tg = new aws.lb.TargetGroup('tg',{
//     healthCheck: {
//         path: '/WeatherForecast',
//         port: '3000',
//     },
//     port: 3000
// })

// const appLoadBalancer = new awsx.lb.ApplicationLoadBalancer("loadbalancer", {
//     defaultTargetGroup: {
//         healthCheck: {
//             path: '/',
//             port: '3000',
//         },
//         port: 3000
//     }
// });
// const appService: FargateService = lib.buildService(cluster, apiImage.image, appLoadBalancer, 3000)

// Create a load balancer to listen for requests and route them to the container.
//const loadbalancer = new awsx.lb.ApplicationLoadBalancer("loadbalancer", {});