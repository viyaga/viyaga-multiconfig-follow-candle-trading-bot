import { ConfigType, InternalChopConfig } from "../type";

export function getInternalConfig(config: ConfigType): InternalChopConfig {

    const base: Record<string, InternalChopConfig> = {

        conservative: {
            ATR_PERIOD: 14,
            ADX_PERIOD: 14,
            ADX_WEAK_THRESHOLD: 22,
            STRUCTURE_LOOKBACK: 14,
            SMALL_BODY_PERCENT_THRESHOLD: 50,
            SMALL_BODY_MIN_COUNT: 7,
            MIN_REQUIRED_CANDLES: 70,
            CHOP_SCORE_THRESHOLD: 3
        },

        balanced: {
            ATR_PERIOD: 14,
            ADX_PERIOD: 14,
            ADX_WEAK_THRESHOLD: 20,
            STRUCTURE_LOOKBACK: 10,
            SMALL_BODY_PERCENT_THRESHOLD: 48,
            SMALL_BODY_MIN_COUNT: 6,
            MIN_REQUIRED_CANDLES: 60,
            CHOP_SCORE_THRESHOLD: 3
        },

        aggressive: {
            ATR_PERIOD: 10,
            ADX_PERIOD: 10,
            ADX_WEAK_THRESHOLD: 18,
            STRUCTURE_LOOKBACK: 8,
            SMALL_BODY_PERCENT_THRESHOLD: 45,
            SMALL_BODY_MIN_COUNT: 5,
            MIN_REQUIRED_CANDLES: 40,
            CHOP_SCORE_THRESHOLD: 3
        },

        meme: {
            ATR_PERIOD: 7,                     // reacts faster to volatility
            ADX_PERIOD: 7,                     // meme trends form quickly
            ADX_WEAK_THRESHOLD: 14,            // allow low ADX pumps
            STRUCTURE_LOOKBACK: 6,             // structure changes fast
            SMALL_BODY_PERCENT_THRESHOLD: 40,  // meme candles often messy
            SMALL_BODY_MIN_COUNT: 4,           // allow noisy candles
            MIN_REQUIRED_CANDLES: 30,          // new meme coins often short history
            CHOP_SCORE_THRESHOLD: 4            // allow more chaos
        }
    };

    return base[config.TRADING_MODE];
}