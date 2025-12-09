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

export class GofileService {
    // Current working endpoint for anonymous uploads
    private static UPLOAD_SERVER = 'store1';

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

            // Using store1 directly as getServer is deprecated/unreliable
            const uploadUrl = `https://${this.UPLOAD_SERVER}.gofile.io/uploadFile`;

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
