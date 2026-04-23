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

    static async syncTradeStates() {
        const collectionKey = 'trade-states';
        const now = new Date();

        let status = await SyncStatus.findOne({ collectionName: collectionKey });
        if (!status) {
            status = await SyncStatus.create({
                collectionName: collectionKey,
                lastSyncedAt: new Date(0)
            });
        }

        const lastSync = status.lastSyncedAt;

        // 🚀 STREAM instead of loading everything
        const cursor = TradeState.find({
            updatedAt: { $gt: lastSync, $lte: now }
        })
        .select({
            _id: 1,
            userId: 1,
            tradingBotId: 1,
            symbol: 1,
            side: 1,
            tradeOutcome: 1,
            entryPrice: 1,
            slPrice: 1,
            tpPrice: 1,
            quantity: 1,
            leverage: 1,
            pnl: 1,
            pnlPercentage: 1,
            riskRewardRatio: 1,
            tpPercentage: 1,
            slPercentage: 1,
            finalScore: 1,
            entryScore: 1,
            confirmationProbability: 1,
            structureProbability: 1,
            tradingMode: 1,
            createdAt: 1,
            updatedAt: 1
        })
        .lean()
        .cursor();

        const chunkSize = 500;
        let batch: any[] = [];
        let total = 0;

        try {
            for await (const doc of cursor) {
                batch.push({
                    tradeId: String(doc._id), // 🔥 use Mongo _id
                    ...doc
                });

                if (batch.length === chunkSize) {
                    await PayloadClient.bulkUpsertTradeStates(batch);
                    total += batch.length;
                    batch = [];
                }
            }

            // flush remaining
            if (batch.length > 0) {
                await PayloadClient.bulkUpsertTradeStates(batch);
                total += batch.length;
            }

            status.lastSyncedAt = now;
            await status.save();

            return total;

        } catch (err: any) {
            console.error('[BulkSync] TradeStates Failed:', err.message);
            return 0;
        }
    }

    static async runFullSync() {
        try {
            const pnlCount = await this.syncBotPnl();
            const tradeCount = await this.syncTradeStates();

            if (pnlCount > 0 || tradeCount > 0) {
                console.log(`[BulkSync] Synced: ${pnlCount} PNL updates, ${tradeCount} trade states`);
            }
        } catch (err) {
            console.error('[BulkSync] Error:', err);
        }
    }
}