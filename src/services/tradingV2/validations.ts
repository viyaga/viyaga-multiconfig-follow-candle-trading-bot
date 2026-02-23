import { Candle, ConfigType, InternalChopConfig } from "./type";
import { skipTradingLogger } from "./logger";

export class Validations {

    /* ======================================================
       PUBLIC ENTRY
    ====================================================== */

    static getMarketState(
        candles: Candle[],
        currentPrice: number,
        config: ConfigType
    ): "CHOPPY" | "TRENDING" {

        const internal = this.getInternalConfig(config);

        return this.isMarketChoppy(
            candles,
            currentPrice,
            internal,
            config.id,
            config.USER_ID,
            config.SYMBOL,
            config.TIMEFRAME
        )
            ? "CHOPPY"
            : "TRENDING";
    }

    /* ======================================================
       INTERNAL MODE MAPPING
    ====================================================== */

    private static getInternalConfig(
        config: ConfigType
    ): InternalChopConfig {

        const tfMultiplier =
            config.TIMEFRAME.includes("4h") ? 1.4 :
                config.TIMEFRAME.includes("1h") ? 1 :
                    config.TIMEFRAME.includes("15m") ? 0.8 :
                        1;

        const base: Record<string, InternalChopConfig> = {

            conservative: {
                ATR_PERIOD: 14,
                ADX_PERIOD: 14,
                ADX_WEAK_THRESHOLD: 22,
                REQUIRE_ADX_FALLING: true,
                CHOPPY_ATR_THRESHOLD: 1.2 * tfMultiplier,
                STRUCTURE_LOOKBACK: 12,
                CHOPPY_RANGE_THRESHOLD: 2.0 * tfMultiplier,
                SMALL_BODY_PERCENT_THRESHOLD: 55,
                SMALL_BODY_MIN_COUNT: 7,
                MIN_REQUIRED_CANDLES: 60,
                CHOP_SCORE_THRESHOLD: 4
            },

            balanced: {
                ATR_PERIOD: 14,
                ADX_PERIOD: 14,
                ADX_WEAK_THRESHOLD: 20,
                REQUIRE_ADX_FALLING: true,
                CHOPPY_ATR_THRESHOLD: 1.0 * tfMultiplier,
                STRUCTURE_LOOKBACK: 10,
                CHOPPY_RANGE_THRESHOLD: 1.8 * tfMultiplier,
                SMALL_BODY_PERCENT_THRESHOLD: 50,
                SMALL_BODY_MIN_COUNT: 6,
                MIN_REQUIRED_CANDLES: 50,
                CHOP_SCORE_THRESHOLD: 3
            },

            aggressive: {
                ATR_PERIOD: 10,
                ADX_PERIOD: 10,
                ADX_WEAK_THRESHOLD: 18,
                REQUIRE_ADX_FALLING: false,
                CHOPPY_ATR_THRESHOLD: 0.8 * tfMultiplier,
                STRUCTURE_LOOKBACK: 8,
                CHOPPY_RANGE_THRESHOLD: 1.5 * tfMultiplier,
                SMALL_BODY_PERCENT_THRESHOLD: 45,
                SMALL_BODY_MIN_COUNT: 5,
                MIN_REQUIRED_CANDLES: 40,
                CHOP_SCORE_THRESHOLD: 2
            }
        };

        return base[config.TRADING_MODE];
    }

    /* ======================================================
       CHOP LOGIC (MACRO + MICRO)
    ====================================================== */

    private static isMarketChoppy(
        candles: Candle[],
        currentPrice: number,
        cfg: InternalChopConfig,
        configId: string,
        userId: string,
        symbol: string,
        candleTimeframe: string
    ): boolean {

        if (candles.length < cfg.MIN_REQUIRED_CANDLES) {
            return true;
        }

        let score = 0;
        const reasons: string[] = [];

        /* ======================
           ATR (Volatility)
        ====================== */
        const atr = this.calculateATR(candles, cfg.ATR_PERIOD);
        const atrPercent = (atr / currentPrice) * 100;

        if (atrPercent < cfg.CHOPPY_ATR_THRESHOLD) {
            score++;
            reasons.push("Low ATR");
        }

        /* ======================
           ADX
        ====================== */
        const adxSeries = this.calculateADXSeries(candles, cfg.ADX_PERIOD);

        if (adxSeries.length >= 2) {
            const currentAdx = adxSeries[adxSeries.length - 1];
            const prevAdx = adxSeries[adxSeries.length - 2];

            if (currentAdx < cfg.ADX_WEAK_THRESHOLD) {
                score++;
                reasons.push("Weak ADX");
            }

            if (cfg.REQUIRE_ADX_FALLING && currentAdx < prevAdx) {
                score++;
                reasons.push("ADX Falling");
            }
        }

        /* ======================
           STRUCTURE (MACRO)
        ====================== */
        const recent = candles.slice(-cfg.STRUCTURE_LOOKBACK);

        if (this.getRangePercent(recent) < cfg.CHOPPY_RANGE_THRESHOLD) {
            score++;
            reasons.push("Structure Range Tight");
        }

        const smallBodyCount =
            recent.filter(c =>
                this.getBodyPercent(c)
                < cfg.SMALL_BODY_PERCENT_THRESHOLD
            ).length;

        if (smallBodyCount >= cfg.SMALL_BODY_MIN_COUNT) {
            score++;
            reasons.push("Structure Small Bodies");
        }

        /* ======================
           MICRO CHOP (3–5 candles)
        ====================== */
        const microChop = this.detectMicroChop(
            candles,
            currentPrice,
            cfg.SMALL_BODY_PERCENT_THRESHOLD
        );

        if (microChop) {
            score++;
            reasons.push("Micro Chop 3-5 Candles");
        }

        /* ======================
           FINAL
        ====================== */
        const isChoppy = score >= cfg.CHOP_SCORE_THRESHOLD;

        if (isChoppy) {
            skipTradingLogger.info(`[ChoppyMarket] SKIP: Market is choppy for ${symbol}`, {
                configId,
                userId,
                symbol,
                candleTimeframe,
                score,
                threshold: cfg.CHOP_SCORE_THRESHOLD,
                reasons
            });
        }

        return isChoppy;
    }

    /* ======================================================
       MICRO CHOP DETECTOR (CORE ADDITION)
    ====================================================== */

    private static detectMicroChop(
        candles: Candle[],
        currentPrice: number,
        bodyThreshold: number
    ): boolean {

        if (candles.length < 5) return false;

        const windows = [3, 4, 5];

        for (const size of windows) {

            const slice = candles.slice(-size);

            const high = Math.max(...slice.map(c => c.high));
            const low = Math.min(...slice.map(c => c.low));

            const rangePercent = ((high - low) / currentPrice) * 100;

            const smallBodies =
                slice.filter(c =>
                    this.getBodyPercent(c) < bodyThreshold
                ).length;

            const noBreakStructure =
                slice[slice.length - 1].high <= Math.max(...slice.slice(0, -1).map(c => c.high)) &&
                slice[slice.length - 1].low >= Math.min(...slice.slice(0, -1).map(c => c.low));

            if (
                rangePercent < 0.6 &&      // tight compression
                smallBodies >= size - 1 && // mostly small candles
                noBreakStructure           // no breakout
            ) {
                return true;
            }
        }

        return false;
    }

    /* ======================================================
       INDICATORS
    ====================================================== */

    private static calculateATR(candles: Candle[], period: number): number {
        if (candles.length < period + 1) return 0;

        const trs: number[] = [];

        for (let i = 1; i < candles.length; i++) {
            const high = candles[i].high;
            const low = candles[i].low;
            const prevClose = candles[i - 1].close;

            trs.push(Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            ));
        }

        let atr =
            trs.slice(0, period)
                .reduce((a, b) => a + b, 0) / period;

        for (let i = period; i < trs.length; i++)
            atr = ((atr * (period - 1)) + trs[i]) / period;

        return atr;
    }

    private static calculateADXSeries(
        candles: Candle[],
        period: number
    ): number[] {

        if (candles.length < period * 2) return [];

        const plusDM: number[] = [];
        const minusDM: number[] = [];
        const trs: number[] = [];

        for (let i = 1; i < candles.length; i++) {

            const upMove = candles[i].high - candles[i - 1].high;
            const downMove = candles[i - 1].low - candles[i].low;

            plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
            minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

            trs.push(Math.max(
                candles[i].high - candles[i].low,
                Math.abs(candles[i].high - candles[i - 1].close),
                Math.abs(candles[i].low - candles[i - 1].close)
            ));
        }

        let smoothedTR =
            trs.slice(0, period).reduce((a, b) => a + b, 0);

        let smoothedPlus =
            plusDM.slice(0, period).reduce((a, b) => a + b, 0);

        let smoothedMinus =
            minusDM.slice(0, period).reduce((a, b) => a + b, 0);

        const dxValues: number[] = [];

        for (let i = period; i < trs.length; i++) {

            smoothedTR =
                smoothedTR - (smoothedTR / period) + trs[i];

            smoothedPlus =
                smoothedPlus - (smoothedPlus / period) + plusDM[i];

            smoothedMinus =
                smoothedMinus - (smoothedMinus / period) + minusDM[i];

            if (smoothedTR === 0) {
                dxValues.push(0);
                continue;
            }

            const plusDI = (smoothedPlus / smoothedTR) * 100;
            const minusDI = (smoothedMinus / smoothedTR) * 100;
            const sum = plusDI + minusDI;

            dxValues.push(
                sum === 0
                    ? 0
                    : (Math.abs(plusDI - minusDI) / sum) * 100
            );
        }

        let adx =
            dxValues.slice(0, period)
                .reduce((a, b) => a + b, 0) / period;

        const series: number[] = [adx];

        for (let i = period; i < dxValues.length; i++) {
            adx = ((adx * (period - 1)) + dxValues[i]) / period;
            series.push(adx);
        }

        return series;
    }

    private static getBodyPercent(c: Candle): number {
        const range = c.high - c.low;
        return range === 0
            ? 0
            : (Math.abs(c.close - c.open) / range) * 100;
    }

    private static getRangePercent(candles: Candle[]): number {
        const high = Math.max(...candles.map(c => c.high));
        const low = Math.min(...candles.map(c => c.low));
        return low === 0
            ? 0
            : ((high - low) / low) * 100;
    }
}