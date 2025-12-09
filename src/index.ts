import { DiscordClient } from './bot/DiscordClient';
import { CollectorManager } from './managers/CollectorManager';
import { SettingsManager } from './managers/SettingsManager';
import { config } from './config';

async function main() {
    console.log('Starting Discord File Collector Bot...');

    // Initialize Settings Manager
    const settingsManager = new SettingsManager();

    // Initialize Bot & Collector with Settings
    const discordClient = new DiscordClient(settingsManager);
    const collector = new CollectorManager(discordClient.client, settingsManager);

    // Setup event listeners
    discordClient.setupEvents(collector);

    // Start
    await discordClient.login(config.DISCORD_TOKEN);
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
