// "Who's coming to Mincha today?" - send a question, count answers, announce when there's a minyan.
import twilio from 'twilio';
import { getContacts, phonesInGroup, normalizePhone, addSendLog, getMinyanAutoLog, markMinyanAutoSent, recordDelivery } from './_store.js';
import { getSettings, todayNY } from './_settings.js';

let kv = null;
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) kv = (await import('@vercel/kv')).kv;
} catch (e) { kv = null; }
let mem = null;

export async function getCall() {
  const c = kv ? await kv.get('minyanCall') : mem;
  return c || null;
}
async function saveCall(c) { if (kv) await kv.set('minyanCall', c); else mem = c; }

const OPEN_HOURS = 18; // a count closes by itself 18 hours after it started

// Active = not stopped and not older than 18 hours
export async function getActiveCall() {
  const c = await getCall();
  return c && c.active && Date.now() - c.startedAt < OPEN_HOURS * 3600000 ? c : null;
}

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Turn a YYYY-MM-DD into "today" / "tomorrow" / a nice short date, for the {when} text.
export function whenLabel(dateStr) {
  const t = todayNY();
  if (!dateStr || dateStr === t) return 'today';
  if (dateStr === addDays(t, 1)) return 'tomorrow';
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export const TEFILOS = ['Shacharis', 'Mincha', 'Maariv'];
export function fillText(t, call, count) {
  return String(t || '').replace(/\{tefila\}/g, call.tefila || 'Mincha').replace(/\{when\}/g, call.when || 'today')
    .replace(/\{count\}/g, count ?? '').replace(/\{goal\}/g, call.goal);
}

// Send one text to many phones, 10 at a time. Returns number sent.
export async function sendMany(phones, body) {
  return (await sendManyDetailed(phones, body)).sent;
}

// Same, but also returns the Twilio message ids (for the cost lookup) and marks failures on the member.
export async function sendManyDetailed(phones, body) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const ms = process.env.TWILIO_MESSAGING_SERVICE_SID;
  let sent = 0;
  const pend = [], failed = [];
  for (let i = 0; i < phones.length; i += 10) {
    const batch = phones.slice(i, i + 10);
    const res = await Promise.allSettled(batch.map(async to => client.messages.create({ messagingServiceSid: ms, to, body })));
    res.forEach((r, j) => {
      if (r.status === 'fulfilled') { sent++; if (r.value && r.value.sid) pend.push([r.value.sid, batch[j]]); }
      else failed.push({ phone: batch[j], failed: true, error: r.reason && r.reason.message });
    });
  }
  try { await recordDelivery(failed); } catch (e) {}
  return { sent, pend, failedCount: failed.length };
}

export async function startCall({ groupId, by, tefila, date }) {
  const S = await getSettings();
  let phones;
  if (groupId) phones = (await phonesInGroup(groupId)).map(normalizePhone).filter(Boolean);
  else phones = (await getContacts()).map(c => c.phone);
  if (!phones.length) return { ok: false, error: 'No members to send to.' };
  const forDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayNY();
  const call = { date: todayNY(), forDate, active: true, startedAt: Date.now(), phones, groupId: groupId || null,
    tefila: TEFILOS.includes(tefila) ? tefila : 'Mincha', when: whenLabel(forDate),
    goal: S.minyanGoal, responses: {}, confirmedAt: null };
  const ask = fillText(S.minyanAskText, call);
  const { sent, pend } = await sendManyDetailed(phones, ask);
  await saveCall(call);
  await addSendLog({ message: ask, mediaUrl: null, hadImage: false, sent, failedCount: phones.length - sent,
    total: phones.length, scope: 'minyan', scopeLabel: call.tefila + ' minyan count', groupId: groupId || null, by: by || 'gabbai', pend });
  return { ok: true, sent, total: phones.length };
}

export async function stopCall() {
  const c = await getCall();
  if (c) { c.active = false; await saveCall(c); }
  return { ok: true };
}

export function total(call) {
  return Object.values(call.responses || {}).reduce((a, r) => a + (r.count || 0), 0);
}

export async function confirmCall(call, by) {
  const S = await getSettings();
  call.confirmedAt = Date.now();
  await saveCall(call);
  const msg = fillText(S.minyanConfirmText, call);
  const { sent, pend } = await sendManyDetailed(call.phones, msg);
  await addSendLog({ message: msg, mediaUrl: null, hadImage: false, sent, failedCount: call.phones.length - sent,
    total: call.phones.length, scope: 'minyan', scopeLabel: call.tefila + ' minyan confirmed', groupId: call.groupId, by: by || 'auto', pend });
  return sent;
}

// How many people does this answer mean? null = not a minyan answer.
export function parseAnswer(text) {
  const t = String(text || '').trim().toLowerCase().replace(/[.!]+$/, '');
  if (/^(no|not coming|can'?t|cant|0|x0)$/.test(t)) return 0;
  if (/^(me|yes|y|yeah|yep|coming|i'?m coming|im coming|x|\+1|1|me too)$/.test(t)) return 1;
  let m = t.match(/^(?:me|yes|y)?\s*(?:x|\+)\s*(\d{1,2})$/) || t.match(/^(?:me|yes|y)\s+(\d{1,2})$/) || t.match(/^(\d{1,2})$/);
  if (m) { const n = parseInt(m[1], 10); return n >= 0 && n <= 30 ? n : null; }
  return null;
}

// Called for every incoming text. Returns null if it's not a minyan answer, else { text } (text may be null = no reply).
export async function handleAnswer(from, text) {
  const call = await getActiveCall();
  if (!call || !call.phones.includes(from)) return null;
  const n = parseAnswer(text);
  if (n === null) return null;
  if (n === 0) delete call.responses[from];
  else call.responses[from] = { count: n, at: Date.now() };
  await saveCall(call);
  const S = await getSettings();
  const count = total(call);
  if (!call.confirmedAt && count >= call.goal) {
    await confirmCall(call, 'auto');
    return { text: null }; // they get the "we have a minyan" text like everyone else
  }
  if (!S.minyanSendThanks) return { text: null };
  if (n === 0) return { text: 'Thanks for letting us know.' };
  if (call.confirmedAt) return { text: 'Thanks! We have a minyan - ' + count + ' coming so far.' };
  return { text: fillText(S.minyanThanksText, call, count) };
}


// Called once a day by /api/cron. If the feature is on, nothing else is running, and today
// falls in one of the gabbai's date-range schedules, sends that count automatically (once).
export async function autoRunIfDue() {
  const S = await getSettings();
  if (!S.minyanEnabled) return { ran: false, reason: 'off' };
  if (await getActiveCall()) return { ran: false, reason: 'a count is already running' };
  const today = todayNY();
  const due = (S.minyanSchedules || []).find(x => x.startDate <= today && today <= x.endDate);
  if (!due) return { ran: false, reason: 'nothing due today' };
  const key = due.tefila + '_' + today;
  const log = await getMinyanAutoLog();
  if (log[key]) return { ran: false, reason: 'already sent today' };
  const r = await startCall({ groupId: due.groupId, by: 'auto', tefila: due.tefila, date: today });
  if (r.ok) await markMinyanAutoSent(key);
  return { ran: !!r.ok, tefila: due.tefila, result: r };
}
