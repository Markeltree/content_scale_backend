import { Router } from 'express';
import { requireWrite } from '../middleware/auth.js';
import { wordCount, complete, extractJson } from '../lib/anthropic.js';
import { db, must, logActivity, getSetting } from '../lib/supabase.js';

const r = Router();

const SELECT = `*, author:profiles!content_items_user_id_fkey(id, full_name, email, avatar_url),
  assignee:profiles!content_items_assignee_id_fkey(id, full_name, email, avatar_url),
  comments:content_comments(count)`;

const PRIVILEGED = ['approved', 'scheduled', 'published'];

r.get('/', async (req, res) => {
  const { status, type, q, mine, limit = 200 } = req.query;
  let query = db().from('content_items').select(SELECT).order('updated_at', { ascending: false }).limit(Math.min(Number(limit), 500));
  if (status) query = query.in('status', String(status).split(','));
  if (type) query = query.eq('type', type);
  if (mine === 'true') query = query.eq('user_id', req.user.id);
  if (q) query = query.ilike('title', `%${String(q).replace(/[%_]/g, '')}%`);
  res.json({ items: must(await query) });
});

r.get('/:id', async (req, res) => {
  const item = must(await db().from('content_items').select(SELECT).eq('id', req.params.id).maybeSingle());
  if (!item) return res.status(404).json({ error: 'Content not found' });
  const comments = must(
    await db()
      .from('content_comments')
      .select('*, author:profiles(id, full_name, email, avatar_url)')
      .eq('content_id', req.params.id)
      .order('created_at')
  );
  const activity = must(
    await db()
      .from('activity_logs')
      .select('*, actor:profiles(full_name)')
      .eq('entity', 'content')
      .eq('entity_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(20)
  );
  res.json({ item, comments, activity });
});

r.post('/', requireWrite, async (req, res) => {
  const { title, type = 'blog_post', body = '', status = 'draft', priority = 'medium', channel, tags = [], due_date, assignee_id } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  const data = must(
    await db()
      .from('content_items')
      .insert({
        user_id: req.user.id,
        title,
        type,
        body,
        status: PRIVILEGED.includes(status) && req.user.role !== 'admin' ? 'draft' : status,
        priority,
        channel,
        tags,
        due_date: due_date || null,
        assignee_id: assignee_id || null,
        word_count: wordCount(body),
      })
      .select(SELECT)
      .single()
  );
  await logActivity(req.user.id, 'created', 'content', data.id, { title });
  res.status(201).json({ item: data });
});

r.patch('/:id', requireWrite, async (req, res) => {
  const current = must(await db().from('content_items').select('id, status, title').eq('id', req.params.id).maybeSingle());
  if (!current) return res.status(404).json({ error: 'Content not found' });

  const patch = {};
  for (const k of ['title', 'type', 'body', 'status', 'priority', 'channel', 'tags', 'due_date', 'scheduled_at', 'assignee_id'])
    if (k in req.body) patch[k] = req.body[k] === '' ? null : req.body[k];
  if ('body' in patch) patch.word_count = wordCount(patch.body || '');

  if (patch.status && patch.status !== current.status) {
    const workflow = await getSetting('workflow', {});
    const approvers = workflow?.approvers ?? ['admin'];
    if (workflow?.require_approval && PRIVILEGED.includes(patch.status) && !approvers.includes(req.user.role)) {
      return res.status(403).json({ error: `Only ${approvers.join('/')} users can move content to "${patch.status}" while approvals are required.` });
    }
    if (patch.status === 'scheduled' && !patch.scheduled_at && !req.body.scheduled_at) {
      patch.scheduled_at = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    }
  }
  patch.updated_at = new Date().toISOString();

  const data = must(await db().from('content_items').update(patch).eq('id', req.params.id).select(SELECT).single());
  if (patch.status && patch.status !== current.status) {
    await logActivity(req.user.id, 'moved', 'content', data.id, { from: current.status, to: patch.status, title: data.title });
  } else {
    await logActivity(req.user.id, 'edited', 'content', data.id, { title: data.title });
  }
  res.json({ item: data });
});

r.delete('/:id', requireWrite, async (req, res) => {
  const q = db().from('content_items').delete().eq('id', req.params.id);
  if (req.user.role !== 'admin') q.eq('user_id', req.user.id);
  must(await q);
  await logActivity(req.user.id, 'deleted', 'content', req.params.id);
  res.json({ ok: true });
});

r.post('/:id/comments', async (req, res) => {
  if (!req.body.body?.trim()) return res.status(400).json({ error: 'Comment is empty' });
  const data = must(
    await db()
      .from('content_comments')
      .insert({ content_id: req.params.id, user_id: req.user.id, body: req.body.body.trim() })
      .select('*, author:profiles(id, full_name, email, avatar_url)')
      .single()
  );
  await logActivity(req.user.id, 'commented', 'content', req.params.id);
  res.status(201).json({ comment: data });
});

/** AI quality review of a piece of content (JSON). */
r.post('/:id/review', async (req, res) => {
  const item = must(await db().from('content_items').select('title, body, type').eq('id', req.params.id).single());
  const { text } = await complete({
    system: 'You are a senior content editor reviewing work before publication.',
    prompt: `Review this ${item.type.replace('_', ' ')} titled "${item.title}".
<content>
${item.body.slice(0, 60000)}
</content>
Return ONLY JSON: {"score": number (0-100), "verdict": "approve"|"minor_changes"|"major_changes", "strengths": string[], "issues": string[], "suggestions": string[], "readability": string, "brand_fit": string}`,
    maxTokens: 1500,
    feature: 'content_review',
    userId: req.user.id,
  });
  try {
    res.json({ review: extractJson(text) });
  } catch {
    res.status(502).json({ error: 'Could not parse the review.' });
  }
});

export default r;
