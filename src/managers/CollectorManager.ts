import { Client, TextChannel, Message, Attachment, ChannelType, CategoryChannel } from 'discord.js';
import { config } from '../config';
import { GofileService } from '../services/GofileService';
import { SettingsManager } from './SettingsManager';
import axios from 'axios';
import archiver from 'archiver';
import { PassThrough } from 'stream';

interface PendantFile {
    messageId: string;
    filename: string;
    url: string; // Discord attachment URL
    username: string;
    messageUrl: string; // Link to original message
    isReplacement?: boolean;
}

export class CollectorManager {
    private client: Client;
    private settings: SettingsManager;

    // Key: Guild ID -> Map<Filename, PendantFile> (Filename based deduplication)
    private pendingFiles: Map<string, Map<string, PendantFile>> = new Map();
    // Key: Guild ID -> Timer
    private timers: Map<string, NodeJS.Timeout> = new Map();

    constructor(client: Client, settings: SettingsManager) {
        this.client = client;
        this.settings = settings;
    }

    /**
     * Called when a valid file is posted in the monitored channel.
     */
    public handleFileEvent(guildId: string, message: Message, attachment: Attachment) {
        if (!this.pendingFiles.has(guildId)) {
            this.pendingFiles.set(guildId, new Map());
        }

        const guildFiles = this.pendingFiles.get(guildId)!;
        const filename = attachment.name;

        // Check for duplicate
        const isReplacement = guildFiles.has(filename);

        guildFiles.set(filename, {
            messageId: message.id,
            filename: filename,
            url: attachment.url,
            username: message.author.username,
            messageUrl: message.url,
            isReplacement
        });

        console.log(`[Collector][${guildId}] File added: ${filename} (Replacement: ${isReplacement})`);
        this.resetTimer(guildId);
    }

    /**
     * Called when a cancellation reply is detected.
     */
    public handleCancelEvent(guildId: string, targetMessageId: string) {
        const guildFiles = this.pendingFiles.get(guildId);
        if (!guildFiles) return;

        let foundFilename: string | undefined;

        for (const [filename, fileUrl] of guildFiles.entries()) {
            if (fileUrl.messageId === targetMessageId) {
                foundFilename = filename;
                break;
            }
        }

        if (foundFilename) {
            guildFiles.delete(foundFilename);
            console.log(`[Collector][${guildId}] File cancelled: ${foundFilename}`);
            // Reset timer for this guild
            this.resetTimer(guildId);
        }
    }

    /**
     * Returns the list of currently pending files for a guild.
     */
    public getPendingFiles(guildId: string): PendantFile[] {
        const guildFiles = this.pendingFiles.get(guildId);
        if (!guildFiles) return [];
        return Array.from(guildFiles.values());
    }

    private resetTimer(guildId: string) {
        const existingTimer = this.timers.get(guildId);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        console.log(`[Collector][${guildId}] Timer reset. Waiting ${config.UPLOAD.BATCH_WAIT_MS}ms...`);
        const newTimer = setTimeout(() => {
            this.processBatch(guildId);
        }, config.UPLOAD.BATCH_WAIT_MS);

        this.timers.set(guildId, newTimer);
    }

    private async processBatch(guildId: string) {
        const guildFiles = this.pendingFiles.get(guildId);
        if (!guildFiles || guildFiles.size === 0) return;

        console.log(`[Collector][${guildId}] Processing batch: ${guildFiles.size} files.`);

        const filesToProcess = Array.from(guildFiles.values());
        guildFiles.clear();
        this.timers.delete(guildId);

        try {
            // 1. Download all files
            const downloads = await Promise.all(filesToProcess.map(async (file) => {
                try {
                    const response = await axios.get(file.url, { responseType: 'arraybuffer' });
                    return {
                        buffer: Buffer.from(response.data),
                        filename: file.filename,
                        isReplacement: file.isReplacement
                    };
                } catch (e) {
                    console.error(`Failed to download ${file.filename}`, e);
                    return null;
                }
            }));

            const validDownloads = downloads.filter(d => d !== null) as { buffer: Buffer, filename: string, isReplacement?: boolean }[];

            if (validDownloads.length === 0) return;

            // 2. Archive to ZIP
            const archive = archiver('zip', { zlib: { level: 9 } });
            const buffers: Buffer[] = [];

            const outputStream = new PassThrough();
            outputStream.on('data', (chunk) => buffers.push(chunk));

            archive.pipe(outputStream);

            validDownloads.forEach(file => {
                archive.append(file.buffer, { name: file.filename });
            });

            await archive.finalize();

            const zipBuffer = Buffer.concat(buffers);
            const now = new Date();
            const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const zipFilename = `files_${timestamp}.zip`;

            // 3. Upload ZIP
            const gofileLink = await GofileService.uploadFile(zipBuffer, zipFilename);
            console.log(`[Collector][${guildId}] Uploaded ZIP: ${zipFilename}`);

            // 4. Create Channel & Notify
            const fileList = validDownloads.map(f => `・${f.filename}${f.isReplacement ? ' (更新)' : ''}`);
            await this.sendNotificationInNewChannel(guildId, gofileLink, fileList, now);

        } catch (error) {
            console.error(`[Collector][${guildId}] Critical error during batch processing:`, error);
        }
    }

    private async sendNotificationInNewChannel(guildId: string, url: string, fileList: string[], date: Date) {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return;

        // 1. Get or Create Category
        let categoryId = this.settings.getOutputCategoryId(guildId);
        let category: CategoryChannel | null = null;

        if (categoryId) {
            try {
                const chan = await guild.channels.fetch(categoryId);
                if (chan && chan.type === ChannelType.GuildCategory) {
                    category = chan as CategoryChannel;
                }
            } catch (e) { console.warn('Category fetch failed, will try create'); }
        }

        if (!category) {
            try {
                category = await guild.channels.create({
                    name: 'File Manager Output',
                    type: ChannelType.GuildCategory
                });
                this.settings.setOutputCategoryId(guildId, category.id);
                console.log(`[Collector][${guildId}] Created new category: ${category.name}`);
            } catch (e) {
                console.error(`[Collector][${guildId}] Failed to create category:`, e);
                return; // Cannot proceed without permissions?
            }
        }

        // 2. Delete Old Channel
        const lastChannelId = this.settings.getLastOutputChannelId(guildId);
        if (lastChannelId) {
            try {
                const oldChannel = await guild.channels.fetch(lastChannelId);
                if (oldChannel) {
                    await oldChannel.delete();
                    console.log(`[Collector][${guildId}] Deleted old channel: ${oldChannel.name}`);
                }
            } catch (e) {
                console.warn(`[Collector][${guildId}] Failed to delete old channel (maybe already gone):`, e);
            }
        }

        // 3. Create New Channel
        // Format: アウトプットチャンネル-YYYYMMDDHHmmss
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        const min = String(date.getMinutes()).padStart(2, '0');
        const sec = String(date.getSeconds()).padStart(2, '0');

        const channelName = `アウトプットチャンネル-${year}${month}${day}${hour}${min}${sec}`;

        try {
            const newChannel = await guild.channels.create({
                name: channelName,
                type: ChannelType.GuildText,
                parent: category.id
            });
            this.settings.setLastOutputChannelId(guildId, newChannel.id);

            // 4. Send Message
            const message = `以下のファイルを更新しました\n\n${fileList.join('\n')}\n\n**まとめてダウンロード**: ${url}`;
            await newChannel.send(message);
            console.log(`[Collector][${guildId}] Created new channel and sent notification: ${newChannel.name}`);

        } catch (e) {
            console.error(`[Collector][${guildId}] Failed to create output channel:`, e);
        }
    }
}
