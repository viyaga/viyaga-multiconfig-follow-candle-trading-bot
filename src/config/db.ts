import mongoose from 'mongoose';
import errorLogger from '../utils/errorLogger';
import env from './env';

const connectDB = async (): Promise<void> => {
    try {
        await mongoose.connect(env.mongoUri);
        console.log('MongoDB connected successfully.');
    } catch (error) {
        errorLogger.error('MongoDB connection error:', error);
        console.warn('Server will start without database connection. Database operations will fail.');
        // Don't exit the process - allow server to start without DB
    }
};

export default connectDB;
