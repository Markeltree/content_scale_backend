import { Router } from 'express';
import { requireWrite } from '../middleware/auth.js';
import { streamToClient, complete, extractJson, wordCount } from '../lib/anthropic.js';
import { BASE_SYSTEM, CONTENT_TYPES, LENGTHS, brandVoiceBlock } from '../lib/prompts.js';
import { searchKnowledge, formatContext } from '../lib/knowledge.js';
import { db, logActivity, getSetting } from '../lib/supabase.js';

const r = Router();

r.get('/types', (_req, res) =>
  res.json({ types: Object.entries(CONTENT_TYPES).map(([id, t]) => ({ id, label: t.label })) })
);

/**
 * POST /api/generate/content  (SSE stream)
 * body: { type, topic, audience, tone, length, keywords, instructions, useBrandVoice, useKnowledge, model, save }
 */
r.post('/content', requireWrite, async (req, res) => {
  const {
    type = 'blog_post',
    topic,
    audience,
    tone = 'Professional',
    length = 'medium',
    keywords = '',
    instructions = '',
    useBrandVoice = true,
    useKnowledge = false,
    model,
    save = true,
  } = req.body;
  if (!topic?.trim()) return res.status(400).json({ error: 'Topic is required' });

  const ct = CONTENT_TYPES[type] ?? CONTENT_TYPES.blog_post;
  const [brand, sources] = await Promise.all([
    useBrandVoice ? brandVoiceBlock() : '',
    useKnowledge ? searchKnowledge(`${topic} ${keywords}`, 6) : [],
  ]);

  const system = [
    BASE_SYSTEM,
    brand && `Follow this brand voice:\n${brand}`,
    sources.length &&
      `Ground the content in the company knowledge below. Prefer these facts over general knowledge and do not contradict them.\n<knowledge>\n${formatContext(sources)}\n</knowledge>`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const prompt = `Task: ${ct.guide}
Topic / brief: ${topic}
Target audience: ${audience || 'General business audience'}
Tone: ${tone}
Length: ${LENGTHS[length] ?? LENGTHS.medium}
${keywords ? `Keywords to include naturally: ${keywords}` : ''}
${instructions ? `Additional instructions: ${instructions}` : ''}`;

  await streamToClient(res, {
    system,
    prompt,
    model,
    maxTokens: length === 'long' ? 6000 : 3500,
    feature: 'content_generation',
    userId: req.user.id,
    meta: { sources: sources.map((s) => ({ title: s.title, excerpt: s.content.slice(0, 180) })) },
    onComplete: async (text) => {
      if (!save || !text.trim()) return {};
      const workflow = await getSetting('workflow', {});
      const title = (text.match(/^#\s+(.+)$/m)?.[1] || topic).slice(0, 160);
      const { data } = await db()
        .from('content_items')
        .insert({
          user_id: req.user.id,
          title,
          type,
          body: text,
          status: workflow?.auto_submit_generated ? 'review' : 'draft',
          word_count: wordCount(text),
          tags: keywords ? keywords.split(',').map((k) => k.trim()).filter(Boolean).slice(0, 8) : [],
          metadata: { topic, audience, tone, length, generated: true, sources: sources.length },
        })
        .select('id, title, status')
        .single();
      await logActivity(req.user.id, 'generated', 'content', data?.id, { type, title });
      return { contentId: data?.id, title: data?.title, status: data?.status };
    },
  });
});

/** POST /api/generate/ideas — quick topic ideas (JSON) */
r.post('/ideas', requireWrite, async (req, res) => {
  const { type = 'blog_post', niche = '', model } = req.body;
  const brand = await brandVoiceBlock();
  const { text } = await complete({
    system: `${BASE_SYSTEM}\n${brand}`,
    prompt: `Suggest 6 fresh content ideas for a ${CONTENT_TYPES[type]?.label || 'blog article'}${niche ? ` about ${niche}` : ''}.
Return ONLY a JSON array of objects: [{"title": string, "angle": string, "audience": string}]`,
    model,
    maxTokens: 1200,
    feature: 'ideas',
    userId: req.user.id,
  });
  let ideas = [];
  try {
    ideas = extractJson(text);
  } catch {
    ideas = [];
  }
  res.json({ ideas });
});

export default r;
