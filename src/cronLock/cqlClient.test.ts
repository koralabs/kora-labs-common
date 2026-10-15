import { Client, types } from 'cassandra-driver';
import { createCqlExecutor } from './cqlClient';

const topology = {
    network: 'preview', nodeCode: 'rdm', mintNodes: ['sfo', 'rdm'],
    localDataCenter: 'kora-dc2', contactPoints: ['127.0.0.1']
};

afterEach(() => jest.restoreAllMocks());

// Invariant: the driver receives unchanged ownership/quorum queries, with shared routing only for SERIAL.
// Failure caught: an owner read routes locally and races the write, or solo operations route to the offline DC.
// Negative control: removing either SERIAL detection clause breaks its corresponding outgoing-contract assertion.
it.each([
    ['INSERT', { serialConsistency: types.consistencies.serial, consistency: types.consistencies.quorum }, 'cron-lock-serial'],
    ['SELECT', { consistency: types.consistencies.serial }, 'cron-lock-serial'],
    ['DELETE', { serialConsistency: types.consistencies.localSerial, consistency: types.consistencies.localQuorum }, undefined],
    ['SELECT table_name', { consistency: types.consistencies.localOne }, undefined]
])('preserves the %s network contract', async (query, options, executionProfile) => {
    const reply = { rows: [{ owner: 'rdm:invocation', '[applied]': true }] };
    const execute = jest.spyOn(Client.prototype, 'execute').mockResolvedValue(reply as never);
    const executor = createCqlExecutor(topology);
    try {
        expect(await executor.execute(query, ['preview:lock'], { ...options, prepare: true })).toEqual(reply);
        expect(execute).toHaveBeenCalledWith(query, ['preview:lock'], {
            ...options, prepare: true, ...(executionProfile ? { executionProfile } : {})
        });
    } finally {
        await executor.shutdown();
    }
});

// Invariant: routing never turns a database failure into ownership or an apparent successful release.
// Failure caught: an adapter catch/fallback hides a failed conditional write.
// Negative control: swallowing the rejection or substituting rows makes this test fail.
it('propagates the exact network failure instead of manufacturing ownership', async () => {
    const failure = new Error('SERIAL outcome unknown');
    jest.spyOn(Client.prototype, 'execute').mockRejectedValue(failure as never);
    const executor = createCqlExecutor(topology);
    try {
        await expect(executor.execute('DELETE IF owner = ?', ['rdm:token'], {
            serialConsistency: types.consistencies.serial, consistency: types.consistencies.quorum
        })).rejects.toBe(failure);
    } finally {
        await executor.shutdown();
    }
});

