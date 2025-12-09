import axios from 'axios';
import FormData from 'form-data';

interface GofileUploadResponse {
    status: string;
    data: {
        downloadPage: string;
        code: string;
        parentFolder: string;
        fileId: string;
        fileName: string;
        md5: string;
    };
}

interface GofileServersResponse {
    status: string;
    data: {
        servers: {
            name: string;
            zone: string;
        }[];
    };
}

export class GofileService {
    // Fallback servers if API fails
    private static FALLBACK_SERVERS = ['store1', 'store2', 'store3', 'store4', 'store5'];

    /**
     * Tries to get the best available server.
     */
    private static async getBestServer(): Promise<string> {
        try {
            const response = await axios.get<GofileServersResponse>('https://api.gofile.io/servers');
            if (response.data.status === 'ok' && response.data.data.servers.length > 0) {
                // Return the first one (usually the best one)
                return response.data.data.servers[0].name;
            }
        } catch (error) {
            console.warn('Failed to fetch Gofile servers dynamically, using fallback.', error);
        }
        // Random fallback to distribute load/avoid full servers
        return this.FALLBACK_SERVERS[Math.floor(Math.random() * this.FALLBACK_SERVERS.length)];
    }

    /**
     * Uploads a file buffer to Gofile.io.
     * @param buffer File content buffer
     * @param filename Filename including extension
     * @returns The download page URL
     */
    public static async uploadFile(buffer: Buffer, filename: string): Promise<string> {
        try {
            const form = new FormData();
            form.append('file', buffer, filename);

            const server = await this.getBestServer();
            console.log(`[Gofile] Uploading to ${server}...`);

            const uploadUrl = `https://${server}.gofile.io/uploadFile`;

            const response = await axios.post<GofileUploadResponse>(uploadUrl, form, {
                headers: {
                    ...form.getHeaders()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            if (response.data.status === 'ok') {
                return response.data.data.downloadPage;
            }
            throw new Error(`Upload failed on ${server}: ${JSON.stringify(response.data)}`);
        } catch (error) {
            console.error(`Error uploading file ${filename}:`, error);
            throw error;
        }
    }
}
