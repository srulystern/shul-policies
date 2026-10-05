// Runs on a schedule (Vercel Cron) to fire any due scheduled messages.
import { popDueScheduled } from './_store.js';
import { performSend } from './_send.js';
import { autoRunIfDue } from './_minyan.js';
import { settleCosts } from './_costs.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // Vercel Cron sends a bearer token if CRON_SECRET is set; accept it or an internal call.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${secret}`) return res.status(401).json({ ok: false });
  }

  const now = Date.now();
  const due = await popDueScheduled(now);
  const results = [];
  for (const job of due) {
    try {
      const r = await performSend(job);
      results.push({ id: job.id, ok: r.ok, sent: r.sent || 0 });
    } catch (e) {
      results.push({ id: job.id, ok: false, error: e.message });
    }
  }
  let minyan = null;
  try { minyan = await autoRunIfDue(); } catch (e) { minyan = { ran: false, error: e.message }; }

  // Catch up on text costs + failed-text flags
  let costs = null;
  try { costs = await settleCosts(250); } catch (e) { costs = { error: e.message }; }

  return res.status(200).json({ ok: true, fired: results.length, results, minyan, costs });
}
