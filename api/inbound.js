// Every text to the shul number comes here (Twilio webhook).
// All replies and settings come from the dashboard - nothing is set in Twilio except the number.
import twilio from 'twilio';
import { addContact, removeContact, updateContactName, addReply, findLastInbound, getContacts, normalizePhone, setPendingReply, isPendingReply, saveAskedName, setGabbaiForward, getGabbaiForward, setBroadcastPending, getBroadcastPending } from './_store.js';
import { getSettings, todayNY, withGabbaiPrefix, withSubject } from './_settings.js';
import { performSend } from './_send.js';
import { handleAnswer } from './_minyan.js';
import { hasRealName, dropNameAsk, dropJoinAsk, looksLikeName, cleanName } from './_names.js';
import { shabbosZmanimText } from './_zmanim.js';

export const config = { maxDuration: 60 };

const STOP_WORDS = ['stop', 'stopall', 'cancel', 'quit', 'unsubscribe', 'end', 'revoke', 'optout'];
const START_WORDS = ['start', 'unstop'];
const HELP_WORDS = ['help', 'info'];
// Words the gabbai can text for himself without it going to a member
const GABBAI_OWN_WORDS = ['times', 'donate', 'contact', 'join', 'yes', 'menu', 'name', ...STOP_WORDS, ...START_WORDS, ...HELP_WORDS];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('POST only');

  // Make sure the request really came from Twilio
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (token) {
    const url = 'https://' + (req.headers['x-forwarded-host'] || req.headers.host) + req.url;
    const ok = twilio.validateRequest(token, req.headers['x-twilio-signature'] || '', url, req.body || {});
    if (!ok) return res.status(403).send('Bad signature');
  }

  // Someone CALLED the shul number (voice) -> play the caller message and hang up
  if (req.body?.CallSid) {
    const S0 = await getSettings();
    res.setHeader('Content-Type', 'text/xml');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(S0.callerMessage || '')}</Say><Pause length="1"/><Say>${escapeXml(S0.callerMessage || '')}</Say><Hangup/></Response>`);
  }

  const from = normalizePhone(req.body?.From || '');
  const bodyRaw = (req.body?.Body || '').trim();
  const word = bodyRaw.toLowerCase().replace(/[.!]+$/, '');
  const S = await getSettings();
  const gabbai = normalizePhone(S.gabbaiNumber);

  const reply = (text) => {
    res.setHeader('Content-Type', 'text/xml');
    const inner = text ? `<Message>${escapeXml(text)}</Message>` : '';
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`);
  };

  // STOP / START / HELP: Twilio sends its own required reply, we just update the list
  if (STOP_WORDS.includes(word)) { await removeContact(from); return reply(null); }
  if (START_WORDS.includes(word)) { await addContact('Member', from); return reply(null); }
  if (HELP_WORDS.includes(word)) return reply(null);

  // Gabbai sends a member's message to everyone: Y -> asks to confirm -> YES ALL -> sends
  const isGabbai = !!gabbai && from === gabbai;
  const w2 = word.replace(/\s+/g, ' ');
  if (isGabbai && w2 === 'yes all') {
    const p = await getBroadcastPending();
    if (!p || !p.msg || Date.now() - p.at > 30 * 60000) {
      await setBroadcastPending(null);
      return reply('Nothing is waiting to be sent. Reply Y to a member\'s message first.');
    }
    await setBroadcastPending(null);
    const r = await performSend({ message: withSubject(S.subjectLine, p.msg), by: 'gabbai (texted Y)' });
    if (!r.ok) return reply('Not sent: ' + (r.error || 'error') + ' Reply Y to try again.');
    const f = await getGabbaiForward();
    if (f && f.msg === p.msg && f.phone === p.phone) await setGabbaiForward({ ...f, used: true });
    return reply('Sent to ' + r.sent + ' member' + (r.sent === 1 ? '' : 's') + (r.failedCount ? ', ' + r.failedCount + ' failed' : '') + '. It shows in History.');
  }
  if (isGabbai && (w2 === 'y' || w2 === 'yes')) {
    const f = await getGabbaiForward();
    if (f && f.msg && !f.used && Date.now() - f.at < 24 * 3600000) {
      await setBroadcastPending({ phone: f.phone, name: f.name, msg: f.msg, at: Date.now() });
      const n = (await getContacts()).length;
      const preview = f.msg.length > 120 ? f.msg.slice(0, 120) + '...' : f.msg;
      return reply('Send this message from ' + (f.name || 'a member') + ' to all ' + n + ' members?\n\n"' + preview + '"\n\nReply YES ALL to send. If you don\'t, nothing is sent.');
    }
  }

  // Answer to "who's coming to Mincha?" (ME, YES, X2...)
  const minyanAns = await handleAnswer(from, bodyRaw);
  if (minyanAns) return reply(minyanAns.text);

  // Gabbai texted Y / YES but there is no member message to send
  if (isGabbai && (w2 === 'y' || w2 === 'yes')) return reply('Nothing to send to everyone right now. Y works after a member\'s message comes to your phone.');

  // Gabbai answering a member (plain text -> last member, "#1234 text" -> that member)
  if (gabbai && from === gabbai && !GABBAI_OWN_WORDS.includes(word) && !/^name\b/i.test(bodyRaw)) {
    const pick = bodyRaw.match(/^#(\d{4})\s*([\s\S]*)$/);
    const hit = await findLastInbound(pick ? pick[1] : null);
    const text = pick ? pick[2].trim() : bodyRaw;
    if (!hit) return reply('Not sent. No matching member message found.');
    if (!text) return reply('Not sent. Type your answer after #' + pick[1]);
    try {
      const m = await sendSms(hit.phone, withGabbaiPrefix(S, text));
      await addReply(hit.phone, text, 'out', 'gabbai (text)', m && m.sid);
    } catch (e) {
      return reply('Not sent: ' + e.message);
    }
    return reply('Sent to ' + (await nameFor(hit.phone)) + ' ' + hit.phone);
  }

  // NAME Moshe Cohen -> saves the member's name on the Members list
  const nm = bodyRaw.match(/^name\b\s*:?\s*([\s\S]*)$/i);
  if (nm) {
    const name = nm[1].trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!name) return reply('Please text NAME followed by your name, like: NAME Moshe Cohen');
    const r = await updateContactName(from, name);
    if (!r.ok) return reply('You are not on the list yet. Text JOIN first, then NAME ' + name);
    return reply('Thanks ' + name + ', your name is saved.');
  }

  // If we already have this person's real name, skip the "Reply NAME..." part
  const me = (await getContacts()).find(x => x.phone === from);
  const known = hasRealName(me?.name);
  const noNameAsk = t => known ? dropNameAsk(t) : t;

  if (word === 'join' || word === 'yes') {
    // Already on the list -> don't send the welcome text again
    const already = (await getContacts()).some(x => x.phone === from);
    if (already) return reply(S.alreadyJoinedText);
    await addContact('Member', from);
    return reply(noNameAsk(S.joinText));
  }
  if (word === 'donate') return reply(S.donateText);
  if (word === 'contact') return reply(S.contactText);
  if (word === 'times') return reply(await timesMessage(S));

  // Member writing to the gabbai: "REPLY: msg", "Reply msg", "R: msg", "R msg"
  const r = bodyRaw.match(/^(?:reply|r)\b\s*[:\-]?\s*([\s\S]*)$/i);
  const pending = !r && await isPendingReply(from);
  if (r || pending) {
    const msg = (r ? r[1] : bodyRaw).trim();
    if (!msg) {
      // Just "REPLY" or "R" - their next text goes to the gabbai
      await setPendingReply(from, true);
      return reply('Type your message for the gabbai and send it now.');
    }
    if (pending) await setPendingReply(from, false);
    await addReply(from, msg, 'in');
    if (gabbai && S.forwardToGabbai) {
      const name = await nameFor(from);
      try {
        await sendSms(gabbai, name + ' ' + prettyPhone(from) + ' (#' + from.slice(-4) + '):\n' + msg + '\n\nReply Y to send this to everyone.');
        await setGabbaiForward({ phone: from, name: name === 'Unknown name' ? '' : name, msg, at: Date.now() });
      } catch (e) { /* still saved on the dashboard */ }
    }
    return reply(S.replyConfirmText);
  }

  // We asked this member for their name ("Ask name" button) -> save what they texted as their name
  if (me && !known && me.askedNameAt && Date.now() - me.askedNameAt < 14 * 86400000 && looksLikeName(bodyRaw)) {
    const name = cleanName(bodyRaw);
    await saveAskedName(from, name);
    return reply('Thanks ' + name + ', your name is saved.');
  }

  // Anything else -> the menu (without the JOIN line if they're already on the list)
  let menu = noNameAsk(S.menuText);
  if (me) menu = dropJoinAsk(menu);
  return reply(menu);
}

async function sendSms(to, body) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client.messages.create({ messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID, to, body });
}

function prettyPhone(p) {
  const d = String(p).replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : p;
}

async function nameFor(phone) {
  const c = (await getContacts()).find(x => x.phone === phone);
  return c && c.name && c.name !== 'Member' ? c.name : 'Unknown name';
}

async function timesMessage(S) {
  const fmt = d => d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const fmt24 = t => { const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; return ((h % 12) || 12) + ':' + String(m).padStart(2, '0') + ' ' + ap; };
  const today = todayNY();
  // 1) Gabbai's special message for today (one day or a from/to range)
  const special = (S.specialTimes || []).find(x => x.date <= today && today <= (x.endDate || x.date));
  // 2) Friday / Erev Yom Tov -> Shabbos / Yom Tov zmanim
  if (!special && S.shabbosZmanimEnabled !== false) {
    try {
      const z = await shabbosZmanimText(S, today);
      if (z) return keepTimesLTR(z);
    } catch (e) { /* Hebcal not reachable - use the regular reply */ }
  }
  // 3) TIMES turned off
  if (!special && S.timesEnabled === false) return S.timesOffText;
  let mincha = '', maariv = '';
  try {
    if (S.timesMode === 'fixed') {
      mincha = fmt24(S.fixedMincha);
      const m = (S.fixedMaariv || '').trim();
      maariv = !m ? 'right after Mincha' : (/^\d{1,2}:\d{2}$/.test(m) ? fmt24(m) : m);
    } else {
      const r = await fetch(`https://www.hebcal.com/zmanim?cfg=json&zip=${encodeURIComponent(S.timesZip)}&date=${today}`);
      const z = await r.json();
      const rt = new Date(z.times.tzeit72min);
      if (isNaN(rt)) throw new Error('no time');
      mincha = fmt(new Date(rt.getTime() - S.minchaMinutesBefore * 60000));
      maariv = fmt(rt);
    }
  } catch (e) {
    if (!special) return S.timesFallbackText;
  }
  const fill = t => t.replace(/\{mincha\}/g, mincha || '?').replace(/\{maariv\}/g, maariv || '?');
  return keepTimesLTR(fill(special ? special.text : S.timesText));
}

// In a Hebrew text, phones flip "7:47 PM" to "PM 7:47".
// An invisible left-to-right mark around each time keeps it in the right order.
function keepTimesLTR(text) {
  if (!/[\u0590-\u05FF]/.test(text)) return text;
  const LRM = '\u200E';
  return text.replace(/\d{1,2}:\d{2}(?:\s*[AaPp]\.?[Mm]\.?)?/g, t => LRM + t + LRM);
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}
