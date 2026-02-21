import { Candle, ConfigType } from "./type";

export class Validations {
    /* MARKET STATE */
    static getMarketState(candles: Candle[], currentPrice: number, config: ConfigType): "CHOPPY" | "TRENDING" {
        return this.isMarketChoppy(candles, currentPrice, config) ? "CHOPPY" : "TRENDING";
    }

    static isMarketChoppy(candles: Candle[], currentPrice: number, config: ConfigType): boolean {
        if (candles.length < 50) {
            return true;
        }

        // Calculate ATR and ADX
        const atr = this.calculateATR(candles, 14);
        const atrPercent = (atr / currentPrice) * 100;
        const adxSeries = this.calculateADXSeries(candles, 14);
        if (adxSeries.length < 2) {
            return true;
        }
        const currentAdx = adxSeries[adxSeries.length - 1];
        const prevAdx = adxSeries[adxSeries.length - 2];

        // 1️⃣ Weak trend: ADX < 20 and falling
        const adxFalling = currentAdx < prevAdx;
        const weakTrend = currentAdx < 20 && adxFalling;

        // 2️⃣ Low volatility: ATR% below threshold (~1.0)
        const lowVolatility = atrPercent < config.CHOPPY_ATR_THRESHOLD;

        // Require both ADX and ATR conditions to consider chop
        if (!(weakTrend && lowVolatility)) {
            // If either trend is strong or volatility spiked, consider trending
            return false;
        }

        // Check additional chop conditions
        const recent = candles.slice(-10);
        // 3️⃣ Range compression (last 10 bars)
        const rangePercent = this.getRangePercent(recent);
        const compressedRange = rangePercent < config.CHOPPY_RANGE_THRESHOLD;
        // 4️⃣ Many small bodies
        const smallBodies = recent.filter(c => this.getBodyPercent(c) < 50).length >= 6;
        // 5️⃣ No expansion (no new HH or LL in recent bars)
        const highs = recent.map(c => c.high);
        const lows = recent.map(c => c.low);
        const higherHigh = highs[highs.length - 1] > Math.max(...highs.slice(0, -1));
        const lowerLow = lows[lows.length - 1] < Math.min(...lows.slice(0, -1));
        const noExpansion = !higherHigh && !lowerLow;

        // If ANY one of the secondary conditions holds, we declare chop
        if (compressedRange || smallBodies || noExpansion) {
            return true;
        }
        return false;
    }

    /* INDICATORS */
    private static calculateATR(candles: Candle[], period: number): number {
        if (candles.length < period + 1) return 0;
        const trs: number[] = [];
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
        // Wilder's smoothing
        let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
        for (let i = period; i < trs.length; i++) {
            atr = ((atr * (period - 1)) + trs[i]) / period;
        }
        return atr;
    }

    private static calculateADXSeries(candles: Candle[], period: number): number[] {
        if (candles.length < period * 2) return [];
        const plusDM: number[] = [], minusDM: number[] = [], trs: number[] = [];
        for (let i = 1; i < candles.length; i++) {
            const upMove = candles[i].high - candles[i - 1].high;
            const downMove = candles[i - 1].low - candles[i].low;
            plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
            minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
            const tr = Math.max(
                candles[i].high - candles[i].low,
                Math.abs(candles[i].high - candles[i - 1].close),
                Math.abs(candles[i].low - candles[i - 1].close)
            );
            trs.push(tr);
        }
        let smoothedTR = trs.slice(0, period).reduce((a, b) => a + b, 0);
        let smoothedPlus = plusDM.slice(0, period).reduce((a, b) => a + b, 0);
        let smoothedMinus = minusDM.slice(0, period).reduce((a, b) => a + b, 0);
        const dxValues: number[] = [];
        for (let i = period; i < trs.length; i++) {
            smoothedTR = smoothedTR - (smoothedTR / period) + trs[i];
            smoothedPlus = smoothedPlus - (smoothedPlus / period) + plusDM[i];
            smoothedMinus = smoothedMinus - (smoothedMinus / period) + minusDM[i];
            if (smoothedTR === 0) { dxValues.push(0); continue; }
            const plusDI = (smoothedPlus / smoothedTR) * 100;
            const minusDI = (smoothedMinus / smoothedTR) * 100;
            const sum = plusDI + minusDI;
            const dx = sum === 0 ? 0 : (Math.abs(plusDI - minusDI) / sum) * 100;
            dxValues.push(dx);
        }
        // Smooth DX into ADX series
        let adx = dxValues.slice(0, period).reduce((a, b) => a + b, 0) / period;
        const adxSeries: number[] = [adx];
        for (let i = period; i < dxValues.length; i++) {
            adx = ((adx * (period - 1)) + dxValues[i]) / period;
            adxSeries.push(adx);
        }
        return adxSeries;
    }

    /* HELPERS */
    private static getBodyPercent(c: Candle): number {
        const range = c.high - c.low;
        return range === 0 ? 0 : (Math.abs(c.close - c.open) / range) * 100;
    }

    private static getRangePercent(candles: Candle[]): number {
        const high = Math.max(...candles.map(c => c.high));
        const low = Math.min(...candles.map(c => c.low));
        return low === 0 ? 0 : ((high - low) / low) * 100;
    }
}
