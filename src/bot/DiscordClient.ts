import { Client, GatewayIntentBits, Partials, Message, PermissionsBitField } from 'discord.js';
import { config } from '../config';
import { CollectorManager } from '../managers/CollectorManager';
import { SettingsManager } from '../managers/SettingsManager';

export class DiscordClient {
    public client: Client;
    private settings: SettingsManager;

    constructor(settings: SettingsManager) {
        this.settings = settings;
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
            ],
            partials: [Partials.Message, Partials.Channel, Partials.Reaction]
        });
    }

    public setupEvents(collector: CollectorManager): void {
        this.client.on('ready', () => {
            console.log(`Bot is ready!`);
            console.log(`Monitor Channel: ${this.settings.getMonitorChannelId() || 'Not Set'}`);
            console.log(`Notify Channel : ${this.settings.getNotifyChannelId() || 'Not Set'}`);
        });

        this.client.on('messageCreate', async (message: Message) => {
            if (message.author.bot) return;

            // --- Command Handling (Admin Only) ---
            if (message.content.startsWith('!')) {
                await this.handleCommands(message);
                return;
            }

            // --- File Collection Logic ---
            const monitorChannelId = this.settings.getMonitorChannelId();
            if (monitorChannelId && message.channelId === monitorChannelId) {
                // 1. Check for File Uploads (.jar)
                const jarAttachments = message.attachments.filter(att => att.name?.toLowerCase().endsWith('.jar'));

                if (jarAttachments.size > 0) {
                    jarAttachments.forEach(att => collector.handleFileEvent(message, att));
                }

                // 2. Check for Cancellation (Reply)
                if (message.reference && message.reference.messageId) {
                    const content = message.content.trim().toLowerCase();
                    if (content === 'cancel' || content === 'キャンセル' || content.includes('キャンセル')) {
                        collector.handleCancelEvent(message.reference.messageId);
                        await message.react('❌').catch(() => { });
                    }
                }
            }
        });
    }

    private async handleCommands(message: Message) {
        if (!message.member?.permissions.has(PermissionsBitField.Flags.Administrator)) return;

        const content = message.content.trim();

        if (content === '!setmonitor') {
            this.settings.setMonitorChannelId(message.channelId);
            await message.reply(`✅ Monitor channel set to: ${message.channelId} (${message.channel})`);
            console.log(`Monitor channel updated to ${message.channelId}`);
        }
        else if (content === '!setnotify') {
            this.settings.setNotifyChannelId(message.channelId);
            await message.reply(`✅ Notification channel set to: ${message.channelId} (${message.channel})`);
            console.log(`Notification channel updated to ${message.channelId}`);
        }
    }

    public async login(token: string): Promise<void> {
        try {
            await this.client.login(token);
            console.log(`LoggedIn as ${this.client.user?.tag}`);
        } catch (error) {
            console.error('Failed to login:', error);
            throw error;
        }
    }
}
