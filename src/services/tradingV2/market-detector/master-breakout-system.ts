import { Candle, ConfigType, TargetCandle } from "../type";
import { getInternalConfig } from "./config";
import {
    calculateATR,
    getRollingATRPercentAvg,
    calculateADXSeries,
    calculateVEISeries,
} from "./indicators";
import {
    detectMicroChop,
    isVolumeContracting,
    isTargetCandleNotGood,
    detectLiquiditySweep,
    getVolumeExpansionPoints,
    getTargetCandleVolumeSpike,
    isRangeCompressed,
} from "./price-action";
import { Utils } from "../utils";

export type TradeDirection = "BUY" | "SELL" | "NONE";

export interface MasterScoreResult {
    score: number; // 0..100
    direction: TradeDirection;
    isTrade: boolean;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function getBreakout(
    historyCandles: Candle[],
    target: TargetCandle,
    lookback: number,
    atr: number
) {
    const recent = historyCandles.slice(-lookback);

    if (recent.length < 2) {
        return null;
    }

    const prevHigh = Math.max(...recent.map(c => c.high));
    const prevLow = Math.min(...recent.map(c => c.low));

    const buffer = atr * 0.25;

    const breakoutUp = target.close > prevHigh + buffer;
    const breakoutDown = target.close < prevLow - buffer;

    if (!breakoutUp && !breakoutDown) {
        return null;
    }

    return {
        breakoutUp,
        breakoutDown,
        prevHigh,
        prevLow,
        buffer,
    };
}

export function evaluateBreakoutTrade(
    candles: Candle[],
    target: TargetCandle,
    config: ConfigType
): MasterScoreResult {
    const cfg = getInternalConfig(config);

    if (candles.length < cfg.MIN_REQUIRED_CANDLES) {
        return { score: 0, direction: "NONE", isTrade: false };
    }

    const historyCandles = candles.length > 1 ? candles.slice(0, -1) : [];

    if (historyCandles.length < Math.max(10, cfg.STRUCTURE_LOOKBACK)) {
        return { score: 0, direction: "NONE", isTrade: false };
    }

    const latestClose = target.close;

    /* ================= ATR ================= */

    const atr = calculateATR(candles, cfg.ATR_PERIOD);
    const atrPercent = latestClose === 0 ? 0 : (atr / latestClose) * 100;
    const atrAvg = getRollingATRPercentAvg(candles, cfg.ATR_PERIOD);

    /* ================= BREAKOUT ================= */

    const breakout = getBreakout(historyCandles, target, cfg.STRUCTURE_LOOKBACK, atr);

    if (!breakout) {
        return { score: 0, direction: "NONE", isTrade: false };
    }

    const { breakoutUp, breakoutDown, prevHigh, prevLow } = breakout;

    let direction: TradeDirection = "NONE";
    let breakoutLevel = 0;

    if (breakoutUp) {
        direction = "BUY";
        breakoutLevel = prevHigh;
    } else if (breakoutDown) {
        direction = "SELL";
        breakoutLevel = prevLow;
    }

    if (direction === "NONE" || breakoutLevel <= 0) {
        return { score: 0, direction: "NONE", isTrade: false };
    }

    let score = 50;

    /* ================= STRUCTURE / COMPRESSION ================= */

    const compressed = isRangeCompressed(candles, 5, cfg.STRUCTURE_LOOKBACK, 2);
    score += compressed ? 6 : -3;

    /* ================= VOLATILITY ================= */

    if (atrAvg > 0) {
        if (atrPercent > atrAvg * 1.1) score += 8;
        else if (atrPercent > atrAvg * 0.95) score += 4;
        else score -= 6;
    }

    /* ================= ADX ================= */

    const adxSeries = calculateADXSeries(candles, cfg.ADX_PERIOD);
    if (adxSeries.length > 0) {
        const adx = adxSeries[adxSeries.length - 1];

        if (adx > cfg.ADX_WEAK_THRESHOLD + 5) score += 8;
        else if (adx > cfg.ADX_WEAK_THRESHOLD) score += 4;
        else score -= 4;
    }

    /* ================= VEI ================= */

    const veiSeries = calculateVEISeries(candles, 20);
    const vei = veiSeries.length > 0 ? veiSeries[veiSeries.length - 1] : 1;

    if (vei > 1.3) score += 8;
    else if (vei > 1.1) score += 4;
    else score -= 4;

    /* ================= BREAKOUT QUALITY ================= */

    const bodyPercent = Utils.getBodyPercent(target);

    if (bodyPercent > 75) score += 12;
    else if (bodyPercent > 65) score += 9;
    else if (bodyPercent > 55) score += 5;
    else score -= 10;

    const distance = breakoutLevel === 0
        ? 0
        : (Math.abs(target.close - breakoutLevel) / breakoutLevel) * 100;

    if (distance > 0.6) score += 8;
    else if (distance > 0.3) score += 5;
    else if (distance > 0.15) score += 2;
    else score -= 4;

    /* ================= VOLUME ================= */

    if (!isVolumeContracting(candles)) score += 5;
    else score -= 6;

    score += getVolumeExpansionPoints(candles);
    score += getTargetCandleVolumeSpike(target, candles);

    /* ================= MOMENTUM ================= */

    const prev = historyCandles[historyCandles.length - 1];

    if (
        (direction === "BUY" && target.close > prev.close) ||
        (direction === "SELL" && target.close < prev.close)
    ) {
        score += 8;
    } else {
        score -= 8;
    }

    /* ================= LIQUIDITY SWEEP ================= */

    if (detectLiquiditySweep(candles, cfg.STRUCTURE_LOOKBACK)) {
        score += 6;
    }

    /* ================= PENALTIES ================= */

    if (
        detectMicroChop(
            candles,
            atrAvg,
            cfg.SMALL_BODY_PERCENT_THRESHOLD,
            cfg.SMALL_BODY_MIN_COUNT
        )
    ) {
        score -= 12;
    }

    if (isTargetCandleNotGood(target, atrPercent, 0.3)) {
        score -= 10;
    }

    score = clamp(score, 0, 100);

    const isTrade = score >= 65;

    return {
        score,
        direction,
        isTrade,
    };
}