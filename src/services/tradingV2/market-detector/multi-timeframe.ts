import { marketDetectorLogger } from "../logger";
import { Candle, ConfigType, TargetCandle } from "../type";
import { MarketDetector } from "./market-detector";

export interface TripleTFResult {
    entryScore: number;
    confirmationScore: number;
    structureScore: number;
    isAllowed: boolean;
}

const MIN_STRUCTURE_STRENGTH = 6;

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

        const logMTF = (isAllowed: boolean, blockedReason: string | null) => {
            marketDetectorLogger.info(`[MTFDetail] ${symbol}`, {
                isAllowed,
                blockedReason,
                // ── Per-TF regime scores ──────────────────────────────
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

        if (!structureResult.isAllowed || !confirmationResult.isAllowed) {
            logMTF(false,
                !structureResult.isAllowed && !confirmationResult.isAllowed
                    ? "STRUCTURE_AND_CONFIRMATION_BLOCKED"
                    : !structureResult.isAllowed
                        ? "STRUCTURE_BLOCKED"
                        : "CONFIRMATION_BLOCKED"
            );
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        const isAllowed = entryResult.isAllowed;
        logMTF(isAllowed, isAllowed ? null : "ENTRY_TF_BLOCKED");

        return {
            entryScore,
            confirmationScore,
            structureScore,
            isAllowed,
        };
    }
}