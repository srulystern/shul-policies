// Helpers for "does this member already have a real name?"

// A real name = not blank and not the default "Member"
export function hasRealName(name) {
  const n = String(name || '').trim();
  return !!n && n.toLowerCase() !== 'member';
}

// Remove the part of a text that asks for NAME (used when we already know their name).
// Works line by line; inside a line, removes only the sentence that mentions NAME.
export function dropNameAsk(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (const line of lines) {
    if (!/\bNAME\b/.test(line)) { out.push(line); continue; }
    const kept = line.split(/(?<=[.!?])\s+/).filter(s => !/\bNAME\b/.test(s)).join(' ').trim();
    if (kept) out.push(kept);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Remove the part of the menu that says JOIN (used for people who are already on the list).
// Same rule as NAME: removes the line, or only the sentence inside a line, that has the word JOIN.
export function dropJoinAsk(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  for (const line of lines) {
    if (!/\bJOIN\b/.test(line)) { out.push(line); continue; }
    const kept = line.split(/(?<=[.!?])\s+/).filter(s => !/\bJOIN\b/.test(s)).join(' ').trim();
    if (kept) out.push(kept);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Does this text look like someone's name? (used after "Ask name")
const NOT_NAMES = ['hi', 'hello', 'hey', 'ok', 'okay', 'k', 'thanks', 'thank you', 'thx', 'who is this', 'who', 'what', 'why', 'menu', 'sure', 'got it', 'good', 'great'];
export function looksLikeName(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  if (t.length < 2 || t.length > 50) return false;
  if (/\d|[?@#:/]/.test(t)) return false;
  if (NOT_NAMES.includes(t.toLowerCase())) return false;
  const words = t.split(' ');
  if (words.length > 5) return false;
  return words.every(w => /^[A-Za-z֐-׿][A-Za-z֐-׿'\-.,"׳״]*$/.test(w));
}

// Tidy up a name someone texted in
export function cleanName(text) {
  return String(text || '').trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '').slice(0, 60);
}
