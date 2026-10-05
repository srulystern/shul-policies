// Storage for contacts, groups, replies, the send log (history), and scheduled messages.
// Uses Vercel KV when configured; falls back to in-memory (resets on redeploy)
// so the app still runs before KV is connected.

let kv = null;
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const mod = await import('@vercel/kv');
    kv = mod.kv;
  }
} catch (e) {
  kv = null;
}

// ----- in-memory fallback -----
const mem = {
  contacts: [],  // { name, phone, groups:[] }
  groups: [],    // { id, name }
  replies: [],   // { phone, body, at }
  sendlog: [],   // { id, message, ..., at, archived }
  scheduled: [], // { id, message, mediaUrl, onlyPhones, groupId, runAt, createdBy, createdAt }
};

function normalizePhone(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  d = d.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return d ? '+' + d : null;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function kvGet(key, fallback) {
  if (kv) return (await kv.get(key)) || fallback;
  return mem[key] ?? fallback;
}
async function kvSet(key, val) {
  if (kv) { await kv.set(key, val); return; }
  mem[key] = val;
}

// ----- contacts -----
export async function getContacts() {
  const list = await kvGet('contacts', []);
  return list.map(c => ({ ...c, groups: Array.isArray(c.groups) ? c.groups : [] }));
}

export async function saveContacts(list) {
  await kvSet('contacts', list);
}

export async function addContact(name, phone) {
  const p = normalizePhone(phone);
  if (!p) return { ok: false, error: 'Invalid phone number' };
  const list = await getContacts();
  if (list.some(c => c.phone === p)) return { ok: false, error: 'Already on the list' };
  list.push({ name: (name || '').trim() || 'Member', phone: p, groups: [] });
  await saveContacts(list);
  return { ok: true };
}

export async function removeContact(phone) {
  const p = normalizePhone(phone);
  let list = await getContacts();
  const before = list.length;
  list = list.filter(c => c.phone !== p);
  await saveContacts(list);
  return { ok: list.length < before };
}

export async function removeContacts(phones) {
  const targets = new Set((phones || []).map(normalizePhone).filter(Boolean));
  let list = await getContacts();
  const before = list.length;
  list = list.filter(c => !targets.has(c.phone));
  await saveContacts(list);
  return { removed: before - list.length, total: list.length };
}

export async function updateContactName(phone, name) {
  const p = normalizePhone(phone);
  const list = await getContacts();
  const c = list.find(x => x.phone === p);
  if (!c) return { ok: false, error: 'Member not found' };
  c.name = (name || '').trim() || 'Member';
  delete c.askedNameAt;
  await saveContacts(list);
  return { ok: true };
}

export async function setContactGroups(phone, groupIds) {
  const p = normalizePhone(phone);
  const list = await getContacts();
  const c = list.find(x => x.phone === p);
  if (!c) return { ok: false, error: 'Member not found' };
  c.groups = Array.isArray(groupIds) ? groupIds : [];
  await saveContacts(list);
  return { ok: true };
}

export async function bulkAddContacts(rows) {
  const list = await getContacts();
  const existing = new Set(list.map(c => c.phone));
  let added = 0, skipped = 0, invalid = 0;
  for (const r of rows) {
    const p = normalizePhone(r.phone);
    if (!p) { invalid++; continue; }
    if (existing.has(p)) { skipped++; continue; }
    existing.add(p);
    list.push({ name: (r.name || '').trim() || 'Member', phone: p, groups: [] });
    added++;
  }
  await saveContacts(list);
  return { added, skipped, invalid, total: list.length };
}

// ----- groups -----
export async function getGroups() {
  return await kvGet('groups', []);
}
export async function addGroup(name) {
  const nm = (name || '').trim();
  if (!nm) return { ok: false, error: 'Enter a group name.' };
  const list = await getGroups();
  if (list.some(g => g.name.toLowerCase() === nm.toLowerCase())) return { ok: false, error: 'A group with that name already exists.' };
  const g = { id: uid(), name: nm };
  list.push(g);
  await kvSet('groups', list);
  return { ok: true, group: g };
}
export async function renameGroup(id, name) {
  const nm = (name || '').trim();
  if (!nm) return { ok: false, error: 'Enter a group name.' };
  const list = await getGroups();
  const g = list.find(x => x.id === id);
  if (!g) return { ok: false, error: 'Group not found.' };
  g.name = nm;
  await kvSet('groups', list);
  return { ok: true };
}
export async function removeGroup(id) {
  let list = await getGroups();
  const before = list.length;
  list = list.filter(g => g.id !== id);
  await kvSet('groups', list);
  const contacts = await getContacts();
  let changed = false;
  for (const c of contacts) {
    if (c.groups && c.groups.includes(id)) { c.groups = c.groups.filter(x => x !== id); changed = true; }
  }
  if (changed) await saveContacts(contacts);
  return { ok: list.length < before };
}
export async function phonesInGroup(groupId) {
  const contacts = await getContacts();
  return contacts.filter(c => (c.groups || []).includes(groupId)).map(c => c.phone);
}

// ----- replies -----
export async function getReplies() {
  return await kvGet('replies', []);
}

// dir: 'in' = member wrote to the gabbai, 'out' = gabbai answered the member
export async function addReply(phone, body, dir = 'in', by = null, sid = null) {
  const entry = { id: uid(), phone: normalizePhone(phone), body, dir, by, at: Date.now() };
  if (sid) entry.sid = sid; // Twilio message id, used to look up the cost later
  const list = await kvGet('replies', []);
  list.unshift(entry);
  await kvSet('replies', list.slice(0, 1000));
  return entry;
}

// Most recent member message; optionally only a phone ending in last4.
export async function findLastInbound(last4) {
  const list = await kvGet('replies', []);
  return list.find(r => (r.dir || 'in') === 'in' && (!last4 || (r.phone || '').endsWith(last4))) || null;
}

// When the gabbai marked a member's conversation as handled: { phone: timestamp }
export async function getHandled() {
  return await kvGet('repliesHandled', {});
}
export async function markHandled(phone) {
  const map = await getHandled();
  map[normalizePhone(phone)] = Date.now();
  await kvSet('repliesHandled', map);
  return { ok: true };
}

export async function deleteReplyThread(phone) {
  const p = normalizePhone(phone);
  const list = await kvGet('replies', []);
  await kvSet('replies', list.filter(r => r.phone !== p));
  return { ok: true };
}

export async function saveReplies(list) {
  await kvSet('replies', list.slice(0, 1000));
}

// ----- failed texts: count failures in a row per member -----
// changes = [{ phone, failed: true/false, error }]  (failed:false = a text went through, resets the count)
export async function recordDelivery(changes) {
  if (!changes || !changes.length) return;
  const list = await getContacts();
  let changed = false;
  for (const ch of changes) {
    const c = list.find(x => x.phone === normalizePhone(ch.phone));
    if (!c) continue;
    if (ch.failed) {
      c.failCount = (c.failCount || 0) + 1;
      c.lastFailAt = Date.now();
      c.lastFailError = String(ch.error || '').slice(0, 120);
      changed = true;
    } else if (c.failCount) {
      c.failCount = 0; delete c.lastFailError; changed = true;
    }
  }
  if (changed) await saveContacts(list);
}

export async function clearFailFlag(phone) {
  const p = normalizePhone(phone);
  const list = await getContacts();
  const c = list.find(x => x.phone === p);
  if (!c) return { ok: false, error: 'Member not found' };
  c.failCount = 0; delete c.lastFailError; delete c.lastFailAt;
  await saveContacts(list);
  return { ok: true };
}

// ----- "Ask name": remember who we asked, so their next text is saved as their name -----
export async function markAskedName(phones) {
  const set = new Set((phones || []).map(normalizePhone));
  const list = await getContacts();
  for (const c of list) if (set.has(c.phone)) c.askedNameAt = Date.now();
  await saveContacts(list);
}

export async function saveAskedName(phone, name) {
  const p = normalizePhone(phone);
  const list = await getContacts();
  const c = list.find(x => x.phone === p);
  if (!c) return { ok: false };
  c.name = name;
  delete c.askedNameAt;
  await saveContacts(list);
  return { ok: true };
}

// ----- minyan auto-schedule dedupe log -----
export async function getMinyanAutoLog() {
  return await kvGet('minyanAutoLog', {});
}

export async function markMinyanAutoSent(key) {
  const log = await getMinyanAutoLog();
  log[key] = Date.now();
  const entries = Object.entries(log).sort((a, b) => b[1] - a[1]).slice(0, 40);
  await kvSet('minyanAutoLog', Object.fromEntries(entries));
}

// ----- send log (History / Archive) -----
export async function getSendLog() {
  return await kvGet('sendlog', []);
}

export async function addSendLog(entry) {
  const row = { id: uid(), archived: false, ...entry, at: Date.now() };
  const list = await kvGet('sendlog', []);
  list.unshift(row);
  await kvSet('sendlog', list.slice(0, 400));
  return row;
}

export async function saveSendLog(list) {
  await kvSet('sendlog', list.slice(0, 400));
}

export async function setLogArchived(id, archived) {
  const list = await getSendLog();
  const row = list.find(x => x.id === id);
  if (!row) return { ok: false, error: 'Message not found.' };
  row.archived = !!archived;
  await kvSet('sendlog', list);
  return { ok: true };
}

export async function deleteLog(id) {
  let list = await getSendLog();
  const before = list.length;
  list = list.filter(x => x.id !== id);
  await kvSet('sendlog', list);
  return { ok: list.length < before };
}

// ----- scheduled messages -----
export async function getScheduled() {
  return await kvGet('scheduled', []);
}
export async function addScheduled(entry) {
  const row = { id: uid(), createdAt: Date.now(), ...entry };
  const list = await getScheduled();
  list.push(row);
  await kvSet('scheduled', list);
  return row;
}
export async function deleteScheduled(id) {
  let list = await getScheduled();
  const before = list.length;
  list = list.filter(x => x.id !== id);
  await kvSet('scheduled', list);
  return { ok: list.length < before };
}
export async function updateScheduled(id, fields) {
  const list = await getScheduled();
  const row = list.find(x => x.id === id);
  if (!row) return { ok: false, error: 'Scheduled message not found.' };
  if (typeof fields.message === 'string') row.message = fields.message.trim();
  if (fields.runAt) row.runAt = Number(fields.runAt);
  await kvSet('scheduled', list);
  return { ok: true };
}
export async function popDueScheduled(now) {
  const list = await getScheduled();
  const due = list.filter(x => x.runAt <= now);
  if (due.length === 0) return [];
  const remaining = list.filter(x => x.runAt > now);
  await kvSet('scheduled', remaining);
  return due;
}

// ----- "REPLY" with no message: the member's next text goes to the gabbai -----
export async function setPendingReply(phone, on) {
  const p = normalizePhone(phone);
  const map = await kvGet('pendingReply', {});
  if (on) map[p] = Date.now(); else delete map[p];
  await kvSet('pendingReply', map);
}
export async function isPendingReply(phone) {
  const map = await kvGet('pendingReply', {});
  const t = map[normalizePhone(phone)];
  return !!t && Date.now() - t < 30 * 60000; // good for 30 minutes
}

// ----- Gabbai "Y" = send a member's message to everyone -----
// gabbaiForward = the last member message texted to the gabbai's phone { phone, name, msg, at, used }
// broadcastPending = what the gabbai said Y to, waiting for YES ALL { phone, name, msg, at }
export async function setGabbaiForward(rec) { await kvSet('gabbaiForward', rec || {}); }
export async function getGabbaiForward() { return await kvGet('gabbaiForward', {}); }
export async function setBroadcastPending(rec) { await kvSet('broadcastPending', rec || {}); }
export async function getBroadcastPending() { return await kvGet('broadcastPending', {}); }

export { normalizePhone };
