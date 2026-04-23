import { TradingV2 } from ".";
import { ITradeState, TradeState } from "../../models/tradeState.model";

import { TradingConfig } from "./config";
import { deltaExchange } from "./delta-exchange";
import { tradingCycleErrorLogger, tradingCronLogger, getContextualLogger } from "./logger";
import { Candle, OrderDetails, TargetCandle } from "./type";
import { Utils } from "./utils";
import { TripleTFResult } from "./market-detector/multi-timeframe";

export class ProcessPendingState {

    /* =========================================================================
       CANDLE ANALYSIS UTILITIES
    ========================================================================= */

    static resetState(s: ITradeState): ITradeState {
        const c = TradingConfig.getConfig();
        return {
            ...s,
            currentLevel: 1,
            tradeOutcome: "none",
            entryOrderId: null,
            stopLossOrderId: null,
            takeProfitOrderId: null,
            entryPrice: null,
            slPrice: null,
            tpPrice: null,
            quantity: c.INITIAL_BASE_QUANTITY,
            pnl: 0,
            cumulativeFees: 0,
            allTimePnl: s.allTimePnl || 0,
            allTimeFees: s.allTimeFees || 0,
        };
    }

    static async handleWin(
        s: ITradeState,
        winPnl: number,
        tempFees: number,
        incrementalPnl: number,
        incrementalFees: number,
        logContext?: any
    ): Promise<ITradeState> {
        const logger = getContextualLogger(tradingCronLogger, logContext);
        logger.info(`[StateTransition] Outcome: WIN | Symbol: ${s.symbol} | Net PnL (Session): ${winPnl.toFixed(2)} | Total Fees (Session): ${tempFees.toFixed(2)}`);
        logger.info(`[StateTransition] WIN Details: Incremental PnL: ${incrementalPnl.toFixed(2)}, Incremental Fees: ${incrementalFees.toFixed(2)}`);

        const updated = await TradeState.findByIdAndUpdate(s.id || (s as any)._id, {
            $set: {
                status: 'closed',
                tradeOutcome: "win",
                pnl: winPnl,
                cumulativeFees: tempFees,
                allTimePnl: (s.allTimePnl || 0) + incrementalPnl,
                allTimeFees: (s.allTimeFees || 0) + incrementalFees,
                lastTradeSettledAt: new Date()
            }
        }, { new: true });

        if (!updated) throw new Error("Failed to close trade state on win");
        return updated as ITradeState;
    }

    static async handleLoss(
        s: ITradeState,
        netDebt: number,
        pnl: number,
        fees: number,
        currentPrice: number,
        incrementalPnl: number,
        incrementalFees: number,
        multiplier: number,
        logContext?: any
    ): Promise<ITradeState> {
        const logger = getContextualLogger(tradingCronLogger, logContext);

        const c = TradingConfig.getConfig();

        const targetAmount = Math.abs(netDebt) * multiplier; // Dynamic multiplier based on MTF score
        const marginRequiredPerLot = currentPrice * c.LOT_SIZE / c.LEVERAGE
        const lots = c.INITIAL_BASE_QUANTITY + Math.ceil(
            targetAmount / marginRequiredPerLot
        );
        const nextLevel = s.currentLevel + 1;

        logger.info(`[StateTransition] Outcome: LOSS | Symbol: ${s.symbol} | Net Debt: ${netDebt.toFixed(2)} | Next Level: ${nextLevel} | Calculated Lots: ${lots}`);
        logger.info(`[StateTransition] LOSS Details: Incremental PnL: ${incrementalPnl.toFixed(2)}, Incremental Fees: ${incrementalFees.toFixed(2)}`);

        const updated = await TradeState.findByIdAndUpdate(s.id || (s as any)._id, {
            $set: {
                status: 'closed',
                currentLevel: nextLevel,
                tradeOutcome: "loss",
                quantity: lots,
                entryOrderId: null,
                stopLossOrderId: null,
                takeProfitOrderId: null,
                entryPrice: null,
                slPrice: null,
                tpPrice: null,
                pnl,
                cumulativeFees: fees,
                allTimePnl: (s.allTimePnl || 0) + incrementalPnl,
                allTimeFees: (s.allTimeFees || 0) + incrementalFees,
                lastTradeSettledAt: new Date()
            }
        }, { new: true });

        if (!updated) throw new Error("Failed to update trade state on loss");
        return updated as ITradeState;
    }

    static async markCancelled(s: ITradeState): Promise<ITradeState> {
        const updated = await TradeState.findByIdAndUpdate(s.id || (s as any)._id, {
            $set: { tradeOutcome: "cancelled" }
        }, { new: true });

        if (!updated) throw new Error("Failed to update trade state to cancelled");
        return updated as ITradeState;
    }

    /* =========================================================================
   PENDING ORDER HANDLING
========================================================================= */

    private static async handleCanceledEntryOrder(s: ITradeState): Promise<ITradeState> {

        return this.markCancelled(s);
    }

    /* =========================================================================
   CLOSED POSITION OUTCOME
========================================================================= */

    static async processClosedPosition(
        s: ITradeState,
        entryCommission: number,
        currentPrice: number,
        multiplier: number,
        logContext?: any
    ): Promise<ITradeState> {
        const logger = getContextualLogger(tradingCronLogger, logContext);

        if (!s.stopLossOrderId || !s.takeProfitOrderId) {
            logger.warn(`[PositionOutcome] Missing TP/SL order IDs for ${s.symbol} in state. Entry was CLOSED but bracket orders are unknown. Recovering status while PRESERVING trade metrics (Level, PnL, Fees).`);

            return {
                ...s,
                entryOrderId: null,
                stopLossOrderId: null,
                takeProfitOrderId: null,
                tradeOutcome: "none",
                cumulativeFees: s.cumulativeFees + entryCommission,
                allTimeFees: (s.allTimeFees || 0) + entryCommission,
            };
        }

        const tp = await deltaExchange.getOrderDetails(s.takeProfitOrderId);
        if (tp && tp.status === "CLOSED") {
            const incrementalPnl = Number(tp.meta_data?.pnl || 0);
            const incrementalFees = Number(tp.paid_commission || 0) + entryCommission;
            const netPnl = s.pnl + incrementalPnl;
            const fees = s.cumulativeFees + incrementalFees;

            getContextualLogger(tradingCronLogger, logContext).info(`[PositionOutcome] TAKE PROFIT reached for ${s.symbol}`);

            return await this.handleWin(s, netPnl, fees, incrementalPnl, incrementalFees, logContext);
        }

        const sl = await deltaExchange.getOrderDetails(s.stopLossOrderId);
        if (sl && sl.status === "CLOSED") {

            const incrementalPnl = Number(sl?.meta_data?.pnl || 0);
            const incrementalFees = Number(sl?.paid_commission || 0) + entryCommission;
            const netPnl = s.pnl + incrementalPnl;
            const fees = s.cumulativeFees + incrementalFees;
            const netDebt = netPnl - fees;

            getContextualLogger(tradingCronLogger, logContext).info(`[PositionOutcome] STOP LOSS hit for ${s.symbol}`);

            return netDebt >= 0
                ? await this.handleWin(s, netPnl, fees, incrementalPnl, incrementalFees, logContext)
                : await this.handleLoss(s, netDebt, netPnl, fees, currentPrice, incrementalPnl, incrementalFees, multiplier, logContext);
        }

        if (tp?.status === "CANCELLED" && sl?.status === "CANCELLED") {
            const logger = getContextualLogger(tradingCronLogger, logContext);
            logger.warn("TP and SL orders were cancelled by user. Treating as LOSS.");

            const incrementalPnl = 0;
            const incrementalFees = entryCommission;
            const netPnl = s.pnl;
            const fees = s.cumulativeFees + incrementalFees;
            const netDebt = netPnl - fees;
            return await this.handleLoss(s, netDebt, netPnl, fees, currentPrice, incrementalPnl, incrementalFees, multiplier, logContext);
        }

        throw new Error("[processClosedPosition] Neither TP nor SL orders are filled/closed.");
    }

    static async placeCancelledBracketOrders(
        state: ITradeState,
        e: OrderDetails,
        sl: number,
        logContext?: any
    ): Promise<ITradeState> {
        const slOrder = await deltaExchange.getOrderDetails(
            state.stopLossOrderId!
        );

        if (slOrder?.status !== "CANCELLED") {
            throw new Error("SL update failed");
        }

        const cancelRes = await deltaExchange.cancelStopOrders({
            product_id: TradingConfig.getConfig().PRODUCT_ID,
        });
        getContextualLogger(tradingCronLogger, logContext).debug("Cancelled existing stop orders during bracket replacement", { cancelRes });

        const entryPrice =
            e.average_fill_price ?? e.meta_data?.entry_price;

        if (!entryPrice) {
            throw new Error("Entry price not found");
        }

        const tp = state.tpPrice;
        if (!tp) {
            throw new Error("[placeCancelledBracketOrders] TP price not found in state");
        }

        const bracketRes =
            await deltaExchange.placeTPSLBracketOrder(tp, sl, e.side);

        if (!bracketRes.success) {
            throw new Error("TP/SL placement failed");
        }

        const updated = await TradeState.findOneAndUpdate(
            {
                tradingBotId: state.tradingBotId,
                userId: state.userId,
                symbol: state.symbol,
            },
            {
                $set: {
                    slPrice: sl,
                    tpPrice: tp,
                    stopLossOrderId: bracketRes.ids.sl,
                    takeProfitOrderId: bracketRes.ids.tp,
                },
            },
            { new: true }
        );

        if (!updated) {
            throw new Error("Trade state not found");
        }

        return updated as ITradeState;
    }

    static async updateStatePrices(
        state: ITradeState,
        sl: number,
        tp: number
    ): Promise<ITradeState> {
        const updated = await TradeState.findOneAndUpdate(
            {
                tradingBotId: state.tradingBotId,
                userId: state.userId,
                symbol: state.symbol,
            },
            { $set: { slPrice: sl, tpPrice: tp } },
            { new: true }
        );

        if (!updated) {
            throw new Error("Trade state not found");
        }

        return updated as ITradeState;
    }

    static async manageOpenPosition(
        sym: string,
        s: ITradeState,
        e: OrderDetails,
        mtf: TripleTFResult,
        logContext?: any
    ): Promise<ITradeState> {

        if (!mtf.isAllowed) return s;

        const logger = getContextualLogger(tradingCycleErrorLogger, logContext);
        try {

            if (!s.stopLossOrderId || !s.slPrice) throw new Error("SL order or price missing in state");

            const sl = mtf.sl;
            const tp = mtf.tp;

            const updateRes = await deltaExchange.updateStopLossOrder(
                s.stopLossOrderId,
                s.slPrice,
                TradingConfig.getConfig().PRODUCT_ID,
                sym,
                e.side,
                sl,
                logContext
            );

            let tpUpdatedValue = s.tpPrice || 0;
            if (s.takeProfitOrderId && s.tpPrice && tp) {
                const updateTpRes = await deltaExchange.updateTakeProfitOrder(
                    s.takeProfitOrderId,
                    s.tpPrice,
                    TradingConfig.getConfig().PRODUCT_ID,
                    sym,
                    tp,
                    logContext
                );
                if (updateTpRes.success) {
                    tpUpdatedValue = Number(updateTpRes.tpLimitPrice);
                }
            }

            if (!updateRes.success && updateRes.isSlSame && tpUpdatedValue === s.tpPrice) return s;
            if (!updateRes.success && updateRes.isSlReversed) return s;

            if (!updateRes.success)
                return this.placeCancelledBracketOrders(s, e, sl, logContext);

            const updated = await this.updateStatePrices(s, Number(updateRes.slLimitPrice), tpUpdatedValue);

            if (!updated) throw new Error("Trade state not found");

            return updated as ITradeState;

        } catch (err) {
            logger.error("Error in manageOpenPosition", { error: err });
            return s;
        }
    }

    static async recoverMissingBracketOrders(
        s: ITradeState,
        e: OrderDetails,
        mtf: TripleTFResult,
        logContext?: any
    ): Promise<ITradeState> {
        const logger = getContextualLogger(tradingCronLogger, logContext);
        logger.info(`[Recovery] Detected open position for ${s.symbol} but missing TP/SL IDs in state. Re-placing bracket orders...`);

        // Use existing prices from state if available, otherwise fallback to MTF
        const tp = s.tpPrice || mtf.tp;
        const sl = s.slPrice || mtf.sl;

        if (!tp || !sl) {
            throw new Error(`[Recovery] Invalid TP/SL during recovery: TP=${tp}, SL=${sl}`);
        }

        const tpSlResult = await deltaExchange.placeTPSLBracketOrder(tp, sl, e.side, logContext);

        if (!tpSlResult.success || !tpSlResult.ids.tp || !tpSlResult.ids.sl) {
            throw new Error(`[Recovery] Failed to re-place TP/SL bracket orders during recovery. TP_ID=${tpSlResult.ids.tp}, SL_ID=${tpSlResult.ids.sl}`);
        }

        const updated = await TradeState.findOneAndUpdate(
            { tradingBotId: s.tradingBotId, userId: s.userId, symbol: s.symbol },
            {
                $set: {
                    stopLossOrderId: tpSlResult.ids.sl,
                    takeProfitOrderId: tpSlResult.ids.tp,
                    slPrice: sl,
                    tpPrice: tp
                }
            },
            { new: true }
        );

        if (!updated) throw new Error("[Recovery] Failed to update state after bracket recovery");

        logger.info(`[Recovery] Successfully re-placed TP/SL bracket orders: TP_ID=${tpSlResult.ids.tp}, SL_ID=${tpSlResult.ids.sl}`);

        return updated as ITradeState;
    }

    static async processStateOfPendingTrade(
        sym: string,
        state: ITradeState,
        order: OrderDetails,
        mtf: TripleTFResult,
        currentPrice: number,
        multiplier: number,
        logContext?: any
    ): Promise<ITradeState> {
        const logger = getContextualLogger(tradingCycleErrorLogger, logContext);
        try {

            switch (order.status.toUpperCase()) {
                case "CANCELLED":
                    return await this.handleCanceledEntryOrder(state);
                case "CLOSED":
                    return await this.handleClosedEntryOrder(sym, state, order, mtf, currentPrice, multiplier, logContext);
                default:
                    return state;
            }

        } catch (err) {
            logger.error("Error in processStateOfPendingTrade", { error: err });
            return state;
        }
    }

    static async handleClosedEntryOrder(
        sym: string,
        s: ITradeState,
        e: OrderDetails,
        mtf: TripleTFResult,
        currentPrice: number,
        multiplier: number,
        logContext?: any
    ): Promise<ITradeState> {
        const cfg = TradingConfig.getConfig();
        const positions = await deltaExchange.getPositions(cfg.PRODUCT_ID);
        const hasOpenPosition = Array.isArray(positions)
            ? positions.some(p => Number(p.size) !== 0)
            : positions && Number(positions.size) !== 0;

        getContextualLogger(tradingCronLogger, logContext).debug("Checking for open positions after entry order close", { hasOpenPosition });

        if (hasOpenPosition) {
            // Safety Check: If position is open but TP/SL IDs are missing, re-place them
            if (!s.stopLossOrderId || !s.takeProfitOrderId) {
                return this.recoverMissingBracketOrders(s, e, mtf, logContext);
            }
            return s;
        }

        return this.processClosedPosition(s, Number(e.paid_commission || 0), currentPrice, multiplier, logContext);
    }
}