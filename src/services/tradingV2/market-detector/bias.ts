import { Candle } from "../type";
import { calculateADXSeries } from "./indicators";
import { getBodyPercent } from "./price-action";

export type TradeDirection = "LONG" | "SHORT";

export interface BiasResult {
    direction: "LONG" | "SHORT" | "NEUTRAL";
    strength: number; // 0–10
    adx: number;
    emaFast: number;
    emaSlow: number;
    breakoutDetected: boolean;
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
    adxPeriod: number = 14,
    breakoutLookback: number = 20
): BiasResult {

    if (candles.length < slowPeriod + breakoutLookback) {
        return {
            direction: "NEUTRAL",
            strength: 0,
            adx: 0,
            emaFast: 0,
            emaSlow: 0,
            breakoutDetected: false
        };
    }

    const closes = candles.map(c => c.close);
    const last = candles[candles.length - 1];

    /* ================= EMA ================= */
    const emaFast = calculateEMA(closes.slice(-fastPeriod - 50), fastPeriod);
    const emaSlow = calculateEMA(closes.slice(-slowPeriod - 50), slowPeriod);

    const price = last.close;

    const emaBullish = emaFast > emaSlow;
    const emaBearish = emaFast < emaSlow;

    const priceAbove = price > emaFast && price > emaSlow;
    const priceBelow = price < emaFast && price < emaSlow;

    /* ================= ADX ================= */
    const adxSeries = calculateADXSeries(candles, adxPeriod);
    const adx = adxSeries.length ? adxSeries[adxSeries.length - 1] : 0;

    /* ================= BREAKOUT DETECTION ================= */
    const recent = candles.slice(-breakoutLookback);

    const prevHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
    const prevLow = Math.min(...recent.slice(0, -1).map(c => c.low));

    const isBreakoutUp = last.close > prevHigh;
    const isBreakoutDown = last.close < prevLow;

    const strongBody = getBodyPercent(last) > 60;

    const avgVolume =
        recent.slice(0, -1).reduce((a, b) => a + b.volume, 0) /
        (breakoutLookback - 1);

    const volumeExpansion = last.volume > avgVolume * 1.3;

    const breakoutDetected =
        (isBreakoutUp || isBreakoutDown) &&
        strongBody &&
        volumeExpansion &&
        adx > 18; // minimum baseline

    /* ================= DIRECTION LOGIC ================= */

    let direction: "LONG" | "SHORT" | "NEUTRAL" = "NEUTRAL";
    let strength = 0;

    // 🔥 BREAKOUT OVERRIDE (FIRST PRIORITY)
    if (breakoutDetected) {

        direction = isBreakoutUp ? "LONG" : "SHORT";
        strength = 8; // strong initial confidence

        if (adx > 25) strength += 1;
        if (adx > 30) strength += 1;

        return {
            direction,
            strength: Math.min(10, strength),
            adx,
            emaFast,
            emaSlow,
            breakoutDetected: true
        };
    }

    // 📈 NORMAL TREND MODE
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
        emaSlow,
        breakoutDetected: false
    };
}