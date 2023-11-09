import { CardanoNetwork } from "../logger";

export enum ComputeEnvironment {
    AWS_LAMBDA = 'aws_lambda',
    AWS_FARGATE = 'aws_fargate',
    AWS_EC2 = 'aws_ec2',
    AWS_OTHER = 'aws_other',
    OTHER = 'other'
}

export class Environment {
    public static async getComputeEnvironment(): Promise<ComputeEnvironment> {
        if (process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV) {
            return ComputeEnvironment.AWS_LAMBDA;
        }
        if (process.env.ECS_CLUSTER) {
            return ComputeEnvironment.AWS_FARGATE;
        }
        if (await Environment.getEc2InstanceName()){
            return ComputeEnvironment.AWS_EC2;
        }
        if (process.env.AWS_DEFAULT_REGION || process.env.AWS_REGION){
            return ComputeEnvironment.AWS_OTHER;
        }
        return ComputeEnvironment.OTHER;
    }

    public static getCardanoNetwork(): CardanoNetwork {
        try {
            if (process.env.NETWORK) {
                return CardanoNetwork[process.env.NETWORK.toUpperCase() as keyof typeof CardanoNetwork]
            }
            else {
                return CardanoNetwork.UNSET
            }
        }
        catch {
            return CardanoNetwork.UNSET
        }

    }

    public static async getIpAddress(): Promise<{private:string|null, public:string|null}|null> {
        let prv:string | undefined
        let pub:string | undefined;
        if (await Environment.getComputeEnvironment() == ComputeEnvironment.AWS_EC2){
            try {
                const response = await fetch('http://169.254.169.254/latest/meta-data/local-ipv4');
                prv = await response.text();
            }
            catch{
            }
            try {
                const response = await fetch('http://169.254.169.254/latest/meta-data/public-ipv4');
                pub = await response.text();
            }
            catch{
            }
            if (prv || pub){
                return {private: prv ?? null, public: pub ?? null}
            }
        }
        if (await Environment.getComputeEnvironment() == ComputeEnvironment.AWS_EC2){
            const metadata = await Environment.getEcsTaskMetaData();
            return {private: metadata?.Networks[0]?.IPv4Addresses[0] ?? null, public: null}
        }
        return null;
    }

    public static async getEc2InstanceName(): Promise<string|null> {
        try {
            
            const response = await fetch('http://169.254.169.254/latest/meta-data/tags/instance/Name');
            return response.text();
        }
        catch(err){
        }
        try {
            const response = await fetch('http://169.254.169.254/latest/meta-data/instance-id');
            return response.text();
        }
        catch(err){
        }
        return null;

    }

    public static async getEcsTaskMetaData(): Promise<{Networks:[{IPv4Addresses:[string]}]}|null> {
        try {
            const response = await fetch('http://169.254.170.2/v2/metadata');
            return await response.json();
        }
        catch(err){
            return null;
        }
        
    }

    public static async getPotentialApplicationName(): Promise<string|null> {
        if (process.env.APPLICATION_NAME){
            return process.env.APPLICATION_NAME;
        }
        if (await Environment.getComputeEnvironment() == ComputeEnvironment.AWS_LAMBDA){
            return process.env.AWS_LAMBDA_FUNCTION_NAME ?? null
        }
        if (await Environment.getComputeEnvironment() == ComputeEnvironment.AWS_FARGATE){
            return process.env.ECS_CLUSTER ?? null
        }
        if (await Environment.getComputeEnvironment() == ComputeEnvironment.AWS_EC2){
            const ec2_name = await Environment.getEc2InstanceName();
            if (ec2_name){
                return ec2_name;
            }
        }
        try {
            return process.cwd();
        }
        catch {
            return null;
        }

    }
}
