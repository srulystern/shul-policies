import { checkAuth, authRole } from './_auth.js';
import { getCall, startCall, stopCall, confirmCall, total, getActiveCall } from './_minyan.js';
import { getContacts } from './_store.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!(await checkAuth(req))) return res.status(401).json({ ok: false, error: 'Not authorized' });

  if (req.method === 'GET') {
    const c = await getCall();
    // Show the last count if it's still open or started in the last 18 hours
    if (!c || Date.now() - c.startedAt > 18 * 3600000) return res.status(200).json({ ok: true, call: null });
    const names = Object.fromEntries((await getContacts()).map(x => [x.phone, x.name]));
    const list = Object.entries(c.responses || {}).map(([phone, r]) => ({ phone, name: names[phone] || 'Member', count: r.count, at: r.at }))
      .sort((a, b) => a.at - b.at);
    const open = !!(await getActiveCall());
    return res.status(200).json({ ok: true, call: { active: open, tefila: c.tefila || 'Mincha', when: c.when || 'today', goal: c.goal, total: total(c), asked: c.phones.length,
      confirmedAt: c.confirmedAt, startedAt: c.startedAt, list } });
  }

  if (req.method === 'POST') {
    const { action, groupId, tefila, date } = req.body || {};
    const by = await authRole(req);
    if (action === 'start') {
      // Only one count at a time - starting a new one closes the old one
      if (await getActiveCall()) await stopCall();
      const r = await startCall({ groupId, by, tefila, date });
      return res.status(r.ok ? 200 : 400).json(r);
    }
    if (action === 'stop') return res.status(200).json(await stopCall());
    if (action === 'confirmNow') {
      const c = await getActiveCall();
      if (!c) return res.status(400).json({ ok: false, error: 'No count is running.' });
      const sent = await confirmCall(c, by);
      return res.status(200).json({ ok: true, sent });
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  }
  return res.status(405).json({ ok: false });
}
