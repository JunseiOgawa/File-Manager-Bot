import { Client, GatewayIntentBits, Partials, Message, Interaction, PermissionsBitField, REST, Routes, SlashCommandBuilder } from 'discord.js';
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
        this.client.on('ready', async () => {
            console.log(`Bot is ready! Logged in as ${this.client.user?.tag}`);
            await this.registerCommands();
        });

        // Handle Slash Commands
        this.client.on('interactionCreate', async (interaction: Interaction) => {
            if (!interaction.isChatInputCommand()) return;

            // Admin Only Check
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
                await interaction.reply({ content: '❌ You need Administrator permissions to use this command.', ephemeral: true });
                return;
            }

            const guildId = interaction.guildId;
            if (!guildId) return;

            const { commandName } = interaction;

            if (commandName === 'inputchannel') {
                this.settings.setMonitorChannelId(guildId, interaction.channelId);
                await interaction.reply({ content: `✅ Input (Monitor) channel set to: <#${interaction.channelId}>` });
                console.log(`[${guildId}] Input channel set to ${interaction.channelId}`);
            }
            else if (commandName === 'outputchannel') {
                this.settings.setNotifyChannelId(guildId, interaction.channelId);
                await interaction.reply({ content: `✅ Output (Notification) channel set to: <#${interaction.channelId}>` });
                console.log(`[${guildId}] Output channel set to ${interaction.channelId}`);
            }
        });

        // Handle Messages (File Collection)
        this.client.on('messageCreate', async (message: Message) => {
            if (message.author.bot || !message.guildId) return;

            const guildId = message.guildId;
            const monitorChannelId = this.settings.getMonitorChannelId(guildId);

            if (monitorChannelId && message.channelId === monitorChannelId) {
                // 1. Check for File Uploads (.jar)
                const jarAttachments = message.attachments.filter(att => att.name?.toLowerCase().endsWith('.jar'));

                if (jarAttachments.size > 0) {
                    jarAttachments.forEach(att => collector.handleFileEvent(guildId, message, att));
                }

                // 2. Check for Cancellation (Reply)
                if (message.reference && message.reference.messageId) {
                    const content = message.content.trim().toLowerCase();
                    if (content === 'cancel' || content === 'キャンセル' || content.includes('キャンセル')) {
                        collector.handleCancelEvent(guildId, message.reference.messageId);
                        await message.react('❌').catch(() => { });
                    }
                }
            }
        });
    }

    private async registerCommands() {
        if (!config.DISCORD_TOKEN) return;

        const commands = [
            new SlashCommandBuilder()
                .setName('inputchannel')
                .setDescription('Set the current channel as the input (monitor) channel for .jar files.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName('outputchannel')
                .setDescription('Set the current channel as the output (notification) channel.')
                .toJSON(),
        ];

        const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

        try {
            console.log('Started refreshing application (/) commands.');

            // Register global commands (reverts to guild-based if rapid updates needed, but global is cleaner for public bots)
            // However, for development speed, we often iterate over all guilds.
            // Let's use application-level global commands for simplicity.
            if (this.client.application) {
                await rest.put(
                    Routes.applicationCommands(this.client.application.id),
                    { body: commands },
                );
                console.log('Successfully reloaded application (/) commands.');
            }
        } catch (error) {
            console.error(error);
        }
    }

    public async login(token: string): Promise<void> {
        try {
            await this.client.login(token);
        } catch (error) {
            console.error('Failed to login:', error);
            throw error;
        }
    }
}
