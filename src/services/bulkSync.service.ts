import { SyncStatus } from '../models/syncStatus.model';

import { MartingaleState } from '../models/martingaleState.model';
import { PayloadClient } from './payload.client';

export class BulkSyncService {

    /**
     * Synchronizes bot PNL to Payload CMS.
     */
    static async syncBotPnl() {
        const collectionKey = 'trading-bot-pnl';
        const now = new Date(); // 1. Capture now to prevent race conditions

        // 2. Get last sync status
        let status = await SyncStatus.findOne({ collectionName: collectionKey });
        if (!status) {
            status = await SyncStatus.create({ collectionName: collectionKey, lastSyncedAt: new Date(0) });
        }

        const lastSync = status.lastSyncedAt;

        // 3. Identify unique bots that have updates and get their latest allTimePnl
        // Optimized: Uses compound index { updatedAt: 1, tradingBotId: 1 } and removes global sort
        const stats = await MartingaleState.aggregate([
            { $match: { updatedAt: { $gt: lastSync, $lte: now } } },
            {
                $group: {
                    _id: "$tradingBotId",
                    allTimePnl: { $last: "$allTimePnl" },
                    maxUpdatedAt: { $max: "$updatedAt" }
                }
            }
        ]);

        if (stats.length === 0) {
            status.lastSyncedAt = now;
            await status.save();
            return 0;
        }

        console.log(`[BulkSync] Syncing PNL for ${stats.length} unique bots...`);

        // 4. Prepare data
        const updates = stats.map((s) => ({
            botId: s._id,
            allTimePnl: s.allTimePnl,
        }));

        try {
            // 5. Send bulk request to backend in chunks (Scalability)
            const chunkSize = 500;
            for (let i = 0; i < updates.length; i += chunkSize) {
                const chunk = updates.slice(i, i + chunkSize);
                await PayloadClient.updatePnl(chunk);
            }

            // 6. Update sync status using the capture time
            status.lastSyncedAt = now;
            await status.save();

            return updates.length;
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
