import { Candle, ConfigType, TargetCandle } from "../type";
import { MarketDetector } from "./index";

export interface TripleTFResult {
    entryScore: number;
    confirmationScore: number;
    structureScore: number;
    isAllowed: boolean;
    direction: "long" | "short" | null;
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
        let direction: "long" | "short" | null = null;

        // 🚫 HARD BLOCKS
        if (structureScore >= 6) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false, direction: null };
        }

        if (confirmationScore >= 6) {
            return { entryScore, confirmationScore, structureScore, isAllowed: false, direction: null };
        }

        // ✅ Base Alignment
        if (
            structureScore <= 4 &&
            confirmationScore <= 4 &&
            entryResult.isAllowed
        ) {
            isAllowed = true;
        }

        // ===== STRUCTURE DIRECTION BIAS =====
        const recent = structureCandles.slice(-10);
        const last = structureCandles[structureCandles.length - 1];

        const prevHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
        const prevLow = Math.min(...recent.slice(0, -1).map(c => c.low));

        const bullish = last.close > prevHigh;
        const bearish = last.close < prevLow;

        if (bullish) direction = "long";
        if (bearish) direction = "short";

        // 🚫 Block counter-direction trades
        if (direction === "long" && entryTarget.color === "red") {
            isAllowed = false;
        }

        if (direction === "short" && entryTarget.color === "green") {
            isAllowed = false;
        }

        return {
            entryScore,
            confirmationScore,
            structureScore,
            isAllowed,
            direction
        };
    }
}
