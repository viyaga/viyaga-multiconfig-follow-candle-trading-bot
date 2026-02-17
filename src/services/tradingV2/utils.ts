import { IMartingaleState } from "../../models/martingaleState.model";
import { TradingConfig } from "./config";
import { Candle, OrderDetails, OrderSide, TargetCandle } from "./type";
import { ChoppyMarketLog } from "../../models/choppyMarketLog.model";
import { VolatilityLog } from "../../models/volatilityLog.model";
import { PriceTrendLog } from "../../models/priceTrendLog.model";
import { PriceRangeLog } from "../../models/priceRangeLog.model";

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

    static async hasVolatilityAndMomentum(
        candle: TargetCandle,
        configId: string,
        userId: string,
        symbol: string
    ): Promise<boolean> {
        const cfg = TradingConfig.getConfig();

        const MIN_RANGE_PERCENT = cfg.MIN_RANGE_PERCENT ?? 1.2;
        const MIN_BODY_PERCENT = cfg.MIN_BODY_PERCENT ?? 0.6;

        // Full volatility (high-low)
        const rangePercent =
            ((candle.high - candle.low) / candle.open) * 100;

        // Real momentum (open-close body)
        const bodyPercent =
            (Math.abs(candle.close - candle.open) / candle.open) * 100;

        console.log({
            rangePercent,
            bodyPercent,
            MIN_RANGE_PERCENT,
            MIN_BODY_PERCENT
        });

        const hasVolatility = rangePercent >= MIN_RANGE_PERCENT;
        const hasMomentum = bodyPercent >= MIN_BODY_PERCENT;
        const isTrue = hasVolatility && hasMomentum;

        if (!hasVolatility || !hasMomentum) {
            try {
                await VolatilityLog.create({
                    configId,
                    userId,
                    symbol,
                    targetCandleData: candle,
                    rangePercent,
                    bodyPercent,
                    minRangePercent: MIN_RANGE_PERCENT,
                    minBodyPercent: MIN_BODY_PERCENT,
                    hasVolatility,
                    hasMomentum,
                    isTrue,
                    timestamp: new Date()
                });
            } catch (error) {
                console.error("Error creating VolatilityLog:", error);
            }
        }

        return isTrue;
    }

    static async isPriceMovingInCandleDirection(
        candle: TargetCandle,
        currentPrice: number,
        configId: string,
        userId: string,
        symbol: string
    ): Promise<boolean> {
        let isTrendValid = false;

        if (candle.color === "red") {
            // red candle → price should less than high
            isTrendValid = currentPrice < candle.high;
        } else {
            // green candle → price should more than low
            isTrendValid = currentPrice > candle.low;
        }

        if (!isTrendValid) {
            try {
                await PriceTrendLog.create({
                    configId,
                    userId,
                    symbol,
                    targetCandleDirection: candle.color,
                    currentPrice,
                    candleHigh: candle.high,
                    candleLow: candle.low,
                    isTrendValid,
                    timestamp: new Date()
                });
            } catch (error) {
                console.error("Error creating PriceTrendLog:", error);
            }
        }

        return isTrendValid;
    }

    static async isPriceMovementPercentWithinRange(
        candle: TargetCandle,
        currentPrice: number,
        configId: string,
        userId: string,
        symbol: string
    ): Promise<boolean> {
        const cfg = TradingConfig.getConfig();
        const maxPercent = cfg.MAX_ALLOWED_PRICE_MOVEMENT_PERCENT;
        const minPercent = cfg.MIN_ALLOWED_PRICE_MOVEMENT_PERCENT;

        const basePrice =
            candle.color === "red"
                ? candle.high   // red candle → from high
                : candle.low;   // green candle → from low

        const percentMove =
            Math.abs((currentPrice - basePrice) / basePrice) * 100;

        console.log({ percentMove, minPercent, maxPercent });

        const isWithinRange = percentMove >= minPercent && percentMove <= maxPercent;

        if (!isWithinRange) {
            try {
                await PriceRangeLog.create({
                    configId,
                    userId,
                    symbol,
                    targetCandleData: candle,
                    currentPrice,
                    percentMove,
                    minPercent,
                    maxPercent,
                    isWithinRange,
                    timestamp: new Date()
                });
            } catch (error) {
                console.error("Error creating PriceRangeLog:", error);
            }
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

    static async isChoppyMarket(candles: Candle[], lookback = 3, symbol: string, timeFrame: string): Promise<boolean> {
        if (candles.length < lookback) return false;

        const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
        const recent = sorted.slice(-lookback);

        let totalMovement = 0;

        for (let i = 1; i < recent.length; i++) {
            totalMovement += Math.abs(recent[i].close - recent[i - 1].close);
        }

        if (totalMovement === 0) return true;

        const netMovement = Math.abs(
            recent[recent.length - 1].close - recent[0].close
        );

        const efficiencyRatio = netMovement / totalMovement;
        console.log({ efficiencyRatio });

        const isChoppy = efficiencyRatio < 0.3;

        if (isChoppy) {
            try {
                // Log choppy market condition asynchronously
                await ChoppyMarketLog.create({
                    symbol,
                    lookback,
                    efficiencyRatio,
                    totalMovement,
                    netMovement,
                    candles: recent
                });
                console.log(`[ChoppyMarket] Logged choppy condition for ${symbol}`);
            } catch (err) {
                console.error(`[ChoppyMarket] Failed to log choppy condition for ${symbol}:`, err);
            }
        }

        return isChoppy;
    }
}