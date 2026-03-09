import { TradingV2 } from ".";
import { IMartingaleState, MartingaleState } from "../../models/martingaleState.model";
import { TradingConfig } from "./config";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger, tradingCronLogger, reversalLogger } from "./logger";
import { Candle, OrderDetails, TargetCandle } from "./type";
import { Utils } from "./utils";

export class ProcessPendingState {

    /* =========================================================================
       CANDLE ANALYSIS UTILITIES
    ========================================================================= */


    static resetState(s: IMartingaleState): IMartingaleState {
        const c = TradingConfig.getConfig();
        return {
            ...s,
            currentLevel: 1,
            lastTradeOutcome: "none",
            lastEntryOrderId: null,
            lastStopLossOrderId: null,
            lastTakeProfitOrderId: null,
            lastEntryPrice: null,
            lastSlPrice: null,
            lastTpPrice: null,
            lastTradeQuantity: c.INITIAL_BASE_QUANTITY,
            pnl: 0,
            cumulativeFees: 0,
            allTimePnl: s.allTimePnl || 0,
            allTimeFees: s.allTimeFees || 0,
        };
    }

    static handleWin(
        s: IMartingaleState,
        winPnl: number,
        tempFees: number,
        incrementalPnl: number,
        incrementalFees: number
    ): IMartingaleState {
        console.log(`[outcome] WIN | Final PnL: ${winPnl} | Total Fees: ${tempFees} | Incremental PnL: ${incrementalPnl} | Incremental Fees: ${incrementalFees}`);
        const currentState = this.resetState(s);
        return {
            ...currentState,
            currentLevel: 1,
            lastTradeOutcome: "win",
            allTimePnl: (s.allTimePnl || 0) + incrementalPnl,
            allTimeFees: (s.allTimeFees || 0) + incrementalFees,
        };
    }

    static handleLoss(
        s: IMartingaleState,
        netDebt: number,
        pnl: number,
        fees: number,
        currentPrice: number,
        incrementalPnl: number,
        incrementalFees: number
    ): IMartingaleState {

        const c = TradingConfig.getConfig();

        const targetAmount = Math.abs(netDebt) * 1.5; // 50% extra to cover fees and slippage
        const marginRequiredPerLot = currentPrice * c.LOT_SIZE / c.LEVERAGE
        const lots = c.INITIAL_BASE_QUANTITY + Math.ceil(
            targetAmount / marginRequiredPerLot
        );
        const nextLevel = s.currentLevel + 1;

        console.log({ lots });

        const currentState = this.resetState(s);
        return {
            ...currentState,
            currentLevel: nextLevel,
            lastTradeOutcome: "loss",
            lastTradeQuantity: lots,
            pnl,
            cumulativeFees: fees,
            allTimePnl: (s.allTimePnl || 0) + incrementalPnl,
            allTimeFees: (s.allTimeFees || 0) + incrementalFees,
        };
    }

    static markCancelled(s: IMartingaleState): IMartingaleState {
        return {
            ...s,
            lastTradeOutcome: "cancelled",
        };
    }

    /* =========================================================================
   PENDING ORDER HANDLING
========================================================================= */

    private static handleCanceledEntryOrder(s: IMartingaleState): IMartingaleState {
        return this.markCancelled(s);
    }

    /* =========================================================================
   CLOSED POSITION OUTCOME
========================================================================= */

    static async processClosedPosition(
        s: IMartingaleState,
        entryCommission: number,
        currentPrice: number
    ): Promise<IMartingaleState> {

        if (!s.lastStopLossOrderId || !s.lastTakeProfitOrderId) throw new Error("[checkTPSL] Missing TP/SL order IDs in state.");

        const tp = await deltaExchange.getOrderDetails(s.lastTakeProfitOrderId);
        if (tp && tp.status === "CLOSED") {
            const incrementalPnl = Number(tp.meta_data?.pnl || 0);
            const incrementalFees = Number(tp.paid_commission || 0) + entryCommission;
            const netPnl = s.pnl + incrementalPnl;
            const fees = s.cumulativeFees + incrementalFees;
            return this.handleWin(s, netPnl, fees, incrementalPnl, incrementalFees);
        }

        const sl = await deltaExchange.getOrderDetails(s.lastStopLossOrderId);
        if (sl && sl.status === "CLOSED") {

            const incrementalPnl = Number(sl?.meta_data?.pnl || 0);
            const incrementalFees = Number(sl?.paid_commission || 0) + entryCommission;
            const netPnl = s.pnl + incrementalPnl;
            const fees = s.cumulativeFees + incrementalFees;
            const netDebt = netPnl - fees;

            return netDebt >= 0
                ? this.handleWin(s, netPnl, fees, incrementalPnl, incrementalFees)
                : this.handleLoss(s, netDebt, netPnl, fees, currentPrice, incrementalPnl, incrementalFees);
        }

        if (tp?.status === "CANCELLED" && sl?.status === "CANCELLED") {
            console.log("[processClosedPosition] TP and SL orders are cancelled by user. consider this as loss");

            const incrementalPnl = 0;
            const incrementalFees = entryCommission;
            const netPnl = s.pnl;
            const fees = s.cumulativeFees + incrementalFees;
            const netDebt = netPnl - fees;
            return this.handleLoss(s, netDebt, netPnl, fees, currentPrice, incrementalPnl, incrementalFees);
        }

        throw new Error("[processClosedPosition] Neither TP nor SL orders are filled/closed.");
    }

    static async placeCancelledBracketOrders(
        state: IMartingaleState,
        e: OrderDetails,
        sl: number
    ): Promise<IMartingaleState> {
        const slOrder = await deltaExchange.getOrderDetails(
            state.lastStopLossOrderId!
        );

        if (slOrder?.status !== "CANCELLED") {
            throw new Error("SL update failed");
        }

        const cancelRes = await deltaExchange.cancelStopOrders({
            product_id: TradingConfig.getConfig().PRODUCT_ID,
        });
        console.log({ cancelRes });

        const entryPrice =
            e.average_fill_price ?? e.meta_data?.entry_price;

        if (!entryPrice) {
            throw new Error("Entry price not found");
        }

        const tp = Utils.calculateTpPrice(Number(entryPrice), e.side);
        if (!tp) {
            throw new Error("TP calculation failed");
        }

        const bracketRes =
            await deltaExchange.placeTPSLBracketOrder(tp, sl, e.side);

        if (!bracketRes.success) {
            throw new Error("TP/SL placement failed");
        }

        const updated = await MartingaleState.findOneAndUpdate(
            {
                configId: state.configId,
                userId: state.userId,
                symbol: state.symbol,
            },
            {
                $set: {
                    lastSlPrice: sl,
                    lastTpPrice: tp,
                    lastStopLossOrderId: bracketRes.ids.sl,
                    lastTakeProfitOrderId: bracketRes.ids.tp,
                },
            },
            { new: true }
        );

        if (!updated) {
            throw new Error("Martingale state not found");
        }

        return updated as IMartingaleState;
    }

    static async updateStateSl(
        state: IMartingaleState,
        sl: number
    ): Promise<IMartingaleState> {
        const updated = await MartingaleState.findOneAndUpdate(
            {
                configId: state.configId,
                userId: state.userId,
                symbol: state.symbol,
            },
            { $set: { lastSlPrice: sl } },
            { new: true }
        );

        if (!updated) {
            throw new Error("Martingale state not found");
        }

        return updated as IMartingaleState;
    }

    static async manageOpenPosition(
        sym: string,
        s: IMartingaleState,
        e: OrderDetails,
        targetCandle: TargetCandle,
        currentPrice: number,
        lowerTFTargetCandle: TargetCandle,
        lowerTFCandles: Candle[]
    ): Promise<IMartingaleState> {

        try {

            if (!s.lastStopLossOrderId || !s.lastSlPrice)
                throw new Error("SL order or price missing in state");

            let slPrice = e.side === "buy" ? targetCandle.low : targetCandle.high;

            if (lowerTFCandles.length) {
                const r = Utils.detectLowerTimeframeReversal(
                    e.side,
                    lowerTFTargetCandle,
                    lowerTFCandles
                );

                if (r.shouldTighten && r.slPrice !== undefined) {
                    slPrice = r.slPrice;

                    reversalLogger.info(
                        `[15m-ReversalDetected] ${sym} tighten SL → ${slPrice} | Points: ${r.points}`,
                        { side: e.side, slPrice, points: r.points }
                    );
                }
            }

            let sl =
                e.side === "buy"
                    ? Math.min(slPrice, currentPrice)
                    : Math.max(slPrice, currentPrice);

            if (sl === currentPrice) {
                const buffer = 0.1;
                sl = e.side === "buy"
                    ? sl * (1 - buffer / 100)
                    : sl * (1 + buffer / 100);
            }

            const updateRes = await deltaExchange.updateStopLossOrder(
                s.lastStopLossOrderId,
                s.lastSlPrice,
                TradingConfig.getConfig().PRODUCT_ID,
                sym,
                e.side,
                sl
            );

            if (!updateRes.success && updateRes.isSlSame) return s;
            if (!updateRes.success && updateRes.isReversed) return s;

            if (!updateRes.success)
                return this.placeCancelledBracketOrders(s, e, sl);

            const updated = await this.updateStateSl(s, Number(updateRes.slLimitPrice));

            if (!updated) throw new Error("Martingale state not found");

            return updated as IMartingaleState;

        } catch (err) {

            tradingCycleErrorLogger.error("[manageOpenPosition]", err);

            return s;
        }
    }

    static async processStateOfPendingTrade(
        sym: string,
        state: IMartingaleState,
        order: OrderDetails,
        targetCandle: TargetCandle,
        currentPrice: number,
        lowerTFTargetCandle: TargetCandle,
        lowerTFCandles: Candle[]
    ): Promise<IMartingaleState> {

        try {

            switch (order.status.toUpperCase()) {
                case "CANCELLED":
                    return this.handleCanceledEntryOrder(state);
                case "CLOSED":
                    return this.handleClosedEntryOrder(sym, state, order, targetCandle, currentPrice, lowerTFTargetCandle, lowerTFCandles);
                default:
                    return state;
            }

        } catch (err) {
            tradingCycleErrorLogger.error("[processOutcome] error", err);
            return state;
        }
    }

    static async handleClosedEntryOrder(
        sym: string,
        s: IMartingaleState,
        e: OrderDetails,
        targetCandle: TargetCandle,
        currentPrice: number,
        lowerTFTargetCandle: TargetCandle,
        lowerTFCandles: Candle[]
    ): Promise<IMartingaleState> {
        const cfg = TradingConfig.getConfig();
        const positions = await deltaExchange.getPositions(cfg.PRODUCT_ID);
        const hasOpenPosition =
            Array.isArray(positions)
                ? positions.some(p => Number(p.size) !== 0)
                : positions && Number(positions.size) !== 0;

        console.log({ hasOpenPosition });

        return hasOpenPosition
            ? this.manageOpenPosition(sym, s, e, targetCandle, currentPrice, lowerTFTargetCandle, lowerTFCandles)
            : this.processClosedPosition(s, Number(e.paid_commission || 0), currentPrice);
    }
}