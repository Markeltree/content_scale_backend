import { Router } from 'express';
import { db, must } from '../lib/supabase.js';

const r = Router();

r.get('/', (req, res) => res.json({ user: req.user }));

r.patch('/', async (req, res) => {
  const { full_name, job_title, avatar_url } = req.body;
  const data = must(
    await db().from('profiles').update({ full_name, job_title, avatar_url }).eq('id', req.user.id).select().single()
  );
  res.json({ user: { ...req.user, ...data } });
});

/** Lightweight list of teammates (for assignees, mentions). */
r.get('/team', async (_req, res) => {
  const data = must(await db().from('profiles').select('id, full_name, email, role, avatar_url, job_title').eq('status', 'active').order('full_name'));
  res.json({ team: data });
});

export default r;
