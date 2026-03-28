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

/* ================= BREAKOUT DETECTOR ================= */

function getBreakout(
    historyCandles: Candle[],
    target: TargetCandle,
    lookback: number,
    atr: number
) {
    const recent = historyCandles.slice(-lookback);

    if (recent.length < 2) return null;

    const prevHigh = Math.max(...recent.map(c => c.high));
    const prevLow = Math.min(...recent.map(c => c.low));

    const buffer = atr * 0.25;

    const breakoutUp = target.close > prevHigh + buffer;
    const breakoutDown = target.close < prevLow - buffer;

    if (!breakoutUp && !breakoutDown) return null;

    return {
        breakoutUp,
        breakoutDown,
        prevHigh,
        prevLow,
        buffer,
    };
}

/* ================= MAIN ENGINE ================= */

export function evaluateBreakoutTrade(
    candles: Candle[],
    target: TargetCandle,
    config: ConfigType
): MasterScoreResult {

    const cfg = getInternalConfig(config);

    if (candles.length < cfg.MIN_REQUIRED_CANDLES) {
        return { score: 0, direction: "NONE", isTrade: false };
    }

    const history = candles.slice(0, -1);
    if (history.length < Math.max(10, cfg.STRUCTURE_LOOKBACK)) {
        return { score: 0, direction: "NONE", isTrade: false };
    }

    const latestClose = target.close;

    /* ================= BASE ================= */

    let score = 50;
    let direction: TradeDirection = "NONE";
    let breakoutLevel = 0;

    /* ================= ATR ================= */

    const atr = calculateATR(candles, cfg.ATR_PERIOD);
    const atrPercent = latestClose === 0 ? 0 : (atr / latestClose) * 100;
    const atrAvg = getRollingATRPercentAvg(candles, cfg.ATR_PERIOD);

    /* ================= BREAKOUT ================= */

    const breakout = getBreakout(history, target, cfg.STRUCTURE_LOOKBACK, atr);

    if (breakout) {
        if (breakout.breakoutUp) {
            direction = "BUY";
            breakoutLevel = breakout.prevHigh;
            score += 15;
        } else if (breakout.breakoutDown) {
            direction = "SELL";
            breakoutLevel = breakout.prevLow;
            score += 15;
        }
    } else {
        score -= 20;
    }

    /* ================= CANDLE STRENGTH ================= */

    const bodyPercent = Utils.getBodyPercent(target);

    if (bodyPercent > 75) score += 12;
    else if (bodyPercent > 65) score += 8;
    else if (bodyPercent > 55) score += 4;
    else score -= 20;

    /* ================= VOLATILITY ================= */

    if (atrAvg > 0) {
        if (atrPercent > atrAvg * 1.2) score += 10;
        else if (atrPercent > atrAvg) score += 6;
        else score -= 20;
    }

    /* ================= STRUCTURE ================= */

    const compressed = isRangeCompressed(candles, 5, cfg.STRUCTURE_LOOKBACK, 2);
    score += compressed ? 6 : -20;

    /* ================= VOLUME ================= */

    const volumeWindow = Math.min(20, candles.length);
    const avgVol = candles.slice(-volumeWindow).reduce((a, b) => a + b.volume, 0) / volumeWindow;

    if (avgVol > 0) {
        const ratio = target.volume / avgVol;

        if (ratio > 2) score += 12;
        else if (ratio > 1.5) score += 8;
        else if (ratio > 1.2) score += 4;
        else score -= 20;
    }

    if (isVolumeContracting(candles)) score -= 8;

    score += getVolumeExpansionPoints(candles);
    score += getTargetCandleVolumeSpike(target, candles);

    /* ================= ADX ================= */

    const adxSeries = calculateADXSeries(candles, cfg.ADX_PERIOD);
    if (adxSeries.length > 0) {
        const adx = adxSeries[adxSeries.length - 1];

        if (adx > cfg.ADX_WEAK_THRESHOLD + 10) score += 10;
        else if (adx > cfg.ADX_WEAK_THRESHOLD) score += 6;
        else score -= 6;
    }

    /* ================= VEI ================= */

    const veiSeries = calculateVEISeries(candles, 20);
    const vei = veiSeries.length > 0 ? veiSeries[veiSeries.length - 1] : 1;

    if (vei > 1.4) score += 8;
    else if (vei > 1.2) score += 5;
    else score -= 5;

    /* ================= MOMENTUM ================= */

    const prev = history[history.length - 1];

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

    /* ================= CHOP ================= */

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

    /* ================= TARGET QUALITY ================= */

    if (isTargetCandleNotGood(target, atrPercent, 0.3)) {
        score -= 10;
    }

    /* ================= RETEST SCORING ================= */

    if (breakoutLevel > 0) {
        const distance =
            Math.abs(target.close - breakoutLevel) / breakoutLevel;

        if (distance < 0.002) score += 12;       // perfect retest
        else if (distance < 0.005) score += 8;
        else if (distance < 0.01) score += 4;
        else score -= 6;                         // overextended
    }

    /* ================= FINAL ================= */

    score = clamp(score, 0, 100);

    const isTrade = score >= 60;

    return {
        score,
        direction,
        isTrade,
    };
}