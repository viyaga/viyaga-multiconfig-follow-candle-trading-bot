import { resolve } from "node:path";
import { IMartingaleState, MartingaleState } from "../../models/martingaleState.model";
import { TradingConfig } from "./config";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger } from "./logger";
import { OrderDetails, TargetCandle } from "./type";
import { Utils } from "./utils";

export class ProcessPendingState {

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
            allTimeFees: (s.allTimeFees || 0) + incrementalFees
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

        const targetAmount = Math.abs(netDebt) * 1;
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
            allTimeFees: (s.allTimeFees || 0) + incrementalFees
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

    private static async handleOpenEntryOrder(
        s: IMartingaleState
    ): Promise<IMartingaleState> {

        try {
            const res = await deltaExchange.cancelAllOpenOrders({ product_id: TradingConfig.getConfig().PRODUCT_ID });
            if (res?.success) {
                return this.markCancelled(s);
            }
        } catch (err) {
            tradingCycleErrorLogger.error("[cleanup] Failed to cancel open entry", err);
        }

        return s;
    }

    private static handleCanceledEntryOrder(s: IMartingaleState): IMartingaleState {
        return this.markCancelled(s);
    }


    static async handlePartiallyFilledEntryOrder(
        s: IMartingaleState,
        ep: number,
        pc: number
    ): Promise<IMartingaleState> {

        try {
            await deltaExchange.cancelAllOpenOrders({ product_id: TradingConfig.getConfig().PRODUCT_ID });
        } catch (err) {
            tradingCycleErrorLogger.error(
                "[partialFill] cancelAllOpenOrders failed",
                err
            );
        }

        try {
            await deltaExchange.closeAllPositions(
                TradingConfig.getConfig().DELTAEX_USER_ID
            );
        } catch (err) {
            tradingCycleErrorLogger.error(
                "[partialFill] closeAllPositions failed",
                err
            );
        }

        return {
            ...s,
            cumulativeFees: s.cumulativeFees + pc,
            allTimeFees: (s.allTimeFees || 0) + pc,
            lastEntryPrice: ep,
            lastTradeOutcome: "cancelled",
        };
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

    static async manageOpenPosition(
        sym: string,
        s: IMartingaleState,
        e: OrderDetails,
        targetCandle: TargetCandle
    ): Promise<IMartingaleState> {
        try {

            const sl = e.side === "buy" && targetCandle.color === "green" ? targetCandle.low : e.side === "sell" && targetCandle.color === "red" ? targetCandle.high : null;

            if (!sl) {
                console.log("[manageOpenPosition] Candle color is not in the direction of the trade.Skipping this cycle")
                return s;
            }

            if (!s.lastStopLossOrderId || !s.lastSlPrice) {
                throw new Error("[manageOpenPosition] SL order ID not found. Skipping this cycle");
            }

            const res = await deltaExchange.updateStopLossOrder(
                s.lastStopLossOrderId,
                s.lastSlPrice,
                TradingConfig.getConfig().PRODUCT_ID,
                sym,
                e.side,
                sl,
            );

            if (!res.success) {
                if (res.isSlSame) return s;
                throw new Error("[manageOpenPosition] Failed to update SL. Skipping update.");
            }

            const updatedState = await MartingaleState.findOneAndUpdate(
                { userId: s.userId, symbol: s.symbol },
                {
                    $set: {
                        lastSlPrice: res.slLimitPrice,
                    },
                },
                { new: true } // 🔥 return updated document
            );

            if (!updatedState) throw new Error("Martingale state not found");

            return updatedState as IMartingaleState;
        } catch (err) {
            tradingCycleErrorLogger.error("[manageOpenPosition] error", err);
            return s;
        }
    }

    static async processStateOfPendingTrade(
        sym: string,
        state: IMartingaleState,
        order: OrderDetails,
        targetCandle: TargetCandle,
        currentPrice: number
    ): Promise<IMartingaleState> {

        try {

            switch (order.status.toUpperCase()) {
                case "OPEN":
                    return this.handleOpenEntryOrder(state);
                case "CANCELLED":
                    return this.handleCanceledEntryOrder(state);
                case "CLOSED":
                    return this.handleClosedEntryOrder(sym, state, order, targetCandle, currentPrice);
                case "PENDING":
                    return this.handlePartiallyFilledEntryOrder(state, Utils.resolveEntryPrice(order), Number(order.paid_commission) || 0);
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
        currentPrice: number
    ): Promise<IMartingaleState> {
        const cfg = TradingConfig.getConfig();
        const positions = await deltaExchange.getPositions(cfg.PRODUCT_ID);
        const hasOpenPosition =
            Array.isArray(positions)
                ? positions.some(p => Number(p.size) !== 0)
                : positions && Number(positions.size) !== 0;

        return hasOpenPosition
            ? this.manageOpenPosition(sym, s, e, targetCandle)
            : this.processClosedPosition(s, Number(e.paid_commission || 0), currentPrice);
    }
}