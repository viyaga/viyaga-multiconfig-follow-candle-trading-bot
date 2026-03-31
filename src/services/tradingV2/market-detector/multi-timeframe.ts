import { marketDetectorLogger } from "../logger";
import { Candle, ConfigType, TargetCandle } from "../type";
import { MarketDetector } from "./market-detector";
import { evaluateBreakoutTrade } from "./master-breakout-system";

export type TradeDecision = "STRONG_TRADE" | "GOOD_TRADE" | "WEAK_TRADE" | "SKIP";

export interface TripleTFResult {
    entryScore: number; // breakout quality score 0..100
    confirmationProbability: number; // 0..100
    structureProbability: number; // 0..100
    finalScore: number; // 0..100
    decision: TradeDecision;
    isAllowed: boolean;
    direction: "BUY" | "SELL" | "NONE";
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
            const finalScore = 0;
            const decision: TradeDecision = "SKIP";

            marketDetectorLogger.info(`[MTFDetail] ${symbol}`, {
                direction,
                entryScore,
                confirmationProbability,
                structureProbability,
                finalScore,
                decision,
                isAllowed: false,
            });

            return {
                entryScore,
                confirmationProbability,
                structureProbability,
                finalScore,
                decision,
                isAllowed: false,
                direction: "NONE",
            };
        }

        const finalScore = Math.round(
            (entryScore * 0.50) +
            (confirmationProbability * 0.25) +
            (structureProbability * 0.25)
        );

        let decision: TradeDecision = "SKIP";

        if (finalScore >= 75) decision = "STRONG_TRADE";
        else if (finalScore >= 65) decision = "GOOD_TRADE";
        else if (finalScore >= 50) decision = "WEAK_TRADE";

        const isAllowed = finalScore >= 50;

        marketDetectorLogger.info(`[MTFDetail] ${symbol}`, {
            direction,
            entryScore,
            confirmationProbability,
            structureProbability,
            finalScore,
            decision,
            isAllowed,
            entry: {
                score: entryScore,
                isTrade: breakout.isTrade,
                timeframe: entryConfig.TIMEFRAME,
            },
            confirmation: {
                score: confirmationProbability,
                allowed: confirmationResult.isAllowed,
                timeframe: confirmationConfig.TIMEFRAME,
            },
            structure: {
                score: structureProbability,
                allowed: structureResult.isAllowed,
                timeframe: structureConfig.TIMEFRAME,
            },
        });

        return {
            entryScore,
            confirmationProbability,
            structureProbability,
            finalScore,
            decision,
            isAllowed,
            direction,
        };
    }
}