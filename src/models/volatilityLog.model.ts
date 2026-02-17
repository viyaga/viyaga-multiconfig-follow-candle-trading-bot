import mongoose, { Schema, Document } from 'mongoose';

export interface IVolatilityLog extends Document {
    configId: string;
    userId: string;
    symbol: string;
    targetCandleData: any;
    rangePercent?: number;
    bodyPercent?: number;
    minRangePercent?: number;
    minBodyPercent?: number;
    hasVolatility?: boolean;
    hasMomentum?: boolean;
    isTrue?: boolean;
    timestamp: Date;
}

const VolatilityLogSchema: Schema = new Schema({
    configId: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    symbol: { type: String, required: true },
    targetCandleData: { type: Schema.Types.Mixed },
    rangePercent: { type: Number },
    bodyPercent: { type: Number },
    minRangePercent: { type: Number },
    minBodyPercent: { type: Number },
    hasVolatility: { type: Boolean },
    hasMomentum: { type: Boolean },
    isTrue: { type: Boolean },
    timestamp: { type: Date, default: Date.now, index: true }
}, {
    capped: { size: 102400, max: 100 }
});

export const VolatilityLog = mongoose.model<IVolatilityLog>('VolatilityLog', VolatilityLogSchema);
