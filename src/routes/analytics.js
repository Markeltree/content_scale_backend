import { Router } from 'express';
import { db, must } from '../lib/supabase.js';

const r = Router();

const FEATURE_GROUPS = [
  [/^content_generation|^ideas/, 'Content Generation'],
  [/^assistant_/, 'Writing Assistant'],
  [/^image_/, 'Image Generation'],
  [/^document_/, 'Document Intelligence'],
  [/^knowledge_/, 'Knowledge Base'],
  [/^prompt_|^playground|^workflow_run/, 'Prompt Workspace'],
  [/^content_review/, 'Content Review'],
];
export const featureGroup = (f = '') => FEATURE_GROUPS.find(([re]) => re.test(f))?.[1] ?? 'Other';

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);
const pct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 100) : cur ? 100 : 0);

/**
 * GET /api/analytics/overview?days=30&scope=me|team
 * Team scope is available to everyone (workspace-level analytics); per-user leaderboard is admin only.
 */
r.get('/overview', async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
  const scopeMe = req.query.scope === 'me';
  const since = new Date(Date.now() - days * 86400_000);
  const prevSince = new Date(Date.now() - 2 * days * 86400_000);

  let usageQ = db().from('usage_logs').select('user_id, feature, model, input_tokens, output_tokens, created_at').gte('created_at', prevSince.toISOString()).range(0, 49_999);
  let contentQ = db().from('content_items').select('id, user_id, status, type, word_count, created_at, metadata').range(0, 19_999);
  if (scopeMe) {
    usageQ = usageQ.eq('user_id', req.user.id);
    contentQ = contentQ.eq('user_id', req.user.id);
  }

  const [usage, content, models, images, docs, prompts, kb, activity, profiles] = await Promise.all([
    usageQ.then(must),
    contentQ.then(must),
    db().from('ai_models').select('id, name, input_price, output_price').then(must),
    db().from('images').select('id', { count: 'exact', head: true }),
    db().from('documents').select('id', { count: 'exact', head: true }),
    db().from('prompts').select('id', { count: 'exact', head: true }),
    db().from('kb_sources').select('id', { count: 'exact', head: true }),
    db().from('activity_logs').select('*, actor:profiles(full_name, avatar_url)').order('created_at', { ascending: false }).limit(12).then(must),
    req.user.role === 'admin' ? db().from('profiles').select('id, full_name, email, avatar_url, role').then(must) : Promise.resolve([]),
  ]);

  const price = Object.fromEntries(models.map((m) => [m.id, m]));
  const cost = (u) => {
    const p = price[u.model] ?? { input_price: 3, output_price: 15 };
    return (u.input_tokens * Number(p.input_price) + u.output_tokens * Number(p.output_price)) / 1_000_000;
  };

  const cur = usage.filter((u) => new Date(u.created_at) >= since);
  const prev = usage.filter((u) => new Date(u.created_at) < since);
  const sum = (rows, f) => rows.reduce((a, x) => a + f(x), 0);

  const curContent = content.filter((c) => new Date(c.created_at) >= since);
  const prevContent = content.filter((c) => new Date(c.created_at) < since && new Date(c.created_at) >= prevSince);
  const words = sum(curContent, (c) => c.word_count || 0);
  const prevWords = sum(prevContent, (c) => c.word_count || 0);

  // Daily series
  const daily = {};
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(Date.now() - i * 86400_000);
    daily[k] = { date: k, generations: 0, tokens: 0, content: 0 };
  }
  for (const u of cur) {
    const d = daily[dayKey(u.created_at)];
    if (d) {
      d.generations += 1;
      d.tokens += u.input_tokens + u.output_tokens;
    }
  }
  for (const c of curContent) {
    const d = daily[dayKey(c.created_at)];
    if (d) d.content += 1;
  }

  const group = (rows, keyFn, valFn = () => 1) =>
    Object.entries(rows.reduce((acc, x) => ((acc[keyFn(x)] = (acc[keyFn(x)] || 0) + valFn(x)), acc), {}))
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);

  const byStatus = ['draft', 'review', 'revision', 'approved', 'scheduled', 'published'].map((s) => ({
    name: s,
    value: content.filter((c) => c.status === s).length,
  }));

  let topUsers = [];
  if (req.user.role === 'admin' && !scopeMe) {
    const byUser = {};
    for (const u of cur) {
      byUser[u.user_id] ??= { generations: 0, tokens: 0, cost: 0 };
      byUser[u.user_id].generations += 1;
      byUser[u.user_id].tokens += u.input_tokens + u.output_tokens;
      byUser[u.user_id].cost += cost(u);
    }
    topUsers = profiles
      .map((p) => ({ ...p, ...(byUser[p.id] ?? { generations: 0, tokens: 0, cost: 0 }) }))
      .sort((a, b) => b.generations - a.generations)
      .slice(0, 8);
  }

  const totalTokens = sum(cur, (u) => u.input_tokens + u.output_tokens);
  const prevTokens = sum(prev, (u) => u.input_tokens + u.output_tokens);
  // A human writer drafts ~500 words/hour; count generated words only.
  const generatedWords = sum(curContent.filter((c) => c.metadata?.generated), (c) => c.word_count || 0);

  res.json({
    days,
    totals: {
      generations: cur.length,
      generationsChange: pct(cur.length, prev.length),
      tokens: totalTokens,
      tokensChange: pct(totalTokens, prevTokens),
      inputTokens: sum(cur, (u) => u.input_tokens),
      outputTokens: sum(cur, (u) => u.output_tokens),
      cost: Number(sum(cur, cost).toFixed(4)),
      words,
      wordsChange: pct(words, prevWords),
      contentCreated: curContent.length,
      contentChange: pct(curContent.length, prevContent.length),
      hoursSaved: Math.round((generatedWords / 500) * 10) / 10,
      published: content.filter((c) => c.status === 'published').length,
      inReview: content.filter((c) => c.status === 'review').length,
      images: images.count ?? 0,
      documents: docs.count ?? 0,
      prompts: prompts.count ?? 0,
      knowledgeSources: kb.count ?? 0,
    },
    daily: Object.values(daily),
    byFeature: group(cur, (u) => featureGroup(u.feature)),
    byModel: group(cur, (u) => price[u.model]?.name ?? u.model, (u) => u.input_tokens + u.output_tokens),
    byType: group(content, (c) => c.type),
    byStatus,
    topUsers,
    activity,
  });
});

export default r;
