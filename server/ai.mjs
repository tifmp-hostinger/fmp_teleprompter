// Gerador de roteiro com IA, do lado do servidor.
//
// Existe para que a chave da API fique no ambiente do contêiner e nunca chegue
// ao navegador: um site estático não consegue esconder uma chave, quem abre a
// página consegue lê-la. Aqui o navegador chama /api/ai e este módulo fala
// com a OpenAI ou com a Anthropic.
//
// Variáveis de ambiente:
//   OPENAI_API_KEY      chave da OpenAI
//   ANTHROPIC_API_KEY   chave da Anthropic
//   AI_PROVIDER         openai | anthropic (padrão: o que tiver chave)
//   AI_MODEL            força um modelo; sem isso o melhor disponível é escolhido
//   AI_RATE_PER_MIN     limite de gerações por IP por minuto (padrão 10)
import {
  buildPrompt, validateRequest, SYSTEM_PROMPT, DEFAULT_ANTHROPIC_MODEL, pickOpenAiModel,
} from '../js/ai-shared.js';
import { json, readJson } from './api.mjs';

const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const RATE_PER_MIN = Number(process.env.AI_RATE_PER_MIN || 10);
const PROVIDER = (process.env.AI_PROVIDER || (OPENAI_KEY ? 'openai' : ANTHROPIC_KEY ? 'anthropic' : '')).toLowerCase();
const FORCED_MODEL = (process.env.AI_MODEL || '').trim();
const API_KEY = PROVIDER === 'anthropic' ? ANTHROPIC_KEY : OPENAI_KEY;

export const aiEnabled = Boolean(PROVIDER && API_KEY);
export const aiProvider = PROVIDER;

let resolvedModel = FORCED_MODEL || (PROVIDER === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : '');

/** Descobre o melhor modelo disponível na conta OpenAI (uma vez). */
async function openAiModel() {
  if (resolvedModel) return resolvedModel;
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`não foi possível listar os modelos (HTTP ${res.status})`);
  const data = await res.json();
  const model = pickOpenAiModel((data?.data || []).map((m) => m.id));
  if (!model) throw new Error('nenhum modelo de texto disponível nesta conta');
  resolvedModel = model;
  console.log(`[ia] modelo escolhido: ${model}`);
  return model;
}

// Limite simples por IP, para uma instância pública não virar torneira aberta.
const hits = new Map();
function rateLimited(ip) {
  if (RATE_PER_MIN <= 0) return false;
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > RATE_PER_MIN;
}

/** Lê os eventos SSE da resposta do provedor e devolve só o texto. */
async function* streamText(res, extract) {
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
        let ev;
        try { ev = JSON.parse(payload); } catch { continue; }
        const text = extract(ev);
        if (text) yield text;
      }
    }
  }
}

async function callProvider(fields, signal) {
  const prompt = buildPrompt(fields);
  if (PROVIDER === 'anthropic') {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model: resolvedModel || DEFAULT_ANTHROPIC_MODEL,
        max_tokens: 8000,
        stream: true,
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    return {
      upstream,
      extract: (ev) => (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' ? ev.delta.text : ''),
    };
  }

  const model = await openAiModel();
  const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
  });
  return { upstream, extract: (ev) => ev?.choices?.[0]?.delta?.content || '' };
}

/**
 * Trata as rotas /api/ai/*.
 * @param {(req) => object|null} getUser devolve o usuário logado, se houver contas ativadas
 * @returns {boolean} true se a rota foi tratada aqui
 */
export function createAiRoutes({ requireUser } = {}) {
  return async function handleAi(req, res, url) {
    if (!url.pathname.startsWith('/api/ai/')) return false;

    if (url.pathname === '/api/ai/status') {
      json(res, 200, { enabled: aiEnabled, provider: PROVIDER || null, model: resolvedModel || 'auto' });
      return true;
    }

    if (!aiEnabled) { json(res, 404, { error: 'Gerador de IA não configurado neste servidor.' }); return true; }
    if (url.pathname !== '/api/ai/generate' || req.method !== 'POST') {
      json(res, 404, { error: 'Rota não encontrada.' });
      return true;
    }

    // Com contas ativadas, só quem está logado gera roteiro.
    if (requireUser) {
      try { requireUser(req); } catch (err) {
        json(res, err.status || 401, { error: err.message });
        return true;
      }
    }

    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'anon';
    if (rateLimited(ip)) { json(res, 429, { error: 'Muitos pedidos. Tente de novo em um minuto.' }); return true; }

    let fields;
    try {
      fields = validateRequest(await readJson(req));
    } catch (err) {
      json(res, 400, { error: err.message });
      return true;
    }

    const controller = new AbortController();
    req.on('close', () => controller.abort());

    try {
      const { upstream, extract } = await callProvider(fields, controller.signal);
      if (!upstream.ok) {
        let detail = `HTTP ${upstream.status}`;
        try {
          const data = await upstream.json();
          detail = data?.error?.message || detail;
        } catch { /* corpo não-JSON */ }
        console.error('[ia] provedor recusou:', detail);
        json(res, 502, { error: detail });
        return true;
      }
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
      });
      for await (const text of streamText(upstream, extract)) res.write(text);
      res.end();
    } catch (err) {
      if (controller.signal.aborted) { res.destroy(); return true; }
      console.error('[ia] erro:', err.message);
      if (!res.headersSent) json(res, 502, { error: err.message });
      else res.end();
    }
    return true;
  };
}
