import twilio from 'twilio';
import { checkAuth, authRole } from './_auth.js';
import { getReplies, addReply, deleteReplyThread, normalizePhone, getHandled, markHandled } from './_store.js';
import { getSettings, withGabbaiPrefix } from './_settings.js';

export default async function handler(req, res) {
  if (!(await checkAuth(req))) return res.status(401).json({ ok: false, error: 'Not authorized' });

  if (req.method === 'GET') {
    const replies = await getReplies();
    const handled = await getHandled();
    return res.status(200).json({ ok: true, replies, handled });
  }

  if (req.method === 'POST') {
    const { action, phone, message } = req.body || {};
    if (action === 'send') {
      const to = normalizePhone(phone);
      const text = (message || '').trim();
      if (!to || !text) return res.status(400).json({ ok: false, error: 'Write a message first.' });
      const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
      const ms = process.env.TWILIO_MESSAGING_SERVICE_SID;
      if (!sid || !token || !ms) return res.status(400).json({ ok: false, error: 'Twilio is not configured yet.' });
      let msgSid = null;
      try {
        const S = await getSettings();
        const m = await twilio(sid, token).messages.create({ messagingServiceSid: ms, to, body: withGabbaiPrefix(S, text) });
        msgSid = m && m.sid;
      } catch (e) {
        return res.status(400).json({ ok: false, error: 'Not sent: ' + e.message });
      }
      await addReply(to, text, 'out', await authRole(req), msgSid);
      return res.status(200).json({ ok: true });
    }
    if (action === 'handled') {
      return res.status(200).json(await markHandled(phone));
    }
    if (action === 'deleteThread') {
      return res.status(200).json(await deleteReplyThread(phone));
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  }

  return res.status(405).json({ ok: false });
}
