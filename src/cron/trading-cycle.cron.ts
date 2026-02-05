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
            // 1️⃣ Fetch configs from external app
            const configs = await Data.fetchTradingConfigs({
                timeframe: "1m",
                limit: 500
            });

            // 2️⃣ Enqueue jobs (FAST)
            for (const cfg of configs) {
                await TradingV2.tradingQueue.add("trade", {
                    config: cfg
                });
            }

            console.log(`[TradingCron] Enqueued ${configs.length} jobs`);

        } catch (error) {
            errorLogger.error("[TradingCron] Failed to enqueue jobs", error);
        } finally {
            const executionTimeMs = Date.now() - startTime;
            console.log(`[TradingCron] Finished in ${executionTimeMs}ms`);
        }
    });

    console.log(`[tradingCycleCronJob] Scheduled with: ${env.cronSchedule}`);
};

export default tradingCycleCronJob;