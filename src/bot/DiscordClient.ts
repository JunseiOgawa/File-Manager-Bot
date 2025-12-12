import { Client, GatewayIntentBits, Partials, Message, Interaction, PermissionsBitField, REST, Routes, SlashCommandBuilder, TextChannel, ChannelType, CategoryChannel, Attachment } from 'discord.js';
import { config } from '../config';
import { CollectorManager } from '../managers/CollectorManager';
import { SettingsManager } from '../managers/SettingsManager';

/**
 * メッセージの内容から、サニタイズされた添付ファイル名と一致する元のファイル名を抽出します。
 * Discordはファイル名から「!」などの特殊文字を削除するため、メッセージ本文から元のファイル名を探します。
 */
function getOriginalFilename(messageContent: string, sanitizedName: string): string {
    // メッセージ内のファイル名パターンを検索 (!filename.jar, filename.jar など)
    const filenamePattern = /[!@#$%^&*]?[\w\-\.]+\.jar/gi;
    const potentialFilenames = messageContent.match(filenamePattern) || [];

    for (const potentialName of potentialFilenames) {
        // 比較のために特殊文字を削除して正規化
        const normalized = potentialName.replace(/^[!@#$%^&*]+/, '');
        if (normalized.toLowerCase() === sanitizedName.toLowerCase()) {
            console.log(`[ファイル名] 復元: "${sanitizedName}" -> "${potentialName}"`);
            return potentialName;
        }
    }

    // 一致するものが見つからない場合は、サニタイズされた名前を返す
    return sanitizedName;
}

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
            console.log(`ボットの準備完了！ ログイン中: ${this.client.user?.tag}`);
            await this.registerCommands();
        });

        // スラッシュコマンドの処理
        this.client.on('interactionCreate', async (interaction: Interaction) => {
            if (!interaction.isChatInputCommand()) return;

            // 管理者権限チェック
            if (!interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)) {
                await interaction.reply({ content: '❌ このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
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

                    // 既存の inputfolder を探す
                    let targetChannel = guild.channels.cache.find(c => c.name === 'inputfolder' && c.type === ChannelType.GuildText) as TextChannel;

                    if (!targetChannel) {
                        try {
                            // 念のためフェッチする
                            const channels = await guild.channels.fetch();
                            targetChannel = channels.find(c => c !== null && c.name === 'inputfolder' && c.type === ChannelType.GuildText) as TextChannel;

                            // カテゴリが存在するか確認
                            let category: CategoryChannel | undefined;
                            const categoryName = 'File Manager Output';

                            // 設定からIDで探す
                            const storedCatId = this.settings.getOutputCategoryId(guildId);
                            if (storedCatId) {
                                try {
                                    const c = await guild.channels.fetch(storedCatId);
                                    if (c && c.type === ChannelType.GuildCategory) category = c as CategoryChannel;
                                } catch { }
                            }

                            if (!category) {
                                category = guild.channels.cache.find(c => c.type === ChannelType.GuildCategory && c.name === categoryName) as CategoryChannel;
                            }

                            if (!category) {
                                try {
                                    category = await guild.channels.create({
                                        name: categoryName,
                                        type: ChannelType.GuildCategory
                                    });
                                    this.settings.setOutputCategoryId(guildId, category.id);
                                } catch (error) {
                                    console.error('カテゴリの作成に失敗しました:', error);
                                }
                            }

                            if (!targetChannel) {
                                // 作成する
                                targetChannel = await guild.channels.create({
                                    name: 'inputfolder',
                                    type: ChannelType.GuildText,
                                    topic: 'ZIP作成用のファイル入力',
                                    parent: category?.id
                                });
                                await interaction.reply({ content: `❌ \`inputfolder\` が見つからなかったため自動作成しました。\nこちらでコマンドを実行してください: ${targetChannel}`, ephemeral: true });
                                return;
                            }
                        } catch (error) {
                            console.error('inputfolder の検索または作成に失敗しました:', error);
                            await interaction.reply({ content: `❌ \`inputfolder\` 以外では実行できません。また、チャンネルの自動作成に失敗しました。\n権限を確認してください。`, ephemeral: true });
                            return;
                        }
                    }

                    // チャンネルは存在するが、現在のチャンネルではない場合
                    await interaction.reply({ content: `❌ このコマンドは \`inputfolder\` でのみ実行できます。\nこちらに移動してください: ${targetChannel}`, ephemeral: true });
                    return;
                }

                await interaction.deferReply({ ephemeral: true });
                console.log(`[${guildId}] 手動ZIP作成がトリガーされました。`);

                // 過去200件のメッセージをスキャン
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

                        // デバッグ: すべての添付ファイルをログ出力
                        if (msg.attachments.size > 0) {
                            console.log(`[デバッグ] メッセージ ${msg.id} には ${msg.attachments.size} 個の添付ファイルがあります:`);
                            msg.attachments.forEach((att: Attachment) => {
                                console.log(`  - 名前: "${att.name}" | URL: ${att.url.substring(0, 50)}...`);
                            });
                        }

                        const jarAttachments = msg.attachments.filter((att: Attachment) => {
                            const name = att.name || '';
                            const isJar = name.toLowerCase().endsWith('.jar');
                            console.log(`[デバッグ] 確認中: "${name}" -> isJar: ${isJar}`);
                            return isJar;
                        });
                        if (jarAttachments.size > 0) {
                            console.log(`[デバッグ] メッセージ ${msg.id} に ${jarAttachments.size} 個の .jar ファイルが見つかりました`);
                            jarAttachments.forEach((att: Attachment) => {
                                const originalName = getOriginalFilename(msg.content, att.name);
                                collector.handleFileEvent(guildId, msg, att, originalName);
                            });
                            processedCount += jarAttachments.size;
                        }
                    }

                    // ページネーションを進めるために lastId を更新
                    const lastMsg = messages.last();
                    if (lastMsg) lastId = lastMsg.id;

                    fetchedCount += messages.size;
                }

                // ファイルが見つかったか確認
                const pendingFiles = collector.getPendingFiles(guildId);
                if (pendingFiles.length === 0) {
                    await interaction.editReply({ content: '❌ チャット内に該当するファイルが見つかりませんでした。' });
                    return;
                }

                // 強制処理
                await interaction.editReply({ content: '現在アップロード作業中です...' });
                await collector.forceProcess(guildId);
                await interaction.editReply({ content: `✅ アップロード完了。出力チャンネルを確認してください。` });
            }

            else if (commandName === 'folderlist') {
                // 1. 古いメッセージを削除
                const lastMsgId = this.settings.getLastFolderListMessageId(guildId);
                if (lastMsgId && interaction.channel) {
                    try {
                        const oldMsg = await interaction.channel.messages.fetch(lastMsgId);
                        if (oldMsg) await oldMsg.delete();
                    } catch (e) { /* 削除済みなら無視 */ }
                }

                // 2. ファイルを取得
                const files = collector.getPendingFiles(guildId);
                let content = '**📂 保留中のファイル (現在のバッチ):**\n';
                if (files.length === 0) {
                    content += '(待機中のファイルはありません)';
                } else {
                    content += files.map(f => `・[${f.filename}](${f.messageUrl}) ${f.isReplacement ? '(更新)' : ''}`).join('\n');
                }

                // 3. 新しいメッセージを送信
                await interaction.reply({ content });
                const reply = await interaction.fetchReply();
                this.settings.setLastFolderListMessageId(guildId, reply.id);
            }
        });

        // メッセージの処理 (ファイル収集)
        this.client.on('messageCreate', async (message: Message) => {
            if (message.author.bot || !message.guildId) return;

            const guildId = message.guildId;

            if ((message.channel as any).name === 'inputfolder') {
                // デバッグ: 受信メッセージの添付ファイルをログ出力
                if (message.attachments.size > 0) {
                    console.log(`[デバッグ][messageCreate] 新しいメッセージに ${message.attachments.size} 個の添付ファイルがあります:`);
                    message.attachments.forEach((att: Attachment) => {
                        console.log(`  - 名前: "${att.name}" | URL: ${att.url.substring(0, 50)}...`);
                    });
                }

                // 1. ファイルアップロード (.jar) の確認
                const jarAttachments = message.attachments.filter((att: Attachment) => {
                    const name = att.name || '';
                    const isJar = name.toLowerCase().endsWith('.jar');
                    console.log(`[デバッグ][messageCreate] 確認中: "${name}" -> isJar: ${isJar}`);
                    return isJar;
                });

                if (jarAttachments.size > 0) {
                    console.log(`[デバッグ][messageCreate] ${jarAttachments.size} 個の .jar ファイルをコレクターに追加します`);
                    jarAttachments.forEach((att: Attachment) => {
                        const originalName = getOriginalFilename(message.content, att.name);
                        collector.handleFileEvent(guildId, message, att, originalName);
                    });
                }

                // 2. キャンセルの確認 (リプライ)
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
                .setDescription('inputfolder内の最新200件のメッセージをスキャンし、即座にアップロードします。')
                .toJSON(),
            new SlashCommandBuilder()
                .setName('folderlist')
                .setDescription('現在保留中のファイル一覧を表示します。')
                .toJSON(),
        ];

        const rest = new REST({ version: '10' }).setToken(config.DISCORD_TOKEN);

        try {
            console.log('アプリケーション (/) コマンドのリフレッシュを開始しました。');
            if (this.client.application) {
                await rest.put(
                    Routes.applicationCommands(this.client.application.id),
                    { body: commands },
                );
                console.log('アプリケーション (/) コマンドの再読み込みに成功しました。');
            }
        } catch (error) {
            console.error(error);
        }
    }

    public async login(token: string): Promise<void> {
        try {
            await this.client.login(token);
        } catch (error) {
            console.error('ログインに失敗しました:', error);
            throw error;
        }
    }
}
