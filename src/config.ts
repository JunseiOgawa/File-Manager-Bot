import dotenv from 'dotenv';

dotenv.config();

export const config = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN || '',
    UPLOAD: {
        BATCH_WAIT_MS: 30 * 1000 // 30 seconds
    }
};

if (!config.DISCORD_TOKEN) console.warn("WARNING: DISCORD_TOKEN is not set.");
