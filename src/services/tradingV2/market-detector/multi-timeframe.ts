import { marketDetectorLogger } from "../logger";
import { Candle, ConfigType, TargetCandle } from "../type";
import { MarketDetector } from "./market-detector";

export interface TripleTFResult {
    entryScore: number;
    confirmationScore: number;
    structureScore: number;
    isAllowed: boolean;
}

export class MultiTimeframeAlignment {

    static evaluate(
        entryTarget: TargetCandle,
        entryCandles: Candle[],
        confirmationCandles: Candle[],
        structureCandles: Candle[],
        entryConfig: ConfigType,
        confirmationConfig: ConfigType,
        structureConfig: ConfigType,
    ): TripleTFResult {

        const entryResult = MarketDetector.getMarketRegimeScore(
            entryTarget,
            entryCandles,
            entryConfig
        );

        const confirmationResult = MarketDetector.getMarketRegimeScore(
            entryTarget,
            confirmationCandles,
            confirmationConfig
        );

        const structureResult = MarketDetector.getMarketRegimeScore(
            entryTarget,
            structureCandles,
            structureConfig
        );

        const entryScore = entryResult.score;
        const confirmationScore = confirmationResult.score;
        const structureScore = structureResult.score;

        const symbol = entryConfig.SYMBOL;

        let isAllowed = false;
        let blockedReason: string | null = null;

        const logMTF = () => {
            marketDetectorLogger.info(`[MTFDetail] ${symbol}`, {
                isAllowed,
                blockedReason,
                entry: {
                    score: entryScore,
                    allowed: entryResult.isAllowed,
                    timeframe: entryConfig.TIMEFRAME
                },
                confirmation: {
                    score: confirmationScore,
                    allowed: confirmationResult.isAllowed,
                    timeframe: confirmationConfig.TIMEFRAME
                },
                structure: {
                    score: structureScore,
                    allowed: structureResult.isAllowed,
                    timeframe: structureConfig.TIMEFRAME
                },
            });
        };

        // 🚫 HARD BLOCKS (very choppy TF)
        if (structureScore >= 6 || confirmationScore >= 6) {
            blockedReason = "HARD_BLOCK_HIGH_CHOP_SCORE";
            logMTF();
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // 🚫 If any TF already blocked internally
        if (!structureResult.isAllowed || !confirmationResult.isAllowed) {
            blockedReason =
                !structureResult.isAllowed && !confirmationResult.isAllowed
                    ? "STRUCTURE_AND_CONFIRMATION_BLOCKED"
                    : !structureResult.isAllowed
                        ? "STRUCTURE_BLOCKED"
                        : "CONFIRMATION_BLOCKED";

            logMTF();
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // 🚫 Cumulative Chop Filter (medium stacking protection)
        if (structureScore + confirmationScore > 10) {
            blockedReason = "CUMULATIVE_CHOP_BLOCK";

            marketDetectorLogger.info(
                `[MTF] BLOCKED by cumulative chop filter | StructureScore=${structureScore} | ConfirmationScore=${confirmationScore} | Sum=${structureScore + confirmationScore}`
            );

            logMTF();
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // ✅ Final Allow Condition
        if (
            structureScore <= 6 &&
            confirmationScore <= 6 &&
            entryResult.isAllowed
        ) {
            isAllowed = true;
        } else {
            blockedReason = "ENTRY_TF_BLOCKED";
        }

        logMTF();

        return {
            entryScore,
            confirmationScore,
            structureScore,
            isAllowed,
        };
    }
}