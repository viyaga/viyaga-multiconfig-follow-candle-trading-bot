import { Candle, TargetCandle } from "../type";
import { Utils } from "../utils";

export function detectMicroChop(
    candles: Candle[],
    atrAvg: number,
    bodyMovementThreshold: number,
    minSmallBodies: number
): boolean {

    if (candles.length < 5) return false;

    const windows = [3, 4, 5];

    for (const size of windows) {

        const slice = candles.slice(-size);

        const high = Math.max(...slice.map(c => c.high));
        const low = Math.min(...slice.map(c => c.low));
        const close = slice[slice.length - 1].close;

        const rangePercent =
            close === 0 ? 0 :
                ((high - low) / close) * 100;

        const smallBodies =
            slice.filter(
                c => Utils.getBodyPercent(c) < bodyMovementThreshold
            ).length;

        const dynamicThreshold = atrAvg * 0.6;

        const sliceWithoutLast = slice.slice(0, -1);

        const prevHighs = sliceWithoutLast.map(c => c.high);
        const prevLows = sliceWithoutLast.map(c => c.low);

        const noBreak =
            slice[slice.length - 1].high <= Math.max(...prevHighs) &&
            slice[slice.length - 1].low >= Math.min(...prevLows);

        if (
            rangePercent < dynamicThreshold &&
            smallBodies >= minSmallBodies &&
            noBreak
        ) {
            return true;
        }
    }

    return false;
}

export function isVolumeContracting(candles: Candle[]): boolean {

    if (candles.length < 25) return false;

    const last20 = candles.slice(-20);
    const last5 = candles.slice(-5);

    const avg20 =
        last20.reduce((a, b) => a + b.volume, 0) / 20;

    const avg5 =
        last5.reduce((a, b) => a + b.volume, 0) / 5;

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

    const rangePercent =
        close === 0 ? 0 :
            (range / close) * 100;

    const bodyPercent = Utils.getBodyPercent(targetCandle);
    const bodyMovePercent = Utils.getBodyMovePercent(targetCandle);

    const upperWick = high - Math.max(open, close);
    const lowerWick = Math.min(open, close) - low;

    const closeNearHigh = close >= high - range * 0.25;
    const closeNearLow = close <= low + range * 0.25;

    let penalty = 0;

    if (rangePercent < atrPercent * 0.8) penalty += 2;

    if (bodyPercent < 30) penalty += 1;

    if (bodyMovePercent < bodyMovementThreshold) penalty += 3;

    if (color === "green" && !closeNearHigh) penalty += 1;
    if (color === "red" && !closeNearLow) penalty += 1;

    const heavyUpperWick = upperWick > range * 0.4;
    const heavyLowerWick = lowerWick > range * 0.4;

    if (color === "green" && heavyUpperWick) penalty += 1;
    if (color === "red" && heavyLowerWick) penalty += 1;

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

    const last = recent[recent.length - 1];

    const isBreakoutUp =
        last.close > Math.max(...recent.slice(0, -1).map(c => c.high));

    const isBreakoutDown =
        last.close < Math.min(...recent.slice(0, -1).map(c => c.low));

    const bodyPercent = Utils.getBodyPercent(last);
    const strongBody = bodyPercent > 60;

    const breakoutDetected =
        (isBreakoutUp || isBreakoutDown) && strongBody;

    if (breakoutDetected) return false;

    for (let size = minWindow; size <= maxWindow; size++) {

        const slice = candles.slice(-size);

        const high = Math.max(...slice.map(c => c.high));
        const low = Math.min(...slice.map(c => c.low));
        const close = slice[slice.length - 1].close;

        if (close === 0) continue;

        const rangePercent =
            ((high - low) / close) * 100;

        const timeScale = Math.sqrt(size / maxWindow);

        const dynamicMaxRange =
            maxRangePercent * timeScale;

        if (rangePercent <= dynamicMaxRange) {
            return true;
        }
    }

    return false;
}

/**
 * 🔥 Liquidity Sweep Detector
 * Detects stop-hunt sweeps before real breakouts
 */
export function detectLiquiditySweep(
    candles: Candle[],
    lookback: number = 10
): boolean {

    if (candles.length < lookback + 2) return false;

    const last = candles[candles.length - 1];

    const prev = candles.slice(-lookback - 1, -1);

    const prevHigh =
        Math.max(...prev.map(c => c.high));

    const prevLow =
        Math.min(...prev.map(c => c.low));

    const sweepHigh = last.high > prevHigh;
    const sweepLow = last.low < prevLow;

    const bodyPercent =
        Utils.getBodyPercent(last);

    const strongCloseUp =
        last.close > prevHigh && bodyPercent > 55;

    const strongCloseDown =
        last.close < prevLow && bodyPercent > 55;

    return (
        (sweepHigh && strongCloseUp) ||
        (sweepLow && strongCloseDown)
    );
}

export function getVolumeExpansionPoints(
    candles: Candle[],
    shortWindow: number = 5,
    longWindow: number = 20
): number {

    if (candles.length < longWindow + 1) return 0;

    const last = candles[candles.length - 1];

    const shortAvg =
        candles.slice(-shortWindow)
            .reduce((a, b) => a + b.volume, 0) / shortWindow;

    const longAvg =
        candles.slice(-longWindow)
            .reduce((a, b) => a + b.volume, 0) / longWindow;

    if (longAvg === 0) return 0;

    const expansionRatio = shortAvg / longAvg;

    let points = 0;

    if (expansionRatio > 1.2) points += 1;
    if (expansionRatio > 1.5) points += 1;
    if (last.volume > shortAvg) points += 1;

    return points;
}

export function getTargetCandleVolumeSpike(
    targetCandle: TargetCandle,
    candles: Candle[],
    lookback: number = 20
): number {

    if (candles.length < lookback) return 0;

    const avgVol =
        candles.slice(-lookback)
            .reduce((a, b) => a + b.volume, 0) / lookback;

    if (avgVol === 0) return 0;

    const spikeRatio =
        targetCandle.volume / avgVol;

    let points = 0;

    if (spikeRatio > 1.3) points += 1;
    if (spikeRatio > 2.0) points += 1;

    return points;
}