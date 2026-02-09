import dotenv from 'dotenv';

dotenv.config();

interface EnvConfig {
    port: number;
    mongoUri: string;
    cronSchedule: string;
    clientServiceUrl: string;
}

const env: EnvConfig = {
    port: parseInt(process.env.PORT || '3001', 10),
    mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/express_api_db',
    cronSchedule: process.env.CRON_SCHEDULE || '*/5 * * * *',
    clientServiceUrl: process.env.CLIENT_SERVICE_URL || 'http://localhost:3000'
};

export default env;
