import { ConfigType, InternalChopConfig } from "../type";

export function getInternalConfig(config: ConfigType): InternalChopConfig {

    const timeframe = config.TIMEFRAME || "15m";

    let lookback = 24;

    if (timeframe.toLowerCase().includes("15m")) lookback = 24;
    else if (timeframe.toLowerCase().includes("1h")) lookback = 36;
    else if (timeframe.toLowerCase().includes("4h")) lookback = 48;

    const base: Record<string, InternalChopConfig> = {

        conservative: {
            ATR_PERIOD: 14,
            ADX_PERIOD: 14,
            ADX_WEAK_THRESHOLD: 22,
            STRUCTURE_LOOKBACK: lookback,
            SMALL_BODY_PERCENT_THRESHOLD: 50,
            SMALL_BODY_MIN_COUNT: 7,
            MIN_REQUIRED_CANDLES: 70,
            PROBABILITY_THRESHOLD: 75 //55,65,75
        },

        balanced: {
            ATR_PERIOD: 14,
            ADX_PERIOD: 14,
            ADX_WEAK_THRESHOLD: 20,
            STRUCTURE_LOOKBACK: lookback,
            SMALL_BODY_PERCENT_THRESHOLD: 48,
            SMALL_BODY_MIN_COUNT: 6,
            MIN_REQUIRED_CANDLES: 60,
            PROBABILITY_THRESHOLD: 65 //55,65,75
        },

        aggressive: {
            ATR_PERIOD: 10,
            ADX_PERIOD: 10,
            ADX_WEAK_THRESHOLD: 18,
            STRUCTURE_LOOKBACK: lookback,
            SMALL_BODY_PERCENT_THRESHOLD: 45,
            SMALL_BODY_MIN_COUNT: 5,
            MIN_REQUIRED_CANDLES: 40,
            PROBABILITY_THRESHOLD: 55 //55,65,75
        },
    };

    return base[config.TRADING_MODE];
}