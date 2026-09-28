import { Router } from 'express';
import { requireWrite } from '../middleware/auth.js';
import { streamToClient } from '../lib/anthropic.js';
import { brandVoiceBlock } from '../lib/prompts.js';
import { db, must, logActivity } from '../lib/supabase.js';

const r = Router();

const RATIOS = {
  '1:1': [1080, 1080],
  '16:9': [1600, 900],
  '9:16': [900, 1600],
  '4:5': [1080, 1350],
  '3:2': [1500, 1000],
};

const CATEGORIES = {
  marketing_visual: 'a marketing visual / hero graphic',
  product_imagery: 'a stylized product showcase illustration',
  concept_art: 'concept art / editorial illustration',
  social_graphic: 'a social media graphic with a short headline',
  ad_creative: 'a paid advertising creative with headline and call-to-action button',
  brand_asset: 'a brand asset such as a pattern, badge or abstract brand illustration',
};

/** Strip anything executable or external from model-produced SVG. */
export function sanitizeSvg(svg) {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '')
    .replace(/(href|xlink:href)\s*=\s*("|')\s*(javascript:|https?:|data:text)[^"']*\2/gi, '')
    .replace(/@import[^;]+;/gi, '');
}

r.get('/', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const q = db().from('images').select('*, author:profiles(full_name)').order('created_at', { ascending: false }).limit(limit);
  if (req.query.mine === 'true') q.eq('user_id', req.user.id);
  res.json({ images: must(await q) });
});

/**
 * POST /api/images/generate  (SSE)
 * body: { prompt, category, style, aspectRatio, palette, headline, useBrandVoice, model }
 */
r.post('/generate', requireWrite, async (req, res) => {
  const { prompt, category = 'marketing_visual', style = 'Modern flat', aspectRatio = '1:1', palette = '', headline = '', useBrandVoice = true, model } = req.body;
  if (!prompt?.trim()) return res.status(400).json({ error: 'Prompt is required' });
  const [w, h] = RATIOS[aspectRatio] ?? RATIOS['1:1'];
  const brand = useBrandVoice ? await brandVoiceBlock() : '';

  const system = `You are a senior brand illustrator and art director who produces production-ready vector artwork as hand-written SVG.
Rules for the SVG:
- A single root <svg> with xmlns="http://www.w3.org/2000/svg", width="${w}" height="${h}" and viewBox="0 0 ${w} ${h}".
- Fully self-contained: no <script>, no <image>, no external fonts, links or CSS imports. Use font-family="Inter, Helvetica, Arial, sans-serif".
- Rich composition: layered shapes, <linearGradient>/<radialGradient>, subtle shadows via <filter>, depth, balanced negative space. It should look like a polished marketing asset, not clip art.
- Any text must be short, spelled correctly, and fit inside the canvas with comfortable margins.
- Keep it under ~250 elements.
Output format — exactly these two parts and nothing else:
<enhanced_prompt>A detailed 60–100 word prompt describing the image, suitable for a photorealistic text-to-image model.</enhanced_prompt>
<svg ...>...</svg>`;

  const userPrompt = `Create ${CATEGORIES[category] ?? CATEGORIES.marketing_visual}.
Brief: ${prompt}
Visual style: ${style}
Aspect ratio: ${aspectRatio} (${w}×${h})
${palette ? `Color palette: ${palette}` : 'Choose a harmonious, modern palette.'}
${headline ? `Include this headline text: "${headline}"` : ''}
${brand ? `Brand context:\n${brand}` : ''}`;

  await streamToClient(res, {
    system,
    prompt: userPrompt,
    model,
    maxTokens: 12000,
    feature: 'image_generation',
    userId: req.user.id,
    onComplete: async (text) => {
      const svgMatch = text.match(/<svg[\s\S]*<\/svg>/i);
      if (!svgMatch) return { error: 'The model did not return valid SVG. Try again or simplify the brief.' };
      const enhanced = text.match(/<enhanced_prompt>([\s\S]*?)<\/enhanced_prompt>/i)?.[1]?.trim() ?? null;
      const svg = sanitizeSvg(svgMatch[0]);
      const image = must(
        await db()
          .from('images')
          .insert({ user_id: req.user.id, prompt, enhanced_prompt: enhanced, category, style, aspect_ratio: aspectRatio, svg })
          .select()
          .single()
      );
      await logActivity(req.user.id, 'generated', 'image', image.id, { category });
      return { image };
    },
  });
});

r.delete('/:id', requireWrite, async (req, res) => {
  const q = db().from('images').delete().eq('id', req.params.id);
  if (req.user.role !== 'admin') q.eq('user_id', req.user.id);
  must(await q);
  res.json({ ok: true });
});

export default r;
