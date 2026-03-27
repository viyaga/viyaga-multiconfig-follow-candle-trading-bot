import { Data } from "./data";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger, martingaleTradeLogger, skipTradingLogger, tradingCronLogger, getContextualLogger } from "./logger";
import { ConfigType, TargetCandle, Candle } from "./type";
import { Utils } from "./utils";
import { ProcessPendingState } from "./ProcessPendingState";
import { MartingaleState } from "../../models/martingaleState.model";
import { ExecutedTrade } from "../../models/executedTrade.model";
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
        const { id: configId, SYMBOL: symbol, USER_ID: userId } = c;
        const cycleId = `cycle-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        const cronLogger = getContextualLogger(tradingCronLogger, { cycleId, symbol, configId });
        const skipLogger = getContextualLogger(skipTradingLogger, { cycleId, symbol, configId });
        const errorLogger = getContextualLogger(tradingCycleErrorLogger, { cycleId, symbol, configId });
        const tradeLogger = getContextualLogger(martingaleTradeLogger, { cycleId, symbol, configId });

        // 🚫 Risk guard
        if (c.LEVERAGE * c.MAX_ALLOWED_PRICE_MOVEMENT_PERCENT > 80) {
            skipLogger.info(`[Config] SKIP: Leverage risk too high for ${symbol}`, {
                candleTimeframe: c.TIMEFRAME,
                leverage: c.LEVERAGE,
                maxAllowedPercent: c.MAX_ALLOWED_PRICE_MOVEMENT_PERCENT,
                riskScore: c.LEVERAGE * c.MAX_ALLOWED_PRICE_MOVEMENT_PERCENT
            });
            return;
        }

        try {
            // ───────────────── MARKET DATA ─────────────────
            const targetDataStructure = await TradingV2.getTargetCandle(c, 'STRUCTURE');

            if (!targetDataStructure) {
                skipLogger.info(
                    `[MarketData] SKIP: Could not find required candle data for ${symbol}. API might be lagging.`,
                    {
                        confirmationTimeframe: c.CONFIRMATION_TIMEFRAME,
                        structureTimeframe: c.STRUCTURE_TIMEFRAME
                    }
                );
                return;
            }

            const { target: structureTargetCandle, candles: structureCandles } = targetDataStructure;

            const currentPrice = await TradingV2.getCurrentPrice(symbol);

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
                    `Processing pending trade state...`
                );

                state = await ProcessPendingState.processStateOfPendingTrade(
                    symbol,
                    state,
                    orderDetails,
                    structureTargetCandle,
                    currentPrice,
                    { cycleId, configId } // Pass context for logging
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
                    `Skipping config: ${c.id} (${c.SYMBOL}) because it is not in the RUN_MINUTES list.`
                );
                return;
            }

            // ───────────────── MULTI TIMEFRAME ALIGNMENT ─────────────────
            const configConfirmation: ConfigType = { ...c, TIMEFRAME: c.CONFIRMATION_TIMEFRAME };
            const configStructure: ConfigType = { ...c, TIMEFRAME: c.STRUCTURE_TIMEFRAME };

            const targetData = await TradingV2.getTargetCandle(c, 'ENTRY');

            const targetDataConfirmation = await TradingV2.getTargetCandle(c, 'CONFIRMATION');

            if (!targetData || !targetDataConfirmation) {
                skipLogger.info(
                    `[MarketData] SKIP: Could not find required candle data for ${symbol}. API might be lagging.`,
                    {
                        confirmationTimeframe: c.CONFIRMATION_TIMEFRAME,
                        structureTimeframe: c.STRUCTURE_TIMEFRAME
                    }
                );
                return;
            }

            const { target: confirmationTargetCandle, candles: confirmationCandles } = targetDataConfirmation;
            const { target: targetCandle, candles } = targetData;

            const mtf = MultiTimeframeAlignment.evaluate(
                targetCandle,
                confirmationTargetCandle,
                structureTargetCandle,
                candles,
                confirmationCandles,
                structureCandles,
                c,
                configConfirmation,
                configStructure,
                { cycleId, configId }
            );

            if (mtf.finalScore < 45) {
                skipLogger.info(`[MarketRegime] SKIP: MTF Final Score too low`, {
                    timeframe: c.TIMEFRAME,
                    finalScore: mtf.finalScore,
                    mtf
                });
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
                configId,
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
            let multiplier = 1;
            if (mtf.finalScore >= 75) multiplier = 1.5;
            else if (mtf.finalScore >= 65) multiplier = 1;
            else if (mtf.finalScore >= 55) multiplier = 0.8;
            else multiplier = 0.6;

            const baseQty = c.IS_TESTING ? 1 : state.lastTradeQuantity;
            if (!baseQty) throw new Error("Base quantity not found");
            const qty = Math.floor(baseQty * multiplier);

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
            const tp = Utils.calculateTpPrice(entryPrice, side);

            const slCandle = await Utils.isPriceMovementPercentWithinRange(
                structureTargetCandle,
                side,
                currentPrice,
                configId,
                userId,
                symbol,
                c.TIMEFRAME
            ) ? structureTargetCandle : await Utils.isPriceMovementPercentWithinRange(
                confirmationTargetCandle,
                side,
                currentPrice,
                configId,
                userId,
                symbol,
                c.TIMEFRAME
            ) ? confirmationTargetCandle : targetCandle;

            const slPrice = side === "buy" ? slCandle.low : slCandle.high;

            let sl =
                side === "buy"
                    ? Math.min(slPrice, currentPrice)
                    : Math.max(slPrice, currentPrice);

            if (sl === currentPrice) {
                const buffer = 0.1;
                sl = side === "buy"
                    ? sl * (1 - buffer / 100)
                    : sl * (1 + buffer / 100);
            }

            cronLogger.info(
                `Price levels - Entry: ${entryPrice}, TP: ${tp}, SL: ${sl}`
            );

            // ───────────────── TP / SL ─────────────────
            const tpSlResult = await deltaExchange.placeTPSLBracketOrder(tp, sl, side);

            cronLogger.info(
                `TP/SL orders placed: TP_ID=${tpSlResult.ids.tp}, SL_ID=${tpSlResult.ids.sl}`
            );

            // ───────────────── UPDATE STATE ─────────────────
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

            // ───────────────── TRADE RECORD ─────────────────
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

            tradeLogger.info(
                `NEW TRADE RECORDED ${side.toUpperCase()} at ${entryPrice}`,
                {
                    candleTimeframe: c.TIMEFRAME,
                    side,
                    quantity: qty,
                    entryPrice,
                    slPrice: sl,
                    tpPrice: tp,
                    martingaleState: updatedState
                }
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