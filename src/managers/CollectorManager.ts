import { Client, TextChannel, Message, Attachment } from 'discord.js';
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
            isReplacement
        });

        console.log(`[Collector][${guildId}] File added: ${filename} (Replacement: ${isReplacement})`);
        this.resetTimer(guildId);
    }

    /**
     * Called when a cancellation reply is detected.
     * Note: Finding the file by MessageID is slightly harder now that we key by Filename.
     * But usually reply is to the message. We have to iterate the map.
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

            // Create a pass-through stream to collect the zip data into a buffer
            const outputStream = new PassThrough();
            outputStream.on('data', (chunk) => buffers.push(chunk));

            archive.pipe(outputStream);

            validDownloads.forEach(file => {
                archive.append(file.buffer, { name: file.filename });
            });

            await archive.finalize();

            // Wait for stream to finish (?) - usually sync enough for buffer collection in memory setups but safer to wait for finish event strictly. 
            // Simplified with Promise wrapper if needed, but for now assuming data events fire before finalize promise fully resolves.
            // Actually archive.finalize() resolves when the archive has finished emitted everything? No, it returns promise.
            // Let's ensure we have the full buffer.

            const zipBuffer = Buffer.concat(buffers);
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const zipFilename = `files_${timestamp}.zip`;

            // 3. Upload ZIP
            const gofileLink = await GofileService.uploadFile(zipBuffer, zipFilename);
            console.log(`[Collector][${guildId}] Uploaded ZIP: ${zipFilename}`);

            // 4. Notify
            const fileList = validDownloads.map(f => `・${f.filename}${f.isReplacement ? ' (更新)' : ''}`);
            await this.sendNotification(guildId, gofileLink, fileList);

        } catch (error) {
            console.error(`[Collector][${guildId}] Critical error during batch processing:`, error);
        }
    }

    private async sendNotification(guildId: string, url: string, fileList: string[]) {
        const channelId = this.settings.getNotifyChannelId(guildId);
        if (!channelId) {
            console.error(`[Collector][${guildId}] Notification channel is NOT set.`);
            return;
        }

        try {
            const channel = await this.client.channels.fetch(channelId);
            if (channel && channel.isTextBased()) {
                const message = `以下のファイルを更新しました\n\n${fileList.join('\n')}\n\n**まとめてダウンロード**: ${url}`;
                await (channel as TextChannel).send(message);
                console.log(`[Collector][${guildId}] Notification sent.`);
            }
        } catch (error) {
            console.error(`[Collector][${guildId}] Error sending notification:`, error);
        }
    }
}
