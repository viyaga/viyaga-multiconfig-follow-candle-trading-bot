import { SyncStatus } from '../models/syncStatus.model';
import { TradeState } from '../models/tradeState.model';
import { PayloadClient } from './payload.client';

export class BulkSyncService {

    static async syncBotPnl() {
        const collectionKey = 'trading-bot-pnl';
        const now = new Date();

        let status = await SyncStatus.findOne({ collectionName: collectionKey });
        if (!status) {
            status = await SyncStatus.create({
                collectionName: collectionKey,
                lastSyncedAt: new Date(0)
            });
        }

        const lastSync = status.lastSyncedAt;

        // 🚀 DB-level aggregation (NO in-memory dedupe)
        const stats = await TradeState.aggregate([
            {
                $match: {
                    updatedAt: { $gt: lastSync, $lte: now }
                }
            },
            {
                $sort: { updatedAt: -1 } // latest first
            },
            {
                $group: {
                    _id: "$tradingBotId",
                    allTimePnl: { $first: "$allTimePnl" }, // latest value
                }
            }
        ]);

        if (stats.length === 0) {
            status.lastSyncedAt = now;
            await status.save();
            return 0;
        }

        const updates = stats.map(s => ({
            botId: s._id,
            allTimePnl: s.allTimePnl
        }));

        try {
            // 🚀 Chunking for safety (still important)
            const chunkSize = 500;

            for (let i = 0; i < updates.length; i += chunkSize) {
                await PayloadClient.updatePnl(
                    updates.slice(i, i + chunkSize)
                );
            }

            status.lastSyncedAt = now;
            await status.save();

            return updates.length;

        } catch (err: any) {
            console.error('[BulkSync] Failed:', err.message);
            return 0;
        }
    }

    static async runFullSync() {
        try {
            const count = await this.syncBotPnl();

            if (count > 0) {
                console.log(`[BulkSync] Synced ${count} bots`);
            }
        } catch (err) {
            console.error('[BulkSync] Error:', err);
        }
    }
}