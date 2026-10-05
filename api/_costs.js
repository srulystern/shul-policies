// Looks up on Twilio what each sent text cost (segments = "credits", and $),
// and whether it was delivered. Failed texts are counted on the member (Members tab flag).
// Not an API route (starts with _), so it does not count toward Vercel's 12-function limit.
import twilio from 'twilio';
import { getSendLog, saveSendLog, getReplies, saveReplies, recordDelivery } from './_store.js';

const FAIL = ['failed', 'undelivered'];
const DONE = ['delivered', 'failed', 'undelivered', 'received', 'read', 'canceled'];
const GIVE_UP_MS = 3 * 24 * 3600000; // stop checking a text after 3 days

function client() {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  return sid && token ? twilio(sid, token) : null;
}

// Look up one message. Returns { segs, usd, final, failed, delivered, error } or null if Twilio can't be reached.
async function lookup(cl, sid, sentAt) {
  try {
    const m = await cl.messages(sid).fetch();
    const segs = parseInt(m.numSegments, 10) || 0;
    const hasPrice = m.price !== null && m.price !== undefined && m.price !== '';
    const usd = hasPrice ? Math.abs(parseFloat(m.price)) || 0 : 0;
    const status = String(m.status || '');
    return {
      segs, usd, hasPrice,
      // done when it failed, or when it has a price and a final status
      // (some carriers never report "delivered" - after 6 hours "sent" counts as done)
      final: FAIL.includes(status) || (hasPrice && (DONE.includes(status) || (status === 'sent' && Date.now() - sentAt > 6 * 3600000))),
      failed: FAIL.includes(status),
      delivered: status === 'delivered',
      error: m.errorCode ? 'Error ' + m.errorCode + (m.errorMessage ? ': ' + m.errorMessage : '') : status,
    };
  } catch (e) {
    if (e && e.status === 404) return { segs: 0, usd: 0, final: true, failed: false, delivered: false, gone: true };
    return null;
  }
}

async function inBatches(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
}

// Check up to `budget` messages that are still waiting for their cost. Safe to call often.
export async function settleCosts(budget = 60) {
  const cl = client();
  if (!cl) return { checked: 0 };
  const now = Date.now();
  let left = budget, checked = 0;
  const deliveries = [];

  // 1) History (Send tab + minyan texts)
  const log = await getSendLog();
  let logChanged = false;
  for (const row of log) {
    if (left <= 0) break;
    if (!Array.isArray(row.pend) || !row.pend.length) continue;
    if (now - row.at < 45000) continue; // give Twilio a moment
    if (now - row.at > GIVE_UP_MS) { row.pend = []; row.costDone = true; logChanged = true; continue; }
    const batch = row.pend.slice(0, left);
    left -= batch.length;
    const res = await inBatches(batch, 10, ([sid]) => lookup(cl, sid, row.at));
    const still = [];
    batch.forEach(([sid, phone], i) => {
      const r = res[i];
      checked++;
      if (!r) { still.push([sid, phone]); return; }
      if (!r.final) { still.push([sid, phone]); return; }
      row.segs = (row.segs || 0) + r.segs;
      row.usd = Math.round(((row.usd || 0) + r.usd) * 100000) / 100000;
      if (r.failed) { row.lateFailed = (row.lateFailed || 0) + 1; deliveries.push({ phone, failed: true, error: r.error }); }
      else if (r.delivered) deliveries.push({ phone, failed: false });
    });
    row.pend = still.concat(row.pend.slice(batch.length));
    if (!row.pend.length) row.costDone = true;
    logChanged = true;
  }
  if (logChanged) await saveSendLog(log);

  // 2) Answers sent from the Replies tab / gabbai's phone
  if (left > 0) {
    const replies = await getReplies();
    let rChanged = false;
    for (const e of replies) {
      if (left <= 0) break;
      if (!e.sid || e.costDone || e.dir !== 'out') continue;
      if (now - e.at < 45000) continue;
      if (now - e.at > GIVE_UP_MS) { e.costDone = true; rChanged = true; continue; }
      left--; checked++;
      const r = await lookup(cl, e.sid, e.at);
      if (!r || !r.final) continue;
      e.segs = r.segs; e.usd = r.usd; e.costDone = true;
      if (r.failed) { e.failed = true; deliveries.push({ phone: e.phone, failed: true, error: r.error }); }
      else if (r.delivered) deliveries.push({ phone: e.phone, failed: false });
      rChanged = true;
    }
    if (rChanged) await saveReplies(replies);
  }

  await recordDelivery(deliveries);
  return { checked };
}

// Twilio account balance, straight from Twilio's Balance API.
export async function getBalance() {
  const sid = process.env.TWILIO_ACCOUNT_SID, token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  try {
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`, {
      headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64') },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const bal = parseFloat(d.balance);
    return isNaN(bal) ? null : { balance: bal, currency: d.currency || 'USD' };
  } catch (e) { return null; }
}
