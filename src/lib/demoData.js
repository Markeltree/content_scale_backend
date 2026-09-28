// Sample workspace data used by Admin → "Load demo data".
// Everything created here is tracked in app_settings.demo_seed so it can be removed again.

export const DEMO_CONTENT = [
  {
    title: '5 Ways AI Content Automation Cuts Campaign Production Time',
    type: 'blog_post',
    status: 'published',
    priority: 'high',
    channel: 'Blog',
    tags: ['AI', 'content automation', 'marketing ops'],
    body: `# 5 Ways AI Content Automation Cuts Campaign Production Time

Marketing teams spend most of their week on work that repeats: first drafts, channel variations, approvals and formatting. AI content automation removes that friction so your team can focus on strategy.

## 1. First drafts in minutes
Instead of starting from a blank page, writers begin with a structured draft that already follows the brand voice.

## 2. One brief, every channel
A single campaign brief becomes blog, email, social and ad copy — each tuned to the channel's length and tone.

## 3. Brand voice built in
Guidelines live inside the platform, so every output sounds like your company without a style-guide lookup.

## 4. Faster approvals
Content moves through Draft → Review → Approved on one board, with comments attached to the work itself.

## 5. Answers grounded in your knowledge
Retrieval-augmented generation pulls facts from your own documents, so product details stay accurate.

**Ready to scale your content?** Start with one campaign and measure the hours you get back.`,
  },
  {
    title: 'Q4 Product Launch — Email Nurture Sequence',
    type: 'email_campaign',
    status: 'review',
    priority: 'high',
    channel: 'Email',
    tags: ['launch', 'email'],
    body: `**Subject line options**
1. Your content team just got a new teammate
2. Ship a month of content in a week
3. Meet the AI workspace built for marketers

**Preview text:** Draft, review and publish on-brand content from one place.

Hi [First name],

Your team has more channels to feed than ever — and the same number of hours. ContentScale brings generation, editing, approvals and your company knowledge into one workspace.

- Generate on-brand drafts for any channel
- Route work through approvals without email threads
- Ground every answer in your own documents

**[Book a 20-minute demo]**

Best,
The ContentScale team`,
  },
  {
    title: 'LinkedIn series: Behind the AI workflow',
    type: 'social_media',
    status: 'draft',
    priority: 'medium',
    channel: 'LinkedIn',
    tags: ['social', 'thought leadership'],
    body: `## LinkedIn

**Post 1**
Most "AI content" fails for one reason: it doesn't know your business. We connected our generator to our own knowledge base — product docs, case studies, pricing — and first-draft accuracy went up immediately. Grounding beats prompting.

**Post 2**
Our approval board has six columns: Draft, Review, Revision, Approved, Scheduled, Published. The magic isn't the AI — it's that every piece of content has one home.

#ContentOps #GenerativeAI #MarketingAutomation`,
  },
  {
    title: 'Homepage hero & value props refresh',
    type: 'website_copy',
    status: 'revision',
    priority: 'medium',
    channel: 'Website',
    tags: ['website', 'conversion'],
    body: `# Create more. Coordinate less.

The AI content workspace that drafts, edits and routes on-brand content for every channel.

## Generate in your voice
Brand guidelines are built into every draft.

## Grounded in your knowledge
Answers come from your own documents, not guesses.

## Approvals without the chaos
One board from draft to published.

**[Start free trial]**`,
  },
  {
    title: 'ContentScale Pro — product description',
    type: 'product_description',
    status: 'approved',
    priority: 'low',
    channel: 'Marketplace',
    tags: ['product'],
    body: `# ContentScale Pro

Everything your content team needs to plan, generate and publish at scale.

- **Generate faster:** on-brand drafts for eight content types
- **Stay accurate:** retrieval from your own knowledge base
- **Ship with confidence:** built-in review and approvals
- **See the impact:** usage and productivity analytics

Built for teams that publish every day.

*Meta description:* ContentScale Pro helps marketing teams generate, review and publish on-brand AI content with approvals and analytics.`,
  },
  {
    title: 'Paid search ads — AI writing assistant',
    type: 'ad_copy',
    status: 'scheduled',
    priority: 'medium',
    channel: 'Google Ads',
    tags: ['paid', 'search'],
    body: `**Headlines**
1. AI Writing, On-Brand
2. Draft Content 10x Faster
3. Approvals Built In
4. Your Docs, Your Answers
5. Try ContentScale Free

**Descriptions**
1. Generate blog posts, emails and ads in your brand voice. Start free today.
2. One workspace for drafting, reviewing and publishing AI content.`,
  },
  {
    title: 'Press release: ContentScale launches Document Intelligence',
    type: 'press_release',
    status: 'draft',
    priority: 'low',
    channel: 'PR',
    tags: ['press'],
    body: `# ContentScale Launches Document Intelligence

*New capability turns reports and contracts into summaries, structured data and ready-to-share briefs.*

[CITY], [DATE] — ContentScale today announced Document Intelligence, which lets teams upload PDFs and Word files and instantly summarize, classify and extract key information.

"[Spokesperson quote]," said [Name], [Title] at ContentScale.

**About ContentScale** — ContentScale is a generative AI platform for content teams.`,
  },
  {
    title: 'Customer story: How Nimbus scaled content 4x',
    type: 'blog_post',
    status: 'review',
    priority: 'medium',
    channel: 'Blog',
    tags: ['case study'],
    body: `# How [Customer] Scaled Content Output 4x

[Customer] needed to support three new markets without growing the content team.

## The challenge
Every campaign required localized blog, email and social content, and reviews happened over scattered email threads.

## The solution
The team centralized briefs, generated first drafts with their brand voice, and moved every piece through one approval board.

## The results
- [Stat] more content published per month
- [Stat] faster approval cycle
- Consistent voice across markets`,
  },
];

export const DEMO_PROMPTS = [
  {
    title: 'SEO blog outline',
    category: 'SEO',
    description: 'A search-optimized outline with headings, questions and internal link ideas.',
    template: 'Create a detailed SEO blog outline for the keyword "{{keyword}}" aimed at {{audience}}. Include an H1, 6–8 H2 sections with H3 sub-points, 5 FAQ questions people search for, and 3 internal link ideas. Search intent: {{intent}}.',
  },
  {
    title: 'Cold outreach email',
    category: 'Sales',
    description: 'Short, personal first-touch email for B2B prospects.',
    template: 'Write a 90-word cold email to {{prospect_role}} at {{company}}. Reference this trigger: {{trigger}}. Offer: {{offer}}. One clear question as the CTA. No buzzwords.',
  },
  {
    title: 'Product launch social pack',
    category: 'Social',
    description: 'Launch posts for LinkedIn, X and Instagram.',
    template: 'We are launching {{product}} on {{date}}. Key benefit: {{benefit}}. Write 3 LinkedIn posts, 5 X posts and 3 Instagram captions announcing it, with hashtags.',
  },
  {
    title: 'Meeting notes → action items',
    category: 'Operations',
    description: 'Turn raw notes into decisions, owners and deadlines.',
    template: 'Turn these meeting notes into: 1) a 3-sentence summary, 2) decisions made, 3) a table of action items with owner and due date.\n\nNotes:\n{{notes}}',
  },
  {
    title: 'Brand-voice rewrite',
    category: 'Editing',
    description: 'Rewrite any text so it matches our brand guidelines.',
    template: 'Rewrite the following text in our brand voice for {{channel}}. Keep it under {{word_limit}} words.\n\n{{text}}',
  },
  {
    title: 'Customer support macro',
    category: 'Support',
    description: 'Empathetic, accurate reply to a support ticket.',
    template: 'Write a friendly support reply to this ticket. Acknowledge the issue, explain the fix in numbered steps, and close with an offer to help further.\n\nTicket: {{ticket}}\nKnown fix: {{fix}}',
  },
];

export const DEMO_TEMPLATES = [
  {
    name: 'Blog post pipeline',
    description: 'Research outline → full draft → SEO polish.',
    steps: [
      { name: 'Outline', instruction: 'Create a detailed outline for a blog post on the input topic, with H2/H3 headings and key points.' },
      { name: 'Draft', instruction: 'Write the full blog post in Markdown following the previous outline. About 900 words.' },
      { name: 'SEO polish', instruction: 'Improve the draft for SEO: tighten headings, add a meta description at the end, and improve readability. Return the full final article.' },
    ],
  },
  {
    name: 'Repurpose to social',
    description: 'Turn long-form content into a week of social posts.',
    steps: [
      { name: 'Key messages', instruction: 'Extract the 5 most shareable insights from the input as short bullet points.' },
      { name: 'Social posts', instruction: 'Turn each insight into a LinkedIn post and an X post. Group by day, Monday–Friday.' },
    ],
  },
  {
    name: 'Campaign in a box',
    description: 'Brief → messaging → email + ads.',
    steps: [
      { name: 'Messaging', instruction: 'From the input brief, write a campaign tagline, key message and three supporting proof points.' },
      { name: 'Email', instruction: 'Write a launch email using the messaging. Include 3 subject lines.' },
      { name: 'Ads', instruction: 'Write 5 search ad headlines (≤30 chars) and 3 descriptions (≤90 chars) using the messaging.' },
    ],
  },
];

export const DEMO_KNOWLEDGE = [
  {
    title: 'Company overview',
    text: `ContentScale is a generative AI platform that helps businesses automate content creation, accelerate workflows and unlock productivity through advanced AI intelligence.
The platform combines AI content generation, AI-powered writing assistants, image and media generation, document intelligence, and knowledge automation in one workspace.
Our customers are marketing and operations teams at growing B2B companies with 20 to 2,000 employees.
Core values: accuracy over hype, human review before publishing, and brand consistency across every channel.`,
  },
  {
    title: 'Pricing and plans',
    text: `ContentScale offers three plans.
Starter costs $49 per user per month and includes content generation, the writing assistant and 5 knowledge base sources.
Growth costs $99 per user per month and adds document intelligence, image generation, unlimited knowledge sources and the approval workflow.
Enterprise has custom pricing and adds SSO, audit logs, custom model controls, a dedicated success manager and a 99.9% uptime SLA.
All plans include a 14-day free trial. Annual billing gives a 20% discount.`,
  },
  {
    title: 'Product FAQ',
    text: `Which AI models does ContentScale use? ContentScale uses Anthropic's Claude models. Admins can choose which models are enabled and set a default.
Is customer data used to train models? No. Customer content is not used to train models.
What file types can Document Intelligence read? PDF, DOCX, TXT, Markdown, CSV and JSON files up to 4 MB.
How does the approval workflow work? Content moves through Draft, Review, Revision, Approved, Scheduled and Published. When approvals are required, only approvers can move content to Approved or later stages.
Does ContentScale support team collaboration? Yes. Prompts and workflow templates can be shared with the whole team, and every content item supports comments.`,
  },
];
