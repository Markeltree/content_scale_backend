import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { db, must, getSetting, logActivity } from '../lib/supabase.js';

const r = Router();

r.get('/', async (_req, res) => {
  const rows = must(await db().from('app_settings').select('*'));
  res.json({ settings: Object.fromEntries(rows.map((s) => [s.key, s.value])) });
});

r.get('/brand', async (_req, res) => res.json({ brand: await getSetting('brand_voice', {}) }));

r.put('/brand', requireRole('admin'), async (req, res) => {
  const value = req.body.brand;
  must(await db().from('app_settings').upsert({ key: 'brand_voice', value, updated_at: new Date().toISOString() }));
  await logActivity(req.user.id, 'updated', 'settings', 'brand_voice');
  res.json({ brand: value });
});

r.get('/models', async (_req, res) => {
  const models = must(await db().from('ai_models').select('id, name, description, tier, is_default').eq('enabled', true).order('input_price'));
  res.json({ models });
});

export default r;
