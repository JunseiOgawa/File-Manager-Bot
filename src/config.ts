import dotenv from 'dotenv';

dotenv.config();

export const config = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
    MONITOR_CHANNEL_ID: process.env.MONITOR_CHANNEL_ID || '',
    NOTIFY_CHANNEL_ID: process.env.NOTIFY_CHANNEL_ID || '',
    UPLOAD: {
        BATCH_WAIT_MS: 60 * 1000 // 1 minute
    }
};

if (!config.DISCORD_TOKEN) console.warn("WARNING: DISCORD_TOKEN is not set.");
if (!config.MONITOR_CHANNEL_ID) console.warn("WARNING: MONITOR_CHANNEL_ID is not set.");
