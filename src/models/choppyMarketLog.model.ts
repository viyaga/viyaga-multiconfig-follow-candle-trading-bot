
import mongoose, { Schema, Document } from 'mongoose';
import { Candle } from '../services/tradingV2/type';

export interface IChoppyMarketLog extends Document {
    symbol: string;
    lookback: number;
    efficiencyRatio: number;
    totalMovement: number;
    netMovement: number;
    candles: Candle[];
    timestamp: Date;
}

const ChoppyMarketLogSchema: Schema = new Schema({
    symbol: { type: String, required: true, index: true },
    lookback: { type: Number, required: true },
    efficiencyRatio: { type: Number, required: true },
    totalMovement: { type: Number, required: true },
    netMovement: { type: Number, required: true },
    candles: { type: Array, required: true }, // Storing array of candle objects
    timestamp: { type: Date, default: Date.now, index: true }
});

export const ChoppyMarketLog = mongoose.model<IChoppyMarketLog>('ChoppyMarketLog', ChoppyMarketLogSchema);
