import winston from "winston";

// Logger for trade errors
export const tradingCycleErrorLogger = winston.createLogger({
    level: 'error',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
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
            tailable: true
        })
    ],
});

// Logger for executed trades and martingale state
export const martingaleTradeLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
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
            tailable: true
        })
    ],
});

// Helper for IST Timestamp
const istTime = () => {
    return new Date().toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
};

// Logger for skip reasons
export const skipTradingLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: istTime }),
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
            tailable: true
        })
    ],
});
