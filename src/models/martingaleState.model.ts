import mongoose, { Schema, Document } from 'mongoose';

// MartingaleState Interface (matches Payload CMS structure)
export interface IMartingaleState {
    id: string;
    userId: string;
    tradingBotId: string;
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
    lastTradeSettledAt?: Date | null;
    updatedAt: Date;
    createdAt: Date;
}

// MartingaleState Schema
const MartingaleStateSchema: Schema = new Schema(
    {
        userId: { type: String, required: true, index: true },
        tradingBotId: { type: String, required: true, index: true, unique: true },
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
        lastEntryClientOrderId: { type: String, default: null },
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
        lastTradeSettledAt: { type: Date, default: null },
    },
    {
        timestamps: true
    }
);

MartingaleStateSchema.index({ updatedAt: 1 });

// Export the model with generic type parameter
export const MartingaleState = mongoose.model<IMartingaleState>(
    'MartingaleState',
    MartingaleStateSchema
);