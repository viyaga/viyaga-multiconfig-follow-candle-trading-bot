import cron from 'node-cron';
import { env } from '../config';
import { BulkSyncService } from '../services/bulkSync.service';

/**
 * Polling-based sync for Payload CMS.
 * Runs every 5 minutes by default, or as configured in .env.
 */
const payloadSyncCronJob = (): void => {
    // We'll use a slightly different schedule if needed, but for now we follow the general schedule or a fixed 5m
    const schedule = env.cronSchedule;

    cron.schedule(schedule, async () => {
        console.log('[PayloadSync] Starting scheduled bulk sync...');
        await BulkSyncService.runFullSync();
    });
};

export default payloadSyncCronJob;
