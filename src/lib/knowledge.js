import { db, must } from './supabase.js';

const STOP = new Set(
  'a an and are as at be been but by can could did do does for from had has have how i if in into is it its me my of on or our should so than that the their them then there these they this to was we what when where which who why will with would you your about tell give show please using use make write need want'.split(' ')
);

/** Split text into ~1,200 character chunks on paragraph/sentence boundaries. */
export function chunkText(text, size = 1200, overlap = 150) {
  const clean = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const parts = clean.split(/(?<=[.!?])\s+|\n\n/);
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if ((cur + ' ' + p).length > size && cur) {
      chunks.push(cur.trim());
      cur = cur.slice(-overlap) + ' ' + p;
    } else {
      cur += (cur ? ' ' : '') + p;
    }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks;
}

/** Turn a natural-language question into an OR tsquery: "pricing | plan | team". */
export function toTsQuery(query) {
  const words = (query.toLowerCase().match(/[a-z0-9]+/g) || [])
    .filter((w) => w.length > 2 && !STOP.has(w));
  return [...new Set(words)].slice(0, 14).join(' | ');
}

export async function searchKnowledge(query, limit = 6) {
  const q = toTsQuery(query);
  if (!q) return [];
  const { data, error } = await db().rpc('search_kb', { q, match_count: limit });
  if (error) return [];
  return data ?? [];
}

export async function addToKnowledge({ userId, title, text, sourceType = 'text', documentId = null }) {
  const chunks = chunkText(text);
  const source = must(
    await db()
      .from('kb_sources')
      .insert({ user_id: userId, title, source_type: sourceType, document_id: documentId, chunk_count: chunks.length })
      .select()
      .single()
  );
  if (chunks.length) {
    must(await db().from('kb_chunks').insert(chunks.map((content, i) => ({ source_id: source.id, chunk_index: i, content }))));
  }
  return source;
}

/** Format retrieved chunks as a context block for the model. */
export function formatContext(chunks) {
  if (!chunks.length) return '';
  return chunks
    .map((c, i) => `<source index="${i + 1}" title="${c.title.replace(/"/g, "'")}">\n${c.content}\n</source>`)
    .join('\n');
}
