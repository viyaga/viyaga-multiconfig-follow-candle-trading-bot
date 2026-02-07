import { env, connectDB } from './config';
import app from './app';
import startCronJobs from './cron';



const startServer = async (): Promise<void> => {
    // Connect to MongoDB
    await connectDB();

    // Start cron jobs
    startCronJobs();

    // Start the Express server
    app.listen(env.port, () => {
        console.log(`Server running on port ${env.port}`);
        console.log(`Access API at http://localhost:${env.port}`);
    });
};

startServer();