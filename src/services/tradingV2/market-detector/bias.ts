import { Candle } from "../type";
import { calculateADXSeries } from "./indicators";

export type TradeDirection = "LONG" | "SHORT";

export interface BiasResult {
    direction: "LONG" | "SHORT" | "NEUTRAL";
    strength: number; // 0–10
    adx: number;
    emaFast: number;
    emaSlow: number;
}

function calculateEMA(values: number[], period: number): number {
    const k = 2 / (period + 1);
    let ema = values[0];

    for (let i = 1; i < values.length; i++) {
        ema = values[i] * k + ema * (1 - k);
    }

    return ema;
}

export function getDirectionalBias(
    candles: Candle[],
    fastPeriod: number = 20,
    slowPeriod: number = 50,
    adxPeriod: number = 14
): BiasResult {

    if (candles.length < slowPeriod + 10) {
        return { direction: "NEUTRAL", strength: 0, adx: 0, emaFast: 0, emaSlow: 0 };
    }

    const closes = candles.map(c => c.close);

    const emaFast = calculateEMA(closes.slice(-fastPeriod - 50), fastPeriod);
    const emaSlow = calculateEMA(closes.slice(-slowPeriod - 50), slowPeriod);

    const adxSeries = calculateADXSeries(candles, adxPeriod);
    const adx = adxSeries.length ? adxSeries[adxSeries.length - 1] : 0;

    const price = closes[closes.length - 1];

    const emaBullish = emaFast > emaSlow;
    const emaBearish = emaFast < emaSlow;

    const priceAbove = price > emaFast && price > emaSlow;
    const priceBelow = price < emaFast && price < emaSlow;

    let direction: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
    let strength = 0;

    if (emaBullish && priceAbove) {
        direction = "LONG";
        strength += 5;
    }

    if (emaBearish && priceBelow) {
        direction = "SHORT";
        strength += 5;
    }

    if (adx > 20) strength += 3;
    if (adx > 30) strength += 2;

    strength = Math.min(10, strength);

    return {
        direction,
        strength,
        adx,
        emaFast,
        emaSlow
    };
}