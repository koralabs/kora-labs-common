import { IS_LOCAL } from '../constants';
import { Environment } from '../environment';
import { CardanoNetwork } from '../types';
// Fix from https://stackoverflow.com/questions/18391212/is-it-not-possible-to-stringify-an-error-using-json-stringify
if (!('toJSON' in Error.prototype))
    Object.defineProperty(Error.prototype, 'toJSON', {
        value: function () {
            const alt: any = {};

            Object.getOwnPropertyNames(this).forEach((key) => {
                alt[key] = this[key];
            }, this);

            return alt;
        },
        configurable: true,
        writable: true
    });

export enum LogCategory {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    METRIC = 'METRIC',
    WARN = 'WARN',
    ERROR = 'ERROR',
    FATAL = 'FATAL',
    NOTIFY = 'NOTIFY'
}

const ANSI_RESET = '\x1b[0m';
const ANSI_BLUE = '\x1b[34m';
const ANSI_GREEN = '\x1b[32m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_ORANGE = '\x1b[38;5;208m';
const ANSI_RED = '\x1b[31m';

const LOCAL_CATEGORY_COLORS: Partial<Record<LogCategory, string>> = {
    [LogCategory.INFO]: ANSI_GREEN,
    [LogCategory.WARN]: ANSI_YELLOW,
    [LogCategory.ERROR]: ANSI_ORANGE,
    [LogCategory.NOTIFY]: ANSI_RED
};

export class Logger {
    public static application: string;
    public static network: CardanoNetwork;
    private static isInitialized = false;
    private static isInitializing = false;

    private static getSynchronousApplicationNameFallback(): string {
        if (process.env.NODE_ENV === 'test') return 'TEST';
        return process.env.APPLICATION_NAME ?? process.env.AWS_LAMBDA_FUNCTION_NAME ?? process.env.ECS_CLUSTER ?? process.cwd();
    }

    private static setFallbackMetadata(): void {
        if (!Logger.application) {
            Logger.application = this.getSynchronousApplicationNameFallback();
        }
        if (!Logger.network) {
            Logger.network = Environment.getCardanoNetwork();
        }
    }

    public static async initialize(): Promise<void> {
        this.setFallbackMetadata();
        if (process.env.NODE_ENV !== 'test') {
            try {
                const potentialName = await Environment.getPotentialApplicationName();
                if (potentialName) {
                    Logger.application = potentialName;
                }
            } catch {
                // fall back to sync-derived application name
            }
        }
        this.network = Environment.getCardanoNetwork();

        Logger.isInitialized = true;
    }

    public static local(
        args:
            | {
                  message: string;
                  category?: LogCategory;
                  event?: string;
                  milliseconds?: number;
                  count?: number;
                  dimensions?: string[];
              }
            | string
    ): void {
        if (!IS_LOCAL) return;

        const localPrefix = this.colorize('[LOCAL]', ANSI_BLUE);
        if (typeof args === 'string') {
            this.log(`${localPrefix} ${args}`);
            return;
        }

        this.log({
            ...args,
            message: `${localPrefix} ${args.message}`
        });
    }

    public static log(
        args:
            | {
                  message: string;
                  category?: LogCategory;
                  event?: string;
                  milliseconds?: number;
                  count?: number;
                  dimensions?: string[];
              }
            | string
    ): void {
        this.setFallbackMetadata();
        if (!Logger.isInitialized && !Logger.isInitializing) {
            Logger.isInitializing = true;
            Logger.initialize()
                .catch(() => {})
                .finally(() => {
                    Logger.isInitializing = false;
                });
        }
        if (typeof args === 'string') {
            this.log_entry(LogCategory.INFO, args);
            return;
        }
        const { message, category, event, milliseconds, count, dimensions } = args;
        this.log_entry(category ?? LogCategory.INFO, message, event, milliseconds, count, dimensions);
    }

    private static log_entry(
        category: LogCategory,
        message: string,
        event?: string,
        milliseconds?: number,
        count?: number,
        dimensions?: string[]
    ): void {
        const now = new Date().toISOString();
        message = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); // escape double quotes and already escaped escapes
        const logCategory = category ?? LogCategory.INFO;
        const logCategoryColor = IS_LOCAL ? LOCAL_CATEGORY_COLORS[logCategory] : undefined;
        const displayCategory = logCategoryColor ? this.colorize(logCategory, logCategoryColor) : logCategory;
        const log_event = event ? `, "event": "${event}"` : '';
        const log_milliseconds =
            milliseconds != undefined && milliseconds != null ? `, "milliseconds": ${milliseconds}` : '';
        const log_count = count != undefined && count != null ? `, "count": ${count}` : '';
        const log_dimensions =
            dimensions && Object.keys(dimensions).length ? `, "dimensions": ${JSON.stringify(dimensions)}` : '';
        let logFunc = console.log;
        switch (category) {
            case LogCategory.DEBUG:
                logFunc = console.debug;
                break;
            case LogCategory.WARN:
                logFunc = console.warn;
                break;
            case LogCategory.ERROR:
            case LogCategory.FATAL:
            case LogCategory.NOTIFY:
                logFunc = console.error;
                break;
        }
        // PLEASE KEEP THIS ALL ON ONE LINE SO LOGS AREN'T BROKEN UP
        logFunc(`{"network": "${Logger.network}", "application": "${Logger.application}", "category": "${displayCategory}", "message": "${message}"${log_event}, "timestamp": "${now}"${log_milliseconds}${log_count}${log_dimensions} }`);
        // PLEASE KEEP THIS ALL ON ONE LINE SO LOGS AREN'T BROKEN UP
    }

    private static colorize(value: string, ansiColor: string): string {
        return `${ansiColor}${value}${ANSI_RESET}`;
    }
}
