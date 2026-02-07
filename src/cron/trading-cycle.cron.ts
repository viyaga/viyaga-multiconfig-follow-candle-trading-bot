import cron from "node-cron";
import { env } from "../config";
import errorLogger from "../utils/errorLogger";
import { TradingV2 } from "../services/tradingV2";
import { Data } from "../services/tradingV2/data";

/* ============================================================================
 * Cron Scheduler
 * ============================================================================ */

const tradingCycleCronJob = (): void => {

    cron.schedule(env.cronSchedule, async () => {
        const startTime = Date.now();

        try {
            const configs = await Data.fetchTradingConfigs({
                timeframe: "1m",
                limit: 500
            });

            await Promise.allSettled(
                configs.map(cfg =>
                    TradingV2.runTradingCycle(cfg)
                )
            );

            console.log(`[TradingCron] Processed ${configs.length} configs`);

        } catch (error) {
            errorLogger.error("[TradingCron] Failed", error);
        } finally {
            console.log(
                `[TradingCron] Finished in ${Date.now() - startTime}ms`
            );
        }
    });

    console.log(`[tradingCycleCronJob] Scheduled with: ${env.cronSchedule}`);
};

export default tradingCycleCronJob;