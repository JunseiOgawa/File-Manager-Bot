import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

interface ISettings {
    monitorChannelId: string;
    notifyChannelId: string;
}

export class SettingsManager {
    private settingsFile = path.resolve(process.cwd(), 'settings.json');
    private settings: ISettings;

    constructor() {
        this.settings = this.loadSettings();
    }

    private loadSettings(): ISettings {
        let savedSettings: Partial<ISettings> = {};

        if (fs.existsSync(this.settingsFile)) {
            try {
                const data = fs.readFileSync(this.settingsFile, 'utf-8');
                savedSettings = JSON.parse(data);
                console.log('Loaded settings from file.');
            } catch (error) {
                console.error('Failed to load settings file, using defaults.', error);
            }
        }

        // Merge saved settings with defaults from env
        return {
            monitorChannelId: savedSettings.monitorChannelId || config.MONITOR_CHANNEL_ID || '',
            notifyChannelId: savedSettings.notifyChannelId || config.NOTIFY_CHANNEL_ID || '',
        };
    }

    private saveSettings() {
        try {
            fs.writeFileSync(this.settingsFile, JSON.stringify(this.settings, null, 2));
            console.log('Settings saved.');
        } catch (error) {
            console.error('Failed to save settings:', error);
        }
    }

    public getMonitorChannelId(): string {
        return this.settings.monitorChannelId;
    }

    public setMonitorChannelId(id: string) {
        this.settings.monitorChannelId = id;
        this.saveSettings();
    }

    public getNotifyChannelId(): string {
        return this.settings.notifyChannelId;
    }

    public setNotifyChannelId(id: string) {
        this.settings.notifyChannelId = id;
        this.saveSettings();
    }
}
