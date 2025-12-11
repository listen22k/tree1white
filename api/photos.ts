import { list, del } from '@vercel/blob';

export const config = {
    runtime: 'nodejs',
};

export default async function handler(request: Request) {
    if (request.method === 'DELETE') {
        const body = await request.json();
        const url = body.url;
        if (!url) {
            return new Response('Missing url', { status: 400 });
        }
        await del(url);
        return Response.json({ success: true });
    }

    const { blobs } = await list();
    return Response.json(blobs.map(blob => blob.url));
}
