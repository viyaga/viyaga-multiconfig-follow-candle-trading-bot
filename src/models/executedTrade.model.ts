import mongoose, { Schema, Document } from 'mongoose';
import { IMartingaleState } from './martingaleState.model';

export interface IExecutedTrade extends Document {
    userId: string;
    tradingBotId: string;
    symbol: string;
    candleTimeframe: string;
    side: 'buy' | 'sell';
    quantity: number;
    entryPrice: number;
    slPrice: number;
    tpPrice: number;
    orderId?: string;
    slOrderId?: string;
    tpOrderId?: string;
    status: 'open' | 'closed' | 'cancelled';
    level: number;
    leverage: number;
    isSimulated: boolean;
    exitPrice?: number;
    exitTime?: Date;
    pnl?: number;
    martingaleState: IMartingaleState;
    marketDataSnapshot?: any;
    timestamp: Date;
}

const ExecutedTradeSchema: Schema = new Schema(
    {
        userId: { type: String, required: true, index: true },
        tradingBotId: { type: String, required: true, index: true },
        symbol: { type: String, required: true, index: true },
        candleTimeframe: { type: String, required: true },
        side: { type: String, enum: ['buy', 'sell'], required: true },
        quantity: { type: Number, required: true },
        entryPrice: { type: Number, required: true },
        slPrice: { type: Number, required: true },
        tpPrice: { type: Number, required: true },
        orderId: { type: String, index: true },
        slOrderId: { type: String },
        tpOrderId: { type: String },
        status: { type: String, enum: ['open', 'closed', 'cancelled'], default: 'open', index: true },
        level: { type: Number, required: true },
        leverage: { type: Number, required: true },
        isSimulated: { type: Boolean, default: false },
        exitPrice: { type: Number },
        exitTime: { type: Date },
        pnl: { type: Number },
        martingaleState: { type: Object, required: true },
        marketDataSnapshot: { type: Object },
        timestamp: { type: Date, default: Date.now, index: true }
    },
    {
        timestamps: true
    }
);

ExecutedTradeSchema.index({ updatedAt: 1 });

export const ExecutedTrade = mongoose.model<IExecutedTrade>('ExecutedTrade', ExecutedTradeSchema);
