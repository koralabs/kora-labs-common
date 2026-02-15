const resetLoggerModule = (isLocal: boolean) => {
    jest.resetModules();
    process.env.IS_LOCAL = isLocal ? 'true' : 'false';
    const loggerModule = require('./index') as typeof import('./index');
    loggerModule.Logger.application = 'TEST';
    loggerModule.Logger.network = 'mainnet' as any;
    (loggerModule.Logger as any).isInitialized = true;
    return loggerModule;
};

describe('Logger', () => {
    const originalIsLocal = process.env.IS_LOCAL;

    afterEach(() => {
        if (originalIsLocal == undefined) delete process.env.IS_LOCAL;
        else process.env.IS_LOCAL = originalIsLocal;
        jest.restoreAllMocks();
        jest.resetModules();
    });

    it('prefixes Logger.local message with blue [LOCAL] when IS_LOCAL is true', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const { Logger } = resetLoggerModule(true);

        Logger.local('hello');

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"message": "\x1b[34m[LOCAL]\x1b[0m hello"'));
    });

    it('colors local categories for INFO/WARN/ERROR/NOTIFY', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { Logger, LogCategory } = resetLoggerModule(true);

        Logger.log({ message: 'info', category: LogCategory.INFO });
        Logger.log({ message: 'warn', category: LogCategory.WARN });
        Logger.log({ message: 'error', category: LogCategory.ERROR });
        Logger.log({ message: 'notify', category: LogCategory.NOTIFY });

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"category": "\x1b[32mINFO\x1b[0m"'));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"category": "\x1b[33mWARN\x1b[0m"'));
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"category": "\x1b[38;5;208mERROR\x1b[0m"'));
        expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"category": "\x1b[31mNOTIFY\x1b[0m"'));
    });

    it('does not log Logger.local when IS_LOCAL is false', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const { Logger, LogCategory } = resetLoggerModule(false);

        Logger.local('nope');
        Logger.log({ message: 'warn', category: LogCategory.WARN });

        expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('[LOCAL]'));
        expect(errorSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"category": "WARN"'));
    });
});
