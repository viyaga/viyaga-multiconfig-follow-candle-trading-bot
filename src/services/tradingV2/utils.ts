import { IMartingaleState } from "../../models/martingaleState.model";
import { TradingConfig } from "./config";
import { Candle, OrderDetails, OrderSide, TargetCandle } from "./type";

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

    static isCandleBodyAboveMinimum(
        candle: TargetCandle,
    ): boolean {
        const cfg = TradingConfig.getConfig();
        const minBodyPercent = cfg.MIN_CANDLE_BODY_PERCENT;

        const bodyPercent =
            (Math.abs(candle.close - candle.open) / candle.open) * 100;

        console.log({ bodyPercent, minBodyPercent });

        return bodyPercent >= minBodyPercent;
    }

    static isPriceMovingInCandleDirection(
        candle: TargetCandle,
        currentPrice: number
    ): boolean {
        if (candle.color === "red") {
            // red candle → price should less than high
            return currentPrice < candle.high;
        }

        // green candle → price should more than low
        return currentPrice > candle.low;
    }

    static isPriceMovementPercentWithinRange(
        candle: TargetCandle,
        currentPrice: number,
    ): boolean {
        const cfg = TradingConfig.getConfig();
        const maxPercent = cfg.MAX_ALLOWED_PRICE_MOVEMENT_PERCENT;
        const minPercent = cfg.MIN_ALLOWED_PRICE_MOVEMENT_PERCENT;

        const basePrice =
            candle.color === "red"
                ? candle.high   // red candle → from high
                : candle.low;   // green candle → from low

        const percentMove =
            Math.abs((currentPrice - basePrice) / basePrice) * 100;

        console.log({ percentMove, minPercent, maxPercent })

        if (percentMove < minPercent) {
            return false;
        }

        if (percentMove > maxPercent) {
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


    private static calculateATR(candles: Candle[], period: number = 14): number {
        let trs: number[] = [];

        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i - 1].close;

            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );

            trs.push(tr);
        }

        return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
    }

    private static calculateEMA(values: number[], period: number): number {
        const k = 2 / (period + 1);
        let ema = values[0];

        for (let i = 1; i < values.length; i++) {
            ema = values[i] * k + ema * (1 - k);
        }

        return ema;
    }

    static isShortTermChoppy(candles: Candle[]): boolean {
        if (candles.length < 6) return true;

        const recent = candles.slice(-5);
        const highs = recent.map(c => c.high);
        const lows = recent.map(c => c.low);

        const totalRange = Math.max(...highs) - Math.min(...lows);

        // === ATR calculation ===
        let trSum = 0;
        for (let i = 1; i < recent.length; i++) {
            const high = recent[i].high;
            const low = recent[i].low;
            const prevClose = recent[i - 1].close;

            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );

            trSum += tr;
        }

        const avgTR = trSum / 4;

        const isLowExpansion = totalRange < avgTR * 2;

        // === Direction flip detection ===
        let flips = 0;
        for (let i = 1; i < recent.length; i++) {
            const prevBull = recent[i - 1].close > recent[i - 1].open;
            const currBull = recent[i].close > recent[i].open;
            if (prevBull !== currBull) flips++;
        }

        const isFrequentFlip = flips >= 3;

        // === Structure detection ===
        const isHigherHighs =
            recent[4].high > recent[3].high &&
            recent[3].high > recent[2].high;

        const isLowerLows =
            recent[4].low < recent[3].low &&
            recent[3].low < recent[2].low;

        const hasTrendStructure = isHigherHighs || isLowerLows;

        return isLowExpansion && isFrequentFlip && !hasTrendStructure;
    }


    static isMarketTradable(history: Candle[]): boolean {
        if (history.length < 80) return false;
        const candles = [...history].sort((a, b) => a.timestamp - b.timestamp);

        if (this.isShortTermChoppy(candles)) {
            return false;
        }

        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);

        const atr = this.calculateATR(candles, 14);

        const emaFast = this.calculateEMA(closes.slice(-20), 20);
        const emaSlow = this.calculateEMA(closes.slice(-50), 50);

        const recentHigh = Math.max(...highs.slice(-20));
        const recentLow = Math.min(...lows.slice(-20));
        const range = recentHigh - recentLow;

        const emaSlope = Math.abs(emaFast - emaSlow);

        // 🔹 Normalize metrics
        const volatilityRatio = range / atr;
        const trendStrength = emaSlope / atr;

        const isCompressed = volatilityRatio < 2;
        const isWeakTrend = trendStrength < 1;

        // Detect breakout expansion
        const lastClose = closes[closes.length - 1];
        const prevClose = closes[closes.length - 2];

        const breakoutMove = Math.abs(lastClose - prevClose) > atr * 0.8;

        if (isCompressed && isWeakTrend && !breakoutMove) {
            return false; // Sideways
        }

        return true; // Tradable
    }

}