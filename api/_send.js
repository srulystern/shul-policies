// Shared send logic used by both the Send API (immediate) and the cron job (scheduled).
import twilio from 'twilio';
import { getContacts, addSendLog, normalizePhone, phonesInGroup, getGroups, recordDelivery } from './_store.js';

// job = { message, mediaUrl, onlyPhones, groupId, by }
export async function performSend(job) {
  const { message, mediaUrl, onlyPhones, groupId } = job;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!sid || !token || !messagingServiceSid) {
    return { ok: false, error: 'Twilio is not configured yet.' };
  }

  const client = twilio(sid, token);
  let contacts = await getContacts();
  let scope = 'all';
  let scopeLabel = 'Everyone';

  // Group target
  if (groupId) {
    const phones = new Set((await phonesInGroup(groupId)).map(normalizePhone).filter(Boolean));
    contacts = contacts.filter(c => phones.has(c.phone));
    scope = 'group';
    const g = (await getGroups()).find(x => x.id === groupId);
    scopeLabel = g ? g.name : 'Group';
  } else if (Array.isArray(onlyPhones) && onlyPhones.length > 0) {
    const wanted = new Set(onlyPhones.map(normalizePhone).filter(Boolean));
    contacts = contacts.filter(c => wanted.has(c.phone));
    scope = 'selected';
    scopeLabel = `${contacts.length} selected`;
  }

  if (contacts.length === 0) {
    return { ok: false, error: 'No members to send to.' };
  }

  let sent = 0;
  const failed = [];
  const pend = []; // [twilio message id, phone] - cost is looked up later (api/_costs.js)
  // Send 10 at a time (faster - so a text from the gabbai's phone can send to everyone before Twilio gives up waiting)
  const txt = (message || '').trim();
  for (let i = 0; i < contacts.length; i += 10) {
    await Promise.all(contacts.slice(i, i + 10).map(async c => {
      try {
        const payload = { messagingServiceSid, to: c.phone };
        if (txt) payload.body = txt;
        if (mediaUrl) payload.mediaUrl = [mediaUrl];
        const m = await client.messages.create(payload);
        if (m && m.sid) pend.push([m.sid, c.phone]);
        sent++;
      } catch (e) {
        failed.push({ phone: c.phone, error: e.message });
      }
    }));
  }
  await recordDelivery(failed.map(f => ({ phone: f.phone, failed: true, error: f.error })));

  const logRow = await addSendLog({
    message: (message || '').trim(),
    mediaUrl: mediaUrl || null,
    hadImage: !!mediaUrl,
    sent,
    failedCount: failed.length,
    total: contacts.length,
    scope,
    scopeLabel,
    groupId: groupId || null,
    by: job.by || 'gabbai',
    pend,
  });

  return { ok: true, sent, failedCount: failed.length, failed, log: logRow };
}
