import { Data } from "./data";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger, martingaleTradeLogger, skipTradingLogger, tradingCronLogger } from "./logger";
import { ConfigType, TargetCandle, Candle } from "./type";
import { Utils } from "./utils";
import { ProcessPendingState } from "./ProcessPendingState";
import { MartingaleState } from "../../models/martingaleState.model";
import { ExecutedTrade } from "../../models/executedTrade.model";
import { MultiTimeframeAlignment } from "./market-detector/multi-timeframe";
import { getBodyMovePercent } from "./market-detector/price-action";

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
            tradingCycleErrorLogger.error(`[getTargetCandle:${c.SYMBOL}] No closed candles found`);
            return null;
        }

        const target = closedCandles[closedCandles.length - 1];

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

        if (c.LEVERAGE * c.MAX_ALLOWED_PRICE_MOVEMENT_PERCENT > 80) {
            skipTradingLogger.info(`[Config] SKIP: Leverage risk too high for ${symbol}`, {
                configId,
                userId,
                symbol,
                candleTimeframe: c.TIMEFRAME,
                leverage: c.LEVERAGE,
                maxAllowedPercent: c.MAX_ALLOWED_PRICE_MOVEMENT_PERCENT,
                riskScore: c.LEVERAGE * c.MAX_ALLOWED_PRICE_MOVEMENT_PERCENT
            });
            return;
        }

        try {
            const targetData = await TradingV2.getTargetCandle(c);

            if (!targetData) {
                skipTradingLogger.info(`[MarketData] SKIP: Could not find required candle data for ${symbol} ${c.TIMEFRAME}. API might be lagging.`, {
                    configId,
                    userId,
                    symbol,
                    candleTimeframe: c.TIMEFRAME
                });
                return;
            }

            const { target: targetCandle, candles } = targetData;

            const currentPrice = await TradingV2.getCurrentPrice(c.SYMBOL);

            let state = await Data.getOrCreateState(
                c.id,
                c.USER_ID,
                c.SYMBOL,
                c.PRODUCT_ID,
            );

            if (state.lastEntryOrderId && Utils.isTradePending(state)) {
                tradingCronLogger.info(`[TradingCycle:${symbol}] Found pending trade with order ID: ${state.lastEntryOrderId}. Fetching order details...`);

                const orderDetails = await deltaExchange.getOrderDetails(state.lastEntryOrderId);

                if (!orderDetails) {
                    throw new Error("Failed to fetch order details for pending trade.");
                }
                tradingCronLogger.info(`[TradingCycle:${symbol}] Order details retrieved: Status=${orderDetails.status}`);

                tradingCronLogger.info(`[TradingCycle:${symbol}] Processing pending trade state...`);
                state = await ProcessPendingState.processStateOfPendingTrade(
                    c.SYMBOL,
                    state,
                    orderDetails,
                    targetCandle,
                    currentPrice
                );
                tradingCronLogger.info(`[TradingCycle:${symbol}] Pending state processed: NewOutcome=${state.lastTradeOutcome}`);

                if (Utils.isTradePending(state)) {
                    return;
                }
            }

            let isAllowed = false;

            const configConfirmation: ConfigType = { ...c, TIMEFRAME: c.CONFIRMATION_TIMEFRAME };
            const configStructure: ConfigType = { ...c, TIMEFRAME: c.STRUCTURE_TIMEFRAME };

            const targetDataConfirmation = await TradingV2.getTargetCandle({ TIMEFRAME: c.CONFIRMATION_TIMEFRAME, SYMBOL: c.SYMBOL });
            const targetDataStructure = await TradingV2.getTargetCandle({ TIMEFRAME: c.STRUCTURE_TIMEFRAME, SYMBOL: c.SYMBOL });

            if (!targetDataConfirmation || !targetDataStructure) {
                skipTradingLogger.info(`[MarketData] SKIP: Could not find required higher timeframe candle data for ${symbol}. API might be lagging.`, {
                    configId,
                    userId,
                    symbol,
                    confirmationTimeframe: c.CONFIRMATION_TIMEFRAME,
                    structureTimeframe: c.STRUCTURE_TIMEFRAME
                });
                return;
            }

            const mtf = MultiTimeframeAlignment.evaluate(
                targetCandle,
                candles,
                targetDataConfirmation.candles,
                targetDataStructure.candles,
                c,
                configConfirmation,
                configStructure
            );

            isAllowed = mtf.isAllowed;

            if (!isAllowed) {
                skipTradingLogger.info(`[MarketRegime] SKIP: MTF Alignment Failed for ${symbol}`, {
                    configId,
                    userId,
                    symbol,
                    timeframe: c.TIMEFRAME,
                    mtf
                });
                return;
            }

            const bodyMovementPercentage = getBodyMovePercent(targetCandle);
            console.log("bodyMovementPercentage", bodyMovementPercentage);
            console.log("c.MIN_MOVEMENT_PERCENT", c.MIN_MOVEMENT_PERCENT);

            if (bodyMovementPercentage < c.MIN_MOVEMENT_PERCENT) {
                skipTradingLogger.info(`[MarketRegime] SKIP: Body percent too small for ${symbol}`, {
                    configId,
                    userId,
                    symbol,
                    timeframe: c.TIMEFRAME,
                    bodyPercent: bodyMovementPercentage
                });
                return;
            }

            if (!await Utils.isPriceMovingInCandleDirection(targetCandle, currentPrice, configId, userId, symbol, c.TIMEFRAME)) {
                // Logging handled inside isPriceMovingInCandleDirection
                return;
            }

            if (!await Utils.isPriceMovementPercentWithinRange(targetCandle, currentPrice, configId, userId, symbol, c.TIMEFRAME)) {
                // Logging handled inside isPriceMovementPercentWithinRange
                return;
            }

            if (c.DRY_RUN) {
                skipTradingLogger.info(`[MarketRegime] SKIP: DRY_RUN mode enabled for ${symbol}`, {
                    configId,
                    userId,
                    symbol,
                    timeframe: c.TIMEFRAME,
                });
                return;
            }

            let qty = c.IS_TESTING ? 1 : state.lastTradeQuantity;
            tradingCronLogger.info(`[TradingCycle:${symbol}] Quantity: ${qty} (IS_TESTING=${c.IS_TESTING})`);

            if (!qty || qty <= 0) throw new Error("Invalid trade quantity");

            const side = targetCandle.color === "green" ? "buy" : "sell";

            const entry = await deltaExchange.placeEntryOrder(
                c.SYMBOL,
                side,
                qty
            );
            tradingCronLogger.info(`[TradingCycle:${symbol}] Entry order placed successfully: OrderID=${entry.result?.id}`);

            const entryPrice = Utils.resolveEntryPrice(entry);
            const tp = Utils.calculateTpPrice(entryPrice, side);
            const sl = targetCandle.color === "green" ? targetCandle.low : targetCandle.high;

            tradingCronLogger.info(`[TradingCycle:${symbol}] Price levels - Entry: ${entryPrice}, TP: ${tp}, SL: ${sl}`);
            tradingCronLogger.info(`[TradingCycle:${symbol}] Placing TP/SL bracket order...`);

            const tpSlResult = await deltaExchange.placeTPSLBracketOrder(tp, sl, side);
            tradingCronLogger.info(`[TradingCycle:${symbol}] TP/SL orders placed: TP_ID=${tpSlResult.ids.tp}, SL_ID=${tpSlResult.ids.sl}`);

            tradingCronLogger.info(`[TradingCycle:${symbol}] Updating martingale state in database...`);
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
            tradingCronLogger.info(`[TradingCycle:${symbol}] Martingale state updated successfully`);

            tradingCronLogger.info(`[TradingCycle:${symbol}] Creating executed trade record...`);
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

            martingaleTradeLogger.info(`[ExecutedTrade] NEW TRADE RECORDED ${symbol} ${side.toUpperCase()} at ${entryPrice}`, {
                configId: c.id,
                userId: c.USER_ID,
                symbol: c.SYMBOL,
                candleTimeframe: c.TIMEFRAME,
                side,
                quantity: qty,
                entryPrice,
                slPrice: sl,
                tpPrice: tp,
                martingaleState: updatedState
            });

            tradingCronLogger.info(`[TradingCycle:${symbol}] ✓ TRADE COMPLETED SUCCESSFULLY\n`);

        } catch (err) {
            tradingCycleErrorLogger.error(`[TradingCycle:${symbol}] ✗ ERROR in trading cycle:`, { error: err });
            throw err;
        }
    }

}

export const runTradingCycle = (c: ConfigType) =>
    TradingV2.runTradingCycle(c);