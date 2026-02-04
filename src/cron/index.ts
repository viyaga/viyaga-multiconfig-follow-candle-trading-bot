import tradingCycleCronJob from './trading-cycle.cron';

const startCronJobs = (): void => {
    tradingCycleCronJob();
    console.log('All cron jobs started.');
};

export default startCronJobs;
