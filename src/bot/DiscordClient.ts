import { Client, GatewayIntentBits, Partials, Message, Interaction, PermissionsBitField, REST, Routes, SlashCommandBuilder, TextChannel, ChannelType, CategoryChannel } from 'discord.js';
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
            else if (commandName === 'setoutputcategory') {
                // If run in a category or we check channel parent
                let categoryId = interaction.channelId;

                // If the command is run in a text channel, try to get its parent category
                const channel = interaction.channel;
                let categoryName = "ID: " + categoryId;

                if (channel instanceof TextChannel && channel.parentId) {
                    categoryId = channel.parentId;
                    const parent = channel.parent;
                    categoryName = parent?.name || categoryId;
                } else if (channel && (channel as any).type === ChannelType.GuildCategory) {
                    // Start in category directly? (Discord UI sometimes limits this)
                    categoryName = (channel as unknown as CategoryChannel).name;
                }

                this.settings.setOutputCategoryId(guildId, categoryId);
                await interaction.reply({ content: `✅ Output Category set to: **${categoryName}**\nNew output channels will be created here.` });
                console.log(`[${guildId}] Output Category set to ${categoryId}`);
            }
            else if (commandName === 'folderlist') {
                // 1. Delete Old Message
                const lastMsgId = this.settings.getLastFolderListMessageId(guildId);
                if (lastMsgId && interaction.channel) {
                    try {
                        const oldMsg = await interaction.channel.messages.fetch(lastMsgId);
                        if (oldMsg) await oldMsg.delete();
                    } catch (e) { /* Ignore if already deleted */ }
                }

                // 2. Get Files
                const files = collector.getPendingFiles(guildId);
                let content = '**📂 Pending Files (Current Batch):**\n';
                if (files.length === 0) {
                    content += '(No files waiting)';
                } else {
                    content += files.map(f => `・[${f.filename}](${f.messageUrl}) ${f.isReplacement ? '(更新)' : ''}`).join('\n');
                }

                // 3. Send New Message
                // We use deferReply + delete + followUp or just reply.
                // Since we want to delete THIS message later, reply is good, but if we reply to the interaction, 
                // deleting the "interaction reply" is slightly different.
                // A clean way is: interaction.reply (ephemeral?) -> No, user wants a persistent list.
                // We'll treat the interaction reply as the message to track.

                const reply = await interaction.reply({ content, fetchReply: true });
                this.settings.setLastFolderListMessageId(guildId, reply.id);
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
                .setDescription('Set the current channel as the input (monitor) channel.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName('setoutputcategory')
                .setDescription('Set the Category of current channel as the Output Category.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName('folderlist')
                .setDescription('List currently pending files using self-updating message.')
                .toJSON(),
        ];

        const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

        try {
            console.log('Started refreshing application (/) commands.');
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
