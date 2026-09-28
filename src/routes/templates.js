import { Router } from 'express';
import { requireWrite } from '../middleware/auth.js';
import { claude, resolveModel, logUsage, openSSE, friendlyError, wordCount } from '../lib/anthropic.js';
import { BASE_SYSTEM, brandVoiceBlock } from '../lib/prompts.js';
import { db, must, logActivity } from '../lib/supabase.js';

const r = Router();

r.get('/', async (req, res) => {
  const data = must(
    await db()
      .from('workflow_templates')
      .select('*, author:profiles(full_name)')
      .or(`is_shared.eq.true,user_id.eq.${req.user.id}`)
      .order('created_at', { ascending: false })
  );
  res.json({ templates: data });
});

const cleanSteps = (steps) =>
  (Array.isArray(steps) ? steps : [])
    .filter((s) => s?.instruction?.trim())
    .slice(0, 8)
    .map((s, i) => ({ name: s.name?.trim() || `Step ${i + 1}`, instruction: s.instruction.trim() }));

r.post('/', requireWrite, async (req, res) => {
  const { name, description, steps, is_shared = true } = req.body;
  const clean = cleanSteps(steps);
  if (!name?.trim() || !clean.length) return res.status(400).json({ error: 'Name and at least one step are required' });
  const data = must(
    await db().from('workflow_templates').insert({ user_id: req.user.id, name, description, steps: clean, is_shared }).select().single()
  );
  await logActivity(req.user.id, 'created', 'workflow_template', data.id, { name });
  res.status(201).json({ template: data });
});

r.patch('/:id', requireWrite, async (req, res) => {
  const patch = {};
  for (const k of ['name', 'description', 'is_shared']) if (k in req.body) patch[k] = req.body[k];
  if (req.body.steps) patch.steps = cleanSteps(req.body.steps);
  const data = must(await db().from('workflow_templates').update(patch).eq('id', req.params.id).select().single());
  res.json({ template: data });
});

r.delete('/:id', requireWrite, async (req, res) => {
  must(await db().from('workflow_templates').delete().eq('id', req.params.id));
  res.json({ ok: true });
});

/**
 * POST /api/templates/:id/run (SSE)
 * Runs each step in sequence; every step receives the original input and the previous step's output.
 * Events: step_start {index,name} · text {index,text} · step_done {index} · done {finalOutput, contentId}
 */
r.post('/:id/run', requireWrite, async (req, res) => {
  const t = must(await db().from('workflow_templates').select('*').eq('id', req.params.id).single());
  const input = req.body.input || '';
  const send = openSSE(res);
  try {
    const m = await resolveModel(req.body.model);
    const brand = await brandVoiceBlock();
    let previous = '';
    const outputs = [];
    for (const [i, step] of t.steps.entries()) {
      send({ type: 'step_start', index: i, name: step.name });
      const prompt = `You are executing step ${i + 1} of ${t.steps.length} in the workflow "${t.name}".
Step instruction: ${step.instruction}

<original_input>
${input}
</original_input>
${previous ? `<previous_step_output>\n${previous}\n</previous_step_output>` : ''}

Produce only this step's output.`;
      const stream = claude().messages.stream({
        model: m.id,
        max_tokens: Math.min(4096, m.max_output_tokens || 4096),
        system: `${BASE_SYSTEM}\n${brand}`,
        messages: [{ role: 'user', content: prompt }],
      });
      let out = '';
      stream.on('text', (tx) => {
        out += tx;
        send({ type: 'text', index: i, text: tx });
      });
      const final = await stream.finalMessage();
      await logUsage(req.user.id, 'workflow_run', m.id, final.usage);
      outputs.push({ name: step.name, output: out });
      previous = out;
      send({ type: 'step_done', index: i });
    }

    await db().from('workflow_templates').update({ runs: (t.runs || 0) + 1 }).eq('id', t.id);
    await db().from('prompt_runs').insert({ user_id: req.user.id, template_id: t.id, input: { input }, output: previous });

    let contentId = null;
    if (req.body.saveToLibrary) {
      const { data } = await db()
        .from('content_items')
        .insert({
          user_id: req.user.id,
          title: (previous.match(/^#\s+(.+)$/m)?.[1] || `${t.name} output`).slice(0, 160),
          type: req.body.contentType || 'blog_post',
          body: previous,
          word_count: wordCount(previous),
          metadata: { workflow: t.name, generated: true },
        })
        .select('id')
        .single();
      contentId = data?.id;
    }
    await logActivity(req.user.id, 'ran', 'workflow_template', t.id, { name: t.name });
    send({ type: 'done', outputs, finalOutput: previous, contentId });
  } catch (err) {
    send({ type: 'error', message: friendlyError(err) });
  } finally {
    res.end();
  }
});

export default r;
