import winston from "winston";
import { getIstTime } from "../../utils/timeUtils";

// Standard format for all loggers
const serializeError = (err: any) => {
    if (err instanceof Error) {
        return {
            ...err,
            message: err.message,
            stack: err.stack
        };
    }
    return err;
};

const standardFormat = winston.format.combine(
    winston.format.timestamp({ format: getIstTime }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: getIstTime }),
    winston.format.printf(({ timestamp, level, message, stack, service, ...meta }) => {
        const serviceTag = service ? `[${service}]` : '';
        let msg = `${timestamp} ${level}: ${serviceTag} ${message}`;
        if (stack) msg += `\n${stack}`;
        if (Object.keys(meta).length > 0) {
            const sanitizedMeta = Object.fromEntries(
                Object.entries(meta).map(([k, v]) => [k, serializeError(v)])
            );
            msg += ` ${JSON.stringify(sanitizedMeta, null, 2)}`;
        }
        return msg;
    })
);

const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: getIstTime }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack, service, ...meta }) => {
        const serviceTag = service ? `[${service}]` : '';
        let msg = `${timestamp} [${level.toUpperCase()}]: ${serviceTag} ${message}`;
        if (stack) msg += `\n${stack}`;
        if (Object.keys(meta).length > 0) {
            const sanitizedMeta = Object.fromEntries(
                Object.entries(meta).map(([k, v]) => [k, serializeError(v)])
            );
            msg += ` ${JSON.stringify(sanitizedMeta)}`;
        }
        return msg;
    })
);

// Generic logger creator
const createLogger = (serviceName: string, fileName: string, level: string = 'info', useConsole: boolean = true) => {
    const transports: winston.transport[] = [
        new winston.transports.File({
            filename: `logs/${fileName}`,
            level,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true,
            format: fileFormat
        })
    ];

    if (useConsole) {
        transports.push(new winston.transports.Console({
            format: consoleFormat,
            level: 'debug' // Console shows everything up to debug by default
        }));
    }

    return winston.createLogger({
        level,
        format: standardFormat,
        defaultMeta: { service: serviceName },
        transports
    });
};

// Logger instances
export const tradingCycleErrorLogger = createLogger('trading-error', 'error.log', 'error');
export const marketDetectorLogger = createLogger('market-detector', 'market-detector.log', 'info', false);
export const skipTradingLogger = createLogger('skip-trading', 'skip-trading.log', 'info');
export const tradingCronLogger = createLogger('trading-cron', 'trading-cron.log', 'debug');
export const configDebugLogger = createLogger('config-debug', 'config-debug.log', 'debug');

/**
 * Contextual Logger Helper
 * Attaches common metadata to every log call for a specific trading cycle
 */
export const getContextualLogger = (logger: winston.Logger, context: { cycleId?: string, symbol?: string, tradingBotId?: string } = {}) => {
    const wrap = (fn: Function) => (message: string, meta?: any) => {
        if (meta instanceof Error) {
            return fn(message, { ...context, error: meta });
        }
        return fn(message, { ...context, ...meta });
    };

    return {
        debug: wrap(logger.debug.bind(logger)),
        info: wrap(logger.info.bind(logger)),
        warn: wrap(logger.warn.bind(logger)),
        error: wrap(logger.error.bind(logger)),
    };
};

