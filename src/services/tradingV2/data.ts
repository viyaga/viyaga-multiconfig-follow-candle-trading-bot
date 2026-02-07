import { env } from "../../config";
import { IMartingaleState, MartingaleState } from "../../models/martingaleState.model";
import { TradingConfig } from "./config";
import { ConfigType } from "./type";

export class Data {

    static async getOrCreateState(userId: string, sym: string, pid: number): Promise<IMartingaleState> {
        let st = await MartingaleState.findOne({ userId, symbol: sym });
        if (!st) {
            st = new MartingaleState({
                userId,
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

        console.log(`[data] Loaded state for ${sym}:`, st);
        return st;
    }

    static async fetchTradingConfigs(
        params: { timeframe: string; limit: number; }
    ): Promise<ConfigType[]> {
        const query = new URLSearchParams({
            timeframe: params.timeframe,
            limit: String(params.limit)
        }).toString();

        // const res = await fetch(
        //     `${env.clientServiceUrl}/internal/trading-configs?${query}`
        // );

        // if (!res.ok) {
        //     throw new Error(
        //         `[fetchTradingConfigs] Failed (${res.status})`
        //     );
        // }

        // const json: any = await res.json()
        // const configs: ConfigType[] = json?.configs

        return [TradingConfig.getConfig()];
    }
}