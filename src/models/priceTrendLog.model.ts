import mongoose, { Schema, Document } from 'mongoose';

export interface IPriceTrendLog extends Document {
    configId: string;
    userId: string;
    symbol: string;
    candleTimeframe: string;
    targetCandleDirection: string;
    currentPrice: number;
    candleHigh?: number;
    candleLow?: number;
    isTrendValid?: boolean;
    timestamp: Date;
}

const PriceTrendLogSchema: Schema = new Schema({
    configId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true },
    candleTimeframe: { type: String, required: false },
    targetCandleDirection: { type: String },
    currentPrice: { type: Number },
    candleHigh: { type: Number },
    candleLow: { type: Number },
    isTrendValid: { type: Boolean },
    timestamp: { type: Date, default: Date.now, index: true }
}, {
    capped: { size: 102400, max: 100 }
});

export const PriceTrendLog = mongoose.model<IPriceTrendLog>('PriceTrendLog', PriceTrendLogSchema);
