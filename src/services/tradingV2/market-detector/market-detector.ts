import { Candle, ConfigType, InternalChopConfig, TargetCandle } from "../type";
import { marketDetectorLogger } from "../logger";
import { getInternalConfig } from "./config";
import {
    calculateATR,
    getRollingATRPercentAvg,
    calculateADXSeries
} from "./indicators";
import {
    detectMicroChop,
    isVolumeContracting,
    getBodyPercent,
    getRangePercent,
    isTargetCandleNotGood,
    isRangeCompressed,
    getVolumeExpansionPoints,
    getTargetCandleVolumeSpike
} from "./price-action";

const MIN_ATR_PERCENT = 1.2; // Required for 2% target potential

export class MarketDetector {

    static getMarketRegimeScore(
        targetCandle: TargetCandle,
        candles: Candle[],
        config: ConfigType
    ): { score: number, isAllowed: boolean } {

        const internal = getInternalConfig(config);

        return this.calculateRegimeScore(
            targetCandle,
            candles,
            internal,
            config.SYMBOL
        );
    }

    private static calculateRegimeScore(
        targetCandle: TargetCandle,
        candles: Candle[],
        cfg: InternalChopConfig,
        symbol: string
    ): { score: number, isAllowed: boolean } {

        if (candles.length < cfg.MIN_REQUIRED_CANDLES) {
            return { score: 10, isAllowed: false };
        }

        let chopPoints = 0;
        const latestClose = candles[candles.length - 1].close;

        /* ================= ATR ================= */
        const atr = calculateATR(candles, cfg.ATR_PERIOD);
        const atrPercent = latestClose === 0 ? 0 : (atr / latestClose) * 100;
        const atrAvg = getRollingATRPercentAvg(candles, cfg.ATR_PERIOD);

        if (atrPercent < MIN_ATR_PERCENT) {
            return { score: 9, isAllowed: false };
        }

        if (atrPercent < atrAvg * 0.75) chopPoints += 2;

        /* ================= ADX ================= */
        const adxSeries = calculateADXSeries(candles, cfg.ADX_PERIOD);
        let currentADX = 0;

        if (adxSeries.length >= 2) {
            currentADX = adxSeries[adxSeries.length - 1];
            const prevADX = adxSeries[adxSeries.length - 2];

            if (currentADX < cfg.ADX_WEAK_THRESHOLD) chopPoints += 2;
            if (currentADX > prevADX && currentADX > cfg.ADX_WEAK_THRESHOLD)
                chopPoints -= 1;
        }

        if (currentADX < cfg.ADX_WEAK_THRESHOLD) {
            return { score: 8, isAllowed: false };
        }

        chopPoints = Math.max(0, chopPoints);

        /* ================= STRUCTURE ================= */
        const recent = candles.slice(-cfg.STRUCTURE_LOOKBACK);
        const rangePercent = getRangePercent(recent);

        if (rangePercent < atrAvg * 1.2) chopPoints += 2;

        /* ================= MICRO CHOP ================= */
        if (detectMicroChop(candles, atrAvg, cfg.SMALL_BODY_PERCENT_THRESHOLD)) {
            chopPoints += 2;
        }

        /* ================= TARGET CANDLE ================= */
        if (isTargetCandleNotGood(targetCandle, atrPercent, 0.3)) {
            chopPoints += 2;
        }

        /* ================= VOLUME ================= */
        if (isVolumeContracting(candles)) chopPoints += 2;

        chopPoints -= getVolumeExpansionPoints(candles);
        chopPoints -= getTargetCandleVolumeSpike(targetCandle, candles);

        chopPoints = Math.max(0, chopPoints);

        /* ================= COMPRESSION ================= */
        if (isRangeCompressed(candles, 3, 15, 3)) {
            chopPoints += 2;
        }

        /* ================= BREAKOUT BOOST ================= */
        const last = candles[candles.length - 1];
        const prevHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
        const prevLow = Math.min(...recent.slice(0, -1).map(c => c.low));

        const isBreakout =
            last.close > prevHigh || last.close < prevLow;

        const strongBody = getBodyPercent(last) > 65;

        if (isBreakout && strongBody && atrPercent > atrAvg) {
            chopPoints = Math.max(0, chopPoints - 4);
        }

        const finalScore = chopPoints;
        const isAllowed = finalScore <= cfg.CHOP_SCORE_THRESHOLD;

        marketDetectorLogger.info(`[MarketRegimeDetail] ${symbol}`, {
            regimeScore: finalScore,
            atrPercent,
            adx: currentADX,
            isAllowed
        });

        return { score: finalScore, isAllowed };
    }
}