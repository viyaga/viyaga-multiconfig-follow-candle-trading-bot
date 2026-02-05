import dotenv from 'dotenv';

dotenv.config();

interface EnvConfig {
    port: number;
    mongoUri: string;
    cronSchedule: string;
    redisHost: string;
    redisPort: number;
    clientServiceUrl: string;
}

const env: EnvConfig = {
    port: parseInt(process.env.PORT || '3001', 10),
    mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/express_api_db',
    cronSchedule: process.env.CRON_SCHEDULE || '*/5 * * * *',
    redisHost: process.env.REDIS_HOST || 'localhost',
    redisPort: parseInt(process.env.REDIS_PORT || '6379', 10),
    clientServiceUrl: process.env.CLIENT_SERVICE_URL || 'http://localhost:3000',
};

export default env;
