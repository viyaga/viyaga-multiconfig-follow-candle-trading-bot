import { Data } from "./data";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger, martingaleTradeLogger } from "./logger";
import { ConfigType, TargetCandle, Candle } from "./type";
import { Utils } from "./utils";
import { ProcessPendingState } from "./ProcessPendingState";
import { MartingaleState } from "../../models/martingaleState.model";
import { TradingConfig } from "./config";

import { ExecutedTrade } from "../../models/executedTrade.model";

export class TradingV2 {

    /* =========================================================================
       TARGET CANDLE
    ========================================================================= */

    private static async getTargetCandle(c: {
        TIMEFRAME: string;
        SYMBOL: string;
    }): Promise<{ target: TargetCandle; candles: Candle[] }> {

        const dur = Utils.getTimeframeDurationMs(c.TIMEFRAME);
        const start = Math.floor(Date.now() / dur) * dur - dur;

        const cd = await deltaExchange.getCandlestickData(
            c.SYMBOL,
            c.TIMEFRAME,
            start - 10 * dur,
            Date.now()
        );

        const candles = Utils.parseCandleResponse(cd);
        const target = candles.find(c => c.timestamp === start);

        if (!target) {
            throw new Error(`[workflow] No candle for ${c.SYMBOL} ${c.TIMEFRAME}`);
        }

        return {
            target: {
                ...target,
                color: target.close >= target.open ? "green" : "red"
            },
            candles
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

        const configId = c.id;
        const symbol = c.SYMBOL;
        const userId = c.USER_ID;

        console.log(`\n[TradingCycle:${symbol}] Starting trading cycle for config ${configId} (User: ${userId})`);

        try {
            console.log(`[TradingCycle:${symbol}] Fetching target candle and historical data...`);
            const { target: targetCandle, candles } = await TradingV2.getTargetCandle(c);
            console.log(`[TradingCycle:${symbol}] Candle data retrieved: Open=${targetCandle.open}, High=${targetCandle.high}, Low=${targetCandle.low}, Close=${targetCandle.close}, Color=${targetCandle.color}`);

            if (!Utils.hasVolatilityAndMomentum(targetCandle)) {
                console.log(`[TradingCycle:${symbol}] SKIP: Candle body is below minimum threshold`);
                return;
            }

            console.log(`[TradingCycle:${symbol}] Fetching current price...`);
            const currentPrice = await TradingV2.getCurrentPrice(c.SYMBOL);
            console.log(`[TradingCycle:${symbol}] Current price: ${currentPrice}`);

            console.log(`[TradingCycle:${symbol}] Loading or creating martingale state...`);
            let state = await Data.getOrCreateState(
                c.id,
                c.USER_ID,
                c.SYMBOL,
                c.PRODUCT_ID,
            );
            console.log(`[TradingCycle:${symbol}] State loaded: Level=${state.currentLevel}, PnL=${state.pnl}, LastOutcome=${state.lastTradeOutcome}`);

            if (state.lastEntryOrderId && Utils.isTradePending(state)) {
                console.log(`[TradingCycle:${symbol}] Found pending trade with order ID: ${state.lastEntryOrderId}. Fetching order details...`);
                const orderDetails = await deltaExchange.getOrderDetails(state.lastEntryOrderId);

                if (!orderDetails) {
                    throw new Error("Failed to fetch order details for pending trade.");
                }
                console.log(`[TradingCycle:${symbol}] Order details retrieved: Status=${orderDetails.status}`);

                console.log(`[TradingCycle:${symbol}] Processing pending trade state...`);
                state = await ProcessPendingState.processStateOfPendingTrade(
                    c.SYMBOL,
                    state,
                    orderDetails,
                    targetCandle,
                    currentPrice
                );
                console.log(`[TradingCycle:${symbol}] Pending state processed: NewOutcome=${state.lastTradeOutcome}`);

                if (Utils.isTradePending(state)) {
                    console.log(`[TradingCycle:${symbol}] Trade still pending. Skipping new entry.`);
                    return;
                }
            }

            if (!Utils.isPriceMovementPercentWithinRange(targetCandle, currentPrice)) {
                console.log(`[TradingCycle:${symbol}] SKIP: Price movement percent is not within range`);
                return;
            }

            if (c.DRY_RUN) {
                console.log(`[TradingCycle:${symbol}] DRY_RUN mode enabled. Skipping trade placement.`);
                return;
            }

            if (await Utils.isChoppyMarket(candles, 3, c.SYMBOL)) {
                console.log(`[TradingCycle:${symbol}] SKIP: Market is sideways/choppy - not tradable`);
                tradingCycleErrorLogger.info(`[workflow] Market is always sideways/choppy, skipping trade for ${c.SYMBOL}`);
                return;
            }

            let qty = c.IS_TESTING ? 1 : state.lastTradeQuantity;
            console.log(`[TradingCycle:${symbol}] Quantity: ${qty} (IS_TESTING=${c.IS_TESTING})`);

            if (!qty || qty <= 0) throw new Error("Invalid trade quantity");

            const side = targetCandle.color === "green" ? "buy" : "sell";
            console.log(`[TradingCycle:${symbol}] Placing entry order: Side=${side}, Qty=${qty}`);

            const entry = await deltaExchange.placeEntryOrder(
                c.SYMBOL,
                side,
                qty
            );
            console.log(`[TradingCycle:${symbol}] Entry order placed successfully: OrderID=${entry.result?.id}`);

            const entryPrice = Utils.resolveEntryPrice(entry);
            const tp = Utils.calculateTpPrice(entryPrice, side);
            const sl =
                targetCandle.color === "green"
                    ? targetCandle.low
                    : targetCandle.high;

            console.log(`[TradingCycle:${symbol}] Price levels - Entry: ${entryPrice}, TP: ${tp}, SL: ${sl}`);
            console.log(`[TradingCycle:${symbol}] Placing TP/SL bracket order...`);

            const tpSlResult =
                await deltaExchange.placeTPSLBracketOrder(tp, sl, side);
            console.log(`[TradingCycle:${symbol}] TP/SL orders placed: TP_ID=${tpSlResult.ids.tp}, SL_ID=${tpSlResult.ids.sl}`);

            console.log(`[TradingCycle:${symbol}] Updating martingale state in database...`);
            const updatedState = await MartingaleState.findOneAndUpdate(
                { configId: c.id, userId: c.USER_ID, symbol: c.SYMBOL },
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
            console.log(`[TradingCycle:${symbol}] Martingale state updated successfully`);

            console.log(`[TradingCycle:${symbol}] Creating executed trade record...`);
            await ExecutedTrade.create({
                symbol: c.SYMBOL,
                side,
                quantity: qty,
                entryPrice,
                slPrice: sl,
                tpPrice: tp,
                martingaleState: updatedState
            });
            console.log(`[TradingCycle:${symbol}] ✓ TRADE COMPLETED SUCCESSFULLY\n`);

        } catch (err) {
            console.error(`[TradingCycle:${symbol}] ✗ ERROR in trading cycle:`, err);
            tradingCycleErrorLogger.error("[workflow] Cycle error", err);
            throw err;
        }
    }

}

export const runTradingCycle = (c: ConfigType) =>
    TradingV2.runTradingCycle(c);
