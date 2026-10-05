import { checkAuth, authRole } from './_auth.js';
import { addScheduled } from './_store.js';
import { performSend } from './_send.js';
import { withSubject } from './_settings.js';

export default async function handler(req, res) {
  if (!(await checkAuth(req))) return res.status(401).json({ ok: false, error: 'Not authorized' });
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const { mediaUrl, onlyPhones, groupId, runAt, subject } = req.body || {};
  // Subject goes on the first line (only when there is a message or photo)
  const hasContent = (req.body?.message && String(req.body.message).trim()) || mediaUrl;
  const message = hasContent ? withSubject(subject, req.body?.message) : req.body?.message;
  if ((!message || !String(message).trim()) && !mediaUrl) {
    return res.status(400).json({ ok: false, error: 'Write a message or attach a photo.' });
  }

  const role = await authRole(req);

  // Scheduled: queue it, don't send now.
  if (runAt) {
    const when = Number(runAt);
    if (!when || isNaN(when)) return res.status(400).json({ ok: false, error: 'Invalid scheduled time.' });
    if (when < Date.now() - 60000) return res.status(400).json({ ok: false, error: 'That time is in the past.' });
    const row = await addScheduled({
      message: String(message || '').trim(),
      mediaUrl: mediaUrl || null,
      onlyPhones: Array.isArray(onlyPhones) ? onlyPhones : null,
      groupId: groupId || null,
      runAt: when,
      by: role,
    });
    return res.status(200).json({ ok: true, scheduled: true, runAt: when, id: row.id });
  }

  // Immediate send.
  const result = await performSend({ message, mediaUrl, onlyPhones, groupId, by: role });
  if (!result.ok) return res.status(400).json(result);
  return res.status(200).json(result);
}
