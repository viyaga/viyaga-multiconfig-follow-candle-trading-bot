import { env, connectDB } from './config';
import app from './app';
import startCronJobs from './cron';
import { tradingCronLogger } from './services/tradingV2/logger';



const startServer = async (): Promise<void> => {
    // Connect to MongoDB
    await connectDB();

    // Start cron jobs
    startCronJobs();

    // Start the Express server
    app.listen(env.port, () => {
        tradingCronLogger.info(`Server running on port ${env.port}`);
        tradingCronLogger.info(`Access API at http://localhost:${env.port}`);
    });
};

startServer();