import { CardanoNetwork } from '../types';

// AWS compute/metadata discovery was removed: the platform is self-hosted and the former
// EC2/ECS/Lambda probes would only reach an unreachable link-local metadata address.
export class Environment {
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

    public static async getPotentialApplicationName(): Promise<string | null> {
        if (process.env.APPLICATION_NAME) {
            return process.env.APPLICATION_NAME;
        }
        try {
            return process.cwd();
        }
        catch {
            return null;
        }
    }
}
