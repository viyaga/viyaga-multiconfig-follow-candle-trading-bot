import { marketDetectorLogger } from "../logger";
import { Candle, ConfigType, TargetCandle } from "../type";
import { MarketDetector } from "./market-detector";
import { evaluateBreakoutTrade } from "./master-breakout-system";

export interface TripleTFResult {
    entryScore: number;
    confirmationProbability: number;
    structureProbability: number;
    isAllowed: boolean;
    direction: "BUY" | "SELL" | "NONE";
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
    ): TripleTFResult {

        // ───────────────── HTF REGIME (CHOP) ─────────────────
        const confirmationResult = MarketDetector.getMarketProbability(
            confirmationTarget,
            confirmationCandles,
            confirmationConfig,
            "confirmation"
        );

        const structureResult = MarketDetector.getMarketProbability(
            structureTarget,
            structureCandles,
            structureConfig,
            "structure"
        );

        const confirmationProbability = confirmationResult.probability;
        const structureProbability = structureResult.probability;

        const symbol = entryConfig.SYMBOL;

        // ───────────────── MASTER BREAKOUT SCORE (ENTRY) ─────────────────
        // 🔥 No separate breakout + market score
        // ✅ One final score for entry
        const breakout = evaluateBreakoutTrade(entryCandles, entryTarget, entryConfig);
        const direction = breakout.direction;
        const breakoutScore = breakout.score;
        const isBreakoutTrade = breakout.isTrade;

        let isAllowed = false;
        let blockedReason: string | null = null;

        const logMTF = () => {
            marketDetectorLogger.info(`[MTFDetail] ${symbol}`, {
                isAllowed,
                blockedReason,
                breakoutScore,
                entry: {
                    score: breakoutScore,
                    isTrade: isBreakoutTrade,
                    timeframe: entryConfig.TIMEFRAME
                },
                confirmation: {
                    score: confirmationProbability,
                    allowed: confirmationResult.isAllowed,
                    timeframe: confirmationConfig.TIMEFRAME
                },
                structure: {
                    score: structureProbability,
                    allowed: structureResult.isAllowed,
                    timeframe: structureConfig.TIMEFRAME
                },
            });
        };

        // 🔴 MANDATORY BREAKOUT
        if (direction === "NONE") {
            blockedReason = "NO_BREAKOUT";
            logMTF();
            return {
                entryScore: breakoutScore,
                confirmationProbability,
                structureProbability,
                isAllowed: false,
                direction: "NONE"
            };
        }

        // 🔴 HARD BLOCK: HTF chop (Optional but kept for safety)
        if (structureProbability >= 55 || confirmationProbability >= 55) {
            blockedReason = "HIGH_TF_CHOP_BLOCK";
            logMTF();
            return {
                entryScore: breakoutScore,
                confirmationProbability,
                structureProbability,
                isAllowed: false,
                direction
            };
        }

        if (!structureResult.isAllowed || !confirmationResult.isAllowed) {
            blockedReason = "HTF_FILTER_BLOCK";
            logMTF();
            return {
                entryScore: breakoutScore,
                confirmationProbability,
                structureProbability,
                isAllowed: false,
                direction
            };
        }

        // ✅ FINAL ENTRY LOGIC
        // 🔥 Score-based decision (no binary thinking)

        if (breakoutScore >= 10) {
            isAllowed = true; // strong breakout
        } else if (breakoutScore >= 8) {
            // medium → allow only if HTF is clean
            if (confirmationProbability <= 4 && structureProbability <= 4) {
                isAllowed = true;
            } else {
                blockedReason = "HTF_NOT_SUPPORTING";
            }
        } else {
            blockedReason = "LOW_SCORE_BREAKOUT";
        }

        logMTF();

        return {
            entryScore: breakoutScore,
            confirmationProbability,
            structureProbability,
            isAllowed,
            direction
        };
    }
}
