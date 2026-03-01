import { Candle, ConfigType, InternalChopConfig, TargetCandle } from "../type";
import { marketDetectorLogger } from "../logger";
import { getInternalConfig } from "./config";
import { calculateATR, getRollingATRPercentAvg, calculateADXSeries } from "./indicators";
import { detectMicroChop, isVolumeContracting, getBodyPercent, getRangePercent, isTargetCandleNotGood, isRangeCompressed } from "./price-action";

// ✅ Fixed total weight — NEVER changes dynamically
const TOTAL_WEIGHT = 14;

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
            config.MIN_MOVEMENT_PERCENT
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
        minBodyPercent: number,

    ): { score: number, isAllowed: boolean } {
        if (candles.length < cfg.MIN_REQUIRED_CANDLES) return { score: 7, isAllowed: false };

        let chopPoints = 0;

        const latestClose = candles[candles.length - 1].close;

        /* ================= ATR (weight: 2) ================= */
        const atr = calculateATR(candles, cfg.ATR_PERIOD);
        const atrPercent = latestClose === 0 ? 0 : (atr / latestClose) * 100;
        const atrAvg = getRollingATRPercentAvg(candles, cfg.ATR_PERIOD);

        // ✅ Fix #3: Use ONLY adaptive comparison, no fixed threshold, weight=2
        if (atrPercent < atrAvg * 0.7) {
            chopPoints += 2;
        }

        /* ================= ADX (weight: up to 3) ================= */
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

            // ✅ Fix #4: Graduated ADX scoring — weak trend ≠ chop
            if (currentADX < 18) {
                chopPoints += 2;
            } else if (currentADX < 22) {
                chopPoints += 1;
            }

            // ✅ Rising ADX reduces chop penalty (trend strengthening)
            if (currentADX > prevADX && currentADX > 20) {
                chopPoints -= 1;
            }

            // Clamp: ADX contribution cannot go below 0
            chopPoints = Math.max(0, chopPoints);
        }

        /* ================= STRUCTURE (weight: 2) ================= */
        const recent = candles.slice(-cfg.STRUCTURE_LOOKBACK);
        const rangePercent = getRangePercent(recent);

        // ✅ Fix #5: Use atrAvg (rolling baseline), not atrPercent (current)
        // Multiplier by timeframe: 15m=1.0, 1h=1.2, 4h=1.4
        const structureMultiplier =
            timeframe.includes("4h") ? 1.4 :
                timeframe.includes("1h") ? 1.2 :
                    1.0;

        if (rangePercent < atrAvg * structureMultiplier) chopPoints += 2;

        /* ================= MICRO CHOP (weight: 2) ================= */
        // ✅ Fix #6: Pass atrAvg, not atrPercent (function signature updated in price-action.ts)
        if (detectMicroChop(candles, atrAvg, cfg.SMALL_BODY_PERCENT_THRESHOLD)) {
            chopPoints += 2;
        }

        /* ================= TARGET CANDLE (weight: 2) ================= */
        if (isTargetCandleNotGood(targetCandle, atrPercent, minBodyPercent)) {
            chopPoints += 2;
        }

        /* ================= VOLUME (weight: 2) ================= */
        if (isVolumeContracting(candles)) chopPoints += 2;

        /* ================= BREAKOUT REDUCTION ================= */
        let breakoutReduction = 0;
        let breakoutOverrideActive = false;

        const last = candles[candles.length - 1];
        const prevHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
        const prevLow = Math.min(...recent.slice(0, -1).map(c => c.low));

        const isUpwardBreakout = last.close > prevHigh;
        const isDownwardBreakout = last.close < prevLow;
        const isBreakout = isUpwardBreakout || isDownwardBreakout;

        const lastBodyPercent = getBodyPercent(last);
        const lastRangePercent = last.close === 0 ? 0 : ((last.high - last.low) / last.close) * 100;

        let lastVolOk = false;
        if (candles.length >= 20) {
            const avgVol = candles.slice(-20, -1).reduce((a, b) => a + b.volume, 0) / 19;
            lastVolOk = last.volume > avgVol * 1.3;
        }

        // ✅ Fix #7: Stronger breakout override requires ALL 4 criteria → -4 chop points
        if (
            isBreakout &&
            lastBodyPercent > 65 &&
            lastVolOk &&
            lastRangePercent > atrAvg * 1.2
        ) {
            breakoutReduction = 4;
            breakoutOverrideActive = true;
        }

        /* ================= COMPRESSION BLOCK ================= */
        const maxRangePercent =
            timeframe.includes("4h") ? 3 :
                timeframe.includes("1h") ? 2 :
                    1;

        const compressed = isRangeCompressed(candles, 4, 15, maxRangePercent);
        if (compressed) chopPoints += 2;

        chopPoints = Math.max(0, chopPoints - breakoutReduction);

        /* ================= FINAL SCORE (fixed scale: /14 * 10) ================= */
        // ✅ Fix #1: Fixed weight scoring — no dynamic maxScore
        let finalScore = Math.min(10, Math.round((chopPoints / TOTAL_WEIGHT) * 10));

        /* ================= TRADE ENTRY — CHOP PRIORITY MODE ================= */
        // ✅ Fix #8: Trade definitively if strong breakout, otherwise check score <= 3
        let isAllowed = false;

        if (breakoutOverrideActive) {
            isAllowed = true; // ✅ DEFINITELY allow strong breakouts
        } else if (finalScore <= 4) {
            isAllowed = true;
        }
        // Block if finalScore >= 5 (implicit: no other path sets isAllowed=true)

        const details = {
            configId,
            userId,
            symbol,
            timeframe,
            regimeScore: finalScore,
            metrics: {
                atr: {
                    value: atr,
                    percent: atrPercent,
                    avg: atrAvg,
                    isChoppy: atrPercent < atrAvg * 0.7
                },
                adx: adxSeries.length >= 2 ? {
                    current: currentADX,
                    prev: prevADX,
                    isWeak: adxWeak,
                    isRising: adxRising
                } : null,
                structure: {
                    rangePercent,
                    atrAvg,
                    multiplier: structureMultiplier,
                    isRangeChoppy: rangePercent < atrAvg * structureMultiplier
                },
                microChop: {
                    detected: detectMicroChop(candles, atrAvg, cfg.SMALL_BODY_PERCENT_THRESHOLD)
                },
                targetCandle: {
                    isNotGood: isTargetCandleNotGood(targetCandle, atrPercent, minBodyPercent)
                },
                volume: {
                    isContracting: isVolumeContracting(candles)
                },
                breakout: {
                    isBreakout,
                    bodyPercent: lastBodyPercent,
                    rangePercent: lastRangePercent,
                    highVolumeOk: lastVolOk,
                    overrideActive: breakoutOverrideActive,
                    reduction: breakoutReduction
                },
                compression: {
                    isCompressed: compressed,
                    maxRangePercent: maxRangePercent
                }
            },
            scores: {
                chopPoints,
                breakoutReduction,
                totalWeight: TOTAL_WEIGHT,
                finalScore,
                breakoutOverrideActive,
                isAllowed
            }
        };

        marketDetectorLogger.info(`[MarketRegimeDetail] ${symbol}`, details);

        return { score: finalScore, isAllowed };
    }
}
