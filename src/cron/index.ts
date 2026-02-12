import tradingCycleCronJob from './trading-cycle.cron';

const startCronJobs = (): void => {
    console.log(`[CronJobManager] Starting cron jobs at ${new Date().toISOString()}`);
    tradingCycleCronJob();
    console.log('[CronJobManager] All cron jobs started successfully.');
};

export default startCronJobs;
