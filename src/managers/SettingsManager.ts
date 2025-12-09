import * as fs from 'fs';
import * as path from 'path';

interface IGuildSettings {
    monitorChannelId?: string;
    notifyChannelId?: string;
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
            console.log('Settings saved.');
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

    public getMonitorChannelId(guildId: string): string | undefined {
        return this.settings[guildId]?.monitorChannelId;
    }

    public setMonitorChannelId(guildId: string, channelId: string) {
        const guildSettings = this.getGuildSettings(guildId);
        guildSettings.monitorChannelId = channelId;
        this.saveSettings();
    }

    public getNotifyChannelId(guildId: string): string | undefined {
        return this.settings[guildId]?.notifyChannelId;
    }

    public setNotifyChannelId(guildId: string, channelId: string) {
        const guildSettings = this.getGuildSettings(guildId);
        guildSettings.notifyChannelId = channelId;
        this.saveSettings();
    }
}
