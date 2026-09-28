import { db } from '../lib/supabase.js';

/** Verifies the Supabase access token sent as `Authorization: Bearer <token>`. */
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing access token' });

    const { data, error } = await db().auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'Invalid or expired session' });
    const user = data.user;

    let { data: profile } = await db().from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (!profile) {
      // Covers users created before the schema/trigger existed.
      const { count } = await db().from('profiles').select('id', { count: 'exact', head: true });
      const { data: created } = await db()
        .from('profiles')
        .upsert({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || user.email?.split('@')[0],
          role: count ? 'editor' : 'admin',
        })
        .select()
        .single();
      profile = created;
    }
    if (profile?.status === 'suspended') return res.status(403).json({ error: 'Your account has been suspended by an administrator.' });

    req.user = { id: user.id, email: user.email, ...profile };
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ error: `This action requires the ${roles.join(' or ')} role.` });
  }
  next();
};

/** Viewers are read-only. */
export const requireWrite = requireRole('admin', 'editor');
