import { Candle, ConfigType, InternalChopConfig, TargetCandle, MarketEvaluationMode } from "../type";
import { marketDetectorLogger } from "../logger";
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
    isRangeCompressed,
    getVolumeExpansionPoints,
    getTargetCandleVolumeSpike,
    detectLiquiditySweep
} from "./price-action";
import { Utils } from "../utils";

export class MarketDetector {

    static getMarketRegimeScore(
        targetCandle: TargetCandle,
        candles: Candle[],
        config: ConfigType,
        mode: MarketEvaluationMode = "entry"
    ): { score: number, isAllowed: boolean } {

        const internal = getInternalConfig(config);

        return this.calculateRegimeScore(
            targetCandle,
            candles,
            internal,
            config.SYMBOL,
            mode
        );
    }

    private static isValidBreakout(
        candles: Candle[],
        target: TargetCandle,
        atr: number,
        atrAvg: number,
        cfg: InternalChopConfig
    ): boolean {

        const lookback = cfg.STRUCTURE_LOOKBACK || 20;
        const recent = candles.slice(-lookback);

        const prevHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
        const prevLow = Math.min(...recent.slice(0, -1).map(c => c.low));

        // Improved breakout buffer
        const buffer = atr * 0.3;

        const breakoutUp = target.close > prevHigh + buffer;
        const breakoutDown = target.close < prevLow - buffer;

        if (!breakoutUp && !breakoutDown) return false;

        const strongBody = Utils.getBodyPercent(target) > 60;

        const rangePercent =
            target.close === 0
                ? 0
                : ((target.high - target.low) / target.close) * 100;

        const volatilityExpansion =
            rangePercent > atrAvg * 0.35 &&
            rangePercent > atrAvg * 1.2;

        const avgVol =
            candles.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;

        const volumeSpike = target.volume > avgVol * 1.5;

        const strongMomentum =
            target.volume > avgVol * 2 &&
            Utils.getBodyPercent(target) > 70;

        return strongBody && volatilityExpansion && (volumeSpike || strongMomentum);
    }

    private static calculateRegimeScore(
        targetCandle: TargetCandle,
        candles: Candle[],
        cfg: InternalChopConfig,
        symbol: string,
        mode: MarketEvaluationMode
    ): { score: number, isAllowed: boolean } {

        if (candles.length < cfg.MIN_REQUIRED_CANDLES) {
            return { score: 10, isAllowed: false };
        }

        let chopPoints = 0;

        const latestClose = candles[candles.length - 1].close;

        /* ================= ATR ================= */

        const atr = calculateATR(candles, cfg.ATR_PERIOD);

        const atrPercent =
            latestClose === 0 ? 0 : (atr / latestClose) * 100;

        const atrAvg =
            getRollingATRPercentAvg(candles, cfg.ATR_PERIOD);

        if (atrPercent < atrAvg * 0.75)
            chopPoints += 2;

        /* ================= ADX ================= */

        const adxSeries =
            calculateADXSeries(candles, cfg.ADX_PERIOD);

        if (adxSeries.length > 0) {

            const adx = adxSeries[adxSeries.length - 1];

            if (adx < cfg.ADX_WEAK_THRESHOLD)
                chopPoints += 2;
        }

        /* ================= VEI ================= */

        const veiSeries = calculateVEISeries(candles, 20);
        const currentVei = veiSeries.length > 0 ? veiSeries[veiSeries.length - 1] : 1.0;

        if (currentVei < 1.1) {
            chopPoints += 2;
        }

        /* ================= STRUCTURE ================= */

        const recent =
            candles.slice(-cfg.STRUCTURE_LOOKBACK);

        const rangePercent =
            Utils.getRangePercent(recent);

        const structureWeak =
            rangePercent < atrAvg * 1.2;

        if (structureWeak)
            chopPoints += 1;

        /* ================= MICRO CHOP ================= */

        const microChopDetected =
            detectMicroChop(
                candles,
                atrAvg,
                cfg.SMALL_BODY_PERCENT_THRESHOLD,
                cfg.SMALL_BODY_MIN_COUNT
            );

        if (microChopDetected)
            chopPoints += 1;

        /* ================= TARGET CANDLE ================= */

        const targetBad =
            isTargetCandleNotGood(
                targetCandle,
                atrPercent,
                0.3
            );

        if (targetBad)
            chopPoints += 2;

        /* ================= VOLUME ================= */

        if (isVolumeContracting(candles))
            chopPoints += 2;

        chopPoints -= getVolumeExpansionPoints(candles);

        chopPoints -= getTargetCandleVolumeSpike(
            targetCandle,
            candles
        );

        chopPoints = Math.max(0, chopPoints);

        /* ================= MODE SPECIFIC ================= */

        let compression = false;
        let breakoutValid = false;
        let liquiditySweep = false;

        if (mode === "structure") {

            compression = isRangeCompressed(candles, 5, cfg.STRUCTURE_LOOKBACK, 2);

            if (!compression) {
                marketDetectorLogger.info(`[MarketRegime] ${symbol} Structure-Blocked (No Compression)`);
                return { score: chopPoints + 5, isAllowed: false };
            }

        } else if (mode === "confirmation") {

            const isExpanding =
                (atrPercent > atrAvg * 1.0) ||
                (currentVei > 1.2);

            if (!isExpanding) {
                marketDetectorLogger.info(`[MarketRegime] ${symbol} Confirmation-Blocked (No Expansion)`);
                return { score: chopPoints + 3, isAllowed: false };
            }

        } else {

            // ENTRY MODE

            breakoutValid = MarketDetector.isValidBreakout(candles, targetCandle, atr, atrAvg, cfg);

            if (!breakoutValid) {
                marketDetectorLogger.info(`[BreakoutBlocked] ${symbol}`);
                return { score: 10, isAllowed: false };
            }

            liquiditySweep = detectLiquiditySweep(candles, cfg.STRUCTURE_LOOKBACK);

            const avgVol =
                candles.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;

            const strongMomentum =
                targetCandle.volume > avgVol * 2 &&
                Utils.getBodyPercent(targetCandle) > 70;

            // Allow breakout if sweep OR strong momentum
            if (!liquiditySweep && !strongMomentum) {
                marketDetectorLogger.info(`[SweepOrMomentumBlocked] ${symbol}`);
                return { score: 10, isAllowed: false };
            }
        }

        /* ================= FINAL SCORE ================= */

        const finalScore = chopPoints;
        const isAllowed = finalScore <= cfg.CHOP_SCORE_THRESHOLD;

        marketDetectorLogger.info(
            `[MarketRegimeDetail] ${symbol} Mode: ${mode}`,
            {
                regimeScore: finalScore,
                isAllowed,
                atrPercent,
                atrAvg,
                structureWeak,
                microChopDetected,
                compression: mode === "structure" ? compression : undefined,
                breakoutValid: mode === "entry" ? breakoutValid : undefined,
                liquiditySweep: mode === "entry" ? liquiditySweep : undefined
            }
        );

        return {
            score: finalScore,
            isAllowed
        };
    }
}