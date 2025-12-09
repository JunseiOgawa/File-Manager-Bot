import { Client, GatewayIntentBits, Partials, Message, Interaction, PermissionsBitField, REST, Routes, SlashCommandBuilder, TextChannel, ChannelType, CategoryChannel, Attachment } from 'discord.js';
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

            if (commandName === 'createzip') {
                if (!interaction.channel || (interaction.channel as any).name !== 'inputfolder') {
                    const guild = interaction.guild;
                    if (!guild) {
                        await interaction.reply({ content: '❌ エラー: サーバー情報が取得できませんでした。', ephemeral: true });
                        return;
                    }

                    // Try to find existing inputfolder
                    let targetChannel = guild.channels.cache.find(c => c.name === 'inputfolder' && c.type === ChannelType.GuildText) as TextChannel;

                    if (!targetChannel) {
                        try {
                            // Fetch to be sure
                            const channels = await guild.channels.fetch();
                            targetChannel = channels.find(c => c !== null && c.name === 'inputfolder' && c.type === ChannelType.GuildText) as TextChannel;

                            if (!targetChannel) {
                                // Create it
                                targetChannel = await guild.channels.create({
                                    name: 'inputfolder',
                                    type: ChannelType.GuildText,
                                    topic: 'File input for ZIP creation'
                                });
                                await interaction.reply({ content: `❌ \`inputfolder\` が見つからなかったため自動作成しました。\nこちらでコマンドを実行してください: ${targetChannel}`, ephemeral: true });
                                return;
                            }
                        } catch (error) {
                            console.error('Failed to find or create inputfolder:', error);
                            await interaction.reply({ content: `❌ \`inputfolder\` 以外では実行できません。また、チャンネルの自動作成に失敗しました。\n権限を確認してください。`, ephemeral: true });
                            return;
                        }
                    }

                    // Channel exists but we are not in it
                    await interaction.reply({ content: `❌ このコマンドは \`inputfolder\` でのみ実行できます。\nこちらに移動してください: ${targetChannel}`, ephemeral: true });
                    return;
                }

                await interaction.deferReply({ ephemeral: true });
                console.log(`[${guildId}] Manual ZIP creation triggered.`);

                // Scan last 200 messages
                let fetchedCount = 0;
                let processedCount = 0;
                let lastId: string | undefined = undefined;
                const MAX_SCAN = 200;

                while (fetchedCount < MAX_SCAN) {
                    const limit = Math.min(MAX_SCAN - fetchedCount, 100);
                    const options: any = { limit };
                    if (lastId) options.before = lastId;

                    const messages = await interaction.channel.messages.fetch(options) as any;
                    if (messages.size === 0) break;

                    for (const msg of messages.values()) {
                        if (msg.author.bot) continue;

                        const jarAttachments = msg.attachments.filter((att: Attachment) => att.name?.toLowerCase().endsWith('.jar'));
                        if (jarAttachments.size > 0) {
                            jarAttachments.forEach((att: Attachment) => collector.handleFileEvent(guildId, msg, att));
                            processedCount += jarAttachments.size;
                        }
                        lastId = msg.id;
                    }
                    fetchedCount += messages.size;
                }

                // Force Process
                await interaction.editReply({ content: '現在アップロード作業中です...' });
                await collector.forceProcess(guildId);
                await interaction.editReply({ content: `✅ アップロード完了。出力チャンネルを確認してください。` });
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
                await interaction.reply({ content });
                const reply = await interaction.fetchReply();
                this.settings.setLastFolderListMessageId(guildId, reply.id);
            }
        });

        // Handle Messages (File Collection)
        this.client.on('messageCreate', async (message: Message) => {
            if (message.author.bot || !message.guildId) return;

            const guildId = message.guildId;

            if ((message.channel as any).name === 'inputfolder') {
                // 1. Check for File Uploads (.jar)
                const jarAttachments = message.attachments.filter((att: Attachment) => att.name?.toLowerCase().endsWith('.jar'));

                if (jarAttachments.size > 0) {
                    jarAttachments.forEach((att: Attachment) => collector.handleFileEvent(guildId, message, att));
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
                .setName('createzip')
                .setDescription('Scan last 200 messages in inputfolder and upload immediately.')
                .toJSON(),
            new SlashCommandBuilder()
                .setName('folderlist')
                .setDescription('List currently pending files.')
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
