// Accepts an image and stores it in Vercel Blob, returning a public URL for MMS.
import { checkAuth } from './_auth.js';
import { put } from '@vercel/blob';

export const config = { api: { bodyParser: { sizeLimit: '6mb' } } };

export default async function handler(req, res) {
  if (!(await checkAuth(req))) return res.status(401).json({ ok: false, error: 'Not authorized' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Image storage not set up. Add Vercel Blob to enable photos.' });
  }

  const { dataUrl, filename } = req.body || {};
  if (!dataUrl || !dataUrl.startsWith('data:')) {
    return res.status(400).json({ ok: false, error: 'No image provided.' });
  }

  try {
    const m = dataUrl.match(/^data:(.+?);base64,(.*)$/);
    if (!m) return res.status(400).json({ ok: false, error: 'Bad image format.' });
    const contentType = m[1];
    const buffer = Buffer.from(m[2], 'base64');
    const safe = (filename || 'image').replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `mms/${Date.now()}-${safe}`;
    const blob = await put(key, buffer, { access: 'public', contentType });
    return res.status(200).json({ ok: true, url: blob.url });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Upload failed: ' + e.message });
  }
}
