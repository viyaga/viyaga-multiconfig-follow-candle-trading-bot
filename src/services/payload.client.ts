import axios from 'axios';
import env from '../config/env';

export class PayloadClient {
    private static baseUrl = env.payloadUrl;
    private static apiKey = env.payloadApiKey;

    static async updatePnl(updates: { botId: string; allTimePnl: number }[]) {
        try {
            const url = `${this.baseUrl}/api/trading-bots/update-pnl`;
            const headers = this.apiKey ? { 'Authorization': `users API-Key ${this.apiKey}` } : {};
            
            const response = await axios.post(url, updates, { 
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                }
            });
            
            return response.data;
        } catch (error: any) {
            console.error(`[PayloadClient] PNL update failed:`, error.response?.data || error.message);
            throw error;
        }
    }

    static async bulkUpsertTradeStates(data: any[]) {
        try {
            const url = `${this.baseUrl}/api/trade-states/bulk`;
            const headers = this.apiKey ? { 'Authorization': `users API-Key ${this.apiKey}` } : {};
            
            const response = await axios.post(url, data, { 
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                }
            });
            
            return response.data;
        } catch (error: any) {
            console.error(`[PayloadClient] Trade states bulk sync failed:`, error.response?.data || error.message);
            throw error;
        }
    }
    static async bulkUpdateBots(updates: { botId: string; errorMessage?: string; status?: string; isActive?: boolean }[]) {
        try {
            const url = `${this.baseUrl}/api/trading-bots/bulk-update`;
            const headers = this.apiKey ? { 'Authorization': `users API-Key ${this.apiKey}` } : {};
            
            const response = await axios.post(url, updates, { 
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                }
            });
            
            return response.data;
        } catch (error: any) {
            console.error(`[PayloadClient] Bulk bot update failed:`, error.response?.data || error.message);
            throw error;
        }
    }
}
