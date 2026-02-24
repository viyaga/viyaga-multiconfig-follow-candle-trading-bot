import { Candle, ConfigType, InternalChopConfig } from "../type";
import { skipTradingLogger, marketDetectorLogger } from "../logger";
import { getInternalConfig } from "./config";
import { calculateATR, getRollingATRPercentAvg, calculateADXSeries } from "./indicators";
import { detectMicroChop, isVolumeContracting, getBodyPercent, getRangePercent } from "./price-action";

export class MarketDetector {
    static getMarketRegimeScore(candles: Candle[], config: ConfigType): number {
        const internal = getInternalConfig(config);

        return this.calculateRegimeScore(
            candles,
            internal,
            config.id,
            config.USER_ID,
            config.SYMBOL,
            config.TIMEFRAME
        );
    }

    private static calculateRegimeScore(
        candles: Candle[],
        cfg: InternalChopConfig,
        configId: string,
        userId: string,
        symbol: string,
        timeframe: string
    ): number {
        if (candles.length < cfg.MIN_REQUIRED_CANDLES) return 7;

        let chopScore = 0;
        let maxScore = 0;

        const latestClose = candles[candles.length - 1].close;

        /* ================= ATR ================= */
        const atr = calculateATR(candles, cfg.ATR_PERIOD);
        const atrPercent = latestClose === 0 ? 0 : (atr / latestClose) * 100;
        const atrAvg = getRollingATRPercentAvg(candles, cfg.ATR_PERIOD);

        maxScore++;
        if (atrPercent < cfg.CHOPPY_ATR_THRESHOLD || atrPercent < atrAvg * 0.75) {
            chopScore++;
        }

        /* ================= ADX ================= */
        const adxSeries = calculateADXSeries(candles, cfg.ADX_PERIOD);
        if (adxSeries.length >= 2) {
            const current = adxSeries[adxSeries.length - 1];
            const prev = adxSeries[adxSeries.length - 2];

            maxScore++;
            if (current < cfg.ADX_WEAK_THRESHOLD) chopScore++;

            if (cfg.REQUIRE_ADX_FALLING) {
                maxScore++;
                if (current < prev) chopScore++;
            }
        }

        /* ================= STRUCTURE ================= */
        const recent = candles.slice(-cfg.STRUCTURE_LOOKBACK);
        const rangePercent = getRangePercent(recent);

        maxScore++;
        const structureMultiplier =
            timeframe.includes("4h") ? 2.5 :
                timeframe.includes("1h") ? 2 :
                    1.8;

        if (rangePercent < atrPercent * structureMultiplier) chopScore++;

        const smallBodyCount = recent.filter(c => getBodyPercent(c) < cfg.SMALL_BODY_PERCENT_THRESHOLD).length;

        maxScore++;
        if (smallBodyCount >= cfg.SMALL_BODY_MIN_COUNT) chopScore++;

        /* ================= MICRO CHOP ================= */
        maxScore += 2;
        if (detectMicroChop(candles, atrPercent, cfg.SMALL_BODY_PERCENT_THRESHOLD)) {
            chopScore += 2;
        }

        /* ================= VOLUME ================= */
        maxScore++;
        if (isVolumeContracting(candles)) chopScore++;

        /* ================= BREAKOUT REDUCTION ================= */
        let breakoutReduction = 0;
        const last = candles[candles.length - 1];
        const prevHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
        const prevLow = Math.min(...recent.slice(0, -1).map(c => c.low));

        if (last.close > prevHigh) breakoutReduction += 2;
        if (last.close < prevLow) breakoutReduction += 2;
        if (getBodyPercent(last) > 65) breakoutReduction++;

        if (candles.length >= 20) {
            const avgVol = candles.slice(-20, -1).reduce((a, b) => a + b.volume, 0) / 19;
            if (last.volume > avgVol * 1.4) breakoutReduction++;
        }

        breakoutReduction = Math.min(breakoutReduction, 4);

        /* ================= FINAL SCORE ================= */
        let rawScore = Math.max(0, chopScore - breakoutReduction);

        const normalized = maxScore === 0 ? 0 : Math.min(10, Math.round((rawScore / maxScore) * 10));

        const details = {
            configId,
            userId,
            symbol,
            timeframe,
            regimeScore: normalized,
            metrics: {
                atr: {
                    value: atr,
                    percent: atrPercent,
                    avg: atrAvg,
                    isChoppy: atrPercent < cfg.CHOPPY_ATR_THRESHOLD || atrPercent < atrAvg * 0.75
                },
                adx: adxSeries.length >= 2 ? {
                    current: adxSeries[adxSeries.length - 1],
                    prev: adxSeries[adxSeries.length - 2],
                    isWeak: adxSeries[adxSeries.length - 1] < cfg.ADX_WEAK_THRESHOLD,
                    isFalling: cfg.REQUIRE_ADX_FALLING ? (adxSeries[adxSeries.length - 1] < adxSeries[adxSeries.length - 2]) : undefined
                } : null,
                structure: {
                    rangePercent,
                    atrPercent,
                    multiplier: structureMultiplier,
                    isRangeChoppy: rangePercent < atrPercent * structureMultiplier,
                    smallBodyCount,
                    smallBodyThreshold: cfg.SMALL_BODY_PERCENT_THRESHOLD,
                    isBodyChoppy: smallBodyCount >= cfg.SMALL_BODY_MIN_COUNT
                },
                microChop: {
                    detected: detectMicroChop(candles, atrPercent, cfg.SMALL_BODY_PERCENT_THRESHOLD)
                },
                volume: {
                    isContracting: isVolumeContracting(candles)
                },
                breakoutReduction: {
                    value: breakoutReduction,
                    isStrongBody: getBodyPercent(last) > 65,
                    isHighVolume: candles.length >= 20 && last.volume > (candles.slice(-20, -1).reduce((a, b) => a + b.volume, 0) / 19) * 1.4
                }
            },
            scores: {
                chopScore,
                breakoutReduction,
                rawScore,
                maxScore
            }
        };

        marketDetectorLogger.info(`[MarketRegimeDetail] ${symbol}`, details);

        skipTradingLogger.info(`[MarketRegime] ${symbol}`, {
            configId,
            userId,
            symbol,
            timeframe,
            regimeScore: normalized
        });

        return normalized;
    }
}
