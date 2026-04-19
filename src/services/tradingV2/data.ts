import { env } from "../../config";

import { IMartingaleState, MartingaleState } from "../../models/martingaleState.model";
import { TradingConfig } from "./config";
import { tradingCronLogger } from "./logger";
import { ConfigType } from "./type";

export class Data {

    static async getOrCreateState(tradingBotId: string, userId: string, sym: string, pid: number): Promise<IMartingaleState> {
        let st = await MartingaleState.findOne({ tradingBotId, userId, symbol: sym });

        if (!st) {
            tradingCronLogger.info(`[Data] Creating new state for ${sym}`);
            st = new MartingaleState({
                userId,
                tradingBotId,
                symbol: sym,
                productId: pid,
                currentLevel: 1,
                lastTradeOutcome: "none",
                pnl: 0,
                cumulativeFees: 0,
                allTimePnl: 0,
                allTimeFees: 0,
                lastSecuredProfitPercent: 0,
                lastTradeQuantity: TradingConfig.getConfig().INITIAL_BASE_QUANTITY
            });
            await (st as any).save();
        }

        tradingCronLogger.debug(`[Data] Loaded state for ${sym}`, { state: st });
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

        if (!Array.isArray(bots)) {
            tradingCronLogger.error(`[fetchTradingConfigs] Expected array of bots, got:`, { bots });
            return [];
        }

        const defaultConfig = TradingConfig.defaultConfig;

        const mergedConfigs: ConfigType[] = await Promise.all(
            bots.map(async (bot: any) => {
                const rawSymbol = bot.SYMBOL || bot.symbol;
                const mappedSymbol = this.mapSymbol(rawSymbol);

                const config: ConfigType = {
                    ...defaultConfig,
                    ...bot,
                    id: bot.id || bot._id
                };

                if (mappedSymbol) {
                    try {
                        const productUrl = `${defaultConfig.BASE_URL}/products/${mappedSymbol}`;
                        const productRes = await fetch(productUrl);
                        if (productRes.ok) {
                            const productData: any = await productRes.json();
                            if (productData.success && productData.result) {
                                const p = productData.result;
                                const tickSize = Number(p.tick_size);
                                const contractValue = Number(p.contract_value);

                                // Calculate decimals from tick size
                                const decimals = p.tick_size.includes('.')
                                    ? p.tick_size.split('.')[1].length
                                    : 0;

                                config.PRICE_DECIMAL_PLACES = decimals;
                                config.LOT_SIZE = contractValue;
                                config.PRODUCT_ID = p.id;
                                config.SYMBOL = p.symbol;

                                tradingCronLogger.debug(`[fetchTradingConfigs] Merged product data for ${rawSymbol} (mapped: ${mappedSymbol})`, {
                                    tickSize,
                                    contractValue,
                                    decimals,
                                    productId: p.id
                                });
                            }
                        } else {
                            tradingCronLogger.warn(`[fetchTradingConfigs] Failed to fetch product data for ${rawSymbol} (mapped: ${mappedSymbol}): ${productRes.status}`);
                        }
                    } catch (err) {
                        tradingCronLogger.error(`[fetchTradingConfigs] Error fetching product data for ${rawSymbol} (mapped: ${mappedSymbol}):`, err);
                    }
                }

                return config;
            })
        );

        return mergedConfigs;
    }
}