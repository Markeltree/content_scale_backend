import Anthropic from '@anthropic-ai/sdk';
import { db } from './supabase.js';

let anthropic;
export function claude() {
  if (anthropic) return anthropic;
  if (!process.env.ANTHROPIC_API_KEY) {
    throw Object.assign(new Error('ANTHROPIC_API_KEY is not set on the backend.'), { status: 500 });
  }
  anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropic;
}

export const FALLBACK_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

// Small cache so we don't hit the DB on every request.
let modelCache = { at: 0, rows: [] };
async function loadModels() {
  if (Date.now() - modelCache.at < 60_000 && modelCache.rows.length) return modelCache.rows;
  const { data } = await db().from('ai_models').select('*');
  modelCache = { at: Date.now(), rows: data ?? [] };
  return modelCache.rows;
}
export function clearModelCache() {
  modelCache = { at: 0, rows: [] };
}

/** Pick the requested model if an admin has it enabled, otherwise the default. */
export async function resolveModel(requested) {
  try {
    const rows = await loadModels();
    const enabled = rows.filter((m) => m.enabled);
    const hit = enabled.find((m) => m.id === requested);
    if (hit) return hit;
    return enabled.find((m) => m.is_default) ?? enabled[0] ?? { id: FALLBACK_MODEL, max_output_tokens: 4096 };
  } catch {
    return { id: FALLBACK_MODEL, max_output_tokens: 4096 };
  }
}

export async function logUsage(userId, feature, model, usage) {
  if (!usage) return;
  try {
    await db().from('usage_logs').insert({
      user_id: userId,
      feature,
      model,
      input_tokens: usage.input_tokens ?? 0,
      output_tokens: usage.output_tokens ?? 0,
    });
  } catch {
    /* ignore */
  }
}

/**
 * One-shot completion. Uses streaming under the hood so long outputs
 * (e.g. SVG artwork) don't hit request timeouts.
 */
export async function complete({ system, messages, prompt, model, maxTokens = 2048, feature = 'general', userId }) {
  const m = await resolveModel(model);
  const stream = claude().messages.stream({
    model: m.id,
    max_tokens: Math.min(maxTokens, m.max_output_tokens || maxTokens),
    system,
    messages: messages ?? [{ role: 'user', content: prompt }],
  });
  const final = await stream.finalMessage();
  const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  await logUsage(userId, feature, m.id, final.usage);
  return { text, usage: final.usage, model: m.id, stopReason: final.stop_reason };
}

/* ---------------------------- Server-Sent Events ---------------------------- */

export function openSSE(res) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  return (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Stream a Claude response to the client as SSE.
 * Events: {type:'meta'} {type:'text',text} {type:'done',usage,model,...extra} {type:'error',message}
 * `onComplete(fullText, meta)` may return extra fields to include in the done event.
 */
export async function streamToClient(res, { system, messages, prompt, model, maxTokens = 4096, feature, userId, meta, onComplete, send: existingSend }) {
  const send = existingSend ?? openSSE(res);
  let full = '';
  try {
    const m = await resolveModel(model);
    if (meta) send({ type: 'meta', ...meta, model: m.id });
    const stream = claude().messages.stream({
      model: m.id,
      max_tokens: Math.min(maxTokens, m.max_output_tokens || maxTokens),
      system,
      messages: messages ?? [{ role: 'user', content: prompt }],
    });
    stream.on('text', (t) => {
      full += t;
      send({ type: 'text', text: t });
    });
    const final = await stream.finalMessage();
    await logUsage(userId, feature, m.id, final.usage);
    const extra = onComplete ? await onComplete(full, { model: m.id, usage: final.usage }) : {};
    send({ type: 'done', model: m.id, usage: final.usage, stopReason: final.stop_reason, ...(extra || {}) });
  } catch (err) {
    send({ type: 'error', message: friendlyError(err) });
  } finally {
    if (!existingSend) res.end();
  }
  return full;
}

export function friendlyError(err) {
  if (err?.status === 401) return 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY on the backend.';
  if (err?.status === 429) return 'Rate limit reached on the Anthropic API. Please wait a moment and try again.';
  if (err?.status === 404) return 'The selected model is not available for this API key. An admin can change it under Admin → AI Models.';
  if (err?.status === 529 || err?.status === 503) return 'Claude is temporarily overloaded. Please try again shortly.';
  return err?.message || 'Something went wrong while generating.';
}

/** Pull the first JSON object/array out of a model response. */
export function extractJson(text) {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.search(/[\[{]/);
  if (start === -1) throw new Error('Model did not return JSON');
  const open = cleaned[start];
  const close = open === '{' ? '}' : ']';
  const end = cleaned.lastIndexOf(close);
  return JSON.parse(cleaned.slice(start, end + 1));
}

export function wordCount(text = '') {
  return (text.trim().match(/\S+/g) || []).length;
}
