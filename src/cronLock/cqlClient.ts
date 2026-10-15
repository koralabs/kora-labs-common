import { Client, ExecutionProfile, policies, types } from 'cassandra-driver';
import type { CqlExecutor, CronLockTopology } from './cqlCronLock';

const SERIAL_PROFILE = 'cron-lock-serial';

/** SERIAL still needs both replicas; sharing its coordinator avoids competing Paxos leaders. */
export const createCqlExecutor = (topology: CronLockTopology): CqlExecutor & { shutdown(): Promise<void> } => {
    const client = new Client({
        contactPoints: topology.contactPoints,
        localDataCenter: topology.localDataCenter,
        socketOptions: { connectTimeout: 8000, readTimeout: 12000 },
        profiles: [new ExecutionProfile(SERIAL_PROFILE, {
            // The lock keyspace has one replica in each of these fixed DCs. Both callers must
            // submit to the same coordinator, whose per-partition CAS lock serializes proposals.
            // No remote-DC failover: SERIAL already requires the other replica to be available.
            loadBalancing: new policies.loadBalancing.DCAwareRoundRobinPolicy('kora-dc1')
        })]
    });
    return {
        shutdown: () => client.shutdown(),
        execute(query, params, options) {
            const serial = options?.serialConsistency === types.consistencies.serial || options?.consistency === types.consistencies.serial;
            return client.execute(query, params, serial ? { ...options, executionProfile: SERIAL_PROFILE } : options);
        }
    };
};
