import { SyncStatus } from '../models/syncStatus.model';

import { MartingaleState } from '../models/martingaleState.model';
import { PayloadClient } from './payload.client';

export class BulkSyncService {

    /**
     * Synchronizes bot PNL to Payload CMS.
     */
    static async syncBotPnl() {
        const collectionKey = 'trading-bot-pnl';

        // 1. Get last sync status
        let status = await SyncStatus.findOne({ collectionName: collectionKey });
        if (!status) {
            status = await SyncStatus.create({ collectionName: collectionKey, lastSyncedAt: new Date(0) });
        }

        const lastSync = status.lastSyncedAt;

        // 2. Fetch updated records
        const records = await MartingaleState.find({ updatedAt: { $gt: lastSync } })
            .sort({ updatedAt: 1 })
            .limit(100);

        if (records.length === 0) {
            return 0;
        }

        console.log(`[BulkSync] Syncing PNL for ${records.length} bots...`);

        // 3. Prepare bulk data
        const updates = records.map((record) => ({
            botId: record.tradingBotId,
            allTimePnl: record.allTimePnl,
        }));

        try {
            // 4. Send bulk request
            await PayloadClient.updatePnl(updates);

            // 5. Update sync status to the latest updatedAt in this batch
            const latestRecord = records[records.length - 1];
            status.lastSyncedAt = latestRecord.updatedAt;
            await status.save();

            return records.length;
        } catch (err: any) {
            console.error(`[BulkSync] Failed to sync bot PNL:`, err.message);
            return 0;
        }
    }

    /**
     * Run full sync for all configured collections.
     */
    static async runFullSync() {
        try {
            const syncCount = await this.syncBotPnl();

            if (syncCount > 0) {
                console.log(`[BulkSync] Completed: ${syncCount} bot PNLs synced.`);
            }
        } catch (err) {
            console.error('[BulkSync] Error during full sync:', err);
        }
    }
}
