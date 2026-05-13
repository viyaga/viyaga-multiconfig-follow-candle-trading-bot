import { marketDetectorLogger } from "../logger";
import { Candle, ConfigType, TargetCandle } from "../type";
import { MarketDetector } from "./market-detector";
import { evaluateBreakoutTrade } from "./master-breakout-system";
import { calculateATR } from "./indicators"; // 🔥 NEW

export type TradeDecision = "STRONG_TRADE" | "GOOD_TRADE" | "WEAK_TRADE" | "SKIP";

export interface TripleTFResult {
    entryScore: number;
    confirmationProbability: number;
    structureProbability: number;
    finalScore: number;
    decision: TradeDecision;
    isAllowed: boolean;
    direction: "BUY" | "SELL" | "NONE";

    // 🔥 NEW
    tp: number;
    sl: number;
    rr: number;
    tpPerc: number;
    slPerc: number;
}

export class MultiTimeframeAlignment {
    static evaluate(
        entryTarget: TargetCandle,
        confirmationTarget: TargetCandle,
        structureTarget: TargetCandle,
        entryCandles: Candle[],
        confirmationCandles: Candle[],
        structureCandles: Candle[],
        entryConfig: ConfigType,
        confirmationConfig: ConfigType,
        structureConfig: ConfigType,
        currentPriceParam?: number,
        logContext?: any
    ): TripleTFResult {

        const confirmationResult = MarketDetector.getMarketProbability(
            confirmationTarget,
            confirmationCandles,
            confirmationConfig,
            "confirmation",
            logContext
        );

        const structureResult = MarketDetector.getMarketProbability(
            structureTarget,
            structureCandles,
            structureConfig,
            "structure",
            logContext
        );

        const confirmationProbability = confirmationResult.probability;
        const structureProbability = structureResult.probability;

        const breakout = evaluateBreakoutTrade(entryCandles, entryTarget, entryConfig);
        let direction = breakout.direction;
        const entryScore = breakout.score;

        marketDetectorLogger.info(`[MTF] Sub-scores for ${entryConfig.SYMBOL}: Entry=${entryScore}, Confirmation=${confirmationProbability}, Structure=${structureProbability}`);
        marketDetectorLogger.debug(`[MTF] Breakout details for ${entryConfig.SYMBOL}: Direction=${breakout.direction}, Score=${breakout.score}, Reason=${breakout.reason}`);

        const symbol = entryConfig.SYMBOL;

        // 🔥 TESTING OVERRIDE: If testing and no breakout, force BUY
        if (direction === "NONE" && entryConfig.IS_TESTING) {
            marketDetectorLogger.info(`[TESTING] ${symbol}: Forcing BUY direction since entry search was NONE`);
            direction = "BUY";
        }

        if (direction === "NONE") {
            return {
                entryScore,
                confirmationProbability,
                structureProbability,
                finalScore: 0,
                decision: "SKIP",
                isAllowed: false,
                direction: "NONE",
                tp: 0,
                sl: 0,
                rr: 0,
                tpPerc: 0,
                slPerc: 0,
            };
        }

        /* ================= FINAL SCORE ================= */

        const finalScore = Math.round(
            (entryScore * 0.50) +
            (confirmationProbability * 0.25) +
            (structureProbability * 0.25)
        );

        marketDetectorLogger.info(`[MTF] Final Score Calculation: (${entryScore} * 0.5) + (${confirmationProbability} * 0.25) + (${structureProbability} * 0.25) = ${finalScore}`);

        let decision: TradeDecision = "SKIP";

        if (finalScore >= 75) decision = "STRONG_TRADE";
        else if (finalScore >= 65) decision = "GOOD_TRADE";
        else if (finalScore >= 50) decision = "WEAK_TRADE";

        // Preliminary permission based on score
        let isAllowedScore = entryConfig.IS_TESTING || finalScore >= 65;

        /* ================= EXTRA FILTER (OPTIONAL BUT STRONG) ================= */

        const isStrongTrend =
            confirmationProbability > 60 &&
            structureProbability > 60;

        if (!entryConfig.IS_TESTING && !isStrongTrend && entryScore < 65) {
            isAllowedScore = false;
        }

        /* ================= 🔥 DYNAMIC TP/SL ================= */

        let tp = 0;
        let sl = 0;
        let rr = 0;
        let tpPerc = 0;
        let slPerc = 0;
        const leverage = entryConfig.LEVERAGE;

        // 🔥 Use current price if provided, otherwise fallback to candle close
        const entryPrice = currentPriceParam && currentPriceParam > 0 ? currentPriceParam : entryTarget.close;
        const atr = calculateATR(entryCandles, 14);

        if (atr > 0 && entryPrice > 0) {

            /* ================= BASE ================= */

            let slATR = 1.2;
            let tpATR = 2.0;

            /* ================= SCORE BASED ================= */

            if (finalScore >= 75) {
                slATR = 1.5;
                tpATR = 3.0;
            } else if (finalScore >= 65) {
                slATR = 1.3;
                tpATR = 2.4;
            } else {
                slATR = 1.0;
                tpATR = 1.6;
            }
            marketDetectorLogger.debug(`[MTF] Base TP/SL ATR multipliers: TP=${tpATR}, SL=${slATR} (Score: ${finalScore})`);

            /* ================= CONFIRMATION BOOST ================= */

            if (confirmationProbability > 70) {
                tpATR += 0.4;
                marketDetectorLogger.debug(`[MTF] Confirmation probability boost applied: +0.4 TP ATR`);
            }

            if (structureProbability < 55) {
                tpATR -= 0.3;
                marketDetectorLogger.debug(`[MTF] Weak structure penalty applied: -0.3 TP ATR`);
            }

            /* ================= CALC ================= */

            if (direction === "BUY") {
                sl = parseFloat((entryPrice - atr * slATR).toFixed(entryConfig.PRICE_DECIMAL_PLACES));
                tp = parseFloat((entryPrice + atr * tpATR).toFixed(entryConfig.PRICE_DECIMAL_PLACES));

                // 🔥 MAX SL PRICE MOVEMENT (2%)
                const maxSlDist = entryPrice * 0.02;
                const minSlPrice = parseFloat((entryPrice - maxSlDist).toFixed(entryConfig.PRICE_DECIMAL_PLACES));
                sl = Math.max(sl, minSlPrice);

            } else {
                sl = parseFloat((entryPrice + atr * slATR).toFixed(entryConfig.PRICE_DECIMAL_PLACES));
                tp = parseFloat((entryPrice - atr * tpATR).toFixed(entryConfig.PRICE_DECIMAL_PLACES));

                // 🔥 MAX SL PRICE MOVEMENT (2%)
                const maxSlDist = entryPrice * 0.02;
                const maxSlPrice = parseFloat((entryPrice + maxSlDist).toFixed(entryConfig.PRICE_DECIMAL_PLACES));
                sl = Math.min(sl, maxSlPrice);
            }

            const rawRisk = Math.abs(entryPrice - sl);
            // 🔥 Include SL buffer in risk calculation for accurate RR
            const riskPriceDist = rawRisk + (sl * entryConfig.SL_LIMIT_BUFFER_PERCENT / 100);
            const rewardPriceDist = Math.abs(tp - entryPrice);

            // 🔥 Include Estimated Fees in RR (Conservative)
            const feePercent = entryConfig.ESTIMATED_FEE_PERCENT / 100;
            const entryFee = entryPrice * (feePercent / 2);
            const exitFeeTp = tp * (feePercent / 2);
            const exitFeeSl = sl * (feePercent / 2);

            const netReward = rewardPriceDist - (entryFee + exitFeeTp);
            const netRisk = riskPriceDist + (entryFee + exitFeeSl);

            rr = netRisk > 0 ? netReward / netRisk : 0;

            tpPerc = entryPrice > 0 ? (rewardPriceDist / entryPrice) * 100 * leverage : 0;
            slPerc = entryPrice > 0 ? (riskPriceDist / entryPrice) * 100 * leverage : 0;

            marketDetectorLogger.info(`[MTF] Dynamic TP/SL for ${symbol}: ATR=${atr.toFixed(4)}, Entry=${entryPrice}, TP=${tp} (${tpPerc.toFixed(2)}%), SL=${sl} (${slPerc.toFixed(2)}%), Net RR=${rr.toFixed(2)} (Fees incl.)`);

        } else if (entryConfig.IS_TESTING && entryPrice > 0) {
            // 🔥 TESTING FALLBACK: If ATR is 0, use 0.5% fixed move
            const fallbackAtr = entryPrice * 0.005;
            marketDetectorLogger.info(`[TESTING] ${symbol}: ATR is 0, using fallback TP/SL (0.5% price movement)`);

            if (direction === "BUY") {
                sl = parseFloat((entryPrice - fallbackAtr * 1.5).toFixed(entryConfig.PRICE_DECIMAL_PLACES));
                tp = parseFloat((entryPrice + fallbackAtr * 3.0).toFixed(entryConfig.PRICE_DECIMAL_PLACES));
            } else {
                sl = parseFloat((entryPrice + fallbackAtr * 1.5).toFixed(entryConfig.PRICE_DECIMAL_PLACES));
                tp = parseFloat((entryPrice - fallbackAtr * 3.0).toFixed(entryConfig.PRICE_DECIMAL_PLACES));
            }
            rr = 2.0;
            tpPerc = 0.5 * leverage;
            slPerc = 0.25 * leverage;
        }

        /* ================= FINAL PERMISSION ================= */

        let isAllowed = isAllowedScore && tp > 0 && sl > 0;

        // 🔥 RR FILTER
        if (!entryConfig.IS_TESTING && rr < entryConfig.MIN_RR) {
            isAllowed = false;
        }

        /* ================= LOG ================= */

        /* ================= LOG ================= */
        const mtfLogPrefix = isAllowed ? '[MTF-Allowed]' : '[MTF-Skip]';
        marketDetectorLogger.info(`${mtfLogPrefix} ${symbol} | FS: ${finalScore} | Dir: ${direction} | Dec: ${decision} | RR: ${rr.toFixed(2)} | TP: ${tp} | SL: ${sl}`);

        if (isAllowed) {
            marketDetectorLogger.debug(`[MarketProbability] ${symbol} Confirmation`, {
                probability: confirmationResult.probability,
                isAllowed: confirmationResult.isAllowed,
                mode: confirmationResult.mode,
                details: confirmationResult.details,
            });

            marketDetectorLogger.debug(`[MarketProbability] ${symbol} Structure`, {
                probability: structureResult.probability,
                isAllowed: structureResult.isAllowed,
                mode: structureResult.mode,
                details: structureResult.details,
            });
        } else if (rr < entryConfig.MIN_RR) {
            marketDetectorLogger.info(`[MTF-Skip] ${symbol} | Reward/Risk ratio too low: ${rr.toFixed(2)} < ${entryConfig.MIN_RR.toFixed(2)}`);
        }

        return {
            entryScore,
            confirmationProbability,
            structureProbability,
            finalScore,
            decision,
            isAllowed,
            direction,
            tp,
            sl,
            rr,
            tpPerc,
            slPerc,
        };
    }
}
