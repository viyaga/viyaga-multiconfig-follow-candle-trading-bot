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

    private static isValidBreakout(
        candles: Candle[],
        target: TargetCandle,
        atr: number,
        atrAvg: number
    ): boolean {

        const lookback = 20;
        const recent = candles.slice(-lookback);

        const prevHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
        const prevLow = Math.min(...recent.slice(0, -1).map(c => c.low));

        const buffer = atr * 0.1;

        const breakoutUp = target.close > prevHigh + buffer;
        const breakoutDown = target.close < prevLow - buffer;

        if (!breakoutUp && !breakoutDown) return false;

        const strongBody = Utils.getBodyPercent(target) > 60;

        const rangePercent =
            target.close === 0
                ? 0
                : ((target.high - target.low) / target.close) * 100;

        const volatilityExpansion = rangePercent > atrAvg * 1.2;

        const avgVol =
            candles.slice(-20).reduce((a, b) => a + b.volume, 0) / 20;

        const volumeSpike = target.volume > avgVol * 1.5;

        return strongBody && volatilityExpansion && volumeSpike;
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

        /* ================= COMPRESSION ================= */

        const compression =
            isRangeCompressed(candles, 5, 20, 2);

        if (!compression) {

            marketDetectorLogger.info(
                `[CompressionBlocked] ${symbol}`
            );

            return { score: 10, isAllowed: false };
        }

        /* ================= BREAKOUT ================= */

        const breakoutValid =
            MarketDetector.isValidBreakout(
                candles,
                targetCandle,
                atr,
                atrAvg
            );

        if (!breakoutValid) {

            marketDetectorLogger.info(
                `[BreakoutBlocked] ${symbol}`
            );

            return { score: 10, isAllowed: false };
        }

        /* ================= LIQUIDITY SWEEP ================= */

        const liquiditySweep =
            detectLiquiditySweep(candles, 10);

        if (!liquiditySweep) {

            marketDetectorLogger.info(
                `[LiquiditySweepBlocked] ${symbol}`
            );

            return { score: 10, isAllowed: false };
        }

        /* ================= FINAL SCORE ================= */

        const finalScore = chopPoints;

        const isAllowed =
            finalScore <= cfg.CHOP_SCORE_THRESHOLD;

        marketDetectorLogger.info(
            `[MarketRegimeDetail] ${symbol}`,
            {
                regimeScore: finalScore,
                isAllowed,
                atrPercent,
                atrAvg,
                structureWeak,
                microChopDetected,
                compression,
                breakoutValid,
                liquiditySweep
            }
        );

        return {
            score: finalScore,
            isAllowed
        };
    }
}