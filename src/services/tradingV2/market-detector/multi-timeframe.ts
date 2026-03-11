import { marketDetectorLogger } from "../logger";
import { Candle, ConfigType, TargetCandle } from "../type";
import { MarketDetector } from "./market-detector";

export interface TripleTFResult {
    entryScore: number;
    confirmationScore: number;
    structureScore: number;
    isAllowed: boolean;
    direction: "BUY" | "SELL" | "NONE";
}

export class MultiTimeframeAlignment {

    static getBreakoutDirection(
        candles: Candle[],
        target: TargetCandle,
        lookback: number
    ): "BUY" | "SELL" | "NONE" {

        const recent = candles.slice(-lookback);

        const prevHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
        const prevLow = Math.min(...recent.slice(0, -1).map(c => c.low));

        if (target.close > prevHigh)
            return "BUY";

        if (target.close < prevLow)
            return "SELL";

        return "NONE";
    }

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

        const entryResult = MarketDetector.getMarketRegimeScore(
            entryTarget,
            entryCandles,
            entryConfig,
            "entry"
        );

        const confirmationResult = MarketDetector.getMarketRegimeScore(
            confirmationTarget,
            confirmationCandles,
            confirmationConfig,
            "confirmation"
        );

        const structureResult = MarketDetector.getMarketRegimeScore(
            structureTarget,
            structureCandles,
            structureConfig,
            "structure"
        );

        const entryScore = entryResult.score;
        const confirmationScore = confirmationResult.score;
        const structureScore = structureResult.score;

        const symbol = entryConfig.SYMBOL;

        const direction =
            this.getBreakoutDirection(
                entryCandles,
                entryTarget,
                entryConfig.STRUCTURE_LOOKBACK || 20
            );

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
            return { entryScore, confirmationScore, structureScore, isAllowed: false, direction };
        }

        if (!structureResult.isAllowed || !confirmationResult.isAllowed) {
            blockedReason = "HTF_FILTER_BLOCK";
            logMTF();
            return { entryScore, confirmationScore, structureScore, isAllowed: false, direction };
        }

        if (direction === "NONE") {
            blockedReason = "NO_BREAKOUT_DIRECTION";
            logMTF();
            return {
                entryScore,
                confirmationScore,
                structureScore,
                isAllowed: false,
                direction: "NONE"
            };
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
            isAllowed,
            direction
        };
    }

}
