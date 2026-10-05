import { checkAuth } from './_auth.js';
import { getContacts, addContact, removeContact, removeContacts, updateContactName, bulkAddContacts, normalizePhone, markAskedName, clearFailFlag, addSendLog } from './_store.js';
import { getSettings } from './_settings.js';
import { sendMany, sendManyDetailed } from './_minyan.js';
import { hasRealName, dropNameAsk } from './_names.js';
import { settleCosts } from './_costs.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!(await checkAuth(req))) return res.status(401).json({ ok: false, error: 'Not authorized' });

  // Anyone signed in can view the list
  if (req.method === 'GET') {
    // Check a few recent texts for delivery failures, so the "texts failing" flag is up to date
    try { await settleCosts(30); } catch (e) {}
    const list = await getContacts();
    return res.status(200).json({ ok: true, contacts: list });
  }

  // Any signed-in user (gabbai or admin) can change the list
  if (req.method === 'POST') {
    const { action, name, phone, phones, rows } = req.body || {};

    if (action === 'add') {
      const r = await addContact(name, phone);
      // New member added by hand -> send them the welcome (JOIN) text
      if (r.ok) {
        try {
          const S = await getSettings();
          const to = normalizePhone(phone);
          const txt = hasRealName(name) ? dropNameAsk(S.joinText) : S.joinText;
          if (to && txt) r.welcomed = (await sendMany([to], txt)) === 1;
        } catch (e) { r.welcomed = false; }
      }
      return res.status(r.ok ? 200 : 400).json(r);
    }
    if (action === 'askName') {
      // Text members with no name, asking for their name. Their next text is saved as their name.
      const S = await getSettings();
      const wanted = new Set((phones || []).map(normalizePhone));
      const targets = (await getContacts()).filter(c => wanted.has(c.phone) && !hasRealName(c.name)).map(c => c.phone);
      if (!targets.length) return res.status(400).json({ ok: false, error: 'Everyone picked already has a name.' });
      const r = await sendManyDetailed(targets, S.askNameText);
      await markAskedName(targets);
      await addSendLog({ message: S.askNameText, mediaUrl: null, hadImage: false, sent: r.sent, failedCount: targets.length - r.sent,
        total: targets.length, scope: 'selected', scopeLabel: 'Ask name', groupId: null, by: 'gabbai', pend: r.pend });
      return res.status(200).json({ ok: true, sent: r.sent, total: targets.length });
    }
    if (action === 'clearFail') {
      const r = await clearFailFlag(phone);
      return res.status(r.ok ? 200 : 400).json(r);
    }
    if (action === 'remove') {
      const r = await removeContact(phone);
      return res.status(200).json({ ok: true, ...r });
    }
    if (action === 'removeMany') {
      const r = await removeContacts(phones || []);
      return res.status(200).json({ ok: true, ...r });
    }
    if (action === 'rename') {
      const r = await updateContactName(phone, name);
      return res.status(r.ok ? 200 : 400).json(r);
    }
    if (action === 'bulk') {
      const r = await bulkAddContacts(rows || []);
      return res.status(200).json({ ok: true, ...r });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  }

  return res.status(405).json({ ok: false });
}
