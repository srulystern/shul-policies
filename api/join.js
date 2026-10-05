// Public signup form (shul-texts.vercel.app/join). No password needed.
import twilio from 'twilio';
import { getContacts, saveContacts, normalizePhone } from './_store.js';
import { getSettings } from './_settings.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { name, phone, consent, website } = req.body || {};
  if (website) return res.status(200).json({ ok: true }); // spam trap
  if (!consent) return res.status(400).json({ ok: false, error: 'Please check the box to agree to receive texts.' });
  const p = normalizePhone(phone);
  if (!p || p.length !== 12) return res.status(400).json({ ok: false, error: 'Please enter a valid 10-digit phone number.' });

  const list = await getContacts();
  let c = list.find(x => x.phone === p);
  if (!c) { c = { name: (name || '').trim() || 'Member', phone: p, groups: [] }; list.push(c); }
  else if (name && name.trim()) c.name = name.trim();
  c.optIn = { via: 'web form', at: Date.now() };
  await saveContacts(list);

  try {
    const S = await getSettings();
    await twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN).messages.create({
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID, to: p, body: S.joinText,
    });
  } catch (e) { /* signup still saved */ }

  return res.status(200).json({ ok: true });
}
