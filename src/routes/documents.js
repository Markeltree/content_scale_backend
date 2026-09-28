import { Router } from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';
import { requireWrite } from '../middleware/auth.js';
import { complete, streamToClient, extractJson, wordCount } from '../lib/anthropic.js';
import { addToKnowledge } from '../lib/knowledge.js';
import { db, must, logActivity } from '../lib/supabase.js';

const r = Router();
// Vercel caps request bodies at ~4.5 MB.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024 } });

const MAX_CONTEXT_CHARS = 120_000;

async function parseFile(file) {
  const name = file.originalname.toLowerCase();
  if (file.mimetype === 'application/pdf' || name.endsWith('.pdf')) {
    const pdf = await getDocumentProxy(new Uint8Array(file.buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join('\n\n') : text;
  }
  if (name.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ buffer: file.buffer });
    return value;
  }
  if (/\.(txt|md|markdown|csv|json|html?)$/.test(name) || file.mimetype.startsWith('text/')) {
    return file.buffer.toString('utf8');
  }
  throw Object.assign(new Error('Unsupported file type. Upload PDF, DOCX, TXT, MD, CSV or JSON.'), { status: 400 });
}

async function getDoc(id) {
  const doc = must(await db().from('documents').select('*').eq('id', id).maybeSingle());
  if (!doc) throw Object.assign(new Error('Document not found'), { status: 404 });
  return doc;
}

r.get('/', async (_req, res) => {
  const data = must(
    await db()
      .from('documents')
      .select('id, name, mime_type, size_bytes, word_count, summary, classification, in_knowledge_base, created_at, author:profiles(full_name)')
      .order('created_at', { ascending: false })
  );
  res.json({ documents: data });
});

r.get('/:id', async (req, res) => res.json({ document: await getDoc(req.params.id) }));

/** Upload a file, or send JSON { name, text } to paste raw text. */
r.post('/', requireWrite, upload.single('file'), async (req, res) => {
  let name;
  let text;
  let mime = 'text/plain';
  let size = 0;
  if (req.file) {
    name = req.file.originalname;
    mime = req.file.mimetype;
    size = req.file.size;
    text = await parseFile(req.file);
  } else {
    name = req.body.name || 'Pasted text';
    text = req.body.text || '';
    size = Buffer.byteLength(text);
  }
  text = (text || '').replace(/\u0000/g, '').trim();
  if (!text) return res.status(400).json({ error: 'No readable text found in this document (scanned PDFs need OCR first).' });

  const doc = must(
    await db()
      .from('documents')
      .insert({ user_id: req.user.id, name, mime_type: mime, size_bytes: size, text_content: text.slice(0, 400_000), word_count: wordCount(text) })
      .select('id, name, mime_type, size_bytes, word_count, created_at')
      .single()
  );
  await logActivity(req.user.id, 'uploaded', 'document', doc.id, { name });
  res.status(201).json({ document: doc });
});

r.delete('/:id', requireWrite, async (req, res) => {
  must(await db().from('kb_sources').delete().eq('document_id', req.params.id));
  must(await db().from('documents').delete().eq('id', req.params.id));
  res.json({ ok: true });
});

/** Add document to the RAG knowledge base. */
r.post('/:id/knowledge', requireWrite, async (req, res) => {
  const doc = await getDoc(req.params.id);
  if (doc.in_knowledge_base) return res.json({ ok: true, already: true });
  const source = await addToKnowledge({ userId: req.user.id, title: doc.name, text: doc.text_content, sourceType: 'document', documentId: doc.id });
  must(await db().from('documents').update({ in_knowledge_base: true }).eq('id', doc.id));
  res.json({ ok: true, source });
});

/**
 * POST /api/documents/:id/analyze
 * action: summarize | report | ask  → SSE stream
 * action: extract | classify        → JSON
 */
r.post('/:id/analyze', async (req, res) => {
  const { action = 'summarize', question, model } = req.body;
  if (req.user.role === 'viewer' && action !== 'ask') return res.status(403).json({ error: 'Viewers can only ask questions.' });
  const doc = await getDoc(req.params.id);
  const body = doc.text_content.slice(0, MAX_CONTEXT_CHARS);
  const docBlock = `<document name="${doc.name}">\n${body}\n</document>`;
  const system = 'You are ContentScale Document Intelligence, an expert analyst. Be accurate and only use information found in the document. If something is not in the document, say so.';

  if (action === 'extract' || action === 'classify') {
    const instructions =
      action === 'extract'
        ? `Extract structured information from the document. Return ONLY JSON with this shape:
{"title": string, "document_type": string, "key_facts": string[], "people": [{"name": string, "role": string}], "organizations": string[], "dates": [{"date": string, "context": string}], "amounts": [{"value": string, "context": string}], "action_items": string[], "keywords": string[]}`
        : `Classify the document. Return ONLY JSON with this shape:
{"category": string, "subcategories": string[], "topics": string[], "sentiment": "positive"|"neutral"|"negative"|"mixed", "audience": string, "confidentiality": "public"|"internal"|"confidential", "language": string, "reading_level": string, "confidence": number (0-1), "rationale": string}`;
    const { text } = await complete({
      system,
      prompt: `${docBlock}\n\n${instructions}`,
      model,
      maxTokens: 3000,
      feature: `document_${action}`,
      userId: req.user.id,
    });
    let result;
    try {
      result = extractJson(text);
    } catch {
      return res.status(502).json({ error: 'Could not parse the analysis. Please try again.' });
    }
    must(await db().from('documents').update(action === 'extract' ? { extracted: result } : { classification: result }).eq('id', doc.id));
    return res.json({ result });
  }

  const prompts = {
    summarize: 'Summarize this document in Markdown: a one-paragraph executive summary, then "## Key points" (5–8 bullets), then "## Notable details" and "## Open questions" if relevant.',
    report: 'Write a professional report based on this document in Markdown with sections: Executive Summary, Background, Key Findings, Analysis, Risks & Considerations, Recommendations, and Next Steps.',
    ask: `Answer this question using the document: "${question || 'What is this document about?'}". Quote short relevant passages where helpful. Use Markdown.`,
  };

  await streamToClient(res, {
    system,
    prompt: `${docBlock}\n\n${prompts[action] ?? prompts.summarize}`,
    model,
    maxTokens: action === 'report' ? 5000 : 2500,
    feature: `document_${action}`,
    userId: req.user.id,
    onComplete: async (text) => {
      if (action === 'summarize') await db().from('documents').update({ summary: text }).eq('id', doc.id);
      return {};
    },
  });
});

export default r;
