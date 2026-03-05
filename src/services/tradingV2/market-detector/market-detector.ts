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
            marketDetectorLogger.info(`[MarketRegimeDetail] ${symbol}`, {
                regimeScore: 10, isAllowed: false,
                earlyExit: "NOT_ENOUGH_CANDLES",
                candlesAvailable: candles.length,
                candlesRequired: cfg.MIN_REQUIRED_CANDLES
            });
            return { score: 10, isAllowed: false };
        }

        let chopPoints = 0;
        const latestClose = candles[candles.length - 1].close;

        /* ================= ATR ================= */
        const atr = calculateATR(candles, cfg.ATR_PERIOD);
        const atrPercent = latestClose === 0 ? 0 : (atr / latestClose) * 100;
        const atrAvg = getRollingATRPercentAvg(candles, cfg.ATR_PERIOD);

        const atrWeak = atrPercent < atrAvg * 0.75;
        if (atrWeak) chopPoints += 2;

        /* ================= ADX ================= */
        const adxSeries = calculateADXSeries(candles, cfg.ADX_PERIOD);
        let currentADX = 0;
        let adxRising = false;

        if (adxSeries.length >= 2) {
            currentADX = adxSeries[adxSeries.length - 1];
            const prevADX = adxSeries[adxSeries.length - 2];
            adxRising = currentADX > prevADX;

            if (currentADX < cfg.ADX_WEAK_THRESHOLD) chopPoints += 2;
            if (adxRising && currentADX > cfg.ADX_WEAK_THRESHOLD)
                chopPoints -= 1;
        }

        chopPoints = Math.max(0, chopPoints);

        /* ================= STRUCTURE ================= */
        const recent = candles.slice(-cfg.STRUCTURE_LOOKBACK);
        const rangePercent = getRangePercent(recent);
        const structureWeak = rangePercent < atrAvg * 1.2;

        if (structureWeak) chopPoints += 2;

        /* ================= MICRO CHOP ================= */
        const microChopDetected = detectMicroChop(candles, atrAvg, cfg.SMALL_BODY_PERCENT_THRESHOLD);
        if (microChopDetected) {
            chopPoints += 2;
        }

        /* ================= TARGET CANDLE ================= */
        const targetCandleNotGood = isTargetCandleNotGood(targetCandle, atrPercent, 0.3);
        if (targetCandleNotGood) {
            chopPoints += 2;
        }

        /* ================= VOLUME ================= */
        const volumeContracting = isVolumeContracting(candles);
        if (volumeContracting) chopPoints += 2;

        const volumeExpansionPts = getVolumeExpansionPoints(candles);
        const targetVolumeSpikeBoost = getTargetCandleVolumeSpike(targetCandle, candles);
        chopPoints -= volumeExpansionPts;
        chopPoints -= targetVolumeSpikeBoost;

        chopPoints = Math.max(0, chopPoints);

        /* ================= COMPRESSION ================= */
        const rangeCompressed = isRangeCompressed(candles, 3, 15, 3);
        if (rangeCompressed) {
            chopPoints += 2;
        }

        /* ================= BREAKOUT BOOST ================= */
        const last = candles[candles.length - 1];
        const prevHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
        const prevLow = Math.min(...recent.slice(0, -1).map(c => c.low));

        const isBreakout =
            last.close > prevHigh || last.close < prevLow;

        const strongBody = getBodyPercent(last) > 65;
        const breakoutBoostApplied = isBreakout && strongBody && atrPercent > atrAvg;

        if (breakoutBoostApplied) {
            chopPoints = Math.max(0, chopPoints - 4);
        }

        const finalScore = chopPoints;
        const isAllowed = finalScore <= cfg.CHOP_SCORE_THRESHOLD;

        marketDetectorLogger.info(`[MarketRegimeDetail] ${symbol}`, {
            // ── Final verdict ──────────────────────────────────────────
            regimeScore: finalScore,
            isAllowed,
            chopScoreThreshold: cfg.CHOP_SCORE_THRESHOLD,
            // ── ATR ────────────────────────────────────────────────────
            atrPercent: +atrPercent.toFixed(4),
            atrAvg: +atrAvg.toFixed(4),
            atrWeak,
            // ── ADX ────────────────────────────────────────────────────
            adx: +currentADX.toFixed(4),
            adxThreshold: cfg.ADX_WEAK_THRESHOLD,
            adxRising,
            // ── Structure ──────────────────────────────────────────────
            rangePercent: +rangePercent.toFixed(4),
            structureWeak,
            // ── Micro-chop ─────────────────────────────────────────────
            microChopDetected,
            // ── Target candle ──────────────────────────────────────────
            targetCandleNotGood,
            // ── Volume ─────────────────────────────────────────────────
            volumeContracting,
            volumeExpansionPts,
            targetVolumeSpikeBoost,
            // ── Compression ────────────────────────────────────────────
            rangeCompressed,
            // ── Breakout boost ─────────────────────────────────────────
            isBreakout,
            strongBody,
            breakoutBoostApplied
        });

        return { score: finalScore, isAllowed };
    }
}