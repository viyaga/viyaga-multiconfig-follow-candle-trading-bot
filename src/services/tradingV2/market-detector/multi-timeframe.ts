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

        const symbol = entryConfig.SYMBOL;

        const logMTF = (isAllowed: boolean, blockedReason: string | null) => {
            marketDetectorLogger.info(`[MTFDetail] ${symbol}`, {
                isAllowed,
                blockedReason,
                tradeDirection,
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
                // ── Per-TF directional bias ───────────────────────────
                entryBias: {
                    direction: entryBias.direction,
                    strength: entryBias.strength,
                    adx: +entryBias.adx.toFixed(4),
                    emaFast: +entryBias.emaFast.toFixed(4),
                    emaSlow: +entryBias.emaSlow.toFixed(4),
                    breakoutDetected: entryBias.breakoutDetected
                },
                confirmationBias: {
                    direction: confirmationBias.direction,
                    strength: confirmationBias.strength,
                    adx: +confirmationBias.adx.toFixed(4),
                    emaFast: +confirmationBias.emaFast.toFixed(4),
                    emaSlow: +confirmationBias.emaSlow.toFixed(4),
                    breakoutDetected: confirmationBias.breakoutDetected
                },
                structureBias: {
                    direction: structureBias.direction,
                    strength: structureBias.strength,
                    adx: +structureBias.adx.toFixed(4),
                    emaFast: +structureBias.emaFast.toFixed(4),
                    emaSlow: +structureBias.emaSlow.toFixed(4),
                    breakoutDetected: structureBias.breakoutDetected
                }
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

        if (structureBias.strength < MIN_STRUCTURE_STRENGTH) {
            logMTF(false, `STRUCTURE_BIAS_TOO_WEAK (strength=${structureBias.strength} < ${MIN_STRUCTURE_STRENGTH})`);
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        if (structureBias.direction !== "NEUTRAL" &&
            structureBias.direction !== tradeDirection) {
            logMTF(false, `STRUCTURE_BIAS_OPPOSING (bias=${structureBias.direction}, trade=${tradeDirection})`);
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        if (confirmationBias.direction !== "NEUTRAL" &&
            confirmationBias.direction !== tradeDirection) {
            logMTF(false, `CONFIRMATION_BIAS_OPPOSING (bias=${confirmationBias.direction}, trade=${tradeDirection})`);
            return { entryScore, confirmationScore, structureScore, isAllowed: false };
        }

        if (entryBias.direction !== "NEUTRAL" &&
            entryBias.direction !== tradeDirection) {
            logMTF(false, `ENTRY_BIAS_OPPOSING (bias=${entryBias.direction}, trade=${tradeDirection})`);
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