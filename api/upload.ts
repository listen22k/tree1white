import { put } from '@vercel/blob';

export const config = {
    runtime: 'nodejs',
};

export default async function upload(request: Request) {
    const form = await request.formData();
    const file = form.get('file') as File;
    const blob = await put(file.name, file, { access: 'public' });

    return Response.json(blob);
}
