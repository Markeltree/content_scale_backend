import { Router } from 'express';
import { requireWrite } from '../middleware/auth.js';
import { streamToClient } from '../lib/anthropic.js';
import { ASSISTANT_ACTIONS, brandVoiceBlock } from '../lib/prompts.js';
import { logActivity } from '../lib/supabase.js';

const r = Router();

/**
 * POST /api/assistant  (SSE stream)
 * body: { action, text, tone, keywords, language, instructions, useBrandVoice, model }
 */
r.post('/', requireWrite, async (req, res) => {
  const { action = 'rewrite', text, tone, keywords, language, instructions, useBrandVoice = false, model } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'Text is required' });
  if (text.length > 60000) return res.status(400).json({ error: 'Text is too long (max ~60,000 characters).' });

  const task = ASSISTANT_ACTIONS[action] ?? ASSISTANT_ACTIONS.rewrite;
  const brand = useBrandVoice ? await brandVoiceBlock() : '';

  const system = `You are an expert editor inside the ContentScale writing assistant.
Return only the edited result in Markdown — no explanations, no preamble, no quotes around the output.
${brand ? `Follow this brand voice where it doesn't conflict with the task:\n${brand}` : ''}`;

  const prompt = `Task: ${task}
${tone ? `Requested tone: ${tone}` : ''}
${keywords ? `Target keywords: ${keywords}` : ''}
${language ? `Target language: ${language}` : ''}
${instructions ? `Extra instructions: ${instructions}` : ''}

<text>
${text}
</text>`;

  await streamToClient(res, {
    system,
    prompt,
    model,
    maxTokens: 4096,
    feature: `assistant_${action}`,
    userId: req.user.id,
    onComplete: async () => {
      await logActivity(req.user.id, `assistant_${action}`, 'assistant', null);
      return {};
    },
  });
});

export default r;
