// Express.js Mongoose Models for Trading Cron Job
import mongoose, { Schema, Document } from 'mongoose';

// MartingaleState Interface (matches Payload CMS structure)
export interface IMartingaleState {
    id: string;
    userId: string;
    symbol: string;
    productId: number;
    currentLevel: number;
    lastEntryOrderId?: string | null;
    lastEntryClientOrderId?: string | null;
    lastStopLossOrderId?: string | null;
    lastTakeProfitOrderId?: string | null;
    lastEntryPrice?: number | null;
    lastSlPrice?: number | null;
    lastTpPrice?: number | null;
    lastTradeQuantity?: number | null;
    lastTradeOutcome: 'win' | 'loss' | 'pending' | 'cancelled' | 'partialWin' | 'none';
    pnl: number;
    cumulativeFees: number;
    allTimePnl: number;
    allTimeFees: number;
    updatedAt: string;
    createdAt: string;
}

// MartingaleState Schema
const MartingaleStateSchema: Schema = new Schema(
    {
        userId: { type: String, required: true, index: true },
        symbol: { type: String, required: true, index: true },
        productId: { type: Number },
        currentLevel: { type: Number, required: true, default: 1 },
        lastTradeOutcome: {
            type: String,
            enum: ['win', 'loss', 'pending', 'cancelled', 'none', 'partialWin'],
            required: true,
            default: 'pending'
        },
        lastEntryOrderId: { type: String, default: null },
        lastStopLossOrderId: { type: String, default: null },
        lastTakeProfitOrderId: { type: String, default: null },
        lastEntryPrice: { type: Number, default: null },
        lastSlPrice: { type: Number, default: null },
        lastTpPrice: { type: Number, default: null },
        lastTradeQuantity: { type: Number, default: null },
        pnl: { type: Number, required: true, default: 0 },
        cumulativeFees: { type: Number, required: true, default: 0 },
        allTimePnl: { type: Number, required: true, default: 0 },
        allTimeFees: { type: Number, required: true, default: 0 },
    },
    {
        timestamps: true
    }
);

// Export the model with generic type parameter
export const MartingaleState = mongoose.model<IMartingaleState>(
    'MartingaleState',
    MartingaleStateSchema
);