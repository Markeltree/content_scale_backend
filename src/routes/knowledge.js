import { Router } from 'express';
import { requireWrite } from '../middleware/auth.js';
import { streamToClient } from '../lib/anthropic.js';
import { addToKnowledge, searchKnowledge, formatContext } from '../lib/knowledge.js';
import { brandVoiceBlock } from '../lib/prompts.js';
import { db, must, logActivity } from '../lib/supabase.js';

const r = Router();

r.get('/', async (_req, res) => {
  const sources = must(
    await db().from('kb_sources').select('*, author:profiles(full_name)').order('created_at', { ascending: false })
  );
  const { count } = await db().from('kb_chunks').select('id', { count: 'exact', head: true });
  res.json({ sources, totalChunks: count ?? 0 });
});

r.get('/:id', async (req, res) => {
  const source = must(await db().from('kb_sources').select('*').eq('id', req.params.id).single());
  const chunks = must(await db().from('kb_chunks').select('id, chunk_index, content').eq('source_id', req.params.id).order('chunk_index'));
  res.json({ source, chunks });
});

r.post('/', requireWrite, async (req, res) => {
  const { title, text, sourceType = 'text' } = req.body;
  if (!title?.trim() || !text?.trim()) return res.status(400).json({ error: 'Title and text are required' });
  const source = await addToKnowledge({ userId: req.user.id, title, text, sourceType });
  await logActivity(req.user.id, 'added', 'knowledge', source.id, { title });
  res.status(201).json({ source });
});

r.delete('/:id', requireWrite, async (req, res) => {
  const src = must(await db().from('kb_sources').select('document_id').eq('id', req.params.id).maybeSingle());
  must(await db().from('kb_sources').delete().eq('id', req.params.id));
  if (src?.document_id) await db().from('documents').update({ in_knowledge_base: false }).eq('id', src.document_id);
  res.json({ ok: true });
});

r.post('/search', async (req, res) => {
  const results = await searchKnowledge(req.body.query || '', Number(req.body.limit) || 8);
  res.json({ results });
});

/**
 * POST /api/knowledge/chat (SSE) — Retrieval-augmented chat
 * body: { messages: [{role, content}], model }
 */
r.post('/chat', async (req, res) => {
  const messages = (req.body.messages || []).filter((m) => m?.content?.trim()).slice(-12);
  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last) return res.status(400).json({ error: 'A user message is required' });

  // Use the last two user turns for retrieval so follow-ups keep context.
  const userTurns = messages.filter((m) => m.role === 'user').slice(-2).map((m) => m.content).join(' ');
  const [sources, brand] = await Promise.all([searchKnowledge(userTurns, 6), brandVoiceBlock()]);

  const system = `You are the ContentScale knowledge assistant. You answer questions about the company using its knowledge base.
${brand}
Rules:
- Base answers on the <knowledge> sources. Cite them inline like [1], [2] using the source index.
- If the knowledge base doesn't contain the answer, say that clearly, then offer general guidance labelled as such.
- Use concise Markdown.
<knowledge>
${formatContext(sources) || '(no matching sources found)'}
</knowledge>`;

  await streamToClient(res, {
    system,
    messages: messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    model: req.body.model,
    maxTokens: 2500,
    feature: 'knowledge_chat',
    userId: req.user.id,
    meta: { sources: sources.map((s, i) => ({ index: i + 1, title: s.title, excerpt: s.content.slice(0, 220), sourceId: s.source_id })) },
  });
});

export default r;
