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

        const bots: unknown = await res.json();

        if (!Array.isArray(bots)) {
            tradingCronLogger.error(`[fetchTradingConfigs] Expected array of bots, got:`, { bots });
            return [];
        }

        const mergedConfigs: ConfigType[] = bots.map((bot: any) => {
            return {
                ...TradingConfig.defaultConfig[0],
                ...bot,
                id: bot.id || bot._id
            };
        });

        return mergedConfigs;
    }
}