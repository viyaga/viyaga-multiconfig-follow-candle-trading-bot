import { Data } from "./data";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger, logExecutedTrade } from "./logger";
import { ConfigType, TargetCandle } from "./type";
import { Utils } from "./utils";
import { ProcessPendingState } from "./ProcessPendingState";
import { MartingaleState } from "../../models/martingaleState.model";

export class TradingV2 {

    /**
 * Fetches and returns the completed candle for the previous timeframe.
 * Throws if the target candle is not found.
 */
    private static async getTargetCandle(c: {
        TIMEFRAME: string;
        SYMBOL: string;
    }): Promise<TargetCandle> {
        const tf = c.TIMEFRAME;
        const sym = c.SYMBOL;

        const dur = Utils.getTimeframeDurationMs(tf);

        // Start of the last fully closed candle
        const start = Math.floor(Date.now() / dur) * dur - dur;

        const cd = await deltaExchange.getCandlestickData(
            sym,
            tf,
            start - 5 * dur, // buffer window
            Date.now()
        );

        const candles = Utils.parseCandleResponse(cd);

        const target = candles.find(c => c.timestamp === start);

        if (!target) {
            throw new Error(
                `[workflow] No candle data for ${sym} ${tf} starting at ${new Date(start).toISOString()}`
            );
        }

        const color: "green" | "red" = target.close >= target.open ? "green" : "red";
        const targetCandle = { ...target, color };
        console.log({ targetCandle, IST: new Date(targetCandle?.timestamp || 0).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) });

        return targetCandle;
    }

    private static async getCurrentPrice(sym: string): Promise<number | null> {
        const ticker = await deltaExchange.getTickerData(sym);
        console.log({ ticker });
        if (!ticker) throw new Error(`[workflow] No ticker data for ${sym}`);
        return parseFloat(ticker.mark_price);
    }

    /* =========================================================================
       PUBLIC ENTRY POINT
    ========================================================================= */

    static async runTradingCycle(c: ConfigType) {
        try {
            /* ----------------------------------
             * 1. Target candle & current price
             * ---------------------------------- */
            const targetCandle = await this.getTargetCandle(c);

            /* ----------------------------------
             * 2. Validate candle body
             * ---------------------------------- */
            if (!Utils.isCandleBodyAboveMinimum(targetCandle)) {
                console.log("Candle body is below minimum. Skipping this cycle.");
                return;
            }

            const currentPrice = await this.getCurrentPrice(c.SYMBOL);
            if (!currentPrice) throw new Error("Failed to fetch current price.");
            console.log({ currentPrice })

            /* ----------------------------------
             * 3. Validate candle direction
             * ---------------------------------- */
            if (!Utils.isPriceMovingInCandleDirection(targetCandle, currentPrice)) {
                console.log("[workflow] Price is not moving in the direction of the target candle. Skipping this cycle.");
                return;
            }

            /* ----------------------------------
             * 4. Load / create state
             * ---------------------------------- */
            let state = await Data.getOrCreateState(c.USER_ID, c.SYMBOL, c.PRODUCT_ID);

            /* ----------------------------------
             * 5. Handle pending trade (if any)
             * ---------------------------------- */
            if (state.lastEntryOrderId && Utils.isTradePending(state)) {
                const orderDetails = await deltaExchange.getOrderDetails(state.lastEntryOrderId);
                console.log({ orderDetails });

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

                if (Utils.isTradePending(state)) {
                    console.log("Trade with pending outcome. Skipping this cycle.");
                    return;
                }
            }

            /* ----------------------------------
             * 6. Validate movement % for new entry
             * ---------------------------------- */
            if (!Utils.isPriceMovementPercentWithinRange(targetCandle, currentPrice)) {
                console.log("[workflow] Price movement percentage invalid for target candle. Skipping this cycle.");
                return;
            }

            /* ----------------------------------
             * 7. Dry run check
             * ---------------------------------- */
            if (c.DRY_RUN) {
                console.log("[DRY RUN] - Skipping trade execution.");
                return;
            }

            /* ----------------------------------
             * 8. Quantity & side resolution
             * ---------------------------------- */
            let qty = state.lastTradeQuantity;
            if (!qty || qty <= 0) throw new Error("Invalid trade quantity.");

            if (c.IS_TESTING) qty = 1;

            const side = targetCandle.color === "green" ? "buy" : "sell";

            /* ----------------------------------
             * 9. Place entry order
             * ---------------------------------- */
            let entry;
            try {
                entry = await deltaExchange.placeEntryOrder(c.SYMBOL, side, qty);
            } catch (err) {
                tradingCycleErrorLogger.error("[workflow] placeEntryOrder failed", err);
                throw err;
            }

            console.log("[workflow] Placed entry order:", entry, qty, state);

            /* ----------------------------------
             * 10. TP / SL calculation & placement
             * ---------------------------------- */
            const entryPrice = Utils.resolveEntryPrice(entry);

            const tp = Utils.calculateTpPrice(entryPrice, side);
            const sl = targetCandle.color === "green" ? targetCandle.low : targetCandle.high;
            if (!sl) throw new Error("[utils] Cannot determine stop loss price based on target candle.")

            const tpSlResult = await deltaExchange.placeTPSLBracketOrder(tp, sl, side);
            console.log("[workflow] Placed TP/SL orders:", tpSlResult.ids);

            /* ----------------------------------
             * 11. State update
             * ---------------------------------- */
            const updatedStatePayload = {
                currentLevel: state.currentLevel,
                pnl: state.pnl,
                cumulativeFees: state.cumulativeFees,
                allTimePnl: state.allTimePnl,
                allTimeFees: state.allTimeFees,
                lastTradeOutcome: "pending",
                lastEntryOrderId: String(entry.result.id),
                lastStopLossOrderId: String(tpSlResult.ids.sl),
                lastTakeProfitOrderId: String(tpSlResult.ids.tp),
                lastEntryPrice: entryPrice,
                lastSlPrice: sl,
                lastTpPrice: tp,
                lastTradeQuantity: qty,
            };

            const updatedState = await MartingaleState.findOneAndUpdate(
                { userId: c.USER_ID, symbol: c.SYMBOL },
                { $set: updatedStatePayload },
                { new: true }
            );

            if (!updatedState) throw new Error("Failed to update state.");

            console.log("[workflow] Updated state:", updatedState);

            logExecutedTrade(c.SYMBOL, updatedState, {
                entryOrderId: entry.id ? String(entry.id) : undefined,
                stopLossOrderId: tpSlResult.ids.sl,
                takeProfitOrderId: tpSlResult.ids.tp,
                direction: side,
                quantity: qty,
                entryPrice: entryPrice,
                stopLossPrice: sl,
                takeProfitPrice: tp,
            });

        } catch (err) {
            tradingCycleErrorLogger.error("[workflow] Cycle error", err);
            throw err;
        }
    }


}

export const runTradingCycle = (c: ConfigType) => TradingV2.runTradingCycle(c);