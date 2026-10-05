// Friday / Erev Yom Tov: the TIMES reply becomes the Shabbos / Yom Tov zmanim.
// Uses Hebcal (hebcal.com) - the same site the weekday TIMES already uses.
// Nothing is sent automatically; this only answers when someone texts TIMES.

const HEB_DAYS = ['יום א׳', 'יום ב׳', 'יום ג׳', 'יום ד׳', 'יום ה׳', 'ערב שבת', 'שבת'];

function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
function weekday(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 6 = Shabbos
}
const fmt = iso => {
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
};

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('hebcal ' + r.status);
  return r.json();
}

// Returns the zmanim text if today is Friday or Erev Yom Tov, otherwise null.
// Throws if Hebcal can't be reached (the caller then falls back to the regular TIMES reply).
export async function shabbosZmanimText(S, today) {
  const zip = encodeURIComponent(S.timesZip || '10950');
  const b = Number.isFinite(S.candleMinutes) ? S.candleMinutes : 18;
  const cal = await getJson(`https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=off&mod=off&nx=off&mf=off&ss=off&s=on&c=on&M=off&m=72&b=${b}` +
    `&zip=${zip}&start=${today}&end=${addDays(today, 5)}`);
  const items = Array.isArray(cal.items) ? cal.items : [];
  const day = it => String(it.date || '').slice(0, 10);

  // Is there candle lighting today? If not, it's not Friday / Erev Yom Tov.
  const candles = items.filter(it => it.category === 'candles');
  if (!candles.some(it => day(it) === today)) return null;

  // Which days are Yom Tov
  const ytName = {};
  items.filter(it => it.category === 'holiday' && it.yomtov).forEach(it => { ytName[day(it)] = it.hebrew || it.title; });
  const parsha = {};
  items.filter(it => it.category === 'parashat').forEach(it => { parsha[day(it)] = it.hebrew || it.title; });

  // The holy days that start tonight: Shabbos and/or Yom Tov days in a row (1-3 days)
  const days = [];
  let d = addDays(today, 1);
  while ((weekday(d) === 6 || ytName[d]) && days.length < 3) { days.push(d); d = addDays(d, 1); }
  if (!days.length) return null;

  // Sof zman krias shema for each day
  const zm = await Promise.all(days.map(x => getJson(`https://www.hebcal.com/zmanim?cfg=json&zip=${zip}&date=${x}`).catch(() => null)));
  const shma = i => {
    const t = zm[i] && zm[i].times ? zm[i].times : {};
    const mga = fmt(t.sofZmanShmaMGA), gra = fmt(t.sofZmanShma);
    if (S.shmaOpinion === 'mga') return mga;
    if (S.shmaOpinion === 'gra') return gra;
    return [mga && 'מג״א ' + mga, gra && 'גר״א ' + gra].filter(Boolean).join(' | ');
  };
  const candleOn = x => fmt((candles.find(it => day(it) === x) || {}).date);
  const havdalah = items.find(it => it.category === 'havdalah' && day(it) === days[days.length - 1]);

  const label = x => {
    const isShabbos = weekday(x) === 6;
    if (isShabbos && ytName[x]) return 'שבת - ' + ytName[x];
    if (isShabbos) return parsha[x] ? 'שבת קודש - ' + parsha[x] : 'שבת קודש';
    return ytName[x] || HEB_DAYS[weekday(x)];
  };

  const lines = ['Cong. Lake Shore - זמנים'];
  lines.push('הדלקת הנירות: ' + candleOn(today));
  days.forEach((x, i) => {
    lines.push('');
    lines.push(label(x) + ':');
    const s = shma(i);
    if (s) lines.push('סוף זמן ק״ש: ' + s);
    if (i < days.length - 1) {
      const c = candleOn(x);
      if (c) lines.push('הדלקת הנירות (לא קודם): ' + c);
    }
  });
  const last = days[days.length - 1];
  const motzei = weekday(last) === 6 ? 'מוצאי שבת' : 'מוצאי יום טוב';
  if (havdalah) lines.push(motzei + ': ' + fmt(havdalah.date));
  return lines.join('\n');
}
