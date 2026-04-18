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
}
