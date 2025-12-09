import * as fs from 'fs';
import * as path from 'path';

interface IGuildSettings {
    monitorChannelId?: string;
    outputCategoryId?: string;
    lastOutputChannelId?: string;
    lastFolderListMessageId?: string;
}

interface ISettings {
    [guildId: string]: IGuildSettings;
}

export class SettingsManager {
    private settingsFile = path.resolve(process.cwd(), 'settings.json');
    private settings: ISettings = {};

    constructor() {
        this.loadSettings();
    }

    private loadSettings() {
        if (fs.existsSync(this.settingsFile)) {
            try {
                const data = fs.readFileSync(this.settingsFile, 'utf-8');
                this.settings = JSON.parse(data);
                console.log('Loaded settings from file.');
            } catch (error) {
                console.error('Failed to load settings file, starting fresh.', error);
                this.settings = {};
            }
        }
    }

    private saveSettings() {
        try {
            fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
            // console.log('Settings saved.'); // Reduce noise
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    private getGuildSettings(guildId: string): IGuildSettings {
        if (!this.settings[guildId]) {
            this.settings[guildId] = {};
        }
        return this.settings[guildId];
    }

    // Monitor Channel
    public getMonitorChannelId(guildId: string): string | undefined {
        return this.settings[guildId]?.monitorChannelId;
    }

    public setMonitorChannelId(guildId: string, channelId: string) {
        const guildSettings = this.getGuildSettings(guildId);
        guildSettings.monitorChannelId = channelId;
        this.saveSettings();
    }

    // Output Category
    public getOutputCategoryId(guildId: string): string | undefined {
        return this.settings[guildId]?.outputCategoryId;
    }

    public setOutputCategoryId(guildId: string, categoryId: string) {
        const guildSettings = this.getGuildSettings(guildId);
        guildSettings.outputCategoryId = categoryId;
        this.saveSettings();
    }

    // Last Output Channel (for rotation)
    public getLastOutputChannelId(guildId: string): string | undefined {
        return this.settings[guildId]?.lastOutputChannelId;
    }

    public setLastOutputChannelId(guildId: string, channelId: string) {
        const guildSettings = this.getGuildSettings(guildId);
        guildSettings.lastOutputChannelId = channelId;
        this.saveSettings();
    }

    // Last Folder List Message (for cleanup)
    public getLastFolderListMessageId(guildId: string): string | undefined {
        return this.settings[guildId]?.lastFolderListMessageId;
    }

    public setLastFolderListMessageId(guildId: string, messageId: string) {
        const guildSettings = this.getGuildSettings(guildId);
        guildSettings.lastFolderListMessageId = messageId;
        this.saveSettings();
    }
}
