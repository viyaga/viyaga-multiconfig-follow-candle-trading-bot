import { marketDetectorLogger } from "../logger";
import { Candle, ConfigType, TargetCandle } from "../type";
import { MarketDetector } from "./market-detector";
import { getDirectionalBias, TradeDirection } from "./bias";

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
        tradeDirection: TradeDirection
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

        const entryBias = getDirectionalBias(entryCandles);
        const confirmationBias = getDirectionalBias(confirmationCandles);
        const structureBias = getDirectionalBias(structureCandles);

        let isAllowed = false;

        if (!structureResult.isAllowed || !confirmationResult.isAllowed) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        if (structureBias.strength < MIN_STRUCTURE_STRENGTH) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        if (structureBias.direction !== "NEUTRAL" &&
            structureBias.direction !== tradeDirection) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        if (confirmationBias.direction !== "NEUTRAL" &&
            confirmationBias.direction !== tradeDirection) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        if (entryBias.direction !== "NEUTRAL" &&
            entryBias.direction !== tradeDirection) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        if (entryResult.isAllowed) {
            isAllowed = true;
        }

        marketDetectorLogger.info(
            `[MTF] Entry=${entryScore} Confirm=${confirmationScore} Structure=${structureScore} | Allowed=${isAllowed}`
        );

        return {
            entryScore,
            confirmationScore,
            structureScore,
            isAllowed,
        };
    }
}