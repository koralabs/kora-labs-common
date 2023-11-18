import { LogCategory, Logger } from '.';

describe('Logger Tests', () => {
    it('should log', () => {
        const now = Date.now();
        const logSpy = jest.spyOn(console, 'log');
        Logger.log({
            message: 'burritos',
            category: LogCategory.ERROR,
            event: 'test.log',
            milliseconds: now,
            count: 1,
            dimensions: ['taco']
        });

        const call = logSpy.mock.calls[0][0];
        const obj = JSON.parse(call);
        expect(obj).toEqual({
            category: 'ERROR',
            application: 'TEST',
            count: 1,
            dimensions: ['taco'],
            event: 'test.log',
            message: 'burritos',
            network: "UNSET",
            milliseconds: now,
            timestamp: expect.stringMatching(/[0-9\-]+T[0-9\:\.]+Z/)
        });
    });
});
