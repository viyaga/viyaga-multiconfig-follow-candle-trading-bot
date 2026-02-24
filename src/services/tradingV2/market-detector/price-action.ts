import { Candle } from "../type";

export function getBodyPercent(c: Candle): number {
    const range = c.high - c.low;
    return range === 0 ? 0 : (Math.abs(c.close - c.open) / range) * 100;
}

export function getRangePercent(candles: Candle[]): number {
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    return low === 0 ? 0 : ((high - low) / low) * 100;
}

export function detectMicroChop(candles: Candle[], atrPercent: number, bodyThreshold: number): boolean {
    if (candles.length < 5) return false;

    const windows = [3, 4, 5];

    for (const size of windows) {
        const slice = candles.slice(-size);
        const high = Math.max(...slice.map(c => c.high));
        const low = Math.min(...slice.map(c => c.low));
        const close = slice[slice.length - 1].close;

        const rangePercent = close === 0 ? 0 : ((high - low) / close) * 100;

        const smallBodies = slice.filter(c => getBodyPercent(c) < bodyThreshold).length;

        const dynamicThreshold = atrPercent * 0.6;

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
