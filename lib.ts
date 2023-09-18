import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as docker from "@pulumi/docker";
import { Cluster, Service } from "@pulumi/aws/ecs";
import { ApplicationLoadBalancer } from "@pulumi/awsx/lb";
import { FargateService } from "@pulumi/awsx/ecs";

export const createDockerImage = (repoName: string): { image: docker.Image } => {
    const repo = new aws.ecr.Repository(repoName,{
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

export const buildService = (
    cluster: Cluster,
    image: docker.Image,
    loadbalancer: ApplicationLoadBalancer,
    port: number,
    serviceName: string
): FargateService => {
    const service = new awsx.ecs.FargateService(serviceName, {
        cluster: cluster.arn,
        assignPublicIp: true,
        taskDefinitionArgs: {
            runtimePlatform:{
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
                    containerPort:port,
                    hostPort:port
                }],
            },
        },
    });
    return service
}