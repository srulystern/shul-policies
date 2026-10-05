import { checkAuth, authRole } from './_auth.js';
import { getSendLog, setLogArchived, deleteLog, getScheduled, deleteScheduled, updateScheduled } from './_store.js';
import { settleCosts } from './_costs.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (!(await checkAuth(req))) return res.status(401).json({ ok: false, error: 'Not authorized' });

  if (req.method === 'GET') {
    // Look up the cost of recent texts on Twilio (a few each time the page opens)
    try { await settleCosts(80); } catch (e) {}
    const log = (await getSendLog()).map(({ pend, ...x }) => ({ ...x, pending: Array.isArray(pend) ? pend.length : 0 }));
    const scheduled = (await getScheduled()).sort((a, b) => a.runAt - b.runAt);
    return res.status(200).json({
      ok: true,
      history: log.filter(x => !x.archived),
      archive: log.filter(x => x.archived),
      scheduled,
    });
  }

  if (req.method === 'POST') {
    const { action, id, archived } = req.body || {};
    if (action === 'archive') {
      const r = await setLogArchived(id, true);
      return res.status(r.ok ? 200 : 400).json(r);
    }
    if (action === 'unarchive') {
      const r = await setLogArchived(id, false);
      return res.status(r.ok ? 200 : 400).json(r);
    }
    if (action === 'delete') {
      const r = await deleteLog(id);
      return res.status(200).json(r);
    }
    if (action === 'cancelScheduled') {
      const r = await deleteScheduled(id);
      return res.status(200).json(r);
    }
    if (action === 'editScheduled') {
      const { message, runAt } = req.body || {};
      if (runAt && Number(runAt) < Date.now() - 60000) return res.status(400).json({ ok: false, error: 'That time is in the past.' });
      const r = await updateScheduled(id, { message, runAt });
      return res.status(r.ok ? 200 : 400).json(r);
    }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  }

  return res.status(405).json({ ok: false });
}
