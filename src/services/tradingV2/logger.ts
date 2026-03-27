import winston from "winston";
import { getIstTime } from "../../utils/timeUtils";

// Standard format for all loggers
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
            msg += ` ${JSON.stringify(meta, null, 2)}`;
        }
        return msg;
    })
);

const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: getIstTime }),
    winston.format.printf(({ timestamp, level, message, stack, service, ...meta }) => {
        const serviceTag = service ? `[${service}]` : '';
        let msg = `${timestamp} [${level.toUpperCase()}]: ${serviceTag} ${message}`;
        if (stack) msg += `\n${stack}`;
        if (Object.keys(meta).length > 0) msg += ` ${JSON.stringify(meta)}`;
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
export const martingaleTradeLogger = createLogger('martingale-trade', 'martingale-executed-trades.log', 'info', false);
export const skipTradingLogger = createLogger('skip-trading', 'skip-trading.log', 'info');
export const tradingCronLogger = createLogger('trading-cron', 'trading-cron.log', 'info');

/**
 * Contextual Logger Helper
 * Attaches common metadata to every log call for a specific trading cycle
 */
export const getContextualLogger = (logger: winston.Logger, context: { cycleId?: string, symbol?: string, configId?: string }) => {
    return {
        debug: (message: string, meta?: any) => logger.debug(message, { ...context, ...meta }),
        info: (message: string, meta?: any) => logger.info(message, { ...context, ...meta }),
        warn: (message: string, meta?: any) => logger.warn(message, { ...context, ...meta }),
        error: (message: string, meta?: any) => logger.error(message, { ...context, ...meta }),
    };
};

