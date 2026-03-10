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

        // Hard block if higher timeframe is extremely choppy
        if (structureScore >= 7 || confirmationScore >= 7) {
            blockedReason = "HIGH_TF_CHOP_BLOCK";
            logMTF();
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        if (!structureResult.isAllowed || !confirmationResult.isAllowed) {
            blockedReason = "HTF_FILTER_BLOCK";
            logMTF();
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // Breakout alignment rule
        if (
            structureScore <= 5 &&
            confirmationScore <= 5 &&
            entryResult.isAllowed
        ) {
            isAllowed = true;
        } else {
            blockedReason = "ENTRY_FILTER_BLOCK";
        }

        logMTF();

        return {
            entryScore,
            confirmationScore,
            structureScore,
            isAllowed
        };
    }
}