// Settings the gabbai can edit from the dashboard (Settings tab).
// Stored in Vercel KV under 'settings'; defaults below fill anything not set yet.

let kv = null;
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const mod = await import('@vercel/kv');
    kv = mod.kv;
  }
} catch (e) { kv = null; }

let mem = null;

export const DEFAULT_SETTINGS = {
  gabbaiNumber: process.env.GABBAI_NUMBER || '+18455373093',
  forwardToGabbai: true,
  menuText:
    'Cong. Lake Shore - text one of these words:\n' +
    'TIMES - today\'s davening times\n' +
    'DONATE - donate to the shul\n' +
    'CONTACT - shul contact info\n' +
    'JOIN - get shul announcements\n' +
    'NAME + your name - so the gabbai knows who you are\n' +
    'STOP - stop all texts\n' +
    'To message the gabbai, start your text with REPLY or R',
  donateText: 'Cong. Lake Shore - thank you! To donate, visit conglakeshore.org',
  contactText: 'Cong. Lake Shore\nShul: 379 Lake Shore Drive, Monroe NY 10950\nOffice: 350 Lake Shore Drive\nconglakeshore.org\nTo message the gabbai, start your text with REPLY or R',
  joinText: 'Cong. Lake Shore: You are now subscribed to shul announcements. Msg frequency varies. Msg & data rates may apply. Reply NAME followed by your name (like NAME Moshe Cohen) so the gabbai knows who you are. Reply HELP for help, STOP to unsubscribe.',
  alreadyJoinedText: "Cong. Lake Shore: You're already signed up for shul texts. Reply HELP for help, STOP to unsubscribe.",
  replyConfirmText: 'Thanks, your message was sent to the gabbai.',
  askNameText: 'Cong. Lake Shore: Please reply with your first and last name so the gabbai knows who you are.',
  lowBalanceAt: 10,           // dashboard shows "Contact Sruly" when the available balance is under this ($)
  creditLine: 100,            // Twilio credit line ($) - added to the balance to match Twilio's "Available balance"
  callerMessage: 'You have reached Congregation Lake Shore. This number is for text messages only. Please text the word MENU to see what you can do. Thank you.',
  gabbaiReplyPrefix: 'Gabbai:',   // put at the start of every answer the gabbai sends a member
  subjectLine: 'בית המדרש לעיק שאור', // first line of every message sent from the dashboard (gabbai can change)
  whatsNew: '',               // "What's new" page (admin writes it; text + photos)
  whatsNewAt: 0,              // when it was last changed (gabbai sees a dot until he opens it)
  timesZip: '10950',
  timesEnabled: true,         // gabbai can turn TIMES off (e.g. winter)
  timesOffText: 'Cong. Lake Shore - davening times by text are not available right now.',
  minyanGoal: 10,
  minyanSendThanks: true,     // reply to each person with the count so far
  minyanAskText: 'Cong. Lake Shore - Who is coming to {tefila} {when}? Reply ME (or X2, X3 if you are bringing others). Reply NO if you can\'t make it.',
  minyanThanksText: 'Thanks! So far {count} of {goal} for {tefila} {when}.',
  minyanConfirmText: 'Cong. Lake Shore - We have a minyan for {tefila} {when}! See you there.',
  minyanEnabled: false,       // master on/off for the minyan-count feature
  minyanSchedules: [],        // [{ id, tefila, startDate, endDate, groupId }] - auto-runs once a day when today is in range
  timesMode: 'auto',          // 'auto' = from zmanim, 'fixed' = gabbai sets the time
  minchaMinutesBefore: 15,
  fixedMincha: '18:30',       // used when timesMode = 'fixed' (24h HH:MM)
  fixedMaariv: '',            // HH:MM, or any text; blank = "right after Mincha"
  specialTimes: [],           // [{ date: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD', text }] - replaces the TIMES reply from date to endDate
  shabbosZmanimEnabled: true, // Friday / Erev Yom Tov: TIMES sends the Shabbos / Yom Tov zmanim
  candleMinutes: 18,          // candle lighting = this many minutes before shkia
  shmaOpinion: 'both',        // sof zman krias shema: 'mga', 'gra' or 'both'
  timesText: "Cong. Lake Shore - today's times:\nMincha: {mincha}\nMaariv: {maariv}",
  timesFallbackText: 'Cong. Lake Shore - times are not available right now. Please check the shul board.',
};

// Fields the gabbai may change (Times tab). Admin may change everything.
export const TIMES_FIELDS = ['timesEnabled', 'timesOffText', 'minyanGoal', 'minyanSendThanks', 'minyanAskText', 'minyanThanksText', 'minyanConfirmText', 'minyanEnabled', 'minyanSchedules', 'timesMode', 'minchaMinutesBefore', 'fixedMincha', 'fixedMaariv', 'timesText', 'timesFallbackText', 'specialTimes', 'shabbosZmanimEnabled', 'candleMinutes', 'shmaOpinion', 'subjectLine'];

// Put the subject on the first line of a message - unless it's already there
export function withSubject(subject, text) {
  const s = String(subject || '').trim();
  const t = String(text || '').trim();
  if (!s) return t;
  if (!t) return s;
  if (t.startsWith(s)) return t;
  return s + '\n' + t;
}

// "What's new" is shown as a page on the dashboard - keep only simple text, line breaks and photos
export function cleanWhatsNew(html) {
  let h = String(html || '').slice(0, 100000);
  h = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1\s*>/gi, '');
  const OK = ['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'h3'];
  return h.replace(/<\s*(\/?)\s*([a-z0-9]+)([^>]*)>/gi, (all, close, tag, attrs) => {
    tag = tag.toLowerCase();
    if (tag === 'img') {
      if (close) return '';
      const m = attrs.match(/src\s*=\s*["']?(https:\/\/[^"'\s>]+)/i);
      return m ? '<img src="' + m[1].replace(/"/g, '') + '">' : '';
    }
    if (!OK.includes(tag)) return '';
    if (tag === 'br') return '<br>';
    return '<' + close + tag + '>';
  }).replace(/<[^>]*$/, '');
}

// Add "Gabbai:" (or whatever is set) to the start of a gabbai answer - unless it's already there
export function withGabbaiPrefix(S, text) {
  const p = String(S.gabbaiReplyPrefix || '').trim();
  const t = String(text || '').trim();
  if (!p || t.toLowerCase().startsWith(p.toLowerCase())) return t;
  return p + ' ' + t;
}

export function todayNY() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

export async function getSettings() {
  let saved = null;
  if (kv) saved = await kv.get('settings');
  else saved = mem;
  return { ...DEFAULT_SETTINGS, ...(saved || {}) };
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (patch[k] === undefined) continue;
    if (k === 'minchaMinutesBefore') {
      const n = parseInt(patch[k], 10);
      if (isNaN(n) || n < 0 || n > 120) return { ok: false, error: 'Minutes before must be 0-120.' };
      next[k] = n;
    } else if (k === 'minyanGoal') {
      const n = parseInt(patch[k], 10);
      if (isNaN(n) || n < 1 || n > 100) return { ok: false, error: 'Minyan count must be 1-100.' };
      next[k] = n;
    } else if (k === 'candleMinutes') {
      const n = parseInt(patch[k], 10);
      if (isNaN(n) || n < 0 || n > 60) return { ok: false, error: 'Candle lighting minutes must be 0-60.' };
      next[k] = n;
    } else if (k === 'creditLine') {
      const n = parseFloat(patch[k]);
      if (isNaN(n) || n < 0 || n > 100000) return { ok: false, error: 'Credit line must be 0 or more.' };
      next[k] = n;
    } else if (k === 'lowBalanceAt') {
      const n = parseFloat(patch[k]);
      if (isNaN(n) || n < 0 || n > 1000) return { ok: false, error: 'Low balance amount must be 0-1000.' };
      next[k] = n;
    } else if (k === 'whatsNewAt') {
      continue; // set by itself below
    } else if (k === 'whatsNew') {
      const clean = cleanWhatsNew(patch[k]);
      if (clean !== current.whatsNew) { next.whatsNew = clean; next.whatsNewAt = Date.now(); }
    } else if (k === 'subjectLine') {
      next[k] = String(patch[k]).trim().slice(0, 80);
    } else if (k === 'shmaOpinion') {
      next[k] = ['mga', 'gra', 'both'].includes(patch[k]) ? patch[k] : 'both';
    } else if (k === 'forwardToGabbai' || k === 'timesEnabled' || k === 'minyanSendThanks' || k === 'minyanEnabled' || k === 'shabbosZmanimEnabled') {
      next[k] = !!patch[k];
    } else if (k === 'timesMode') {
      next[k] = patch[k] === 'fixed' ? 'fixed' : 'auto';
    } else if (k === 'fixedMincha') {
      if (!/^\d{1,2}:\d{2}$/.test(String(patch[k]))) return { ok: false, error: 'Enter a Mincha time.' };
      next[k] = String(patch[k]);
    } else if (k === 'specialTimes') {
      const today = todayNY();
      const list = Array.isArray(patch[k]) ? patch[k] : [];
      next[k] = list
        .filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && String(x.text || '').trim())
        .map(x => {
          const end = /^\d{4}-\d{2}-\d{2}$/.test(x.endDate || '') && x.endDate >= x.date ? x.endDate : x.date;
          return { date: x.date, endDate: end, text: String(x.text).trim() };
        })
        .filter(x => x.endDate >= today) // removed by itself after the last day passes
        .sort((a, b) => a.date.localeCompare(b.date));
    } else if (k === 'minyanSchedules') {
      const today = todayNY();
      const TEF = ['Shacharis', 'Mincha', 'Maariv'];
      const list = Array.isArray(patch[k]) ? patch[k] : [];
      next[k] = list
        .filter(x => x && TEF.includes(x.tefila) && /^\d{4}-\d{2}-\d{2}$/.test(x.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(x.endDate)
          && x.endDate >= today && x.endDate >= x.startDate)
        .map(x => ({ id: x.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), tefila: x.tefila, startDate: x.startDate, endDate: x.endDate, groupId: x.groupId || null }))
        .sort((a, b) => a.startDate.localeCompare(b.startDate));
    } else {
      next[k] = String(patch[k]);
    }
  }
  if (next.gabbaiNumber) {
    let d = next.gabbaiNumber.replace(/\D/g, '');
    if (d.length === 10) d = '1' + d;
    if (d.length !== 11) return { ok: false, error: 'Gabbai number must be a 10-digit US number.' };
    next.gabbaiNumber = '+' + d;
  }
  if (kv) await kv.set('settings', next);
  else mem = next;
  return { ok: true, settings: next };
}
