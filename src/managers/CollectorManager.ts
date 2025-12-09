import { Client, TextChannel, Message, Attachment } from 'discord.js';
import { config } from '../config';
import { GofileService } from '../services/GofileService';
import { SettingsManager } from './SettingsManager';
import axios from 'axios';

interface PendantFile {
    messageId: string;
    filename: string;
    url: string; // Discord attachment URL
    username: string;
}

export class CollectorManager {
    private client: Client;
    private settings: SettingsManager;
    private pendingFiles: Map<string, PendantFile> = new Map();
    private timer: NodeJS.Timeout | null = null;

    constructor(client: Client, settings: SettingsManager) {
        this.client = client;
        this.settings = settings;
    }

    /**
     * Called when a valid file is posted in the monitored channel.
     */
    public handleFileEvent(message: Message, attachment: Attachment) {
        this.pendingFiles.set(message.id, {
            messageId: message.id,
            filename: attachment.name,
            url: attachment.url,
            username: message.author.username
        });
        console.log(`[Collector] File added: ${attachment.name} (MsgID: ${message.id})`);
        this.resetTimer();
    }

    /**
     * Called when a cancellation reply is detected.
     */
    public handleCancelEvent(targetMessageId: string) {
        if (this.pendingFiles.has(targetMessageId)) {
            const file = this.pendingFiles.get(targetMessageId);
            this.pendingFiles.delete(targetMessageId);
            console.log(`[Collector] File cancelled: ${file?.filename} (MsgID: ${targetMessageId})`);

            // Requirement: Reset timer even on cancel
            this.resetTimer();
        } else {
            console.log(`[Collector] Cancel request for unknown or already processed message: ${targetMessageId}`);
        }
    }

    private resetTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
        }

        console.log(`[Collector] Timer reset. Waiting ${config.UPLOAD.BATCH_WAIT_MS}ms...`);
        this.timer = setTimeout(() => {
            this.processBatch();
        }, config.UPLOAD.BATCH_WAIT_MS);
    }

    private async processBatch() {
        if (this.pendingFiles.size === 0) return;

        console.log(`[Collector] Processing batch: ${this.pendingFiles.size} files.`);

        // Snapshot current files and clear main map
        const filesToProcess = Array.from(this.pendingFiles.values());
        this.pendingFiles.clear();
        this.timer = null;

        const resultLines: string[] = [];

        for (const fileItem of filesToProcess) {
            try {
                // 1. Download from Discord (temporarily)
                const response = await axios.get(fileItem.url, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data);

                // 2. Upload to Gofile
                const gofileLink = await GofileService.uploadFile(buffer, fileItem.filename);
                resultLines.push(`・${fileItem.filename}: ${gofileLink}`);
                console.log(`[Collector] Uploaded ${fileItem.filename}`);

            } catch (error) {
                console.error(`[Collector] Failed to process ${fileItem.filename}:`, error);
                resultLines.push(`・${fileItem.filename}: アップロード失敗`);
            }
        }

        // 3. Notify
        await this.sendNotification(resultLines);
    }

    private async sendNotification(lines: string[]) {
        if (lines.length === 0) return;

        const channelId = this.settings.getNotifyChannelId();
        if (!channelId) {
            console.error('[Collector] Notification channel is NOT set in settings or env.');
            return;
        }

        try {
            const channel = await this.client.channels.fetch(channelId);
            if (channel && channel.isTextBased()) {
                const message = `以下の配布ファイルを更新しました\n\n${lines.join('\n')}`;
                await (channel as TextChannel).send(message);
                console.log('[Collector] Notification sent.');
            } else {
                console.error('[Collector] Notification channel not found or not text-based');
            }
        } catch (error) {
            console.error('[Collector] Error sending notification:', error);
        }
    }
}
