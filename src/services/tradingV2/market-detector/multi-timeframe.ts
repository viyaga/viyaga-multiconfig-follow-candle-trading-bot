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
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
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
        const direction = breakout.direction;
        const entryScore = breakout.score;

        const symbol = entryConfig.SYMBOL;

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
                rr: 0
            };
        }

        /* ================= FINAL SCORE ================= */

        const finalScore = Math.round(
            (entryScore * 0.50) +
            (confirmationProbability * 0.25) +
            (structureProbability * 0.25)
        );

        let decision: TradeDecision = "SKIP";

        if (finalScore >= 75) decision = "STRONG_TRADE";
        else if (finalScore >= 65) decision = "GOOD_TRADE";
        else if (finalScore >= 50) decision = "WEAK_TRADE";

        let isAllowed = finalScore >= 65;

        /* ================= EXTRA FILTER (OPTIONAL BUT STRONG) ================= */

        const isStrongTrend =
            confirmationProbability > 60 &&
            structureProbability > 60;

        if (!isStrongTrend && entryScore < 65) {
            isAllowed = false;
        }

        /* ================= 🔥 DYNAMIC TP/SL ================= */

        let tp = 0;
        let sl = 0;
        let rr = 0;

        if (isAllowed) {

            const entryPrice = entryTarget.close;
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

                /* ================= CONFIRMATION BOOST ================= */

                if (confirmationProbability > 70) {
                    tpATR += 0.4;
                }

                if (structureProbability < 55) {
                    tpATR -= 0.3;
                }

                /* ================= CALC ================= */

                if (direction === "BUY") {
                    sl = entryPrice - atr * slATR;
                    tp = entryPrice + atr * tpATR;
                } else {
                    sl = entryPrice + atr * slATR;
                    tp = entryPrice - atr * tpATR;
                }

                const risk = Math.abs(entryPrice - sl);
                const reward = Math.abs(tp - entryPrice);

                rr = risk > 0 ? reward / risk : 0;

                /* ================= 🔥 RR FILTER ================= */

                if (rr < 1.6) {
                    return {
                        entryScore,
                        confirmationProbability,
                        structureProbability,
                        finalScore,
                        decision: "SKIP",
                        isAllowed: false,
                        direction: "NONE",
                        tp: 0,
                        sl: 0,
                        rr: 0
                    };
                }
            }
        }

        /* ================= LOG ================= */

        if (isAllowed) {

            marketDetectorLogger.info(`[MTFDetail] ${symbol}`, {
                FS: finalScore,
                isAllowed,
                tp,
                sl,
                D: direction,
                ES: entryScore,
                CP: confirmationProbability,
                SP: structureProbability,
                DEC: decision,
                RR: rr
            });

            marketDetectorLogger.info(`[MarketProbability] ${symbol}`, {
                probability: confirmationResult.probability,
                isAllowed: confirmationResult.isAllowed,
                mode: confirmationResult.mode,
                details: confirmationResult.details,
            });

            marketDetectorLogger.info(`[MarketProbability] ${symbol}`, {
                probability: structureResult.probability,
                isAllowed: structureResult.isAllowed,
                mode: structureResult.mode,
                details: structureResult.details,
            });
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
            rr
        };
    }
}
