import { checkAuth } from './_auth.js';
import { getGroups, addGroup, renameGroup, removeGroup, setContactGroups } from './_store.js';

export default async function handler(req, res) {
  if (!(await checkAuth(req))) return res.status(401).json({ ok: false, error: 'Not authorized' });

  if (req.method === 'GET') {
    const groups = await getGroups();
    return res.status(200).json({ ok: true, groups });
  }

  if (req.method === 'POST') {
    // Any signed-in user (gabbai or admin) can manage groups.
    const { action, id, name, phone, groupIds } = req.body || {};
    if (action === 'add')    { const r = await addGroup(name);           return res.status(r.ok ? 200 : 400).json(r); }
    if (action === 'rename') { const r = await renameGroup(id, name);    return res.status(r.ok ? 200 : 400).json(r); }
    if (action === 'remove') { const r = await removeGroup(id);          return res.status(200).json(r); }
    if (action === 'setMemberGroups') { const r = await setContactGroups(phone, groupIds || []); return res.status(r.ok ? 200 : 400).json(r); }
    return res.status(400).json({ ok: false, error: 'Unknown action' });
  }

  return res.status(405).json({ ok: false });
}
