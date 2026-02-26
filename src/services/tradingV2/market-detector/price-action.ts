import { Candle, TargetCandle } from "../type";

export function getBodyPercent(c: Candle): number {
    const range = c.high - c.low;
    return range === 0 ? 0 : (Math.abs(c.close - c.open) / range) * 100;
}

export function getBodyMovePercent(c: Candle): number {
    return (Math.abs(c.close - c.open) / c.open) * 100;
}

export function getRangePercent(candles: Candle[]): number {
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    return low === 0 ? 0 : ((high - low) / low) * 100;
}

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

        const smallBodies = slice.filter(c => getBodyPercent(c) < bodyMovementThreshold).length;

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

    const bodyPercent = getBodyPercent(targetCandle);
    const bodyMovePercent = getBodyMovePercent(targetCandle);

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
