import mongoose, { Schema, Document } from 'mongoose';
import { IMartingaleState } from './martingaleState.model';

export interface IExecutedTrade extends Document {
    symbol: string;
    candleTimeframe: string;
    side: 'buy' | 'sell';
    quantity: number;
    entryPrice: number;
    slPrice: number;
    tpPrice: number;
    martingaleState: IMartingaleState;
    timestamp: Date;
}

const ExecutedTradeSchema: Schema = new Schema(
    {
        symbol: { type: String, required: true, index: true },
        candleTimeframe: { type: String, required: true },
        side: { type: String, enum: ['buy', 'sell'], required: true },
        quantity: { type: Number, required: true },
        entryPrice: { type: Number, required: true },
        slPrice: { type: Number, required: true },
        tpPrice: { type: Number, required: true },
        martingaleState: { type: Object, required: true },
        timestamp: { type: Date, default: Date.now, index: true }
    },
    {
        timestamps: true
    }
);

export const ExecutedTrade = mongoose.model<IExecutedTrade>('ExecutedTrade', ExecutedTradeSchema);
