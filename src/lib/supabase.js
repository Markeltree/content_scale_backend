import { createClient } from '@supabase/supabase-js';

let client;

/** Service-role Supabase client (server only — bypasses RLS). */
export function db() {
  if (client) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw Object.assign(new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the backend.'), { status: 500 });
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

/** Throw on Supabase error, otherwise return data. */
export function must({ data, error }) {
  if (error) throw Object.assign(new Error(error.message), { status: 400, details: error });
  return data;
}

export async function logActivity(userId, action, entity, entityId, details) {
  try {
    await db().from('activity_logs').insert({
      user_id: userId ?? null,
      action,
      entity,
      entity_id: entityId ? String(entityId) : null,
      details: details ?? null,
    });
  } catch {
    /* activity logging must never break a request */
  }
}

export async function getSetting(key, fallback = null) {
  const { data } = await db().from('app_settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? fallback;
}
