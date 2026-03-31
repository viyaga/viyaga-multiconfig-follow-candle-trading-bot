import { IMartingaleState } from "../../models/martingaleState.model";
import { TradingConfig } from "./config";
import { Candle, OrderSide, TargetCandle } from "./type";
import { skipTradingLogger } from "./logger";

export class Utils {
    static parseJsonSafe(t: string): unknown { try { return JSON.parse(t); } catch { return t; } }
    static compactJson(o: unknown): string { return o ? JSON.stringify(o) : ""; }

    static getTimeframeDurationMs(tf: string): number {
        const v = parseInt(tf.slice(0, -1));
        if (isNaN(v)) return 0;
        const map: Record<string, number> = { m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 };
        return v * (map[tf.slice(-1).toLowerCase()] || 0) * 1000;
    }

    static parseStandardCandle(c: any[]): Candle { const [t, o, h, l, cl, v] = c; return { timestamp: Number(t) * 1000, open: Number(o), high: Number(h), low: Number(l), close: Number(cl), volume: Number(v ?? 0) }; }
    static parseObjectCandle(c: any): Candle { const ts = c.timestamp ?? c.time, ms = String(ts).length > 12; return { timestamp: Number(ts) * (ms ? 1 : 1000), open: Number(c.open ?? c.o), high: Number(c.high ?? c.h), low: Number(c.low ?? c.l), close: Number(c.close ?? c.c), volume: Number(c.volume ?? c.v ?? 0) }; }

    static parseCandleResponse(raw: any): Candle[] {
        if (raw?.result) raw = raw.result;
        if (raw?.timestamps) return raw.timestamps.map((t: number, i: number) => ({ timestamp: t * 1000, open: Number(raw.opens[i]), high: Number(raw.highs[i]), low: Number(raw.lows[i]), close: Number(raw.closes[i]), volume: Number(raw.volumes?.[i] ?? 0) })).sort((a: Candle, b: Candle) => b.timestamp - a.timestamp);
        return (Array.isArray(raw) ? raw : []).map(c => Array.isArray(c) ? this.parseStandardCandle(c) : typeof c === "object" ? this.parseObjectCandle(c) : null).filter((c): c is Candle => !!c).sort((a: Candle, b: Candle) => b.timestamp - a.timestamp);
    }

    /* =========================================================================
     INTERNAL HELPERS
  ========================================================================= */

    static isTradePending(s: IMartingaleState) { return s.lastTradeOutcome === "pending"; }
    static isTradeResolved(s: IMartingaleState) { return s.lastTradeOutcome !== "pending"; }

    static resolveEntryPrice(e?: any): number {
        const price =
            e?.average_fill_price ??
            e?.result?.average_fill_price ??
            e?.limit_price ??
            e?.result?.limit_price;

        if (!price) {
            throw new Error(
                `[utils] Cannot resolve entry price from order details: ${JSON.stringify(e)}`
            );
        }

        return Number(price);
    }

    static async isPriceMovingInOrderSideDirection(
        candle: TargetCandle,
        side: OrderSide,
        currentPrice: number,
        configId: string,
        userId: string,
        symbol: string,
        candleTimeframe: string
    ): Promise<boolean> {
        let isTrendValid = false;

        if (side === "sell") {
            // red candle → price should less than high
            isTrendValid = currentPrice < candle.high;
        } else {
            // green candle → price should more than low
            isTrendValid = currentPrice > candle.low;
        }

        if (!isTrendValid) {
            skipTradingLogger.info(`[PriceTrend] SKIP: Price movement not in candle direction for ${symbol}`, {
                configId,
                userId,
                symbol,
                candleTimeframe,
                targetCandleDirection: candle.color,
                currentPrice,
                candleHigh: candle.high,
                candleLow: candle.low
            });
        }

        return isTrendValid;
    }

    static async isPriceMovementPercentWithinRange(
        candle: TargetCandle,
        side: OrderSide,
        currentPrice: number,
        configId: string,
        userId: string,
        symbol: string,
        candleTimeframe: string
    ): Promise<boolean> {
        const cfg = TradingConfig.getConfig();
        const maxPercent = cfg.MAX_ALLOWED_PRICE_MOVEMENT_PERCENT;
        const minPercent = cfg.MIN_ALLOWED_PRICE_MOVEMENT_PERCENT;

        const basePrice =
            side === "sell"
                ? candle.high   // red candle → from high
                : candle.low;   // green candle → from low

        const percentMove = Math.abs((currentPrice - basePrice) / basePrice) * 100;


        const isWithinRange = percentMove >= minPercent && percentMove <= maxPercent;

        if (!isWithinRange) {
            skipTradingLogger.info(`[PriceRange] SKIP: Price movement percent not within range for ${symbol}`, {
                configId,
                userId,
                symbol,
                candleTimeframe,
                currentPrice,
                percentMove,
                minPercent,
                maxPercent
            });
            return false;
        }

        return true;
    }

    static clampPrice(price: number): number {
        const decimals = TradingConfig.getConfig().PRICE_DECIMAL_PLACES;
        return Number(price.toFixed(decimals));
    }

    static calculateTpPrice(
        entryPrice: number,
        orderSide: OrderSide,
    ): number {
        const tpPercent = TradingConfig.getConfig().TAKE_PROFIT_PERCENT;
        const tpOffset = entryPrice * (tpPercent / 100);

        let tp =
            orderSide === "buy"
                ? entryPrice + tpOffset
                : entryPrice - tpOffset;

        // if tp is less than or equal to 0, set it to 1
        if (tp <= 0) {
            const decimals = TradingConfig.getConfig().PRICE_DECIMAL_PLACES;
            tp = Math.pow(10, -decimals);
        }

        return this.clampPrice(tp);
    }

    static constructBracketOrderPayload(
        tp: number,
        sl: number,
        positionSide: OrderSide,
    ) {
        const c = TradingConfig.getConfig();

        const slTriggerPrice = positionSide === "buy"
            ? sl * (1 - c.SL_TRIGGER_BUFFER_PERCENT / 100) // long → sell SL
            : sl * (1 + c.SL_TRIGGER_BUFFER_PERCENT / 100); // short → buy SL

        const slLimitPrice = positionSide === "buy"
            ? sl * (1 - c.SL_LIMIT_BUFFER_PERCENT / 100) // long → sell SL
            : sl * (1 + c.SL_LIMIT_BUFFER_PERCENT / 100); // short → buy SL

        return {
            product_id: c.PRODUCT_ID,
            product_symbol: c.SYMBOL,
            bracket_stop_trigger_method: "last_traded_price",

            ...(tp && {
                take_profit_order: {
                    order_type: "limit_order",
                    stop_price: String(tp),
                    limit_price: String(tp),
                },
            }),

            ...(sl && {
                stop_loss_order: {
                    order_type: "limit_order",
                    stop_price: String(this.clampPrice(slTriggerPrice)),                 // trigger
                    limit_price: String(this.clampPrice(slLimitPrice)),     // buffered
                },
            }),
        };
    }

    static getBodyPercent(c: Candle): number {
        const range = c.high - c.low;
        return range === 0 ? 0 : (Math.abs(c.close - c.open) / range) * 100;
    }

    static getBodyMovePercent(c: Candle): number {
        return (Math.abs(c.close - c.open) / c.open) * 100;
    }

    static getRangePercent(candles: Candle[]): number {
        const high = Math.max(...candles.map(c => c.high));
        const low = Math.min(...candles.map(c => c.low));
        return low === 0 ? 0 : ((high - low) / low) * 100;
    }

    static getCandleColor(c: Candle): "red" | "green" {
        return c.close >= c.open ? "green" : "red";
    }

    static isVolumeSpike(candles: Candle[], index: number): boolean {
        if (index < 5) return false;
        const avg =
            candles
                .slice(index - 5, index)
                .reduce((a, b) => a + b.volume, 0) / 5;
        return candles[index].volume > avg * 1.8;
    }

    static calculateEMA(candles: Candle[], period: number): number {
        if (candles.length < period) return 0;
        const k = 2 / (period + 1);
        let ema = candles.slice(0, period).reduce((a, b) => a + b.close, 0) / period;
        for (let i = period; i < candles.length; i++) {
            ema = (candles[i].close - ema) * k + ema;
        }
        return ema;
    }
}
