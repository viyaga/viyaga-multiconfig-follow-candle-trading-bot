import { Candle, ConfigType, InternalChopConfig, TargetCandle } from "../type";
import { skipTradingLogger, marketDetectorLogger } from "../logger";
import { getInternalConfig } from "./config";
import { calculateATR, getRollingATRPercentAvg, calculateADXSeries } from "./indicators";
import { detectMicroChop, isVolumeContracting, getBodyPercent, getRangePercent, isTargetCandleNotGood } from "./price-action";

export class MarketDetector {
    static getMarketRegimeScore(targetCandle: TargetCandle, candles: Candle[], config: ConfigType): { score: number, isAllowed: boolean } {
        const internal = getInternalConfig(config);

        return this.calculateRegimeScore(
            targetCandle,
            candles,
            internal,
            config.id,
            config.USER_ID,
            config.SYMBOL,
            config.TIMEFRAME,
            config.MIN_BODY_PERCENT
        );
    }

    private static calculateRegimeScore(
        targetCandle: TargetCandle,
        candles: Candle[],
        cfg: InternalChopConfig,
        configId: string,
        userId: string,
        symbol: string,
        timeframe: string,
        minBodyPercent: number
    ): { score: number, isAllowed: boolean } {
        if (candles.length < cfg.MIN_REQUIRED_CANDLES) return { score: 7, isAllowed: false };

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
        let currentADX = 0;
        let prevADX = 0;
        let adxWeak = false;
        let adxRising = false;

        if (adxSeries.length >= 2) {
            currentADX = adxSeries[adxSeries.length - 1];
            prevADX = adxSeries[adxSeries.length - 2];
            adxWeak = currentADX < cfg.ADX_WEAK_THRESHOLD;
            adxRising = currentADX > prevADX;

            maxScore += 2;
            if (adxWeak) chopScore += 2;

            if (cfg.REQUIRE_ADX_FALLING) {
                maxScore++;
                if (currentADX < prevADX) chopScore++;
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

        /* ================= TARGET CANDLE ================= */
        maxScore += 2;
        if (isTargetCandleNotGood(targetCandle, atrPercent, minBodyPercent)) {
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

        const isUpwardBreakout = last.close > prevHigh;
        const isDownwardBreakout = last.close < prevLow;

        if (isUpwardBreakout) breakoutReduction += 2;
        if (isDownwardBreakout) breakoutReduction += 2;
        if (getBodyPercent(last) > 65) breakoutReduction++;

        if (candles.length >= 20) {
            const avgVol = candles.slice(-20, -1).reduce((a, b) => a + b.volume, 0) / 19;
            if (last.volume > avgVol * 1.4) breakoutReduction++;
        }

        breakoutReduction = Math.min(breakoutReduction, 4);

        /* ================= FINAL SCORE ================= */
        let rawScore = Math.max(0, chopScore - breakoutReduction);

        let normalized = maxScore === 0 ? 0 : Math.min(10, Math.round((rawScore / maxScore) * 10));

        /* ================= VOLATILITY REGIME FILTER ================= */
        if (atrPercent < atrAvg * 0.6) {
            normalized = Math.max(normalized, 6);
        }

        /* ================= TRADE ENTRY LOGIC & DIRECTIONAL BIAS ================= */
        let isAllowed = false;
        const volumeContracting = isVolumeContracting(candles);

        // 1️⃣ Base Rule
        if (normalized <= 3) {
            isAllowed = true;
        } else if (
            normalized === 4 &&
            breakoutReduction >= 2 &&
            getBodyPercent(last) > 65 &&
            !volumeContracting
        ) {
            isAllowed = true;
        }

        // 2️⃣ Directional Bias Filter
        if (adxSeries.length >= 2) {
            if (adxRising && !adxWeak) {
                // Allow only breakout direction
                if (targetCandle.color === "green" && !isUpwardBreakout) {
                    isAllowed = false;
                }
                if (targetCandle.color === "red" && !isDownwardBreakout) {
                    isAllowed = false;
                }
            }

            if (adxWeak) {
                // Block breakout trades even if score <= 3
                if (isUpwardBreakout || isDownwardBreakout) {
                    isAllowed = false;
                }
            }
        }

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
                targetCandle: {
                    isNotGood: isTargetCandleNotGood(targetCandle, atrPercent, minBodyPercent)
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
                maxScore,
                finalScore: normalized,
                isAllowed
            }
        };

        marketDetectorLogger.info(`[MarketRegimeDetail] ${symbol}`, details);

        skipTradingLogger.info(`[MarketRegime] ${symbol}`, {
            configId,
            userId,
            symbol,
            timeframe,
            regimeScore: normalized,
            isAllowed
        });

        return { score: normalized, isAllowed };
    }
}
