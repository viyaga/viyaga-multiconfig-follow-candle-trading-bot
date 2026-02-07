import { Data } from "./data";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger, martingaleTradeLogger } from "./logger";
import { ConfigType, TargetCandle } from "./type";
import { Utils } from "./utils";
import { ProcessPendingState } from "./ProcessPendingState";
import { MartingaleState } from "../../models/martingaleState.model";
import { TradingConfig } from "./config";
import { redis } from "../../lib/redis";
import { ExecutedTrade } from "../../models/executedTrade.model";

export class TradingV2 {

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
            throw new Error(`[workflow] No candle for ${c.SYMBOL} ${c.TIMEFRAME}`);
        }

        return {
            ...target,
            color: target.close >= target.open ? "green" : "red"
        };
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

        const lockKey = `lock:trade:${c.USER_ID}:${c.SYMBOL}:${c.PRODUCT_ID}`;

        // 🔐 distributed lock (55s)
        const locked = await redis.set(lockKey, "1", {
            nx: true,
            ex: 55
        });

        if (!locked) {
            return; // already running somewhere else
        }

        console.log({ lockKey, locked, c });

        try {
            const targetCandle = await TradingV2.getTargetCandle(c);
            if (!Utils.isCandleBodyAboveMinimum(targetCandle)) return;

            const currentPrice = await TradingV2.getCurrentPrice(c.SYMBOL);
            if (!Utils.isPriceMovingInCandleDirection(targetCandle, currentPrice)) return;

            let state = await Data.getOrCreateState(
                c.USER_ID,
                c.SYMBOL,
                c.PRODUCT_ID
            );

            if (state.lastEntryOrderId && Utils.isTradePending(state)) {
                const orderDetails =
                    await deltaExchange.getOrderDetails(state.lastEntryOrderId);

                if (!orderDetails) {
                    throw new Error("Failed to fetch order details for pending trade.");
                }

                state = await ProcessPendingState.processStateOfPendingTrade(
                    c.SYMBOL,
                    state,
                    orderDetails,
                    targetCandle,
                    currentPrice
                );

                if (Utils.isTradePending(state)) return;
            }

            if (!Utils.isPriceMovementPercentWithinRange(targetCandle, currentPrice)) return;
            if (c.DRY_RUN) return;

            let qty = c.IS_TESTING ? 1 : state.lastTradeQuantity;
            if (!qty || qty <= 0) throw new Error("Invalid trade quantity");

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

            const tpSlResult =
                await deltaExchange.placeTPSLBracketOrder(tp, sl, side);

            const updatedState = await MartingaleState.findOneAndUpdate(
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
                        lastTradeQuantity: qty,
                        currentLevel: state.currentLevel,
                        pnl: state.pnl,
                        cumulativeFees: state.cumulativeFees,
                        allTimePnl: state.allTimePnl,
                        allTimeFees: state.allTimeFees
                    }
                },
                { new: true }
            );

            if (!updatedState) {
                throw new Error("Failed to update martingale state");
            }

            await ExecutedTrade.create({
                symbol: c.SYMBOL,
                side,
                quantity: qty,
                entryPrice,
                slPrice: sl,
                tpPrice: tp,
                martingaleState: updatedState
            });

        } catch (err) {
            tradingCycleErrorLogger.error("[workflow] Cycle error", err);
            throw err;
        } finally {
            await redis.del(lockKey);
        }
    }
}

export const runTradingCycle = (c: ConfigType) =>
    TradingV2.runTradingCycle(c);
