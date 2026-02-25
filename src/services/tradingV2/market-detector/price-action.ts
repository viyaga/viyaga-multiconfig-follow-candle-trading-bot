import { Candle, TargetCandle } from "../type";

export function getBodyPercent(c: Candle): number {
    const range = c.high - c.low;
    return range === 0 ? 0 : (Math.abs(c.close - c.open) / range) * 100;
}

export function getRangePercent(candles: Candle[]): number {
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    return low === 0 ? 0 : ((high - low) / low) * 100;
}

// ✅ Fix #6: Accept atrAvg instead of atrPercent to avoid using current (shrinking) volatility
export function detectMicroChop(candles: Candle[], atrAvg: number, bodyThreshold: number): boolean {
    if (candles.length < 5) return false;

    const windows = [3, 4, 5];

    for (const size of windows) {
        const slice = candles.slice(-size);
        const high = Math.max(...slice.map(c => c.high));
        const low = Math.min(...slice.map(c => c.low));
        const close = slice[slice.length - 1].close;

        const rangePercent = close === 0 ? 0 : ((high - low) / close) * 100;

        const smallBodies = slice.filter(c => getBodyPercent(c) < bodyThreshold).length;

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
    bodyThreshold: number
): boolean {

    const range = targetCandle.high - targetCandle.low;
    if (range <= 0) return true;

    // ✅ Fix #2: Convert range to percent before comparing to atrPercent (fix dimension mismatch)
    const rangePercent = targetCandle.close === 0 ? 0 : (range / targetCandle.close) * 100;
    if (rangePercent < atrPercent * 0.8) return true;

    const bodyPercent = getBodyPercent(targetCandle);

    const upperWick =
        targetCandle.high - Math.max(targetCandle.open, targetCandle.close);

    const lowerWick =
        Math.min(targetCandle.open, targetCandle.close) - targetCandle.low;

    const closeNearHigh =
        targetCandle.close >= targetCandle.high - range * 0.25;

    const closeNearLow =
        targetCandle.close <= targetCandle.low + range * 0.25;

    // GREEN candle → Buy analysis
    if (targetCandle.color === "green") {

        const weakBody = bodyPercent < bodyThreshold;
        const badClose = !closeNearHigh;
        const heavyUpperWick = upperWick > range * 0.35;

        if (weakBody || badClose || heavyUpperWick) return true;
    }

    // RED candle → Sell analysis
    if (targetCandle.color === "red") {

        const weakBody = bodyPercent < bodyThreshold;
        const badClose = !closeNearLow;
        const heavyLowerWick = lowerWick > range * 0.35;

        if (weakBody || badClose || heavyLowerWick) return true;
    }

    return false;
}
