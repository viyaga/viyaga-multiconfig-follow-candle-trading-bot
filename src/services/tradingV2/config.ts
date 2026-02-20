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
    static readonly defaultConfig: ConfigType[] = [{
        id: "1",
        USER_ID: "12345",
        DELTA_EXCHANGE_API_KEY: "jb5K5wanfp4HNz9naTruYTOEjfq8eZ",
        DELTA_EXCHANGE_SECRET_KEY: "he9E1B0eeJfhJnxlM49EXhKrYOfNln5b4EOLMZotCLWl6gRFip510Z6yxci1",
        DELTA_EXCHANGE_BASE_URL_INDIA: "https://api.india.delta.exchange/v2",
        PRODUCT_ID: 3136,
        SYMBOL: "ETHUSD",
        LOT_SIZE: 0.01,
        PRICE_DECIMAL_PLACES: 2,
        TIMEFRAME: "1h",
        LEVERAGE: 20,
        INITIAL_BASE_QUANTITY: 1,
        TARGET_PERCENT: 3,
        RISK_MODE: "aggressive",
        MIN_BODY_PERCENT: 0.3,
        MIN_RANGE_PERCENT: 0.4,
        MIN_BODY_DOMINANCE: 0.6,
        MAX_ALLOWED_PRICE_MOVEMENT_PERCENT: 4,
        MIN_ALLOWED_PRICE_MOVEMENT_PERCENT: 0.1,
        TAKE_PROFIT_PERCENT: 3000,
        SL_TRIGGER_BUFFER_PERCENT: 0.1,
        SL_LIMIT_BUFFER_PERCENT: 0.2,
        DRY_RUN: false,
        IS_TESTING: false
    }];

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