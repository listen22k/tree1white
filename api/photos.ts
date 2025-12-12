import { list, del } from '@vercel/blob';
import { IncomingMessage, ServerResponse } from 'http';

export const config = {
    runtime: 'nodejs',
};

// Helper to parse JSON body in Node.js
const parseBody = async (req: IncomingMessage) => {
    return new Promise<any>((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(e);
            }
        });
        req.on('error', reject);
    });
};

export default async function handler(request: IncomingMessage, response: ServerResponse) {
    // Helper for JSON response
    const json = (data: any, status = 200) => {
        response.statusCode = status;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(data));
    };

    try {
        if (request.method === 'DELETE') {
            const body = await parseBody(request);
            const url = body.url;
            if (!url) {
                return json({ error: 'Missing url' }, 400);
            }
            await del(url);
            return json({ success: true });
        }

        // GET
        const { blobs } = await list({ prefix: 'tree1/' });
        // Filter out the directory itself and ensure only images are returned
        const imageBlobs = blobs.filter(blob =>
            !blob.url.endsWith('/') &&
            /\.(jpg|jpeg|png|gif|webp)$/i.test(blob.pathname)
        );
        return json(imageBlobs.map(blob => blob.url));

    } catch (error) {
        console.error(error);
        return json({ error: 'Internal Server Error' }, 500);
    }
}
