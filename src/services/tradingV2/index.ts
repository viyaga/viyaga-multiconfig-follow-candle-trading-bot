import { Data } from "./data";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger, martingaleTradeLogger } from "./logger";
import { ConfigType, TargetCandle, Candle } from "./type";
import { Utils } from "./utils";
import { ProcessPendingState } from "./ProcessPendingState";
import { MartingaleState } from "../../models/martingaleState.model";
import { TradingConfig } from "./config";

import { ExecutedTrade } from "../../models/executedTrade.model";
import { Validations } from "./validations";

export class TradingV2 {

    /* =========================================================================
       TARGET CANDLE
    ========================================================================= */

    private static async getTargetCandle(c: {
        TIMEFRAME: string;
        SYMBOL: string;
    }): Promise<{ target: TargetCandle; candles: Candle[] } | null> {

        const dur = Utils.getTimeframeDurationMs(c.TIMEFRAME);
        const now = Date.now();

        const currentCandleStart = Math.floor(now / dur) * dur;

        const cd = await deltaExchange.getCandlestickData(
            c.SYMBOL,
            c.TIMEFRAME,
            currentCandleStart - 80 * dur,
            now
        );

        const candles = Utils.parseCandleResponse(cd);

        if (!candles.length) return null;

        // Ensure ascending order
        candles.sort((a, b) => a.timestamp - b.timestamp);

        // Filter only fully closed candles
        const closedCandles = candles.filter(
            candle => candle.timestamp < currentCandleStart
        );

        if (!closedCandles.length) {
            console.error(`[getTargetCandle:${c.SYMBOL}] No closed candles found`);
            return null;
        }

        const target = closedCandles[closedCandles.length - 1];
        console.log({ target, istTime: new Date(target.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) });

        return {
            target: {
                ...target,
                color: target.close >= target.open ? "green" : "red"
            },
            candles: closedCandles
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
            const targetData = await TradingV2.getTargetCandle(c);

            if (!targetData) {
                console.log(`[TradingCycle:${symbol}] SKIP: Could not find required candle data for ${symbol} ${c.TIMEFRAME}. API might be lagging.`);
                return;
            }

            const { target: targetCandle, candles } = targetData;
            console.log(`[TradingCycle:${symbol}] Candle data retrieved: Open=${targetCandle.open}, High=${targetCandle.high}, Low=${targetCandle.low}, Close=${targetCandle.close}, Color=${targetCandle.color}`);

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

            const marketState = Validations.getMarketState(candles, currentPrice);

            if (marketState === "CHOPPY") {
                console.log(`[TradingCycle:${symbol}] SKIP: Market is choppy`);
                return;
            }

            if (!await Utils.isPriceMovingInCandleDirection(targetCandle, currentPrice, configId, userId, symbol, c.TIMEFRAME)) {
                console.log(`[TradingCycle:${symbol}] SKIP: Price movement is not in candle direction`);
                return;
            }

            if (!await Utils.isPriceMovementPercentWithinRange(targetCandle, currentPrice, configId, userId, symbol, c.TIMEFRAME)) {
                console.log(`[TradingCycle:${symbol}] SKIP: Price movement percent is not within range`);
                return;
            }

            if (c.DRY_RUN) {
                console.log(`[TradingCycle:${symbol}] DRY_RUN mode enabled. Skipping trade placement.`);
                return;
            }

            let qty = c.IS_TESTING ? 1 : state.lastTradeQuantity;
            console.log(`[TradingCycle:${symbol}] Quantity: ${qty} (IS_TESTING=${c.IS_TESTING})`);

            if (!qty || qty <= 0) throw new Error("Invalid trade quantity");

            const side = targetCandle.color === "green" ? "buy" : "sell";

            if (!side) {
                console.log(`[TradingCycle:${symbol}] SKIP: No side generated`);
                return;
            }
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
                candleTimeframe: c.TIMEFRAME,
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
