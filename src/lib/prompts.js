import { getSetting } from './supabase.js';

export const CONTENT_TYPES = {
  blog_post: { label: 'Blog article', guide: 'Write a well-structured blog article in Markdown with an H1 title, an engaging intro, H2/H3 sections, and a conclusion with a call to action.' },
  website_copy: { label: 'Website copy', guide: 'Write website copy in Markdown: a hero headline, subheadline, 3–4 benefit sections with short headings, social-proof placeholder, and a primary CTA.' },
  marketing_campaign: { label: 'Marketing campaign', guide: 'Create a multi-channel marketing campaign plan in Markdown: campaign concept and tagline, key message, audience insight, channel-by-channel assets (email, social, paid, landing page) with sample copy for each, and a simple 4-week timeline.' },
  social_media: { label: 'Social media content', guide: 'Write a set of social media posts in Markdown, grouped by platform (LinkedIn, X/Twitter, Instagram). Give 2 variations per platform, respect each platform\'s length norms, and suggest hashtags.' },
  product_description: { label: 'Product description', guide: 'Write a persuasive product description in Markdown: a headline, a short paragraph, a bullet list of key features written as benefits, and a closing line. Also include a 160-character SEO meta description at the end.' },
  email_campaign: { label: 'Email campaign', guide: 'Write an email campaign in Markdown: 3 subject line options, preview text, then the email body with greeting, body, a clear CTA button label, and sign-off. If length allows, add a short follow-up email.' },
  ad_copy: { label: 'Ad copy', guide: 'Write paid ad copy in Markdown: 5 headline options (max 30 chars), 4 descriptions (max 90 chars), and 2 longer social ad variants with a CTA.' },
  press_release: { label: 'Press release', guide: 'Write a press release in Markdown with headline, subheadline, dateline, body paragraphs with a quote from a spokesperson placeholder, boilerplate, and media contact placeholder.' },
};

export const LENGTHS = {
  short: 'Keep it concise — roughly 150–300 words.',
  medium: 'Aim for roughly 500–800 words.',
  long: 'Make it comprehensive — roughly 1,200–1,800 words.',
};

export async function brandVoiceBlock() {
  const bv = await getSetting('brand_voice');
  if (!bv) return '';
  const list = (a) => (Array.isArray(a) && a.length ? a.map((x) => `- ${x}`).join('\n') : '- (none)');
  return `<brand_voice>
Company: ${bv.company || ''}
Voice: ${bv.voice || ''}
Primary audience: ${bv.audience || ''}
Do:
${list(bv.do)}
Don't:
${list(bv.dont)}
Preferred keywords: ${(bv.keywords || []).join(', ')}
</brand_voice>`;
}

export const BASE_SYSTEM = `You are ContentScale, an expert AI content strategist and copywriter used by marketing and operations teams.
You write original, accurate, on-brand content. Never invent statistics, customer names or quotes as facts — use clearly marked placeholders like [Customer name] or [Stat] when something specific is needed.
Output clean Markdown only, with no preamble such as "Here is..." and no closing remarks.`;

export const ASSISTANT_ACTIONS = {
  rewrite: 'Rewrite the text to be clearer and more engaging while preserving its meaning.',
  grammar: 'Correct all grammar, spelling and punctuation. Keep wording and meaning as close to the original as possible.',
  tone: 'Rewrite the text in the requested tone while keeping the meaning.',
  summarize: 'Summarize the text. Start with a one-sentence TL;DR, then 3–6 bullet points with the key points.',
  expand: 'Expand the text with more detail, examples and supporting points, keeping the same voice.',
  shorten: 'Shorten the text by about half without losing the key message.',
  seo: 'Optimize the text for SEO for the given keywords: improve headings, naturally include keywords, and improve readability. After the rewritten text, add a section "## SEO notes" with a suggested title tag (≤60 chars), meta description (≤155 chars), and 3 bullet recommendations.',
  translate: 'Translate the text into the requested language, keeping formatting and tone.',
  headline: 'Generate 10 headline options for this text as a numbered list, mixing styles (benefit-led, question, how-to, number-led).',
};
