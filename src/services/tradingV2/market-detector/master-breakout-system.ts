import { Candle, ConfigType, TargetCandle } from "../type";
import { getInternalConfig } from "./config";
import {
    calculateATR,
    getRollingATRPercentAvg,
    calculateADXSeries,
    calculateVEISeries
} from "./indicators";
import {
    detectMicroChop,
    isVolumeContracting,
    isTargetCandleNotGood,
    detectLiquiditySweep,
    getVolumeExpansionPoints,
    getTargetCandleVolumeSpike,
    isRangeCompressed
} from "./price-action";
import { Utils } from "../utils";

export type TradeDirection = "BUY" | "SELL" | "NONE";

export interface MasterScoreResult {
    score: number;
    direction: TradeDirection;
    isTrade: boolean;
}

/* ================= BREAKOUT ================= */

function getBreakout(candles: Candle[], lookback: number, atr: number) {
    const recent = candles.slice(-lookback);
    const prevHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
    const prevLow = Math.min(...recent.slice(0, -1).map(c => c.low));

    const last = recent[recent.length - 1];

    const buffer = atr * 0.25;

    const breakoutUp = last.close > prevHigh + buffer;
    const breakoutDown = last.close < prevLow - buffer;

    return {
        breakoutUp,
        breakoutDown,
        prevHigh,
        prevLow,
        last
    };
}

/* ================= MASTER ================= */

export function evaluateBreakoutTrade(
    candles: Candle[],
    target: TargetCandle,
    config: ConfigType
): MasterScoreResult {

    const cfg = getInternalConfig(config);

    if (candles.length < cfg.MIN_REQUIRED_CANDLES) {
        return { score: 0, direction: "NONE", isTrade: false };
    }

    const latestClose = candles[candles.length - 1].close;

    /* ================= ATR ================= */

    const atr = calculateATR(candles, cfg.ATR_PERIOD);
    const atrPercent = latestClose === 0 ? 0 : (atr / latestClose) * 100;
    const atrAvg = getRollingATRPercentAvg(candles, cfg.ATR_PERIOD);

    /* ================= BREAKOUT ================= */

    const { breakoutUp, breakoutDown, prevHigh, prevLow } =
        getBreakout(candles, cfg.STRUCTURE_LOOKBACK, atr);

    let direction: TradeDirection = "NONE";
    let breakoutLevel = 0;

    if (breakoutUp) {
        direction = "BUY";
        breakoutLevel = prevHigh;
    } else if (breakoutDown) {
        direction = "SELL";
        breakoutLevel = prevLow;
    } else {
        return { score: 0, direction: "NONE", isTrade: false };
    }

    let score = 0;

    /* ================= 🔥 COMPRESSION ================= */

    const compressed = isRangeCompressed(candles, 5, cfg.STRUCTURE_LOOKBACK, 2);
    score += compressed ? 2 : -1;

    /* ================= VOLATILITY ================= */

    if (atrPercent > atrAvg) score += 1;
    else score -= 1;

    if (atrPercent > atrAvg * 1.2) score += 2;

    /* ================= ADX ================= */

    const adxSeries = calculateADXSeries(candles, cfg.ADX_PERIOD);
    if (adxSeries.length > 0) {
        const adx = adxSeries[adxSeries.length - 1];

        if (adx > cfg.ADX_WEAK_THRESHOLD) score += 1;
        else score -= 1;

        if (adx > cfg.ADX_WEAK_THRESHOLD + 5) score += 2;
    }

    /* ================= VEI ================= */

    const veiSeries = calculateVEISeries(candles, 20);
    const vei = veiSeries.length > 0 ? veiSeries[veiSeries.length - 1] : 1;

    if (vei > 1.1) score += 1;
    else score -= 1;

    if (vei > 1.3) score += 2;

    /* ================= 🔥 BREAKOUT QUALITY ================= */

    const bodyPercent = Utils.getBodyPercent(target);

    if (bodyPercent > 70) score += 3;
    else if (bodyPercent > 60) score += 2;
    else if (bodyPercent > 50) score += 1;
    else score -= 2;

    const distance =
        Math.abs(target.close - breakoutLevel) / breakoutLevel * 100;

    if (distance > 0.6) score += 3;
    else if (distance > 0.3) score += 2;
    else if (distance > 0.15) score += 1;
    else score -= 2;

    /* ================= VOLUME ================= */

    if (!isVolumeContracting(candles)) score += 1;
    else score -= 2;

    score += getVolumeExpansionPoints(candles);
    score += getTargetCandleVolumeSpike(target, candles);

    /* ================= MOMENTUM ================= */

    const prev = candles[candles.length - 2];

    if (
        (direction === "BUY" && target.close > prev.close) ||
        (direction === "SELL" && target.close < prev.close)
    ) {
        score += 2;
    } else {
        score -= 2;
    }

    /* ================= LIQUIDITY SWEEP ================= */

    if (detectLiquiditySweep(candles, cfg.STRUCTURE_LOOKBACK)) {
        score += 2;
    }

    /* ================= PENALTIES ================= */

    if (detectMicroChop(
        candles,
        atrAvg,
        cfg.SMALL_BODY_PERCENT_THRESHOLD,
        cfg.SMALL_BODY_MIN_COUNT
    )) {
        score -= 3;
    }

    if (isTargetCandleNotGood(target, atrPercent, 0.3)) {
        score -= 3;
    }

    /* ================= NORMALIZE ================= */

    score = Math.max(0, Math.min(15, score));

    /* ================= FINAL ================= */

    const isTrade = score >= 8; // 🔥 only strong setups

    return {
        score,
        direction,
        isTrade
    };
}