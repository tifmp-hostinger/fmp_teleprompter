// Geração de roteiro com IA. Dois caminhos:
//
// 1. Servidor (recomendado em Docker/EasyPanel): a chave fica no ambiente do
//    contêiner e o navegador fala com /api/ai. A chave nunca chega ao cliente.
// 2. Navegador: a pessoa informa a própria chave, guardada só no localStorage
//    dela, e o pedido vai direto para a OpenAI ou para a Anthropic.
//
// O app é estático (sem build), por isso usa fetch + SSE em vez dos SDKs.
import {
  buildPrompt, SYSTEM_PROMPT, DEFAULT_ANTHROPIC_MODEL, pickOpenAiModel,
} from './ai-shared.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

/** Uma chave da Anthropic começa com sk-ant; o resto tratamos como OpenAI. */
export function providerFromKey(apiKey) {
  return /^sk-ant/i.test(String(apiKey || '').trim()) ? 'anthropic' : 'openai';
}

let serverStatusCache;
/** O contêiner tem uma chave configurada? Resposta em cache. */
export async function serverStatus() {
  if (serverStatusCache) return serverStatusCache;
  serverStatusCache = (async () => {
    try {
      const res = await fetch('api/ai/status', { headers: { accept: 'application/json' } });
      if (!res.ok) return { enabled: false };
      const data = await res.json();
      return data && data.enabled ? data : { enabled: false };
    } catch {
      return { enabled: false };
    }
  })();
  return serverStatusCache;
}

/** Percorre os eventos SSE de uma resposta, devolvendo o JSON de cada `data:`. */
async function* sseEvents(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try { yield JSON.parse(payload); } catch { /* evento parcial */ }
      }
    }
  }
}

async function readError(res) {
  try {
    const data = await res.json();
    return data?.error?.message || data?.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

/** Descobre o melhor modelo disponível na conta OpenAI (com cache). */
let openAiModelCache = null;
async function resolveOpenAiModel(apiKey, signal) {
  if (openAiModelCache) return openAiModelCache;
  const res = await fetch(OPENAI_MODELS_URL, { headers: { authorization: `Bearer ${apiKey}` }, signal });
  if (!res.ok) throw new Error(await readError(res));
  const data = await res.json();
  const model = pickOpenAiModel((data?.data || []).map((m) => m.id));
  if (!model) throw new Error('no_model_available');
  openAiModelCache = model;
  return model;
}

async function* generateViaOpenAi({ apiKey, model, prompt, signal }) {
  const chosen = model || await resolveOpenAiModel(apiKey, signal);
  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: chosen,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  for await (const ev of sseEvents(res)) {
    const text = ev?.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}

async function* generateViaAnthropic({ apiKey, model, prompt, signal }) {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: 8000,
      stream: true,
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  let stopReason = null;
  for await (const ev of sseEvents(res)) {
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') yield ev.delta.text;
    else if (ev.type === 'message_delta') stopReason = ev.delta?.stop_reason || stopReason;
    else if (ev.type === 'error') throw new Error(ev.error?.message || 'stream_error');
  }
  if (stopReason === 'refusal') throw new Error('refusal');
}

/** Pede o roteiro ao proxy do contêiner (chave no ambiente do servidor). */
async function* generateViaServer({ topic, minutes, tone, language, signal }) {
  const res = await fetch('api/ai/generate', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, minutes, tone, language }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    if (text) yield text;
  }
}

/**
 * Gera o roteiro em streaming, escolhendo automaticamente entre servidor,
 * OpenAI e Anthropic.
 * @param {{apiKey?:string, model?:string, topic:string, minutes:number,
 *          tone:string, language:string, signal?:AbortSignal, useServer?:boolean}} params
 */
export async function* generateScript(params) {
  const { apiKey, model, topic, minutes, tone, language, signal } = params;
  const useServer = params.useServer ?? (await serverStatus()).enabled;
  if (useServer) {
    yield* generateViaServer({ topic, minutes, tone, language, signal });
    return;
  }
  if (!apiKey) throw new Error('missing_api_key');
  const prompt = buildPrompt({ topic, minutes, tone, language });
  const provider = providerFromKey(apiKey);
  if (provider === 'anthropic') yield* generateViaAnthropic({ apiKey, model, prompt, signal });
  else yield* generateViaOpenAi({ apiKey, model, prompt, signal });
}
