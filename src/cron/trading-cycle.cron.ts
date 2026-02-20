import cron from "node-cron";
import { env } from "../config";
import errorLogger from "../utils/errorLogger";
import { TradingV2 } from "../services/tradingV2";
import { Data } from "../services/tradingV2/data";
import { TradingConfig } from "../services/tradingV2/config";

/* ============================================================================
 * Cron Scheduler
 * ============================================================================ */

const tradingCycleCronJob = (): void => {

    cron.schedule(env.cronSchedule, async () => {
        const startTime = Date.now();
        let totalProcessed = 0;
        let totalSucceeded = 0;
        let totalFailed = 0;
        let offset = 0;
        const LIMIT = 500;

        console.log(`\n${'='.repeat(80)}`);
        console.log(`[TradingCron] ========== CYCLE START ========== at ${new Date().toISOString()}`);
        console.log(`${'='.repeat(80)}`);

        try {
            console.log(`[TradingCron] Fetching trading configs with LIMIT=${LIMIT}, starting at offset=${offset}...`);

            while (true) {
                const configs = await Data.fetchTradingConfigs({
                    timeframe: "1m",
                    limit: LIMIT,
                    offset: offset
                });

                console.log(`[TradingCron] Fetched ${configs.length} configs at offset=${offset}`);

                if (configs.length === 0) {
                    console.log(`[TradingCron] No more configs found. Breaking loop.`);
                    break;
                }

                console.log(`[TradingCron] Processing batch of ${configs.length} configs...`);
                const results = await Promise.allSettled(
                    configs.map(cfg => {
                        console.log(`[TradingCron] Starting cycle for config: ${cfg.id} (${cfg.SYMBOL})`);
                        // Wrap execution in AsyncLocalStorage context to ensure config isolation
                        return TradingConfig.configStore.run(cfg, async () => {
                            return TradingV2.runTradingCycle(cfg);
                        });
                    })
                );

                // Count successes and failures
                results.forEach((result, index) => {
                    const config = configs[index];
                    if (result.status === 'fulfilled') {
                        totalSucceeded++;
                        console.log(`[TradingCron] ✓ Config ${config.id} (${config.SYMBOL}) completed successfully`);
                    } else {
                        totalFailed++;
                        console.error(`[TradingCron] ✗ Config ${config.id} (${config.SYMBOL}) failed:`, result.reason?.message || result.reason);
                    }
                });

                totalProcessed += configs.length;
                offset += LIMIT;

                console.log(`[TradingCron] Batch summary: ${configs.length} configs, ${totalSucceeded} succeeded, ${totalFailed} failed`);
                console.log(`[TradingCron] Total processed so far: ${totalProcessed}`);

                if (process.env.IS_SERVER_TESTING) {
                    console.log(`[TradingCron] IS_SERVER_TESTING mode enabled. Breaking loop.`);
                    break;
                }
            }

        } catch (error) {
            console.error(`[TradingCron] CRITICAL ERROR occurred:`, error);
            errorLogger.error("[TradingCron] Cron cycle failed", error);
        } finally {
            const duration = Date.now() - startTime;
            console.log(`\n${'='.repeat(80)}`);
            console.log(`[TradingCron] ========== CYCLE COMPLETE =========="`);
            console.log(`[TradingCron] Total Processed: ${totalProcessed}`);
            console.log(`[TradingCron] Succeeded: ${totalSucceeded} | Failed: ${totalFailed}`);
            console.log(`[TradingCron] Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
            console.log(`[TradingCron] Next cycle: ${new Date(Date.now() + 60000).toISOString()}`);
            console.log(`${'='.repeat(80)}\n`);
        }
    });

    console.log(`[CronScheduler] Trading cycle cron job scheduled: "${env.cronSchedule}"`);
    console.log(`[CronScheduler] Next execution will be triggered based on the schedule.`);
};

export default tradingCycleCronJob;