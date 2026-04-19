import { Data } from "./data";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger, skipTradingLogger, tradingCronLogger, getContextualLogger } from "./logger";
import { ConfigType, TargetCandle, Candle } from "./type";
import { Utils } from "./utils";
import { ProcessPendingState } from "./ProcessPendingState";
import { MartingaleState } from "../../models/martingaleState.model";

import { MultiTimeframeAlignment } from "./market-detector/multi-timeframe";

export class TradingV2 {

    /* =========================================================================
       TARGET CANDLE
    ========================================================================= */

    static async getTargetCandle(
        c: {
            SYMBOL: string;
            TIMEFRAME: string;
            CONFIRMATION_TIMEFRAME: string;
            STRUCTURE_TIMEFRAME: string;
        }, timeframeType: 'ENTRY' | 'CONFIRMATION' | 'STRUCTURE'): Promise<{ target: TargetCandle; candles: Candle[] } | null> {

        const timeframe = timeframeType === 'ENTRY' ? c.TIMEFRAME : timeframeType === 'CONFIRMATION' ? c.CONFIRMATION_TIMEFRAME : c.STRUCTURE_TIMEFRAME;
        const dur = Utils.getTimeframeDurationMs(timeframe);
        const now = Date.now();

        const currentCandleStart = Math.floor(now / dur) * dur;

        const cd = await deltaExchange.getCandlestickData(
            c.SYMBOL,
            timeframe,
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
            tradingCycleErrorLogger.error(`[getTargetCandle:${c.SYMBOL}] No closed candles found`);
            return null;
        }

        const target = closedCandles[closedCandles.length - 1];

        return {
            target: {
                ...target,
                color: Utils.getCandleColor(target)
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
        const { id: tradingBotId, SYMBOL: symbol, USER_ID: userId } = c;
        const cycleId = `cycle-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        const cronLogger = getContextualLogger(tradingCronLogger, { cycleId, symbol, tradingBotId });
        const skipLogger = getContextualLogger(skipTradingLogger, { cycleId, symbol, tradingBotId });
        const errorLogger = getContextualLogger(tradingCycleErrorLogger, { cycleId, symbol, tradingBotId });

        cronLogger.info(`[TradingCycle] ========== START PROCESSING BOT: ${symbol} (ID: ${tradingBotId}) ==========`);


        try {
            // ───────────────── MARKET DATA ─────────────────
            // ───────────────── MARKET DATA ─────────────────
            const targetDataEntry = await TradingV2.getTargetCandle(c, 'ENTRY');
            const targetDataConfirmation = await TradingV2.getTargetCandle(c, 'CONFIRMATION');
            const targetDataStructure = await TradingV2.getTargetCandle(c, 'STRUCTURE');

            if (!targetDataEntry || !targetDataConfirmation || !targetDataStructure) {
                const missing = [];
                if (!targetDataEntry) missing.push('ENTRY');
                if (!targetDataConfirmation) missing.push('CONFIRMATION');
                if (!targetDataStructure) missing.push('STRUCTURE');

                skipLogger.info(`[MarketData] SKIP: Missing closed candles for ${symbol} on: ${missing.join(', ')}`);
                return;
            }

            cronLogger.debug(`[MarketData] Fetched candles: ENTRY(${targetDataEntry.candles.length}), CONF(${targetDataConfirmation.candles.length}), STRUCT(${targetDataStructure.candles.length})`);

            const { target: targetCandle, candles: entryCandles } = targetDataEntry;
            const { target: confirmationTargetCandle, candles: confirmationCandles } = targetDataConfirmation;
            const { target: structureTargetCandle, candles: structureCandles } = targetDataStructure;

            cronLogger.debug(`[MarketPrice] Fetching latest price for ${symbol}...`);
            const currentPrice = await TradingV2.getCurrentPrice(symbol);
            cronLogger.info(`[MarketPrice] Current Mark Price: ${currentPrice}`);

            // ───────────────── MULTI TIMEFRAME ALIGNMENT ─────────────────
            const configConfirmation: ConfigType = { ...c, TIMEFRAME: c.CONFIRMATION_TIMEFRAME };
            const configStructure: ConfigType = { ...c, TIMEFRAME: c.STRUCTURE_TIMEFRAME };

            const mtf = MultiTimeframeAlignment.evaluate(
                targetCandle,
                confirmationTargetCandle,
                structureTargetCandle,
                entryCandles,
                confirmationCandles,
                structureCandles,
                c,
                configConfirmation,
                configStructure,
                { cycleId, tradingBotId }
            );

            cronLogger.info(`[MTF] Result: Score=${mtf.finalScore}, Direction=${mtf.direction}, Decision=${mtf.decision}, Allowed=${mtf.isAllowed}`);
            if (mtf.isAllowed) {
                cronLogger.info(`[MTF] Price Levels target: TP=${mtf.tp}, SL=${mtf.sl}, RR=${mtf.rr.toFixed(2)}`);
            }

            const scoreMultiplier = mtf.finalScore < 70 ? 0 : mtf.finalScore < 80 ? 1 : mtf.finalScore < 85 ? 1.5 : mtf.finalScore < 90 ? 2 : 0;

            // ───────────────── STATE ─────────────────
            let state = await Data.getOrCreateState(
                c.id,
                c.USER_ID,
                c.SYMBOL,
                c.PRODUCT_ID
            );

            // ───────────────── HANDLE PENDING TRADE ─────────────────
            if (state.lastEntryOrderId && Utils.isTradePending(state)) {

                cronLogger.info(
                    `Found pending trade with order ID: ${state.lastEntryOrderId}. Fetching order details...`
                );

                const orderDetails = await deltaExchange.getOrderDetails(state.lastEntryOrderId);

                if (!orderDetails) {
                    throw new Error("Failed to fetch order details for pending trade.");
                }

                cronLogger.info(
                    `Order details retrieved: Status=${orderDetails.status}`
                );

                cronLogger.info(
                    `Processing pending trade state with multiplier: ${scoreMultiplier}`
                );

                state = await ProcessPendingState.processStateOfPendingTrade(
                    symbol,
                    state,
                    orderDetails,
                    mtf,
                    currentPrice,
                    scoreMultiplier,
                    { cycleId, tradingBotId } // Pass context for logging
                );

                cronLogger.info(
                    `Pending state processed: NewOutcome=${state.lastTradeOutcome}`
                );

                if (Utils.isTradePending(state)) return;
            }

            const now = new Date();
            const istMinutes = Number(
                now.toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    minute: "numeric"
                })
            )
            cronLogger.debug(`Current time check for run minutes`, { istMinutes, now });

            if (!c.RUN_MINUTES.includes(istMinutes)) {
                skipLogger.info(
                    `[SKIP] ${symbol}: Not in RUN_MINUTES (Current: ${istMinutes}, Target List: ${c.RUN_MINUTES.join(',')})`
                );
                return;
            }

            if (mtf.finalScore < 55) {
                skipLogger.info(`[SKIP] ${symbol}: MTF Final Score too low (Score: ${mtf.finalScore} < Threshold: 55)`);
                return;
            }

            // ───────────────── TRADE SIDE ─────────────────
            const side = mtf.direction.toLowerCase() as "buy" | "sell" | "none";

            if (side === "none") {
                skipLogger.info(`[MarketRegime] SKIP: No breakout direction`, {
                    timeframe: c.TIMEFRAME
                });
                return;
            }

            // ───────────────── PRICE VALIDATION ─────────────────
            if (!await Utils.isPriceMovingInOrderSideDirection(
                targetCandle,
                side,
                currentPrice,
                tradingBotId,
                userId,
                symbol,
                c.TIMEFRAME
            )) return;

            // ───────────────── DRY RUN ─────────────────
            if (c.DRY_RUN) {
                skipLogger.info(`[MarketRegime] SKIP: DRY_RUN mode enabled`, {
                    timeframe: c.TIMEFRAME
                });
                return;
            }

            // ───────────────── QUANTITY ─────────────────
            const qty = c.IS_TESTING ? 1 : state.lastTradeQuantity;
            if (!qty) throw new Error("Quantity not found");

            if (qty && qty > c.MAX_QUANTITY) {
                skipLogger.info(`[Quantity] SKIP: Quantity exceeds MAX_QUANTITY`, {
                    timeframe: c.TIMEFRAME,
                    qty,
                    maxQuantity: c.MAX_QUANTITY
                });
                return;
            }

            cronLogger.info(
                `Quantity: ${qty} (IS_TESTING=${c.IS_TESTING})`
            );

            if (!qty || qty <= 0) {
                throw new Error("Invalid trade quantity");
            }

            // ───────────────── ENTRY ORDER ─────────────────
            const entry = await deltaExchange.placeEntryOrder(symbol, side, qty);

            cronLogger.info(
                `Entry order placed successfully: OrderID=${entry.result?.id}`
            );

            const entryPrice = Utils.resolveEntryPrice(entry);
            const tp = mtf.tp;
            const sl = mtf.sl;

            if (!tp || !sl) {
                throw new Error(`[Trade] Invalid TP/SL from MTF: TP=${tp}, SL=${sl}`);
            }

            cronLogger.info(
                `Price levels - Entry: ${entryPrice}, TP: ${tp}, SL: ${sl}`
            );

            // ───────────────── TP / SL ─────────────────
            const tpSlResult = await deltaExchange.placeTPSLBracketOrder(tp, sl, side, { cycleId, tradingBotId });

            cronLogger.info(
                `TP/SL orders placed: TP_ID=${tpSlResult.ids.tp}, SL_ID=${tpSlResult.ids.sl}`
            );

            // ───────────────── UPDATE STATE ─────────────────
            const updatedState = await MartingaleState.findOneAndUpdate(
                { tradingBotId: c.id, userId: c.USER_ID, symbol: c.SYMBOL },
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
                        allTimeFees: state.allTimeFees,
                        lastTradeSettledAt: new Date()
                    }
                },
                { new: true }
            );

            if (!updatedState) {
                throw new Error("Failed to update martingale state");
            }

            cronLogger.info(
                `Martingale state updated successfully`
            );



            cronLogger.info(
                `✓ TRADE COMPLETED SUCCESSFULLY\n`
            );

        } catch (err) {
            errorLogger.error(
                `✗ ERROR in trading cycle:`,
                { error: err }
            );
            throw err;
        }
    }

}

export const runTradingCycle = (c: ConfigType) =>
    TradingV2.runTradingCycle(c);