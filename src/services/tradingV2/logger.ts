import winston from "winston";
import { getIstTime } from "../../utils/timeUtils";

// Logger for trade errors
export const tradingCycleErrorLogger = winston.createLogger({
    level: 'error',
    format: winston.format.combine(
        winston.format.timestamp({
            format: getIstTime
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'error-logger' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
                    let msg = `${timestamp} [${level}]: ${message}`;
                    if (stack) msg += `\n${stack}`;
                    if (Object.keys(meta).length > 0) msg += ` ${JSON.stringify(meta, null, 2)}`;
                    return msg;
                })
            ),
        }),
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true,
            format: winston.format.combine(
                winston.format.timestamp({ format: getIstTime }),
                winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
                    let msg = `${timestamp} [${level}]: ${message}`;
                    if (stack) msg += `\n${stack}`;
                    if (Object.keys(meta).length > 0) msg += ` ${JSON.stringify(meta)}`;
                    return msg;
                })
            )
        })
    ],
});

// Logger for executed trades and martingale state
export const martingaleTradeLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: getIstTime
        }),
        winston.format.json()
    ),
    defaultMeta: { service: 'martingale-trade-logger' },
    transports: [
        new winston.transports.File({
            filename: 'logs/martingale-executed-trades.log',
            level: 'info',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true,
            format: winston.format.combine(
                winston.format.timestamp({ format: getIstTime }),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length > 0 ? JSON.stringify(meta) : ''}`;
                })
            )
        })
    ],
});

// Logger for skip reasons
export const skipTradingLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: getIstTime }),
        winston.format.json()
    ),
    defaultMeta: { service: 'skip-trading-logger' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length > 0 ? JSON.stringify(meta) : ''}`;
                })
            ),
        }),
        new winston.transports.File({
            filename: 'logs/skip-trading.log',
            level: 'info',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true,
            format: winston.format.combine(
                winston.format.timestamp({ format: getIstTime }),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length > 0 ? JSON.stringify(meta) : ''}`;
                })
            )
        })
    ],
});

// Logger for trading cycle cron job
export const tradingCronLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: getIstTime }),
        winston.format.json()
    ),
    defaultMeta: { service: 'trading-cron-logger' },
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length > 0 ? JSON.stringify(meta, null, 2) : ''}`;
                })
            ),
        }),
        new winston.transports.File({
            filename: 'logs/trading-cron.log',
            level: 'info',
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            tailable: true,
            format: winston.format.combine(
                winston.format.timestamp({ format: getIstTime }),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length > 0 ? JSON.stringify(meta) : ''}`;
                })
            )
        })
    ],
});
