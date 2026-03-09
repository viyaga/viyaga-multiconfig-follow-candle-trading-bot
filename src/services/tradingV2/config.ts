// ============================================================================
// TradingConfigType
// Centralized configuration management with AsyncLocalStorage
// SINGLE CONFIG ONLY
// ZERO LOGIC CHANGES — mechanical refactor only
// ============================================================================

import { AsyncLocalStorage } from "node:async_hooks";
import { ConfigType } from "./type";

export class TradingConfig {

    /* -------------------------------------------------------------------------
       ASYNC STORAGE FOR PER-REQUEST CONFIG
    ------------------------------------------------------------------------- */
    static readonly configStore = new AsyncLocalStorage<ConfigType>();

    /* -------------------------------------------------------------------------
       BASE DEFAULT CONFIG
    ------------------------------------------------------------------------- */
    static readonly defaultConfig: ConfigType[] = [
        {
            id: "1",
            USER_ID: "12345",
            DELTA_EXCHANGE_API_KEY: "jb5K5wanfp4HNz9naTruYTOEjfq8eZ",
            DELTA_EXCHANGE_SECRET_KEY: "he9E1B0eeJfhJnxlM49EXhKrYOfNln5b4EOLMZotCLWl6gRFip510Z6yxci1",
            DELTA_EXCHANGE_BASE_URL_INDIA: "https://api.india.delta.exchange/v2",
            RUN_MINUTES: [31],
            PRODUCT_ID: 3136,
            SYMBOL: "ETHUSD",
            LOT_SIZE: 0.01,
            PRICE_DECIMAL_PLACES: 2,
            TIMEFRAME: "1h", // lower timeframe for trading
            CONFIRMATION_TIMEFRAME: "4h", // higher timeframe for confirmation
            STRUCTURE_TIMEFRAME: "1d", // higher timeframe for structure
            LOWER_TIMEFRAME: "15m",
            LEVERAGE: 20,
            INITIAL_BASE_QUANTITY: 1,
            TRADING_MODE: "aggressive",
            MAX_ALLOWED_PRICE_MOVEMENT_PERCENT: 4,
            MIN_ALLOWED_PRICE_MOVEMENT_PERCENT: 0.01,
            TAKE_PROFIT_PERCENT: 3000,
            SL_TRIGGER_BUFFER_PERCENT: 0.1,
            SL_LIMIT_BUFFER_PERCENT: 0.3,
            DRY_RUN: false,
            IS_TESTING: false,
            REVERSAL_POINT_THRESHOLD: 3,
            COOLDOWN_PERIOD_MINUTES: 55
        }
    ];

    /* -------------------------------------------------------------------------
       CONFIG RESOLVER
    ------------------------------------------------------------------------- */
    static getConfig(user_id?: string, product_symbol?: string): ConfigType {
        // 1. AsyncLocalStorage override (per request)
        const stored = this.configStore.getStore();
        if (stored) {
            return stored;
        }

        throw new Error("No config found");
    }
}