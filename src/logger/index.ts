import { Environment } from "../environment";
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

export class Logger {
    public static application:string;
    private static isInitialized = false;

    public static async initialize(): Promise<void> {
        if (!Logger.application) {
            const potentialName = await Environment.getPotentialApplicationName();
            if (!potentialName){
                throw new Error("Logger.application must be set!");
            }
            Logger.application = potentialName;
        }
        Logger.isInitialized = true;
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
        if (!Logger.isInitialized) Logger.initialize();
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
        const log_event = event ? `, "event": "${event}"` : '';
        const log_milliseconds =
            milliseconds != undefined && milliseconds != null ? `, "milliseconds": ${milliseconds}` : '';
        const log_count = count != undefined && count != null ? `, "count": ${count}` : '';
        const log_dimensions =
            dimensions && Object.keys(dimensions).length ? `, "dimensions": ${JSON.stringify(dimensions)}` : '';
        console.log(
            `{"application": "${Logger.application}", "category": "${category ?? LogCategory.INFO}", "message": "${message}"${log_event}, "timestamp": "${now}"${log_milliseconds}${log_count}${log_dimensions} }`
        );
    }
}
