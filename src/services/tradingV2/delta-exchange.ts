import crypto from "crypto";
import { TradingConfig } from "./config";
import { Utils } from "./utils";
import { tradingCycleErrorLogger } from "./logger";
import { CancelAllOrdersFilter, CancelAllOrdersPayload, OrderDetails, OrderSide, Position, TickerData } from "./type";

export class DeltaExchange {

    private generateSignature(method: string, path: string, ts: number, body = ""): string {
        const c = TradingConfig.getConfig();
        return crypto.createHmac("sha256", c.DELTA_EXCHANGE_SECRET_KEY).update(`${method}${ts}${path}${body}`).digest("hex");
    }

    private buildSignedHeaders(method: string, sig: string, ts: number): Record<string, string> {
        const c = TradingConfig.getConfig(), h: Record<string, string> = { Accept: "application/json", "api-key": c.DELTA_EXCHANGE_API_KEY, signature: sig, timestamp: String(ts) };
        if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) h["Content-Type"] = "application/json";
        return h;
    }

    async signedRequest(method: string, endpoint: string, bodyObj?: any, query?: URLSearchParams): Promise<any> {
        try {
            const c = TradingConfig.getConfig(), qStr = query?.toString() ? `?${query.toString()}` : "", ts = Math.floor(Date.now() / 1000) - 2, body = bodyObj ? Utils.compactJson(bodyObj) : "";
            const sig = this.generateSignature(method, `/v2${endpoint}${qStr}`, ts, body);
            const r = await fetch(`${c.DELTA_EXCHANGE_BASE_URL_INDIA}${endpoint}${qStr}`, { method, headers: this.buildSignedHeaders(method, sig, ts), body: (body && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) ? body : undefined });
            const json = Utils.parseJsonSafe(await r.text());
            if (!r.ok) throw new Error(`Delta API error ${r.status}: ${JSON.stringify(json)}`);
            return json;
        } catch (err) { tradingCycleErrorLogger.error(`[delta] Failed request: ${method} ${endpoint}`, err); return { error: err }; }
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


    async updateStopLossOrder(id: number | string, lastSlPrice: number, productId: number, productSymbol: string, orderSide: OrderSide, sl: number): Promise<{ success: boolean, slLimitPrice: string, isSlSame?: boolean }> {

        const c = TradingConfig.getConfig();

        const slTriggerPrice = orderSide === "buy"
            ? sl * (1 - c.SL_TRIGGER_BUFFER_PERCENT / 100)
            : sl * (1 + c.SL_TRIGGER_BUFFER_PERCENT / 100);

        const slLimitPrice = orderSide === "buy"
            ? sl * (1 - c.SL_LIMIT_BUFFER_PERCENT / 100)
            : sl * (1 + c.SL_LIMIT_BUFFER_PERCENT / 100);

        const stopPrice = String(Utils.clampPrice(slTriggerPrice));
        const limitPrice = String(Utils.clampPrice(slLimitPrice));

        console.log("[updateStopLossOrder] SL price", { limitPrice, lastSlPrice });
        if (limitPrice === lastSlPrice.toString()) {
            console.log("[updateStopLossOrder] SL prices unchanged. Skipping update.");
            return { success: false, slLimitPrice: String(sl), isSlSame: true };
        }

        const payload = {
            id,
            product_id: productId,
            product_symbol: productSymbol,
            limit_price: limitPrice,
            stop_price: stopPrice,
        };
        console.log("[delta] Updating Stop Loss Order:", payload);
        const updateRes: any = await this.signedRequest("PUT", "/orders", payload);
        console.log("[delta] Updated Stop Loss Order:", updateRes);

        return { success: updateRes?.success ?? false, slLimitPrice: limitPrice };
    }

    async placeEntryOrder(symbol: string, side: OrderSide, qty: number, cid?: string) {
        const c = TradingConfig.getConfig();
        return deltaExchange.signedRequest("POST", "/orders", { product_id: c.PRODUCT_ID, product_symbol: symbol, side, size: Math.floor(qty), order_type: "market_order", time_in_force: "gtc", client_order_id: cid || `viy-${Date.now()}` });
    }

    async cancelAllOpenOrders(f: CancelAllOrdersFilter): Promise<{ success: boolean }> {
        const p: CancelAllOrdersPayload = { contract_types: f.contract_types ?? "perpetual_futures", cancel_limit_orders: f.cancel_limit_orders ?? false, cancel_stop_orders: f.cancel_stop_orders ?? false, cancel_reduce_only_orders: f.cancel_reduce_only_orders ?? false };
        if (f.product_id) p.product_id = f.product_id;
        return (await this.signedRequest("DELETE", "/orders/all", p))?.success ? { success: true } : { success: false };
    }

    async getPositions(pid?: number): Promise<Position | Position[] | null> {
        return (await this.signedRequest("GET", "/positions", undefined, pid ? new URLSearchParams({ product_id: String(pid) }) : undefined))?.result ?? null;
    }

    async placeTPSLBracketOrder(tp: number, sl: number, positionSide: OrderSide): Promise<{ success: boolean; ids: { tp: string; sl: string } }> {
        const payload = Utils.constructBracketOrderPayload(tp, sl, positionSide);
        if (!payload.stop_loss_order && !payload.take_profit_order)
            return { success: false, ids: { tp: "", sl: "" } };

        console.log("[delta] Placing TP/SL orders:", tp, sl, payload);
        try {
            const raw = await this.signedRequest("POST", "/orders/bracket", payload);
            return raw?.result
                ? {
                    success: true,
                    ids: {
                        tp: raw.result.take_profit_order?.id?.toString(),
                        sl: raw.result.stop_loss_order?.id?.toString(),
                    },
                }
                : { success: false, ids: { tp: "", sl: "" } };
        } catch (err: any) {
            throw new Error(`Failed to place TPSL bracket order: ${err}`);
        }
    }
}

export const deltaExchange = new DeltaExchange();
