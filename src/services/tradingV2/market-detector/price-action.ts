import { Candle, TargetCandle } from "../type";
import { Utils } from "../utils";

// ✅ Fix #6: Accept atrAvg instead of atrPercent to avoid using current (shrinking) volatility
export function detectMicroChop(candles: Candle[], atrAvg: number, bodyMovementThreshold: number): boolean {
    if (candles.length < 5) return false;

    const windows = [3, 4, 5];

    for (const size of windows) {
        const slice = candles.slice(-size);
        const high = Math.max(...slice.map(c => c.high));
        const low = Math.min(...slice.map(c => c.low));
        const close = slice[slice.length - 1].close;

        const rangePercent = close === 0 ? 0 : ((high - low) / close) * 100;

        const smallBodies = slice.filter(c => Utils.getBodyPercent(c) < bodyMovementThreshold).length;

        // ✅ Fix #6: Use average volatility, not current shrinking volatility
        const dynamicThreshold = atrAvg * 0.6;

        const sliceWithoutLast = slice.slice(0, -1);
        const prevHighs = sliceWithoutLast.map(c => c.high);
        const prevLows = sliceWithoutLast.map(c => c.low);

        const noBreak =
            slice[slice.length - 1].high <= Math.max(...prevHighs) &&
            slice[slice.length - 1].low >= Math.min(...prevLows);

        if (rangePercent < dynamicThreshold && smallBodies >= size - 1 && noBreak) {
            return true;
        }
    }

    return false;
}

export function isVolumeContracting(candles: Candle[]): boolean {
    if (candles.length < 25) return false;

    const last20 = candles.slice(-20);
    const last5 = candles.slice(-5);

    const avg20 = last20.reduce((a, b) => a + b.volume, 0) / 20;
    const avg5 = last5.reduce((a, b) => a + b.volume, 0) / 5;

    return avg5 < avg20 * 0.7;
}

export function isTargetCandleNotGood(
    targetCandle: TargetCandle,
    atrPercent: number,
    bodyMovementThreshold: number
): boolean {

    const { open, high, low, close, color } = targetCandle;

    const range = high - low;
    if (range <= 0) return true;

    // Normalize range vs ATR (dimension-safe)
    const rangePercent = close === 0 ? 0 : (range / close) * 100;

    const bodyPercent = Utils.getBodyPercent(targetCandle);
    const bodyMovePercent = Utils.getBodyMovePercent(targetCandle);

    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;

    const closeNearHigh = close >= high - range * 0.25;
    const closeNearLow = close <= low + range * 0.25;

    let penalty = 0;

    // 🔹 1. Range vs ATR (Very Important)
    if (rangePercent < atrPercent * 0.8) penalty += 2;

    // 🔹 2. Weak body (Medium importance)
    if (bodyPercent < 30) penalty += 1;

    // 🔹 3. Weak actual movement (avoid double heavy weight)
    if (bodyMovePercent < bodyMovementThreshold) penalty += 3;

    // 🔹 4. Close location (Important)
    if (color === "green" && !closeNearHigh) penalty += 1;
    if (color === "red" && !closeNearLow) penalty += 1;

    // 🔹 5. Heavy rejection wick (Absorption detection)
    const heavyUpperWick = upperWick > range * 0.4;
    const heavyLowerWick = lowerWick > range * 0.4;

    if (color === "green" && heavyUpperWick) penalty += 1;
    if (color === "red" && heavyLowerWick) penalty += 1;

    // 🔥 Final Decision
    // Reject only if multiple weaknesses cluster together
    return penalty >= 3;
}

export function isRangeCompressed(
    candles: Candle[],
    minWindow: number = 3,
    maxWindow: number = 15,
    maxRangePercent: number = 2
): boolean {

    if (candles.length < maxWindow) return false;

    const recent = candles.slice(-maxWindow);

    // 🔹 Detect breakout inside recent window
    const last = recent[recent.length - 1];

    const isBreakoutUp = last.close > Math.max(...recent.slice(0, -1).map(c => c.high));
    const isBreakoutDown = last.close < Math.min(...recent.slice(0, -1).map(c => c.low));

    const bodyPercent = Utils.getBodyPercent(last);
    const strongBody = bodyPercent > 60;

    const breakoutDetected = (isBreakoutUp || isBreakoutDown) && strongBody;

    // 🔥 If breakout happened → DO NOT treat as compression
    if (breakoutDetected) return false;

    // 🔹 Now check compression windows
    for (let size = minWindow; size <= maxWindow; size++) {

        const slice = candles.slice(-size);
        const high = Math.max(...slice.map(c => c.high));
        const low = Math.min(...slice.map(c => c.low));
        const close = slice[slice.length - 1].close;

        if (close === 0) continue;

        const rangePercent = ((high - low) / close) * 100;

        // Scale max range by the square root of time (window size) to accurately detect 
        // true compression across different candle lengths without blocking normal trends.
        // e.g. maxWindow=15, maxRange=3% -> size 3 = 1.34% range limit
        const timeScale = Math.sqrt(size / maxWindow);
        const dynamicMaxRange = maxRangePercent * timeScale;

        if (rangePercent <= dynamicMaxRange) {
            return true; // compressed AND no breakout
        }
    }

    return false;
}

/**
 * Score recent volume expansion strength (chop-reduction points).
 *
 * Points breakdown (max 3):
 *  +1  shortAvg / longAvg > 1.2  (mild expansion)
 *  +1  shortAvg / longAvg > 1.5  (strong expansion)
 *  +1  last candle volume > shortAvg  (latest candle confirms surge)
 *
 * Caller should subtract these points from chopPoints to reward volume expansion.
 */
export function getVolumeExpansionPoints(
    candles: Candle[],
    shortWindow: number = 5,
    longWindow: number = 20
): number {

    if (candles.length < longWindow + 1) return 0;

    const last = candles[candles.length - 1];

    const shortAvg =
        candles.slice(-shortWindow).reduce((a, b) => a + b.volume, 0) /
        shortWindow;

    const longAvg =
        candles.slice(-longWindow).reduce((a, b) => a + b.volume, 0) /
        longWindow;

    if (longAvg === 0) return 0;

    const expansionRatio = shortAvg / longAvg;

    let points = 0;

    if (expansionRatio > 1.2) points += 1; // mild expansion
    if (expansionRatio > 1.5) points += 1; // strong expansion
    if (last.volume > shortAvg) points += 1; // latest candle confirms surge

    return points; // 0–3
}

/**
 * Score only the target candle's volume spike (chop-reduction points).
 *
 * Points breakdown (max 2):
 *  +1  target candle volume > avg20 * 1.3  (above-average spike)
 *  +1  target candle volume > avg20 * 2.0  (extreme spike)
 *
 * A candle with high volume shows conviction; reduce chopPoints accordingly.
 */
export function getTargetCandleVolumeSpike(
    targetCandle: TargetCandle,
    candles: Candle[],
    lookback: number = 20
): number {

    if (candles.length < lookback) return 0;

    const avgVol =
        candles.slice(-lookback).reduce((a, b) => a + b.volume, 0) / lookback;

    if (avgVol === 0) return 0;

    const spikeRatio = targetCandle.volume / avgVol;

    let points = 0;

    if (spikeRatio > 1.3) points += 1; // above-average — decent conviction
    if (spikeRatio > 2.0) points += 1; // extreme spike  — strong conviction

    return points; // 0–2
}