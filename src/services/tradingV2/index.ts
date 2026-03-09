import { Data } from "./data";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger, martingaleTradeLogger, skipTradingLogger, tradingCronLogger } from "./logger";
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

    static async getTargetCandle(c: {
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

        // 🚫 Risk guard
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

            // ───────────────── MARKET DATA ─────────────────
            const targetData = await TradingV2.getTargetCandle(c);
            const lowerTFData = await TradingV2.getTargetCandle({ ...c, TIMEFRAME: c.LOWER_TIMEFRAME });

            if (!targetData || !lowerTFData) {
                skipTradingLogger.info(`[MarketData] SKIP: Could not find required candle data for ${symbol} ${c.TIMEFRAME}. API might be lagging.`, {
                    configId,
                    userId,
                    symbol,
                    candleTimeframe: c.TIMEFRAME,
                    lowerTimeframe: c.LOWER_TIMEFRAME
                });
                return;
            }

            const { target: targetCandle, candles } = targetData;
            const { target: lowerTFTargetCandle, candles: lowerTFCandles } = lowerTFData;

            const currentPrice = await TradingV2.getCurrentPrice(symbol);

            // ───────────────── STATE ─────────────────
            let state = await Data.getOrCreateState(
                c.id,
                c.USER_ID,
                c.SYMBOL,
                c.PRODUCT_ID
            );

            // ───────────────── HANDLE PENDING TRADE ─────────────────
            if (state.lastEntryOrderId && Utils.isTradePending(state) && !c.DRY_RUN) {

                tradingCronLogger.info(
                    `[TradingCycle:${symbol}] Found pending trade with order ID: ${state.lastEntryOrderId}. Fetching order details...`
                );

                const orderDetails = await deltaExchange.getOrderDetails(state.lastEntryOrderId);

                if (!orderDetails) {
                    throw new Error("Failed to fetch order details for pending trade.");
                }

                tradingCronLogger.info(
                    `[TradingCycle:${symbol}] Order details retrieved: Status=${orderDetails.status}`
                );

                tradingCronLogger.info(
                    `[TradingCycle:${symbol}] Processing pending trade state...`
                );

                state = await ProcessPendingState.processStateOfPendingTrade(
                    symbol,
                    state,
                    orderDetails,
                    targetCandle,
                    currentPrice,
                    lowerTFTargetCandle,
                    lowerTFCandles
                );

                tradingCronLogger.info(
                    `[TradingCycle:${symbol}] Pending state processed: NewOutcome=${state.lastTradeOutcome}`
                );

                if (Utils.isTradePending(state)) return;
            }


            const now = new Date();
            const istMinutes = Number(
                now.toLocaleString("en-IN", {
                    timeZone: "Asia/Kolkata",
                    minute: "numeric"
                })
            );
            if (!c.RUN_MINUTES.includes(istMinutes)) {
                skipTradingLogger.info(
                    `[TradingCron] Skipping config: ${c.id} (${c.SYMBOL}) because it is not in the RUN_MINUTES list.`
                );
                return;
            }

            // ───────────────── COOLDOWN CHECK ─────────────────
            const cooldownMins = c.COOLDOWN_PERIOD_MINUTES || 0;
            if (cooldownMins > 0 && state.lastTradeSettledAt) {
                const lastSettled = new Date(state.lastTradeSettledAt).getTime();
                const now = Date.now();
                const diffMins = (now - lastSettled) / (1000 * 60);

                if (diffMins < cooldownMins) {
                    skipTradingLogger.info(`[Cooldown] SKIP: Cooldown active for ${symbol}`, {
                        configId,
                        userId,
                        symbol,
                        cooldownMins,
                        remainingMins: (cooldownMins - diffMins).toFixed(2)
                    });
                    return;
                }
            }

            // ───────────────── MULTI TIMEFRAME ALIGNMENT ─────────────────
            const configConfirmation: ConfigType = { ...c, TIMEFRAME: c.CONFIRMATION_TIMEFRAME };
            const configStructure: ConfigType = { ...c, TIMEFRAME: c.STRUCTURE_TIMEFRAME };

            const targetDataConfirmation = await TradingV2.getTargetCandle({
                TIMEFRAME: c.CONFIRMATION_TIMEFRAME,
                SYMBOL: c.SYMBOL
            });

            const targetDataStructure = await TradingV2.getTargetCandle({
                TIMEFRAME: c.STRUCTURE_TIMEFRAME,
                SYMBOL: c.SYMBOL
            });

            if (!targetDataConfirmation || !targetDataStructure) {
                skipTradingLogger.info(
                    `[MarketData] SKIP: Could not find required higher timeframe candle data for ${symbol}. API might be lagging.`,
                    {
                        configId,
                        userId,
                        symbol,
                        confirmationTimeframe: c.CONFIRMATION_TIMEFRAME,
                        structureTimeframe: c.STRUCTURE_TIMEFRAME
                    }
                );
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

            if (!mtf.isAllowed) {
                skipTradingLogger.info(`[MarketRegime] SKIP: MTF Alignment Failed for ${symbol}`, {
                    configId,
                    userId,
                    symbol,
                    timeframe: c.TIMEFRAME,
                    mtf
                });
                return;
            }

            // ───────────────── PRICE VALIDATION ─────────────────
            if (!await Utils.isPriceMovingInCandleDirection(
                targetCandle,
                currentPrice,
                configId,
                userId,
                symbol,
                c.TIMEFRAME
            )) return;

            if (!await Utils.isPriceMovementPercentWithinRange(
                targetCandle,
                currentPrice,
                configId,
                userId,
                symbol,
                c.TIMEFRAME
            )) return;

            // ───────────────── TRADE SIDE ─────────────────
            const side = targetCandle.color === "green" ? "buy" : "sell";

            const reversalCheck = Utils.detectLowerTimeframeReversal(
                side,
                lowerTFTargetCandle,
                lowerTFCandles
            );

            let reversalSL: number | undefined;

            if (reversalCheck.shouldTighten && reversalCheck.slPrice) {
                reversalSL = reversalCheck.slPrice;

                tradingCronLogger.info(
                    `[TradingCycle:${symbol}] Reversal detected. Using reversal SL: ${reversalSL}`
                );
            }

            // ───────────────── DRY RUN ─────────────────
            if (c.DRY_RUN) {
                skipTradingLogger.info(`[MarketRegime] SKIP: DRY_RUN mode enabled for ${symbol}`, {
                    configId,
                    userId,
                    symbol,
                    timeframe: c.TIMEFRAME
                });
                return;
            }

            // ───────────────── QUANTITY ─────────────────
            const qty = c.IS_TESTING ? 1 : state.lastTradeQuantity;

            tradingCronLogger.info(
                `[TradingCycle:${symbol}] Quantity: ${qty} (IS_TESTING=${c.IS_TESTING})`
            );

            if (!qty || qty <= 0) {
                throw new Error("Invalid trade quantity");
            }

            // ───────────────── ENTRY ORDER ─────────────────
            const entry = await deltaExchange.placeEntryOrder(symbol, side, qty);

            tradingCronLogger.info(
                `[TradingCycle:${symbol}] Entry order placed successfully: OrderID=${entry.result?.id}`
            );

            const entryPrice = Utils.resolveEntryPrice(entry);
            const tp = Utils.calculateTpPrice(entryPrice, side);

            const slPrice =
                reversalSL ??
                (targetCandle.color === "green" ? targetCandle.low : targetCandle.high);

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

            tradingCronLogger.info(
                `[TradingCycle:${symbol}] Price levels - Entry: ${entryPrice}, TP: ${tp}, SL: ${sl}`
            );

            // ───────────────── TP / SL ─────────────────
            const tpSlResult = await deltaExchange.placeTPSLBracketOrder(tp, sl, side);

            tradingCronLogger.info(
                `[TradingCycle:${symbol}] TP/SL orders placed: TP_ID=${tpSlResult.ids.tp}, SL_ID=${tpSlResult.ids.sl}`
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

            tradingCronLogger.info(
                `[TradingCycle:${symbol}] Martingale state updated successfully`
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

            martingaleTradeLogger.info(
                `[ExecutedTrade] NEW TRADE RECORDED ${symbol} ${side.toUpperCase()} at ${entryPrice}`,
                {
                    configId,
                    userId,
                    symbol,
                    candleTimeframe: c.TIMEFRAME,
                    side,
                    quantity: qty,
                    entryPrice,
                    slPrice: sl,
                    tpPrice: tp,
                    martingaleState: updatedState
                }
            );

            tradingCronLogger.info(
                `[TradingCycle:${symbol}] ✓ TRADE COMPLETED SUCCESSFULLY\n`
            );

        } catch (err) {
            tradingCycleErrorLogger.error(
                `[TradingCycle:${symbol}] ✗ ERROR in trading cycle:`,
                { error: err }
            );
            throw err;
        }
    }

}

export const runTradingCycle = (c: ConfigType) =>
    TradingV2.runTradingCycle(c);