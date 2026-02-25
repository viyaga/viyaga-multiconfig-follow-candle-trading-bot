import { marketDetectorLogger } from "../logger";
import { Candle, ConfigType, TargetCandle } from "../type";
import { MarketDetector } from "./index";

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
        structureConfig: ConfigType
    ): TripleTFResult {

        // ===== ENTRY =====
        const entryResult = MarketDetector.getMarketRegimeScore(
            entryTarget,
            entryCandles,
            entryConfig
        );

        // ===== CONFIRMATION =====
        const confirmationResult = MarketDetector.getMarketRegimeScore(
            entryTarget,
            confirmationCandles,
            confirmationConfig
        );

        // ===== STRUCTURE =====
        const structureResult = MarketDetector.getMarketRegimeScore(
            entryTarget,
            structureCandles,
            structureConfig
        );

        const entryScore = entryResult.score;
        const confirmationScore = confirmationResult.score;
        const structureScore = structureResult.score;

        let isAllowed = false;

        // 🚫 HARD BLOCKS
        if (structureScore >= 6) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        if (confirmationScore >= 6) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // ✅ Base Alignment
        if (
            structureScore <= 4 &&
            confirmationScore <= 4 &&
            entryResult.isAllowed
        ) {
            isAllowed = true;
        }

        marketDetectorLogger.info(
            `[MTF] EntryScore=${entryScore} | ConfirmationScore=${confirmationScore} | StructureScore=${structureScore} | Allowed=${isAllowed}`
        );

        return {
            entryScore,
            confirmationScore,
            structureScore,
            isAllowed,
        };
    }
}
