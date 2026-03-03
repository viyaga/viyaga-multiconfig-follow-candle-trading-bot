import { ConfigType, InternalChopConfig } from "../type";

export function getInternalConfig(config: ConfigType): InternalChopConfig {

    const base: Record<string, InternalChopConfig> = {

        conservative: {
            ATR_PERIOD: 14,
            ADX_PERIOD: 14,
            ADX_WEAK_THRESHOLD: 23,      // strong trend required
            STRUCTURE_LOOKBACK: 14,
            SMALL_BODY_PERCENT_THRESHOLD: 50,
            SMALL_BODY_MIN_COUNT: 7,
            MIN_REQUIRED_CANDLES: 70,
            CHOP_SCORE_THRESHOLD: 3      // ultra clean only
        },

        balanced: {
            ATR_PERIOD: 14,
            ADX_PERIOD: 14,
            ADX_WEAK_THRESHOLD: 20,
            STRUCTURE_LOOKBACK: 10,
            SMALL_BODY_PERCENT_THRESHOLD: 48,
            SMALL_BODY_MIN_COUNT: 6,
            MIN_REQUIRED_CANDLES: 60,
            CHOP_SCORE_THRESHOLD: 4      // ideal for 2%
        },

        aggressive: {
            ATR_PERIOD: 10,
            ADX_PERIOD: 10,
            ADX_WEAK_THRESHOLD: 18,
            STRUCTURE_LOOKBACK: 8,
            SMALL_BODY_PERCENT_THRESHOLD: 45,
            SMALL_BODY_MIN_COUNT: 5,
            MIN_REQUIRED_CANDLES: 40,
            CHOP_SCORE_THRESHOLD: 5      // allows more noise
        }
    };

    return base[config.TRADING_MODE];
}