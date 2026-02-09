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
        let totalProcessed = 0;
        let offset = 0;
        const LIMIT = 500;

        try {
            console.log(`[TradingCron] Starting cycle at ${new Date().toISOString()}`);

            while (true) {
                const configs = await Data.fetchTradingConfigs({
                    timeframe: "1m",
                    limit: LIMIT,
                    offset: offset
                });

                if (configs.length === 0) {
                    break;
                }

                await Promise.allSettled(
                    configs.map(cfg =>
                        TradingV2.runTradingCycle(cfg)
                    )
                );

                totalProcessed += configs.length;
                offset += LIMIT;

                console.log(`[TradingCron] Processed batch of ${configs.length} (Total: ${totalProcessed})`);

                if (process.env.IS_SERVER_TESTING) {
                    break;
                }
            }

        } catch (error) {
            errorLogger.error("[TradingCron] Failed", error);
        } finally {
            console.log(
                `[TradingCron] Finished. Processed ${totalProcessed} configs in ${Date.now() - startTime}ms`
            );
        }
    });

    console.log(`[tradingCycleCronJob] Scheduled with: ${env.cronSchedule}`);
};

export default tradingCycleCronJob;