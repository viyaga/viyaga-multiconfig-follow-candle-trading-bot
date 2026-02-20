import { ConfigType } from "./type";

export type Candle = {
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
};

export class Validations {

    /* ======================================
       PUBLIC ENTRY FUNCTIONS
    ====================================== */

    static getSignal(candles: Candle[], currentPrice: number, config: ConfigType) {
        const buySignal = this.shouldTakeHighProbBuy(candles, currentPrice, config);
        const sellSignal = this.shouldTakeHighProbSell(candles, currentPrice, config);
        return { buySignal, sellSignal };
    }

    static shouldTakeHighProbBuy(
        candles: Candle[],
        currentPrice: number,
        config: ConfigType
    ): boolean {

        const d = this.deriveSettings(config);
        if (candles.length < d.minCandles) return false;

        const atr = this.calculateATR(candles, d.atrPeriod);
        const atrPercent = (atr / currentPrice) * 100;

        const adxSeries = this.calculateADXSeries(candles, d.adxPeriod);
        if (adxSeries.length < 3) return false;

        const currentAdx = adxSeries[adxSeries.length - 1];
        const prevAdx = adxSeries[adxSeries.length - 2];
        console.log(
            `[shouldTakeHighProbBuy] currentAdx=${currentAdx} | prevAdx=${prevAdx} | minAdx=${d.minAdx} | atrPercent=${atrPercent} | minAtrPercent=${d.minAtrPercent} | isCompression=${this.isCompression(candles, d)} | isBullishBreakout=${this.isBullishBreakout(candles, d)} | isBullishStructureBreak=${this.isBullishStructureBreak(candles, d)}`
        );
        return (
            this.isCompression(candles, d) &&
            currentAdx > d.minAdx &&
            currentAdx > prevAdx &&
            this.isBullishBreakout(candles, d) &&
            this.isBullishStructureBreak(candles, d) &&
            atrPercent >= d.minAtrPercent
        );
    }

    static shouldTakeHighProbSell(
        candles: Candle[],
        currentPrice: number,
        config: ConfigType
    ): boolean {

        const d = this.deriveSettings(config);
        if (candles.length < d.minCandles) return false;

        const atr = this.calculateATR(candles, d.atrPeriod);
        const atrPercent = (atr / currentPrice) * 100;

        const adxSeries = this.calculateADXSeries(candles, d.adxPeriod);
        if (adxSeries.length < 3) return false;

        const currentAdx = adxSeries[adxSeries.length - 1];
        const prevAdx = adxSeries[adxSeries.length - 2];
        console.log(
            `[shouldTakeHighProbSell] currentAdx=${currentAdx} | prevAdx=${prevAdx} | minAdx=${d.minAdx} | atrPercent=${atrPercent} | minAtrPercent=${d.minAtrPercent} | isCompression=${this.isCompression(candles, d)} | isBearishBreakout=${this.isBearishBreakout(candles, d)} | isBearishStructureBreak=${this.isBearishStructureBreak(candles, d)}`
        );
        return (
            this.isCompression(candles, d) &&
            currentAdx > d.minAdx &&
            currentAdx > prevAdx &&
            this.isBearishBreakout(candles, d) &&
            this.isBearishStructureBreak(candles, d) &&
            atrPercent >= d.minAtrPercent
        );
    }

    /* ======================================
       DYNAMIC SETTINGS
    ====================================== */

    private static deriveSettings(config: ConfigType) {

        const target = config.TARGET_PERCENT;
        const risk = config.RISK_MODE ?? "balanced";

        const atrMultiplier =
            risk === "aggressive" ? 0.4 :
                risk === "conservative" ? 0.55 :
                    0.48;

        const minAtrPercent = target * atrMultiplier;

        const minAdx =
            risk === "aggressive" ? 16 :
                risk === "conservative" ? 22 :
                    18 + target * 1;

        const minRangePercent =
            risk === "aggressive"
                ? 3 - target * 0.2
                : 2.8 - target * 0.25;

        const minBodyPercent =
            risk === "aggressive"
                ? 50 + target * 2
                : 55 + target * 3;

        return {
            atrPeriod: 14,
            adxPeriod: 14,
            volumeMaPeriod: 20,
            compressionLookback: 6 + Math.floor(target / 2),
            structureLookback: 8 + Math.floor(target / 2),
            minRangePercent,
            minAtrPercent,
            minAdx,
            minBodyPercent,
            minCandles: 50
        };
    }

    /* ======================================
       CORE CONDITIONS
    ====================================== */

    private static isCompression(candles: Candle[], d: any): boolean {

        const recent = candles.slice(-d.compressionLookback);
        const rangePercent = this.getRangePercent(recent);

        const atrNow = this.calculateATR(candles, d.atrPeriod);
        const atrPrev = this.calculateATR(
            candles.slice(0, -3),
            d.atrPeriod
        );

        return rangePercent < d.minRangePercent && atrNow < atrPrev;
    }

    private static isBullishBreakout(candles: Candle[], d: any): boolean {

        const last = candles[candles.length - 1];
        const bodyPercent = this.getBodyPercent(last);
        const avgVolume = this.getVolumeMA(candles, d.volumeMaPeriod);

        return (
            last.close > last.open &&
            bodyPercent >= d.minBodyPercent &&
            last.volume > avgVolume
        );
    }

    private static isBearishBreakout(candles: Candle[], d: any): boolean {

        const last = candles[candles.length - 1];
        const bodyPercent = this.getBodyPercent(last);
        const avgVolume = this.getVolumeMA(candles, d.volumeMaPeriod);

        return (
            last.close < last.open &&
            bodyPercent >= d.minBodyPercent &&
            last.volume > avgVolume
        );
    }

    private static isBullishStructureBreak(candles: Candle[], d: any): boolean {

        const lookback = candles.slice(
            -(d.structureLookback + 1),
            -1
        );

        const highestHigh = Math.max(...lookback.map(c => c.high));
        const last = candles[candles.length - 1];

        return last.close > highestHigh;
    }

    private static isBearishStructureBreak(candles: Candle[], d: any): boolean {

        const lookback = candles.slice(
            -(d.structureLookback + 1),
            -1
        );

        const lowestLow = Math.min(...lookback.map(c => c.low));
        const last = candles[candles.length - 1];

        return last.close < lowestLow;
    }

    /* ======================================
       INDICATORS
    ====================================== */

    private static calculateATR(candles: Candle[], period: number): number {

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

        const recent = trs.slice(-period);
        return recent.reduce((a, b) => a + b, 0) / period;
    }

    private static calculateADXSeries(
        candles: Candle[],
        period: number
    ): number[] {

        const plusDM: number[] = [];
        const minusDM: number[] = [];
        const trs: number[] = [];

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

        const adx: number[] = [];

        for (let i = period; i < trs.length; i++) {

            const trSum = trs.slice(i - period, i).reduce((a, b) => a + b, 0);
            const plusSum = plusDM.slice(i - period, i).reduce((a, b) => a + b, 0);
            const minusSum = minusDM.slice(i - period, i).reduce((a, b) => a + b, 0);

            const plusDI = (plusSum / trSum) * 100;
            const minusDI = (minusSum / trSum) * 100;

            const dx =
                (Math.abs(plusDI - minusDI) / (plusDI + minusDI)) * 100;

            adx.push(dx);
        }

        return adx;
    }

    /* ======================================
       HELPERS
    ====================================== */

    private static getBodyPercent(c: Candle): number {
        const range = c.high - c.low;
        if (range === 0) return 0;
        return (Math.abs(c.close - c.open) / range) * 100;
    }

    private static getRangePercent(candles: Candle[]): number {
        const high = Math.max(...candles.map(c => c.high));
        const low = Math.min(...candles.map(c => c.low));
        return ((high - low) / low) * 100;
    }

    private static getVolumeMA(
        candles: Candle[],
        period: number
    ): number {
        const volumes = candles.slice(-period).map(c => c.volume);
        return volumes.reduce((a, b) => a + b, 0) / period;
    }
}