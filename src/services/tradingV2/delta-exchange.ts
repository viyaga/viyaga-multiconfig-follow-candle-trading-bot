import crypto from "crypto";
import { TradingConfig } from "./config";
import { Utils } from "./utils";
import { tradingCycleErrorLogger, tradingCronLogger, getContextualLogger } from "./logger";
import { CancelAllOrdersFilter, CancelAllOrdersPayload, OrderDetails, OrderSide, Position, TickerData } from "./type";

export class DeltaExchange {

    private generateSignature(method: string, path: string, ts: number, body = ""): string {
        const c = TradingConfig.getConfig();
        return crypto.createHmac("sha256", c.SECRET_KEY).update(`${method}${ts}${path}${body}`).digest("hex");
    }

    private buildSignedHeaders(method: string, sig: string, ts: number): Record<string, string> {
        const c = TradingConfig.getConfig(), h: Record<string, string> = { Accept: "application/json", "api-key": c.API_KEY, signature: sig, timestamp: String(ts) };
        if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) h["Content-Type"] = "application/json";
        return h;
    }

    async signedRequest(method: string, endpoint: string, bodyObj?: any, query?: URLSearchParams): Promise<any> {
        try {
            const c = TradingConfig.getConfig(), qStr = query?.toString() ? `?${query.toString()}` : "", ts = Math.floor(Date.now() / 1000) - 2, body = bodyObj ? Utils.compactJson(bodyObj) : "";
            const sig = this.generateSignature(method, `/v2${endpoint}${qStr}`, ts, body);
            const r = await fetch(`${c.BASE_URL}${endpoint}${qStr}`, { method, headers: this.buildSignedHeaders(method, sig, ts), body: (body && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) ? body : undefined });
            const json = Utils.parseJsonSafe(await r.text());
            if (!r.ok) throw new Error(`Delta API error ${r.status}: ${JSON.stringify(json)}`);
            return json;
        } catch (err) {
            tradingCycleErrorLogger.error(`[delta] Failed request: ${method} ${endpoint}`, err);
            throw err;
        }
    }

    async getCandlestickData(s: string, r: string, start: number, end: number) {
        return this.signedRequest("GET", "/history/candles", undefined, new URLSearchParams({ symbol: s, resolution: r, start: String(start / 1000), end: String(end / 1000) }));
    }

    async getTickerData(sym: string): Promise<TickerData | null> {
        const r = (await this.signedRequest("GET", `/tickers/${sym}`))?.result ?? null;
        if (r?.quotes) {
            if (r.quotes.best_ask && r.best_ask === undefined) r.best_ask = r.quotes.best_ask;
            if (r.quotes.best_bid && r.best_bid === undefined) r.best_bid = r.quotes.best_bid;
        }
        return r;
    }

    async getOrderDetails(id: string): Promise<OrderDetails | null> {
        const raw = await this.signedRequest("GET", `/orders/${id}`);
        if (!raw?.result) return null;
        const o = raw.result, s = (o.state || o.status)?.toUpperCase();
        if (!s) return null;
        return { id: String(o.id), status: s, meta_data: o.meta_data, paid_commission: o.paid_commission, product_id: o.product_id, side: o.side, client_order_id: o.client_order_id, product_symbol: o.product_symbol, average_fill_price: o.average_fill_price, limit_price: o.limit_price, size: o.size, bracket_order: o.bracket_order ?? null };
    }


    async updateStopLossOrder(
        id: number | string,
        slPrice: number,
        productId: number,
        productSymbol: string,
        orderSide: OrderSide,
        sl: number,
        logContext?: any
    ): Promise<{ success: boolean, slPrice: number, isSlSame?: boolean, isSlReversed?: boolean }> {

        const logger = getContextualLogger(tradingCronLogger, logContext);

        const c = TradingConfig.getConfig();

        const slTriggerPrice = orderSide === "buy"
            ? sl * (1 - c.SL_TRIGGER_BUFFER_PERCENT / 100)
            : sl * (1 + c.SL_TRIGGER_BUFFER_PERCENT / 100);

        const slLimitPrice = orderSide === "buy"
            ? sl * (1 - c.SL_LIMIT_BUFFER_PERCENT / 100)
            : sl * (1 + c.SL_LIMIT_BUFFER_PERCENT / 100);

        const stopPrice = String(Utils.clampPrice(slTriggerPrice));
        const limitPrice = String(Utils.clampPrice(slLimitPrice));

        const oldSlLimit = Utils.clampPrice(slPrice * (orderSide === "buy" ? (1 - c.SL_LIMIT_BUFFER_PERCENT / 100) : (1 + c.SL_LIMIT_BUFFER_PERCENT / 100)));
        const newSlLimit = Number(limitPrice);

        logger.debug("SL price calculation", { newSlLimit, oldSlLimit, sl, slPrice });

        // SL unchanged
        if (newSlLimit === oldSlLimit) {
            logger.debug("SL prices unchanged. Skipping update.");
            return { success: false, slPrice: sl, isSlSame: true };
        }

        // Check wrong direction movement
        const isSlReversed =
            (orderSide === "buy" && newSlLimit < oldSlLimit) ||
            (orderSide === "sell" && newSlLimit > oldSlLimit);

        if (isSlReversed) {
            logger.warn("SL moved in wrong direction. Skipping update.");
            return { success: false, slPrice: sl, isSlReversed: true };
        }

        const payload = {
            id,
            product_id: productId,
            product_symbol: productSymbol,
            limit_price: limitPrice,
            stop_price: stopPrice,
        };

        logger.info("Updating Stop Loss Order", { payload });

        const updateRes: any = await this.signedRequest("PUT", "/orders", payload);

        logger.debug("Updated Stop Loss Order response", { updateRes });

        return { success: updateRes?.success ?? false, slPrice: sl };
    }

    async updateTakeProfitOrder(
        id: number | string,
        tpPrice: number,
        productId: number,
        productSymbol: string,
        tp: number,
        logContext?: any
    ): Promise<{ success: boolean, tpPrice: number, isTpSame?: boolean }> {

        const logger = getContextualLogger(tradingCronLogger, logContext);

        const tpLimitPrice = String(Utils.clampPrice(tp));
        const oldTpLimit = String(Utils.clampPrice(tpPrice));

        logger.debug("TP price calculation", { tpLimitPrice, oldTpLimit, tp, tpPrice });

        // TP unchanged
        if (tpLimitPrice === oldTpLimit) {
            logger.debug("TP prices unchanged. Skipping update.");
            return { success: false, tpPrice: tp, isTpSame: true };
        }

        const payload = {
            id,
            product_id: productId,
            product_symbol: productSymbol,
            limit_price: tpLimitPrice,
            stop_price: tpLimitPrice,
        };

        logger.info("Updating Take Profit Order", { payload });

        const updateRes: any = await this.signedRequest("PUT", "/orders", payload);

        logger.debug("Updated Take Profit Order response", { updateRes });

        return { success: updateRes?.success ?? false, tpPrice: tp };
    }

    async placeEntryOrder(symbol: string, side: OrderSide, qty: number, cid?: string) {
        const c = TradingConfig.getConfig();
        return deltaExchange.signedRequest("POST", "/orders", { product_id: c.PRODUCT_ID, product_symbol: symbol, side, size: Math.floor(qty), order_type: "market_order", time_in_force: "gtc", client_order_id: cid || `viy-${Date.now()}` });
    }

    async cancelStopOrders(f: CancelAllOrdersFilter): Promise<{ success: boolean }> {
        const p: CancelAllOrdersPayload = { contract_types: "perpetual_futures", cancel_limit_orders: false, cancel_stop_orders: true, cancel_reduce_only_orders: true };
        if (f.product_id) p.product_id = f.product_id;
        return (await this.signedRequest("DELETE", "/orders/all", p))?.success ? { success: true } : { success: false };
    }

    async getPositions(pid?: number): Promise<Position | Position[] | null> {
        return (await this.signedRequest("GET", "/positions", undefined, pid ? new URLSearchParams({ product_id: String(pid) }) : undefined))?.result ?? null;
    }

    async placeTPSLBracketOrder(tp: number, sl: number, positionSide: OrderSide, logContext?: any): Promise<{ success: boolean; ids: { tp: string; sl: string } }> {
        const payload = Utils.constructBracketOrderPayload(tp, sl, positionSide);
        const logger = getContextualLogger(tradingCronLogger, logContext);
        if (!payload.stop_loss_order && !payload.take_profit_order) return { success: false, ids: { tp: "", sl: "" } };

        logger.info("Placing TP/SL orders", { tp, sl, payload });

        const maxRetries = 3;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const raw = await this.signedRequest("POST", "/orders/bracket", payload);
                if (raw?.result) {
                    return {
                        success: true,
                        ids: {
                            tp: raw.result.take_profit_order?.id?.toString(),
                            sl: raw.result.stop_loss_order?.id?.toString(),
                        },
                    };
                }

                logger.warn(`Bracket order attempt ${attempt} failed: Empty result (raw: ${JSON.stringify(raw)})`);
            } catch (err: any) {
                const errorStr = String(err);
                const isNoPosition = errorStr.toLowerCase().includes("no_open_position") ||
                    errorStr.toLowerCase().includes("insufficient_position");

                if (isNoPosition && attempt < maxRetries) {
                    logger.warn(`Bracket order attempt ${attempt} failed due to no open position. Retrying in 1s...`);
                    await Utils.sleep(1000);
                    continue;
                }

                logger.error(`Bracket order attempt ${attempt} failed with error:`, err);
                if (attempt === maxRetries) throw new Error(`Failed to place TPSL bracket order after ${maxRetries} attempts: ${err}`);
            }

            if (attempt < maxRetries) {
                logger.info(`Retrying bracket order (attempt ${attempt + 1}/${maxRetries})...`);
                await Utils.sleep(1000);
            }
        }

        return { success: false, ids: { tp: "", sl: "" } };
    }
}

export const deltaExchange = new DeltaExchange();
