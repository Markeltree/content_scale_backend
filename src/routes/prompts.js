import { Router } from 'express';
import { requireWrite } from '../middleware/auth.js';
import { complete, streamToClient, extractJson } from '../lib/anthropic.js';
import { BASE_SYSTEM, brandVoiceBlock } from '../lib/prompts.js';
import { db, must, logActivity } from '../lib/supabase.js';

const r = Router();

export const findVariables = (template = '') => [...new Set([...template.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((m) => m[1]))];
const fill = (template, vars = {}) => template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => vars[k] ?? `[${k}]`);

r.get('/', async (req, res) => {
  const q = db()
    .from('prompts')
    .select('*, author:profiles(full_name)')
    .or(`is_shared.eq.true,user_id.eq.${req.user.id}`)
    .order('updated_at', { ascending: false });
  res.json({ prompts: must(await q) });
});

r.post('/', requireWrite, async (req, res) => {
  const { title, description, category = 'General', template, is_shared = true } = req.body;
  if (!title?.trim() || !template?.trim()) return res.status(400).json({ error: 'Title and template are required' });
  const data = must(
    await db()
      .from('prompts')
      .insert({ user_id: req.user.id, title, description, category, template, is_shared, variables: findVariables(template) })
      .select()
      .single()
  );
  await logActivity(req.user.id, 'created', 'prompt', data.id, { title });
  res.status(201).json({ prompt: data });
});

r.patch('/:id', requireWrite, async (req, res) => {
  const patch = {};
  for (const k of ['title', 'description', 'category', 'template', 'is_shared', 'is_favorite']) if (k in req.body) patch[k] = req.body[k];
  if (patch.template) patch.variables = findVariables(patch.template);
  patch.updated_at = new Date().toISOString();
  const data = must(await db().from('prompts').update(patch).eq('id', req.params.id).select().single());
  res.json({ prompt: data });
});

r.delete('/:id', requireWrite, async (req, res) => {
  const q = db().from('prompts').delete().eq('id', req.params.id);
  if (req.user.role !== 'admin') q.eq('user_id', req.user.id);
  must(await q);
  res.json({ ok: true });
});

/** Run a saved prompt with variables (SSE). */
r.post('/:id/run', requireWrite, async (req, res) => {
  const p = must(await db().from('prompts').select('*').eq('id', req.params.id).single());
  const filled = fill(p.template, req.body.variables);
  const brand = req.body.useBrandVoice ? await brandVoiceBlock() : '';
  await db().from('prompts').update({ uses: (p.uses || 0) + 1 }).eq('id', p.id);
  await streamToClient(res, {
    system: `${BASE_SYSTEM}\n${brand}`,
    prompt: filled,
    model: req.body.model,
    maxTokens: 4096,
    feature: 'prompt_run',
    userId: req.user.id,
    meta: { filledPrompt: filled },
    onComplete: async (text) => {
      await db().from('prompt_runs').insert({ user_id: req.user.id, prompt_id: p.id, input: req.body.variables || {}, output: text });
      return {};
    },
  });
});

/** Ad-hoc playground run (SSE). */
r.post('/playground', requireWrite, async (req, res) => {
  const { prompt, system, model } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });
  await streamToClient(res, {
    system: system?.trim() || BASE_SYSTEM,
    prompt,
    model,
    maxTokens: 4096,
    feature: 'playground',
    userId: req.user.id,
  });
});

/** AI prompt optimization (JSON). */
r.post('/optimize', requireWrite, async (req, res) => {
  const { template, goal = '', model } = req.body;
  if (!template?.trim()) return res.status(400).json({ error: 'Template is required' });
  const { text } = await complete({
    system: 'You are a world-class prompt engineer. You improve prompts for large language models so they produce consistent, high-quality output.',
    prompt: `Improve this prompt template. Keep any {{variables}} it uses (you may add useful new ones in the same {{name}} format).
Make it specific: role, context, task, constraints, output format, and quality bar.
${goal ? `The user's goal: ${goal}` : ''}

<prompt>
${template}
</prompt>

Return ONLY JSON: {"optimized": string, "changes": string[] (3-6 short bullet explanations), "score_before": number (1-10), "score_after": number (1-10)}`,
    model,
    maxTokens: 3000,
    feature: 'prompt_optimize',
    userId: req.user.id,
  });
  try {
    const result = extractJson(text);
    result.variables = findVariables(result.optimized);
    res.json(result);
  } catch {
    res.status(502).json({ error: 'Could not parse the optimized prompt. Please try again.' });
  }
});

export default r;
