import { checkAuth, authRole, setGabbaiPassword } from './_auth.js';
import { getSettings, saveSettings, TIMES_FIELDS } from './_settings.js';
import { getBalance } from './_costs.js';

export default async function handler(req, res) {
  if (!(await checkAuth(req))) return res.status(401).json({ ok: false, error: 'Not authorized' });
  if (req.method === 'GET') {
    const S = await getSettings();
    // /api/settings?balance=1 -> Twilio balance for the top of the dashboard (gabbai + admin)
    if (req.query && req.query.balance) {
      const b = await getBalance();
      if (!b) return res.status(200).json({ ok: false, error: 'Could not get the Twilio balance.' });
      // Twilio's "Available balance" = balance + credit line
      const available = Math.round((b.balance + (Number(S.creditLine) || 0)) * 100) / 100;
      return res.status(200).json({ ok: true, ...b, rawBalance: b.balance, balance: available, low: available < (Number(S.lowBalanceAt) || 0), lowAt: S.lowBalanceAt });
    }
    return res.status(200).json({ ok: true, settings: S });
  }
  if (req.method === 'POST') {
    const role = await authRole(req);
    const body = req.body || {};

    if (body.action === 'setGabbaiPassword') {
      if (role !== 'admin') return res.status(403).json({ ok: false, error: 'Admins only' });
      const r = await setGabbaiPassword(body.newPassword);
      return res.status(r.ok ? 200 : 400).json(r);
    }

    let patch = body;
    // The gabbai can only change the davening times; the admin can change everything.
    if (role !== 'admin') {
      patch = Object.fromEntries(Object.entries(patch).filter(([k]) => TIMES_FIELDS.includes(k)));
    }
    const r = await saveSettings(patch);
    return res.status(r.ok ? 200 : 400).json(r);
  }
  return res.status(405).json({ ok: false });
}
