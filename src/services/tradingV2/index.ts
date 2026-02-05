import { Data } from "./data";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger } from "./logger";
import { ConfigType, TargetCandle } from "./type";
import { Utils } from "./utils";
import { ProcessPendingState } from "./ProcessPendingState";
import { MartingaleState } from "../../models/martingaleState.model";
import axios from "axios";
import { Queue, Worker } from "bullmq";
import { TradingConfig } from "./config";
import { env } from "../../config";

export class TradingV2 {

    static tradingQueue = new Queue("trading", {
        connection: {
            host: env.redisHost,
            port: Number(env.redisPort)
        }
    });

    static tradingWorker = new Worker(
        "trading",
        async (job) => {
            const { config, configId } = job.data;

            // Fallback for logging if config is missing but we have ID (shouldn't happen in new flow)
            const idToLog = config?.id || configId;

            try {
                if (!config) {
                    throw new Error("Job payload missing 'config' object");
                }

                // 2️⃣ AsyncLocalStorage context
                await TradingConfig.configStore.run(config, async () => {
                    await TradingV2.runTradingCycle(config);
                });

            } catch (error) {
                tradingCycleErrorLogger.error(
                    `[TradingWorker] Failed for configId: ${idToLog}`,
                    error
                );
                throw error;
            }
        },
        {
            concurrency: 5,
            connection: {
                host: env.redisHost,
                port: Number(env.redisPort)
            }
        }
    );

    /* =========================================================================
       TARGET CANDLE
    ========================================================================= */

    private static async getTargetCandle(c: {
        TIMEFRAME: string;
        SYMBOL: string;
    }): Promise<TargetCandle> {

        const dur = Utils.getTimeframeDurationMs(c.TIMEFRAME);

        const start = Math.floor(Date.now() / dur) * dur - dur;

        const cd = await deltaExchange.getCandlestickData(
            c.SYMBOL,
            c.TIMEFRAME,
            start - 5 * dur,
            Date.now()
        );

        const candles = Utils.parseCandleResponse(cd);

        const target = candles.find(c => c.timestamp === start);

        if (!target) {
            throw new Error(
                `[workflow] No candle for ${c.SYMBOL} ${c.TIMEFRAME}`
            );
        }

        const color: "green" | "red" =
            target.close >= target.open ? "green" : "red";

        return { ...target, color };
    }

    private static async getCurrentPrice(sym: string): Promise<number> {
        const ticker = await deltaExchange.getTickerData(sym);
        if (!ticker) {
            throw new Error(`[workflow] No ticker data for ${sym}`);
        }
        return Number(ticker.mark_price);
    }

    /* =========================================================================
       PUBLIC ENTRY POINT
    ========================================================================= */

    static async runTradingCycle(c: ConfigType) {
        try {
            const targetCandle = await TradingV2.getTargetCandle(c);

            if (!Utils.isCandleBodyAboveMinimum(targetCandle)) return;

            const currentPrice = await TradingV2.getCurrentPrice(c.SYMBOL);

            if (!Utils.isPriceMovingInCandleDirection(targetCandle, currentPrice)) {
                return;
            }

            let state = await Data.getOrCreateState(
                c.USER_ID,
                c.SYMBOL,
                c.PRODUCT_ID
            );

            if (state.lastEntryOrderId && Utils.isTradePending(state)) {
                const orderDetails = await deltaExchange.getOrderDetails(state.lastEntryOrderId);

                if (!orderDetails) {
                    throw new Error("Failed to fetch order details for pending trade.");
                }
                4
                state = await ProcessPendingState.processStateOfPendingTrade(
                    c.SYMBOL,
                    state,
                    orderDetails,
                    targetCandle,
                    currentPrice
                );

                if (Utils.isTradePending(state)) return;
            }

            if (!Utils.isPriceMovementPercentWithinRange(
                targetCandle,
                currentPrice
            )) return;

            if (c.DRY_RUN) return;

            let qty = state.lastTradeQuantity;
            if (!qty || qty <= 0) throw new Error("Invalid trade quantity");

            if (c.IS_TESTING) qty = 1;

            const side = targetCandle.color === "green" ? "buy" : "sell";

            const entry = await deltaExchange.placeEntryOrder(
                c.SYMBOL,
                side,
                qty
            );

            const entryPrice = Utils.resolveEntryPrice(entry);
            const tp = Utils.calculateTpPrice(entryPrice, side);
            const sl =
                targetCandle.color === "green"
                    ? targetCandle.low
                    : targetCandle.high;

            if (!sl) throw new Error("Invalid SL price");

            const tpSlResult =
                await deltaExchange.placeTPSLBracketOrder(tp, sl, side);

            await MartingaleState.findOneAndUpdate(
                { userId: c.USER_ID, symbol: c.SYMBOL },
                {
                    $set: {
                        lastTradeOutcome: "pending",
                        lastEntryOrderId: String(entry.result.id),
                        lastStopLossOrderId: String(tpSlResult.ids.sl),
                        lastTakeProfitOrderId: String(tpSlResult.ids.tp),
                        lastEntryPrice: entryPrice,
                        lastSlPrice: sl,
                        lastTpPrice: tp,
                        lastTradeQuantity: qty
                    }
                },
                { new: true }
            );

        } catch (err) {
            tradingCycleErrorLogger.error("[workflow] Cycle error", err);
            throw err;
        }
    }
}

/* =========================================================================
   CRON / JOB ENQUEUER
======================================================================== */

export async function enqueueTradingJobsFromConfigs() {
    const startTime = Date.now();

    try {
        const { data: configs } = await axios.get(
            `${env.clientServiceUrl}/api/v1/trading-configs`,
            {
                params: { timeframe: "1m", limit: 500 }
            }
        );

        for (const cfg of configs) {
            await TradingV2.tradingQueue.add("trade", {
                config: cfg
            });
        }

        console.log(`[TradingCron] Enqueued ${configs.length} jobs`);
    } catch (error) {
        tradingCycleErrorLogger.error(
            "[TradingCron] Failed to enqueue jobs",
            error
        );
    } finally {
        console.log(
            `[TradingCron] Finished in ${Date.now() - startTime}ms`
        );
    }
}

export const runTradingCycle = (c: ConfigType) => TradingV2.runTradingCycle(c);