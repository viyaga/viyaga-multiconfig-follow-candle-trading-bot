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
    static readonly defaultConfig: Partial<ConfigType> = {
        // API_KEY: "jb5K5wanfp4HNz9naTruYTOEjfq8eZ",
        // SECRET_KEY: "he9E1B0eeJfhJnxlM49EXhKrYOfNln5b4EOLMZotCLWl6gRFip510Z6yxci1",
        BASE_URL: "https://api.india.delta.exchange/v2",

        RUN_MINUTES: [0, 15, 30, 45],

        // ENTRY TIMEFRAME
        TIMEFRAME: "15m",

        // TREND CONFIRMATION
        CONFIRMATION_TIMEFRAME: "1h",

        // MARKET STRUCTURE
        STRUCTURE_TIMEFRAME: "4h",

        TRADING_MODE: "balanced",

        SL_TRIGGER_BUFFER_PERCENT: 0.1,
        SL_LIMIT_BUFFER_PERCENT: 0.3,

        DRY_RUN: false,
        IS_TESTING: false,
    }


    /* -------------------------------------------------------------------------
       CONFIG RESOLVER
    ------------------------------------------------------------------------- */
    static getConfig(user_id?: string, product_symbol?: string): ConfigType {

        const stored = this.configStore.getStore();

        if (stored) {
            return stored;
        }

        throw new Error("No config found");
    }
}