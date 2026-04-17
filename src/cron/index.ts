import tradingCycleCronJob from './trading-cycle.cron';
import payloadSyncCronJob from './payload-sync.cron';
import { tradingCronLogger } from '../services/tradingV2/logger';

const startCronJobs = (): void => {
    tradingCronLogger.info(`Starting cron jobs...`);
    tradingCycleCronJob();
    payloadSyncCronJob();
    tradingCronLogger.info('All cron jobs started successfully.');
};

export default startCronJobs;