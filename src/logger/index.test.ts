const resetLoggerModule = async (isLocal: boolean) => {
    jest.resetModules();
    process.env.IS_LOCAL = isLocal ? 'true' : 'false';

    const loggerModule = await import('./index');
    loggerModule.Logger.application = '' as any;
    loggerModule.Logger.network = undefined as any;
    (loggerModule.Logger as any).isInitialized = false;
    (loggerModule.Logger as any).isInitializing = false;
    return loggerModule;
};

describe('Logger', () => {
    const originalIsLocal = process.env.IS_LOCAL;
    const originalApplicationName = process.env.APPLICATION_NAME;

    afterEach(() => {
        if (originalIsLocal == undefined) delete process.env.IS_LOCAL;
        else process.env.IS_LOCAL = originalIsLocal;

        if (originalApplicationName == undefined) delete process.env.APPLICATION_NAME;
        else process.env.APPLICATION_NAME = originalApplicationName;

        jest.restoreAllMocks();
        jest.resetModules();
    });

    it('prefixes Logger.local message with blue [LOCAL] when IS_LOCAL is true', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const { Logger } = await resetLoggerModule(true);

        Logger.local('hello');

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"message": "\x1b[34m[LOCAL]\x1b[0m hello"'));
    });

    it('colors local categories for INFO/WARN/ERROR/NOTIFY', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { Logger, LogCategory } = await resetLoggerModule(true);

        Logger.log({ message: 'info', category: LogCategory.INFO });
        Logger.log({ message: 'warn', category: LogCategory.WARN });
        Logger.log({ message: 'error', category: LogCategory.ERROR });
        Logger.log({ message: 'notify', category: LogCategory.NOTIFY });

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"category": "\x1b[32mINFO\x1b[0m"'));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"category": "\x1b[33mWARN\x1b[0m"'));
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"category": "\x1b[38;5;208mERROR\x1b[0m"'));
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"category": "\x1b[31mNOTIFY\x1b[0m"'));
    });

    it('does not log Logger.local when IS_LOCAL is false', async () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { Logger, LogCategory } = await resetLoggerModule(false);

        Logger.local('nope');
        Logger.log({ message: 'warn', category: LogCategory.WARN });

        expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('[LOCAL]'));
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"category": "WARN"'));
    });

    it('never logs application as undefined while async initialize is still resolving', async () => {
        process.env.APPLICATION_NAME = '';
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const loggerModule = await resetLoggerModule(false);
        const { Environment } = await import('../environment');
        const pendingPromise = new Promise<string | null>(() => {});
        jest.spyOn(Environment, 'getPotentialApplicationName').mockReturnValue(pendingPromise);

        loggerModule.Logger.log('race');

        const [entry] = logSpy.mock.calls[0];
        expect(`${entry}`).toContain('"application": "');
        expect(`${entry}`).not.toContain('"application": "undefined"');
    });
});
