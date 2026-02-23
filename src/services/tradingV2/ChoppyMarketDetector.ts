import { Candle, ConfigType, InternalChopConfig } from "./type";
import { skipTradingLogger } from "./logger";

// 0 – 2   Strong Trend
// 3 – 4   Weak Trend
// 5 – 6   Light Chop
// 7 – 8   Clear Chop
// 9 – 10  Tight Compression / High Breakout Probability

export class ChoppyMarketDetector {

    /* ====================================================== */
    /* PUBLIC ENTRY                                           */
    /* ====================================================== */

    static getMarketRegimeScore(
        candles: Candle[],
        config: ConfigType
    ): number {

        const internal = this.getInternalConfig(config);

        return this.calculateRegimeScore(
            candles,
            internal,
            config.id,
            config.USER_ID,
            config.SYMBOL,
            config.TIMEFRAME
        );
    }

    /* ====================================================== */
    /* INTERNAL CONFIG                                        */
    /* ====================================================== */

    private static getInternalConfig(config: ConfigType): InternalChopConfig {

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
                SMALL_BODY_PERCENT_THRESHOLD: 55,
                SMALL_BODY_MIN_COUNT: 7,
                MIN_REQUIRED_CANDLES: 60,
                CHOP_SCORE_THRESHOLD: 6
            },

            balanced: {
                ATR_PERIOD: 14,
                ADX_PERIOD: 14,
                ADX_WEAK_THRESHOLD: 20,
                REQUIRE_ADX_FALLING: true,
                CHOPPY_ATR_THRESHOLD: 1.0 * tfMultiplier,
                STRUCTURE_LOOKBACK: 10,
                SMALL_BODY_PERCENT_THRESHOLD: 50,
                SMALL_BODY_MIN_COUNT: 6,
                MIN_REQUIRED_CANDLES: 50,
                CHOP_SCORE_THRESHOLD: 5
            },

            aggressive: {
                ATR_PERIOD: 10,
                ADX_PERIOD: 10,
                ADX_WEAK_THRESHOLD: 18,
                REQUIRE_ADX_FALLING: false,
                CHOPPY_ATR_THRESHOLD: 0.8 * tfMultiplier,
                STRUCTURE_LOOKBACK: 8,
                SMALL_BODY_PERCENT_THRESHOLD: 45,
                SMALL_BODY_MIN_COUNT: 5,
                MIN_REQUIRED_CANDLES: 40,
                CHOP_SCORE_THRESHOLD: 4
            }
        };

        return base[config.TRADING_MODE];
    }

    /* ====================================================== */
    /* REGIME SCORE (0–10)                                    */
    /* ====================================================== */

    private static calculateRegimeScore(
        candles: Candle[],
        cfg: InternalChopConfig,
        configId: string,
        userId: string,
        symbol: string,
        timeframe: string
    ): number {

        if (candles.length < cfg.MIN_REQUIRED_CANDLES) return 7;

        let chopScore = 0;
        let maxScore = 0;

        const latestClose = candles[candles.length - 1].close;

        /* ================= ATR ================= */

        const atr = this.calculateATR(candles, cfg.ATR_PERIOD);
        const atrPercent = latestClose === 0 ? 0 : (atr / latestClose) * 100;

        const atrAvg = this.getRollingATRPercentAvg(candles, cfg.ATR_PERIOD);

        maxScore++;
        if (atrPercent < cfg.CHOPPY_ATR_THRESHOLD || atrPercent < atrAvg * 0.75) {
            chopScore++;
        }

        /* ================= ADX ================= */

        const adxSeries = this.calculateADXSeries(candles, cfg.ADX_PERIOD);

        if (adxSeries.length >= 2) {
            const current = adxSeries[adxSeries.length - 1];
            const prev = adxSeries[adxSeries.length - 2];

            maxScore++;
            if (current < cfg.ADX_WEAK_THRESHOLD) chopScore++;

            if (cfg.REQUIRE_ADX_FALLING) {
                maxScore++;
                if (current < prev) chopScore++;
            }
        }

        /* ================= STRUCTURE ================= */

        const recent = candles.slice(-cfg.STRUCTURE_LOOKBACK);
        const rangePercent = this.getRangePercent(recent);

        maxScore++;
        if (rangePercent < atrPercent * 2) chopScore++;

        const smallBodyCount =
            recent.filter(c =>
                this.getBodyPercent(c) < cfg.SMALL_BODY_PERCENT_THRESHOLD
            ).length;

        maxScore++;
        if (smallBodyCount >= cfg.SMALL_BODY_MIN_COUNT) chopScore++;

        /* ================= MICRO CHOP ================= */

        maxScore += 2;
        if (this.detectMicroChop(candles, atrPercent, cfg.SMALL_BODY_PERCENT_THRESHOLD)) {
            chopScore += 2;
        }

        /* ================= VOLUME ================= */

        maxScore++;
        if (this.isVolumeContracting(candles)) chopScore++;

        /* ================= BREAKOUT REDUCTION ================= */

        let breakoutReduction = 0;
        const last = candles[candles.length - 1];
        const prevHigh = Math.max(...recent.slice(0, -1).map(c => c.high));
        const prevLow = Math.min(...recent.slice(0, -1).map(c => c.low));

        if (last.close > prevHigh) breakoutReduction += 2;
        if (last.close < prevLow) breakoutReduction += 2;

        if (this.getBodyPercent(last) > 65) breakoutReduction++;

        if (candles.length >= 20) {
            const avgVol =
                candles.slice(-20, -1).reduce((a, b) => a + b.volume, 0) / 19;

            if (last.volume > avgVol * 1.4) breakoutReduction++;
        }

        breakoutReduction = Math.min(breakoutReduction, 4);

        /* ================= FINAL SCORE ================= */

        let rawScore = Math.max(0, chopScore - breakoutReduction);

        const normalized =
            maxScore === 0
                ? 0
                : Math.min(10, Math.round((rawScore / maxScore) * 10));

        skipTradingLogger.info(`[MarketRegime] ${symbol}`, {
            configId,
            userId,
            symbol,
            timeframe,
            regimeScore: normalized
        });

        return normalized;
    }

    /* ====================================================== */
    /* MICRO CHOP (3–5 candles)                               */
    /* ====================================================== */

    private static detectMicroChop(
        candles: Candle[],
        atrPercent: number,
        bodyThreshold: number
    ): boolean {

        if (candles.length < 5) return false;

        const windows = [3, 4, 5];

        for (const size of windows) {

            const slice = candles.slice(-size);
            const high = Math.max(...slice.map(c => c.high));
            const low = Math.min(...slice.map(c => c.low));
            const close = slice[slice.length - 1].close;

            const rangePercent = close === 0 ? 0 : ((high - low) / close) * 100;

            const smallBodies =
                slice.filter(c =>
                    this.getBodyPercent(c) < bodyThreshold
                ).length;

            const dynamicThreshold = atrPercent * 0.6;

            const noBreak =
                slice[slice.length - 1].high <= Math.max(...slice.slice(0, -1).map(c => c.high)) &&
                slice[slice.length - 1].low >= Math.min(...slice.slice(0, -1).map(c => c.low));

            if (
                rangePercent < dynamicThreshold &&
                smallBodies >= size - 1 &&
                noBreak
            ) {
                return true;
            }
        }

        return false;
    }

    /* ====================================================== */
    /* VOLUME CHECK                                           */
    /* ====================================================== */

    private static isVolumeContracting(candles: Candle[]): boolean {

        if (candles.length < 25) return false;

        const last20 = candles.slice(-20);
        const last5 = candles.slice(-5);

        const avg20 = last20.reduce((a, b) => a + b.volume, 0) / 20;
        const avg5 = last5.reduce((a, b) => a + b.volume, 0) / 5;

        return avg5 < avg20 * 0.7;
    }

    /* ====================================================== */
    /* INDICATORS                                             */
    /* ====================================================== */

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
            trs.slice(0, period).reduce((a, b) => a + b, 0) / period;

        for (let i = period; i < trs.length; i++)
            atr = ((atr * (period - 1)) + trs[i]) / period;

        return atr;
    }

    private static getRollingATRPercentAvg(
        candles: Candle[],
        period: number
    ): number {

        if (candles.length < period * 2) return 0;

        const atrValues: number[] = [];

        for (let i = period; i < candles.length; i++) {
            const slice = candles.slice(0, i + 1);
            const atr = this.calculateATR(slice, period);
            const close = slice[slice.length - 1].close;
            atrValues.push(close === 0 ? 0 : (atr / close) * 100);
        }

        const last = atrValues.slice(-period);
        return last.reduce((a, b) => a + b, 0) / last.length;
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

        let smoothedTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
        let smoothedPlus = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
        let smoothedMinus = minusDM.slice(0, period).reduce((a, b) => a + b, 0);

        const dxValues: number[] = [];

        for (let i = period; i < trs.length; i++) {

            smoothedTR = smoothedTR - (smoothedTR / period) + trs[i];
            smoothedPlus = smoothedPlus - (smoothedPlus / period) + plusDM[i];
            smoothedMinus = smoothedMinus - (smoothedMinus / period) + minusDM[i];

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
            dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;

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