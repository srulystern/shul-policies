// Auth with two roles: gabbai and admin.
// Passwords come from env vars, but the gabbai password can be overridden
// from the admin dashboard (stored in KV under 'gabbai_password_override').

let kv = null;
try {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    const mod = await import('@vercel/kv');
    kv = mod.kv;
  }
} catch (e) { kv = null; }

let memOverride = null; // in-memory fallback for the gabbai override

export async function getGabbaiPassword() {
  if (kv) {
    const o = await kv.get('gabbai_password_override');
    if (o) return o;
  } else if (memOverride) {
    return memOverride;
  }
  return process.env.GABBAI_PASSWORD || null;
}

export async function setGabbaiPassword(newPw) {
  if (!newPw || newPw.length < 4) return { ok: false, error: 'Password must be at least 4 characters.' };
  if (kv) { await kv.set('gabbai_password_override', newPw); }
  else { memOverride = newPw; }
  return { ok: true };
}

function adminPassword() {
  return process.env.ADMIN_PASSWORD || null;
}

// Returns 'admin', 'gabbai', or null
export async function roleForPassword(pw) {
  if (!pw) return null;
  if (adminPassword() && pw === adminPassword()) return 'admin';
  const g = await getGabbaiPassword();
  if (g && pw === g) return 'gabbai';
  return null;
}

export async function authRole(req) {
  const given = req.headers['x-gabbai-password'];
  return await roleForPassword(given);
}

export async function checkAuth(req) {
  return (await authRole(req)) !== null;
}

export async function checkAdmin(req) {
  return (await authRole(req)) === 'admin';
}
