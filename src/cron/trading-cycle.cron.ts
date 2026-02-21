import cron from "node-cron";
import { env } from "../config";
import errorLogger from "../utils/errorLogger";
import { TradingV2 } from "../services/tradingV2";
import { Data } from "../services/tradingV2/data";
import { TradingConfig } from "../services/tradingV2/config";
import { tradingCronLogger } from "../services/tradingV2/logger";

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

        tradingCronLogger.info(`${'='.repeat(80)}`);
        tradingCronLogger.info(`[TradingCron] ========== CYCLE START ==========`);
        tradingCronLogger.info(`${'='.repeat(80)}`);

        try {
            tradingCronLogger.info(`[TradingCron] Fetching trading configs with LIMIT=${LIMIT}, starting at offset=${offset}...`);

            while (true) {
                const configs = await Data.fetchTradingConfigs({
                    timeframe: "1m",
                    limit: LIMIT,
                    offset: offset
                });

                tradingCronLogger.info(`[TradingCron] Fetched ${configs.length} configs at offset=${offset}`);

                if (configs.length === 0) {
                    tradingCronLogger.info(`[TradingCron] No more configs found. Breaking loop.`);
                    break;
                }

                tradingCronLogger.info(`[TradingCron] Processing batch of ${configs.length} configs...`);
                const results = await Promise.allSettled(
                    configs.map(cfg => {
                        tradingCronLogger.info(`[TradingCron] Starting cycle for config: ${cfg.id} (${cfg.SYMBOL})`);
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
                        tradingCronLogger.info(`[TradingCron] ✓ Config ${config.id} (${config.SYMBOL}) completed successfully`);
                    } else {
                        totalFailed++;
                        tradingCronLogger.error(`[TradingCron] ✗ Config ${config.id} (${config.SYMBOL}) failed:`, { reason: result.reason?.message || result.reason });
                    }
                });

                totalProcessed += configs.length;
                offset += LIMIT;

                tradingCronLogger.info(`[TradingCron] Batch summary: ${configs.length} configs, ${totalSucceeded} succeeded, ${totalFailed} failed`);
                tradingCronLogger.info(`[TradingCron] Total processed so far: ${totalProcessed}`);

                if (process.env.IS_SERVER_TESTING) {
                    tradingCronLogger.info(`[TradingCron] IS_SERVER_TESTING mode enabled. Breaking loop.`);
                    break;
                }
            }

        } catch (error) {
            tradingCronLogger.error(`[TradingCron] CRITICAL ERROR occurred:`, { error });
            errorLogger.error("[TradingCron] Cron cycle failed", error);
        } finally {
            const duration = Date.now() - startTime;
            tradingCronLogger.info(`${'='.repeat(80)}`);
            tradingCronLogger.info(`[TradingCron] ========== CYCLE COMPLETE =========="`);
            tradingCronLogger.info(`[TradingCron] Total Processed: ${totalProcessed}`);
            tradingCronLogger.info(`[TradingCron] Succeeded: ${totalSucceeded} | Failed: ${totalFailed}`);
            tradingCronLogger.info(`[TradingCron] Duration: ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
            tradingCronLogger.info(`${'='.repeat(80)}`);
        }
    });

    tradingCronLogger.info(`[CronScheduler] Trading cycle cron job scheduled: "${env.cronSchedule}"`);
    tradingCronLogger.info(`[CronScheduler] Next execution will be triggered based on the schedule.`);
};

export default tradingCycleCronJob;