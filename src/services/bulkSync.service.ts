import { SyncStatus } from '../models/syncStatus.model';
import { ExecutedTrade } from '../models/executedTrade.model';
import { MartingaleState } from '../models/martingaleState.model';
import { PayloadClient } from './payload.client';

export class BulkSyncService {
    
    /**
     * Synchronizes a specific collection to Payload CMS.
     */
    static async syncCollection(collectionKey: string, payloadCollectionName: string, model: any) {
        // 1. Get last sync status
        let status = await SyncStatus.findOne({ collectionName: collectionKey });
        if (!status) {
            status = await SyncStatus.create({ collectionName: collectionKey, lastSyncedAt: new Date(0) });
        }

        const lastSync = status.lastSyncedAt;
        
        // 2. Fetch updated records
        const records = await model.find({ updatedAt: { $gt: lastSync } }).sort({ updatedAt: 1 }).limit(100);

        if (records.length === 0) {
            return 0;
        }

        console.log(`[BulkSync] Syncing ${records.length} records for ${collectionKey}...`);

        // 3. Prepare bulk data
        const docs = records.map((record: any) => {
            const data = record.toObject ? record.toObject() : record;
            const { _id, __v, ...syncData } = data;
            
            return {
                id: String(_id),
                data: syncData,
            };
        });

        try {
            // 4. Send bulk request
            const result = await PayloadClient.bulkSync(payloadCollectionName, docs);
            
            if (result.success) {
                // 5. Update sync status to the latest updatedAt in this batch
                const latestRecord = records[records.length - 1];
                status.lastSyncedAt = latestRecord.updatedAt;
                await status.save();
                
                return records.length;
            } else {
                console.error(`[BulkSync] Bulk sync for ${collectionKey} reported failure:`, result.error);
                return 0;
            }
        } catch (err: any) {
            console.error(`[BulkSync] Failed to bulk sync ${collectionKey}:`, err.message);
            return 0;
        }
    }

    /**
     * Run full sync for all configured collections.
     */
    static async runFullSync() {
        try {
            const tradeCount = await this.syncCollection('executed-trades', 'executed-trades', ExecutedTrade);
            const stateCount = await this.syncCollection('martingale-states', 'martingale-states', MartingaleState);
            
            if (tradeCount > 0 || stateCount > 0) {
                console.log(`[BulkSync] Completed: ${tradeCount} trades, ${stateCount} states synced.`);
            }
        } catch (err) {
            console.error('[BulkSync] Error during full sync:', err);
        }
    }
}
