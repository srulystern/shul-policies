import { roleForPassword } from './_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const { password } = req.body || {};
  const role = await roleForPassword(password);
  if (role) return res.status(200).json({ ok: true, role });
  return res.status(401).json({ ok: false, error: 'Wrong password.' });
}
