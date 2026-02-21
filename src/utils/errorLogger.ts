import winston from 'winston';
import { getIstTime } from './timeUtils';

// Create a dedicated logger for errors
const errorLogger = winston.createLogger({
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
        // Console output for development
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: getIstTime }), // Added timestamp format here
                winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
                    let msg = `${timestamp} [${level}]: ${message}`;
                    if (stack) {
                        msg += `\n${stack}`;
                    }
                    if (Object.keys(meta).length > 0) {
                        msg += ` ${JSON.stringify(meta, null, 2)}`;
                    }
                    return msg;
                })
            ),
        }),
        // Dedicated file for all errors
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

export default errorLogger;
