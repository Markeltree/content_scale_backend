import { Router } from 'express';
import { requireRole } from '../middleware/auth.js';
import { complete, extractJson, clearModelCache, wordCount } from '../lib/anthropic.js';
import { addToKnowledge } from '../lib/knowledge.js';
import { db, must, logActivity, getSetting } from '../lib/supabase.js';
import { DEMO_CONTENT, DEMO_PROMPTS, DEMO_TEMPLATES, DEMO_KNOWLEDGE } from '../lib/demoData.js';
import { findVariables } from './prompts.js';

const r = Router();
r.use(requireRole('admin'));

/* ------------------------------- Users ------------------------------- */

r.get('/users', async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [profiles, usage, content] = await Promise.all([
    db().from('profiles').select('*').order('created_at').then(must),
    db().from('usage_logs').select('user_id, input_tokens, output_tokens, created_at').gte('created_at', since).range(0, 49_999).then(must),
    db().from('content_items').select('user_id').range(0, 19_999).then(must),
  ]);
  const users = profiles.map((p) => {
    const mine = usage.filter((u) => u.user_id === p.id);
    return {
      ...p,
      generations30d: mine.length,
      tokens30d: mine.reduce((a, u) => a + u.input_tokens + u.output_tokens, 0),
      lastActive: mine.map((u) => u.created_at).sort().at(-1) ?? null,
      contentCount: content.filter((c) => c.user_id === p.id).length,
    };
  });
  res.json({ users });
});

r.patch('/users/:id', async (req, res) => {
  const patch = {};
  if (['admin', 'editor', 'viewer'].includes(req.body.role)) patch.role = req.body.role;
  if (['active', 'suspended'].includes(req.body.status)) patch.status = req.body.status;
  if (req.params.id === req.user.id && (patch.role && patch.role !== 'admin' || patch.status === 'suspended')) {
    return res.status(400).json({ error: "You can't remove your own admin access." });
  }
  const data = must(await db().from('profiles').update(patch).eq('id', req.params.id).select().single());
  await logActivity(req.user.id, 'updated_user', 'user', req.params.id, patch);
  res.json({ user: data });
});

r.post('/users/invite', async (req, res) => {
  const { email, role = 'editor', full_name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  const redirectTo = (process.env.FRONTEND_URL || '').split(',')[0]?.trim() || undefined;
  const { data, error } = await db().auth.admin.inviteUserByEmail(email, { data: { full_name }, redirectTo: redirectTo ? `${redirectTo}/login` : undefined });
  if (error) return res.status(400).json({ error: error.message });
  await db().from('profiles').upsert({ id: data.user.id, email, full_name: full_name || email.split('@')[0], role });
  await logActivity(req.user.id, 'invited_user', 'user', data.user.id, { email, role });
  res.status(201).json({ ok: true });
});

/* ------------------------------- Models ------------------------------ */

r.get('/models', async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const [models, usage] = await Promise.all([
    db().from('ai_models').select('*').order('input_price').then(must),
    db().from('usage_logs').select('model, input_tokens, output_tokens').gte('created_at', since).range(0, 49_999).then(must),
  ]);
  res.json({
    models: models.map((m) => {
      const rows = usage.filter((u) => u.model === m.id);
      return { ...m, requests30d: rows.length, tokens30d: rows.reduce((a, u) => a + u.input_tokens + u.output_tokens, 0) };
    }),
  });
});

r.patch('/models/:id', async (req, res) => {
  const patch = {};
  for (const k of ['enabled', 'max_output_tokens', 'description']) if (k in req.body) patch[k] = req.body[k];
  if (req.body.is_default === true) {
    must(await db().from('ai_models').update({ is_default: false }).neq('id', req.params.id));
    patch.is_default = true;
    patch.enabled = true;
  }
  const data = must(await db().from('ai_models').update(patch).eq('id', req.params.id).select().single());
  clearModelCache();
  await logActivity(req.user.id, 'updated_model', 'model', req.params.id, patch);
  res.json({ model: data });
});

r.post('/models', async (req, res) => {
  const { id, name, description, tier, input_price = 0, output_price = 0, max_output_tokens = 4096 } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'Model ID and name are required' });
  const data = must(await db().from('ai_models').insert({ id, name, description, tier, input_price, output_price, max_output_tokens }).select().single());
  clearModelCache();
  res.status(201).json({ model: data });
});

/* ------------------------- Content monitoring ------------------------ */

r.get('/content', async (req, res) => {
  let q = db()
    .from('content_items')
    .select('id, title, type, status, flagged, flag_reason, word_count, created_at, updated_at, metadata, author:profiles!content_items_user_id_fkey(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(300);
  if (req.query.flagged === 'true') q = q.eq('flagged', true);
  res.json({ items: must(await q) });
});

r.patch('/content/:id/flag', async (req, res) => {
  const { flagged, reason } = req.body;
  const data = must(
    await db().from('content_items').update({ flagged: !!flagged, flag_reason: flagged ? reason || 'Flagged by admin' : null }).eq('id', req.params.id).select('id, flagged, flag_reason').single()
  );
  await logActivity(req.user.id, flagged ? 'flagged' : 'unflagged', 'content', req.params.id, { reason });
  res.json({ item: data });
});

/** AI moderation scan: checks brand-safety, claims and sensitive content. */
r.post('/content/:id/moderate', async (req, res) => {
  const item = must(await db().from('content_items').select('id, title, body').eq('id', req.params.id).single());
  const safety = await getSetting('safety', {});
  const { text } = await complete({
    system: 'You are a brand-safety and compliance reviewer for marketing content.',
    prompt: `Review this content for: unverifiable claims or invented statistics, legal/compliance risk, offensive or sensitive language, privacy issues, and off-brand tone.
${safety?.blocked_terms?.length ? `Blocked terms: ${safety.blocked_terms.join(', ')}` : ''}
<content title="${item.title}">
${item.body.slice(0, 40000)}
</content>
Return ONLY JSON: {"risk": "low"|"medium"|"high", "should_flag": boolean, "issues": [{"type": string, "excerpt": string, "explanation": string}], "summary": string}`,
    maxTokens: 1500,
    feature: 'content_review',
    userId: req.user.id,
  });
  let result;
  try {
    result = extractJson(text);
  } catch {
    return res.status(502).json({ error: 'Could not parse moderation result.' });
  }
  const threshold = { low: 0, medium: 1, high: 2 }[safety?.flag_threshold || 'medium'];
  const level = { low: 0, medium: 1, high: 2 }[result.risk] ?? 0;
  if (safety?.moderation_enabled !== false && (result.should_flag || level >= Math.max(threshold, 1))) {
    await db().from('content_items').update({ flagged: true, flag_reason: result.summary?.slice(0, 300) }).eq('id', item.id);
    result.flagged = true;
  }
  res.json({ result });
});

/* ------------------------------ Settings ----------------------------- */

r.get('/settings', async (_req, res) => {
  const rows = must(await db().from('app_settings').select('*'));
  res.json({ settings: Object.fromEntries(rows.map((s) => [s.key, s.value])) });
});

r.put('/settings/:key', async (req, res) => {
  const allowed = ['workflow', 'limits', 'brand_voice', 'safety'];
  if (!allowed.includes(req.params.key)) return res.status(400).json({ error: 'Unknown setting' });
  must(await db().from('app_settings').upsert({ key: req.params.key, value: req.body.value, updated_at: new Date().toISOString() }));
  await logActivity(req.user.id, 'updated', 'settings', req.params.key);
  res.json({ ok: true, value: req.body.value });
});

/* ------------------------------ Activity ----------------------------- */

r.get('/activity', async (req, res) => {
  const data = must(
    await db()
      .from('activity_logs')
      .select('*, actor:profiles(full_name, email, avatar_url)')
      .order('created_at', { ascending: false })
      .limit(Math.min(Number(req.query.limit) || 100, 500))
  );
  res.json({ activity: data });
});

/* ------------------------------ Demo data ---------------------------- */

r.post('/demo/seed', async (req, res) => {
  const existing = await getSetting('demo_seed');
  if (existing?.content?.length) return res.status(409).json({ error: 'Demo data is already loaded. Remove it first to reload.' });
  const uid = req.user.id;
  const now = Date.now();

  const content = must(
    await db()
      .from('content_items')
      .insert(
        DEMO_CONTENT.map((c, i) => ({
          ...c,
          user_id: uid,
          assignee_id: uid,
          word_count: wordCount(c.body),
          due_date: new Date(now + (i - 2) * 2 * 86400_000).toISOString().slice(0, 10),
          scheduled_at: c.status === 'scheduled' ? new Date(now + 3 * 86400_000).toISOString() : null,
          metadata: { generated: true, demo: true },
          created_at: new Date(now - (i * 3 + 1) * 86400_000).toISOString(),
          updated_at: new Date(now - i * 86400_000).toISOString(),
        }))
      )
      .select('id, status')
  );
  const reviewItem = content.find((c) => c.status === 'review');
  if (reviewItem) {
    await db().from('content_comments').insert([
      { content_id: reviewItem.id, user_id: uid, body: 'Strong subject lines. Can we make the CTA more specific to the Q4 offer?' },
      { content_id: reviewItem.id, user_id: uid, body: 'Updated the preview text — ready for another look.' },
    ]);
  }

  const prompts = must(
    await db()
      .from('prompts')
      .insert(DEMO_PROMPTS.map((p, i) => ({ ...p, user_id: uid, variables: findVariables(p.template), uses: 40 - i * 6, is_shared: true })))
      .select('id')
  );
  const templates = must(
    await db()
      .from('workflow_templates')
      .insert(DEMO_TEMPLATES.map((t, i) => ({ ...t, user_id: uid, runs: 18 - i * 5 })))
      .select('id')
  );
  const kb = [];
  for (const k of DEMO_KNOWLEDGE) kb.push((await addToKnowledge({ userId: uid, title: k.title, text: k.text, sourceType: 'text' })).id);

  // 30 days of realistic usage so dashboards and charts are populated.
  const features = [
    ['content_generation', 0.34, 900, 1400],
    ['assistant_rewrite', 0.14, 700, 600],
    ['assistant_seo', 0.08, 900, 900],
    ['knowledge_chat', 0.14, 2200, 450],
    ['document_summarize', 0.1, 9000, 700],
    ['image_generation', 0.08, 700, 5200],
    ['prompt_run', 0.08, 500, 900],
    ['workflow_run', 0.04, 1200, 1600],
  ];
  const modelsPick = ['claude-sonnet-5', 'claude-sonnet-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5'];
  const logs = [];
  for (let d = 29; d >= 0; d--) {
    const day = new Date(now - d * 86400_000);
    const weekend = [0, 6].includes(day.getDay());
    const n = Math.round((weekend ? 8 : 22) + (29 - d) * 0.6 + Math.random() * 8);
    for (let i = 0; i < n; i++) {
      let roll = Math.random();
      const f = features.find(([, w]) => (roll -= w) <= 0) ?? features[0];
      const ts = new Date(day);
      ts.setHours(8 + Math.floor(Math.random() * 10), Math.floor(Math.random() * 60));
      logs.push({
        user_id: uid,
        feature: f[0],
        model: modelsPick[Math.floor(Math.random() * modelsPick.length)],
        input_tokens: Math.round(f[2] * (0.6 + Math.random() * 0.8)),
        output_tokens: Math.round(f[3] * (0.6 + Math.random() * 0.8)),
        created_at: ts.toISOString(),
        is_demo: true,
      });
    }
  }
  for (let i = 0; i < logs.length; i += 500) must(await db().from('usage_logs').insert(logs.slice(i, i + 500)));

  const acts = [
    ['moved', 'content', content[0].id, { from: 'scheduled', to: 'published', title: DEMO_CONTENT[0].title }],
    ['generated', 'content', content[2].id, { type: 'social_media', title: DEMO_CONTENT[2].title }],
    ['commented', 'content', reviewItem?.id, null],
    ['moved', 'content', content[3].id, { from: 'review', to: 'revision', title: DEMO_CONTENT[3].title }],
    ['added', 'knowledge', kb[1], { title: 'Pricing and plans' }],
    ['ran', 'workflow_template', templates[0].id, { name: 'Blog post pipeline' }],
  ].map(([action, entity, entity_id, details], i) => ({
    user_id: uid,
    action,
    entity,
    entity_id,
    details,
    is_demo: true,
    created_at: new Date(now - i * 3.5 * 3600_000).toISOString(),
  }));
  await db().from('activity_logs').insert(acts);

  const seed = { content: content.map((c) => c.id), prompts: prompts.map((p) => p.id), templates: templates.map((t) => t.id), kb };
  must(await db().from('app_settings').upsert({ key: 'demo_seed', value: seed }));
  res.json({ ok: true, counts: { content: content.length, prompts: prompts.length, templates: templates.length, knowledge: kb.length, usage: logs.length } });
});

r.delete('/demo/seed', async (_req, res) => {
  const seed = await getSetting('demo_seed');
  if (seed) {
    if (seed.content?.length) await db().from('content_items').delete().in('id', seed.content);
    if (seed.prompts?.length) await db().from('prompts').delete().in('id', seed.prompts);
    if (seed.templates?.length) await db().from('workflow_templates').delete().in('id', seed.templates);
    if (seed.kb?.length) await db().from('kb_sources').delete().in('id', seed.kb);
  }
  await db().from('usage_logs').delete().eq('is_demo', true);
  await db().from('activity_logs').delete().eq('is_demo', true);
  await db().from('app_settings').delete().eq('key', 'demo_seed');
  res.json({ ok: true });
});

r.get('/demo/status', async (_req, res) => {
  const seed = await getSetting('demo_seed');
  res.json({ loaded: Boolean(seed?.content?.length) });
});

export default r;
