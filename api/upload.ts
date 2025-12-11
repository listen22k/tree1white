import { put } from '@vercel/blob';
import { IncomingMessage, ServerResponse } from 'http';

export const config = {
    runtime: 'nodejs',
};

export default async function upload(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== 'POST') {
        response.statusCode = 405;
        response.end('Method Not Allowed');
        return;
    }

    const filename = request.headers['x-filename'] as string || 'uploaded-file';

    try {
        // request is a Readable stream, so we can pass it directly to put
        const blob = await put(filename, request, {
            access: 'public',
            addRandomSuffix: true // Ensure uniqueness
        });

        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(blob));
    } catch (error) {
        console.error(error);
        response.statusCode = 500;
        response.end(JSON.stringify({ error: 'Upload failed' }));
    }
}
