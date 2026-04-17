import axios from 'axios';
import env from '../config/env';

export class PayloadClient {
    private static baseUrl = env.payloadUrl;
    private static apiKey = env.payloadApiKey;

    static async bulkSync(collection: string, docs: { id: string; data: any }[]) {
        try {
            const url = `${this.baseUrl}/api/${collection}/bulk-sync`;
            const headers = this.apiKey ? { 'Authorization': `users API-Key ${this.apiKey}` } : {};
            
            const response = await axios.post(url, { docs }, { 
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                }
            });
            
            return response.data;
        } catch (error: any) {
            console.error(`[PayloadClient] Bulk sync failed for ${collection}:`, error.response?.data || error.message);
            throw error;
        }
    }
}
