import axios, { AxiosInstance } from 'axios';
import env from '../config/env';

import errorLogger from '../utils/errorLogger';

export class PayloadClient {
    private static baseUrl = env.payloadUrl;
    private static apiKey = env.payloadApiKey;
    private static _instance: AxiosInstance;

    private static get instance(): AxiosInstance {
        if (!this._instance) {
            const headers: any = {
                'Content-Type': 'application/json',
            };
            if (this.apiKey) {
                headers['Authorization'] = `users API-Key ${this.apiKey}`;
            }

            this._instance = axios.create({
                baseURL: this.baseUrl,
                headers,
                timeout: 30000,
                // 🚀 Keep-alive for better connection reuse during bulk sync
                httpAgent: new (require('http').Agent)({ keepAlive: true }),
                httpsAgent: new (require('https').Agent)({ keepAlive: true }),
            });

        }
        return this._instance;
    }

    static async updatePnl(updates: { botId: string; allTimePnl: number }[]) {
        try {
            const response = await this.instance.post('/api/trading-bots/update-pnl', updates);
            return response.data;
        } catch (error: any) {
            errorLogger.error(`[PayloadClient] PNL update failed:`, error.response?.data || error.message);
            throw error;
        }
    }

    static async bulkUpsertTradeStates(data: any[]) {
        try {
            const response = await this.instance.post('/api/trade-states/bulk', data);
            return response.data;
        } catch (error: any) {
            errorLogger.error(`[PayloadClient] Trade states bulk sync failed:`, error.response?.data || error.message);
            throw error;
        }
    }

    static async bulkUpdateBots(updates: { botId: string; errorMessage?: string; status?: string; isActive?: boolean }[]) {
        try {
            const response = await this.instance.post('/api/trading-bots/bulk-update', updates);
            return response.data;
        } catch (error: any) {
            errorLogger.error(`[PayloadClient] Bulk bot update failed:`, error.response?.data || error.message);
            throw error;
        }
    }
}

