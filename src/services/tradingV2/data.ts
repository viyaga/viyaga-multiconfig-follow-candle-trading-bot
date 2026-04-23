import { env } from "../../config";

import { ITradeState, TradeState } from "../../models/tradeState.model";
import { TradingConfig } from "./config";
import { configDebugLogger, tradingCronLogger } from "./logger";
import { ConfigType } from "./type";

export class Data {

    static async getOrCreateState(tradingBotId: string, userId: string, sym: string, pid: number): Promise<ITradeState> {
        // 1. Try to find and update existing active (open) state
        // We look for status 'open' or null (for legacy records)
        let st = await TradeState.findOneAndUpdate(
            {
                tradingBotId,
                status: 'open'
            },
            { $set: { symbol: sym, userId, productId: pid, status: 'open' } },
            { new: true }
        );

        if (st) {
            tradingCronLogger.debug(`[Data] Loaded active state for ${sym}`, { state: st });
            return st;
        }

        // 2. No active state found. Look for the latest closed state to inherit lifetime stats.
        const lastClosed = await TradeState.findOne({ tradingBotId, status: 'closed' })
            .sort({ updatedAt: -1 });

        const allTimePnl = lastClosed?.allTimePnl || 0;
        const allTimeFees = lastClosed?.allTimeFees || 0;

        // If the last session was a loss, we inherit its level and debt to continue Trade cycle
        const isLoss = lastClosed?.tradeOutcome === 'loss';
        const currentLevel = isLoss ? (lastClosed?.currentLevel || 1) : 1;
        const sessionPnl = isLoss ? (lastClosed?.pnl || 0) : 0;
        const sessionFees = isLoss ? (lastClosed?.cumulativeFees || 0) : 0;
        const nextQuantity = isLoss ? (lastClosed?.quantity || 0) : TradingConfig.getConfig().INITIAL_BASE_QUANTITY;

        // 3. Create a new open state
        st = await TradeState.create({
            tradingBotId,
            userId,
            symbol: sym,
            productId: pid,
            status: 'open',
            currentLevel,
            tradeOutcome: "none",
            pnl: sessionPnl,
            cumulativeFees: sessionFees,
            allTimePnl,
            allTimeFees,
            quantity: nextQuantity || TradingConfig.getConfig().INITIAL_BASE_QUANTITY
        });

        tradingCronLogger.info(`[Data] Created new active state for ${sym} (Inherited PnL: ${allTimePnl})`, { id: st._id });
        return st;
    }

    private static mapSymbol(symbol: string): string {
        if (!symbol) return symbol;
        // Delta India perpetuals typically use USD suffix instead of USDT
        if (symbol.endsWith("USDT")) {
            return symbol.replace("USDT", "USD");
        }
        return symbol;
    }

    static async fetchTradingConfigs(
        params: { limit: number; offset: number }
    ): Promise<ConfigType[]> {
        const { limit, offset } = params;

        const url = `${env.payloadUrl}/api/trading-bots/active-subscribed/delta?limit=${limit}&offset=${offset}`;

        tradingCronLogger.info(`[fetchTradingConfigs] Fetching bots from: ${url}`);
        const res = await fetch(url);

        if (!res.ok) {
            throw new Error(`[fetchTradingConfigs] Failed (${res.status})`);
        }

        const bots: any = await res.json();
        tradingCronLogger.info(`[fetchTradingConfigs] API returned ${Array.isArray(bots) ? bots.length : 'non-array'} bots`);

        if (!Array.isArray(bots)) {
            tradingCronLogger.error(`[fetchTradingConfigs] Expected array of bots, got:`, { bots });
            return [];
        }

        const defaultConfig = TradingConfig.defaultConfig;

        // 1. Identify unique symbols to avoid redundant API calls
        const uniqueMappedSymbols = [...new Set(
            bots.map((bot: Partial<ConfigType>) => this.mapSymbol(bot.SYMBOL || "")).filter(Boolean) as string[]
        )];

        tradingCronLogger.info(`[fetchTradingConfigs] Found ${uniqueMappedSymbols.length} unique symbols across ${bots.length} bots. Fetching product data...`);

        // 2. Fetch product data for each unique symbol in parallel
        const productDataMap = new Map<string, any>();
        await Promise.all(
            uniqueMappedSymbols.map(async (mappedSymbol) => {
                try {
                    const productUrl = `${defaultConfig.BASE_URL}/products/${mappedSymbol}`;
                    tradingCronLogger.debug(`[fetchTradingConfigs] Fetching product data for unique symbol: ${mappedSymbol} from: ${productUrl}`);
                    const productRes = await fetch(productUrl);
                    if (productRes.ok) {
                        const productData: any = await productRes.json();
                        if (productData.success && productData.result) {
                            productDataMap.set(mappedSymbol, productData.result);
                            tradingCronLogger.info(`[fetchTradingConfigs] ✓ Successfully fetched product data for ${mappedSymbol}`);
                        }
                    } else {
                        tradingCronLogger.warn(`[fetchTradingConfigs] Failed to fetch product data for ${mappedSymbol}: ${productRes.status}`);
                    }
                } catch (err) {
                    tradingCronLogger.error(`[fetchTradingConfigs] Error fetching product data for ${mappedSymbol}:`, err);
                }
            })
        );

        // 3. Merge product data into each bot configuration
        const mergedConfigs: ConfigType[] = bots.map((bot: any) => {
            const rawSymbol = bot.SYMBOL || bot.symbol;
            const mappedSymbol = this.mapSymbol(rawSymbol);

            const config: ConfigType = {
                ...defaultConfig,
                ...bot,
                id: bot.id || bot._id
            };

            const p = productDataMap.get(mappedSymbol);
            if (p) {
                // Calculate decimals from tick size
                const decimals = p.tick_size.includes('.')
                    ? p.tick_size.split('.')[1].length
                    : 0;

                config.PRICE_DECIMAL_PLACES = decimals;
                config.LOT_SIZE = Number(p.contract_value);
                config.PRODUCT_ID = p.id;
                config.SYMBOL = p.symbol;

                tradingCronLogger.info(`[fetchTradingConfigs] ✓ Applied product data to bot ${config.id} [${rawSymbol}] (ID: ${p.id}, Decimals: ${decimals}, Lot: ${config.LOT_SIZE})`);
            } else {
                tradingCronLogger.warn(`[fetchTradingConfigs] ⚠ No product data available for bot ${config.id} [${rawSymbol}]`);
            }

            return config;
        });

        tradingCronLogger.info(`[fetchTradingConfigs] Successfully fetched and merged ${mergedConfigs.length} configs`);
        mergedConfigs.forEach(cfg => {
            configDebugLogger.debug(`[fetchTradingConfigs] Final merged config for bot ${cfg.id} (${cfg.SYMBOL})`, { config: cfg });
        });

        return mergedConfigs;
    }
}