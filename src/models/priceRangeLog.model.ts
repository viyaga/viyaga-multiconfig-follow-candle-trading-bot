import mongoose, { Schema, Document } from 'mongoose';

export interface IPriceRangeLog extends Document {
    configId: string;
    userId: string;
    symbol: string;
    targetCandleData: any;
    currentPrice: number;
    percentMove?: number;
    minPercent?: number;
    maxPercent?: number;
    isWithinRange?: boolean;
    timestamp: Date;
}

const PriceRangeLogSchema: Schema = new Schema({
    configId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true },
    targetCandleData: { type: Schema.Types.Mixed },
    currentPrice: { type: Number },
    percentMove: { type: Number },
    minPercent: { type: Number },
    maxPercent: { type: Number },
    isWithinRange: { type: Boolean },
    timestamp: { type: Date, default: Date.now, index: true }
}, {
    capped: { size: 102400, max: 100 }
});

export const PriceRangeLog = mongoose.model<IPriceRangeLog>('PriceRangeLog', PriceRangeLogSchema);
