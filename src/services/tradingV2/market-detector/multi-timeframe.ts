import { marketDetectorLogger } from "../logger";
import { Candle, ConfigType, TargetCandle } from "../type";
import { MarketDetector } from "./index";
import { getDirectionalBias, TradeDirection } from "./bias";

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
        tradeDirection: TradeDirection // 🔥 NEW PARAM
    ): TripleTFResult {

        // ===== REGIME SCORES =====
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

        // ===== DIRECTION BIAS =====
        const entryBias = getDirectionalBias(entryCandles);
        const confirmationBias = getDirectionalBias(confirmationCandles);
        const structureBias = getDirectionalBias(structureCandles);

        let isAllowed = false;

        // 🚫 HARD BLOCK: High TF chop
        if (structureScore >= 6 || confirmationScore >= 6) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // 🚫 HARD BLOCK: Cumulative chop stacking
        if (structureScore + confirmationScore > 8) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // 🚫 HARD BLOCK: HTF Direction Conflict
        if (
            structureBias.direction !== "NEUTRAL" &&
            confirmationBias.direction !== "NEUTRAL" &&
            structureBias.direction !== confirmationBias.direction
        ) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // 🚫 HARD BLOCK: Trade against structure bias
        if (
            structureBias.direction !== "NEUTRAL" &&
            structureBias.direction !== tradeDirection
        ) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // 🚫 HARD BLOCK: Confirmation misaligned
        if (
            confirmationBias.direction !== "NEUTRAL" &&
            confirmationBias.direction !== tradeDirection
        ) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // 🚫 HARD BLOCK: Entry misaligned
        if (
            entryBias.direction !== "NEUTRAL" &&
            entryBias.direction !== tradeDirection
        ) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // 🚫 HARD BLOCK: Weak trend
        if (structureBias.strength < 5) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        // ✅ FINAL CHECK
        if (
            structureScore <= 4 &&
            confirmationScore <= 4 &&
            entryResult.isAllowed
        ) {
            isAllowed = true;
        }

        marketDetectorLogger.info(
            `[MTF] Entry=${entryScore} Confirm=${confirmationScore} Structure=${structureScore} | Bias=${structureBias.direction} | Allowed=${isAllowed}`
        );

        return {
            entryScore,
            confirmationScore,
            structureScore,
            isAllowed,
        };
    }
}