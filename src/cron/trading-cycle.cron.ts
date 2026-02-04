import cron from "node-cron";
import { env } from "../config";
import errorLogger from "../utils/errorLogger";
import { runTradingCycle } from "../services/tradingV2";
import { TradingConfig } from "../services/tradingV2/config";
import { tradingCycleLogger } from "../services/tradingV2/logger";

/* ============================================================================
 * Cron Scheduler
 * ============================================================================ */


const tradingCycleCronJob = (): void => {

    cron.schedule(env.cronSchedule, async () => {
        const startTime = Date.now();

        const config = TradingConfig.getConfig();
        let success = true;
        let errorMessage: string | undefined;

        try {
            await TradingConfig.configStore.run(config, async () => {
                await runTradingCycle(config);
            });
        } catch (error) {
            success = false;
            errorMessage = error instanceof Error ? error.message : String(error);
            errorLogger.error("[TradingCron] Error during cron job execution:", error);
        } finally {
            const endTime = Date.now();
            const executionTimeMs = endTime - startTime;
            const executionTimeSec = (executionTimeMs / 1000).toFixed(2);
            const endDate = new Date(endTime).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

            console.log(`\n${'='.repeat(60)}`);
            tradingCycleLogger.info(`[TradingCron] completed at: ${endDate} | Status: ${success ? 'SUCCESS' : 'FAILED'} | Execution time: ${executionTimeSec}s (${executionTimeMs}ms)`);
            console.log(`${'='.repeat(60)}\n`);
        }

    });

    console.log(`[tradingCycleCronJob] Trading cycle job scheduled to run with schedule: ${env.cronSchedule}`);
};

export default tradingCycleCronJob;