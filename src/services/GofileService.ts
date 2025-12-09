import axios from 'axios';
import FormData from 'form-data';

interface GofileServerResponse {
    status: string;
    data: {
        server: string;
    };
}

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

export class GofileService {
    private static BASE_URL = 'https://api.gofile.io';

    /**
     * Retrieves the best available server for upload.
     */
    public static async getServer(): Promise<string> {
        try {
            const response = await axios.get<GofileServerResponse>(`${this.BASE_URL}/getServer`);
            if (response.data.status === 'ok') {
                return response.data.data.server;
            }
            throw new Error('Failed to get Gofile server: Status not ok');
        } catch (error) {
            console.error('Error fetching Gofile server:', error);
            throw error;
        }
    }

    /**
     * Uploads a file buffer to Gofile.io.
     * @param buffer File content buffer
     * @param filename Filename including extension
     * @returns The download page URL
     */
    public static async uploadFile(buffer: Buffer, filename: string): Promise<string> {
        try {
            const server = await this.getServer();
            const form = new FormData();
            form.append('file', buffer, filename);

            const uploadUrl = `https://${server}.gofile.io/uploadFile`;

            // Note: maxContentLength and maxBodyLength are important for large files
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
            throw new Error(`Upload failed: ${JSON.stringify(response.data)}`);
        } catch (error) {
            console.error(`Error uploading file ${filename}:`, error);
            throw error;
        }
    }
}
