
import mongoose, { Schema, Document } from 'mongoose';
import { Candle } from '../services/tradingV2/type';

export interface IChoppyMarketLog extends Document {
    configId: string;
    userId: string;
    symbol: string;
    lookback?: number;
    efficiencyRatio?: number;
    totalMovement?: number;
    netMovement?: number;
    candles?: Candle[];
    timestamp: Date;
}

const ChoppyMarketLogSchema: Schema = new Schema({
    configId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true, index: true },
    lookback: { type: Number, required: false },
    efficiencyRatio: { type: Number, required: false },
    totalMovement: { type: Number, required: false },
    netMovement: { type: Number, required: false },
    candles: { type: Array, required: false },
    timestamp: { type: Date, default: Date.now, index: true }
}, {
    capped: { size: 1024000, max: 100 }
});

export const ChoppyMarketLog = mongoose.model<IChoppyMarketLog>('ChoppyMarketLog', ChoppyMarketLogSchema);
