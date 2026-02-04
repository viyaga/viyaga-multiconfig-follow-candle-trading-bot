import winston from "winston";
import { IMartingaleState } from "../../models/martingaleState.model";

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

// Create a dedicated logger for Martingale state tracking
const martingaleLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'martingale-tracker' },
    transports: [
        // Console output for development
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    let msg = `${timestamp} [${level}]: ${message}`;
                    if (Object.keys(meta).length > 0) {
                        msg += ` ${JSON.stringify(meta, null, 2)}`;
                    }
                    return msg;
                })
            ),
        }),
        // Dedicated file for executed trades only
        new winston.transports.File({
            filename: 'logs/martingale-executed-trades.log',
            level: 'info',
            maxsize: 5242880, // 5MB
            maxFiles: 10,
            tailable: true,
            format: winston.format.combine(
                winston.format.timestamp({
                    format: 'YYYY-MM-DD HH:mm:ss'
                }),
                winston.format.printf(({ timestamp, message, ...meta }) => {
                    return JSON.stringify({ timestamp, message, ...meta });
                })
            )
        }),
    ],
});

/**
 * Log the executed trade with martingale state
 */
export function logExecutedTrade(
    symbol: string,
    state: IMartingaleState,
    tradeDetails: {
        entryOrderId?: string;
        stopLossOrderId?: string;
        takeProfitOrderId?: string;
        direction?: string;
        quantity?: number;
        entryPrice?: number;
        stopLossPrice?: number;
        takeProfitPrice?: number;
    }
) {
    martingaleLogger.info('TRADE_EXECUTED', {
        symbol,
        martingaleState: {
            currentLevel: state.currentLevel,
            lastTradeOutcome: state.lastTradeOutcome,
            lastTradeQuantity: state.lastTradeQuantity,
            pnl: state.pnl,
            cumulativeFees: state.cumulativeFees,
            allTimePnl: state.allTimePnl,
            allTimeFees: state.allTimeFees,
        },
        trade: {
            entryOrderId: tradeDetails.entryOrderId,
            stopLossOrderId: tradeDetails.stopLossOrderId,
            takeProfitOrderId: tradeDetails.takeProfitOrderId,
            direction: tradeDetails.direction,
            quantity: tradeDetails.quantity,
            entryPrice: tradeDetails.entryPrice,
            stopLossPrice: tradeDetails.stopLossPrice,
            takeProfitPrice: tradeDetails.takeProfitPrice,
        },
        timestamp: new Date().toISOString()
    });
}

// Create a dedicated logger for general trading cycle flow and timing
export const tradingCycleLogger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'trading-cycle-logger' },
    transports: [
        // Console output
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    let msg = `${timestamp} [${level}]: ${message}`;
                    if (Object.keys(meta).length > 0) {
                        msg += ` ${JSON.stringify(meta, null, 2)}`;
                    }
                    return msg;
                })
            ),
        }),
        // Dedicated file for trading cycle flow
        new winston.transports.File({
            filename: 'logs/trading-cycle.log',
            level: 'info',
            maxsize: 5242880, // 5MB
            maxFiles: 10,
            tailable: true
        }),
    ],
});

export default martingaleLogger;