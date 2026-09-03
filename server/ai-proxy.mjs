// Proxy do gerador de roteiro com IA.
//
// Existe para que a chave da API fique no ambiente do servidor e nunca chegue
// ao navegador: um site estático não consegue esconder uma chave, quem abre a
// página consegue lê-la. Aqui o navegador chama /api/ai e este processo fala
// com a OpenAI ou com a Anthropic.
//
// Variáveis de ambiente:
//   OPENAI_API_KEY      chave da OpenAI
//   ANTHROPIC_API_KEY   chave da Anthropic
//   AI_PROVIDER         openai | anthropic (padrão: o que tiver chave)
//   AI_MODEL            força um modelo; sem isso o melhor disponível é escolhido
//   AI_PROXY_PORT       porta interna (padrão 8787)
//   AI_RATE_PER_MIN     limite de gerações por IP por minuto (padrão 10)
import { createServer } from 'node:http';
import {
  buildPrompt, validateRequest, SYSTEM_PROMPT, DEFAULT_ANTHROPIC_MODEL, pickOpenAiModel,
} from '../js/ai-shared.js';

const PORT = Number(process.env.AI_PROXY_PORT || 8787);
const OPENAI_KEY = (process.env.OPENAI_API_KEY || '').trim();
const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY || '').trim();
const RATE_PER_MIN = Number(process.env.AI_RATE_PER_MIN || 10);
const PROVIDER = (process.env.AI_PROVIDER || (OPENAI_KEY ? 'openai' : ANTHROPIC_KEY ? 'anthropic' : '')).toLowerCase();
const FORCED_MODEL = (process.env.AI_MODEL || '').trim();
const API_KEY = PROVIDER === 'anthropic' ? ANTHROPIC_KEY : OPENAI_KEY;
const MAX_BODY = 64 * 1024;

if (!PROVIDER || !API_KEY) {
  console.error('[ai-proxy] nenhuma chave configurada (OPENAI_API_KEY ou ANTHROPIC_API_KEY). Encerrando.');
  process.exit(0);
}

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
  console.log(`[ai-proxy] modelo escolhido: ${model}`);
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body_too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('invalid_json')); }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || 'anon';

  if (url.pathname === '/api/ai/status') {
    return sendJson(res, 200, { enabled: true, provider: PROVIDER, model: resolvedModel || 'auto' });
  }

  if (url.pathname !== '/api/ai/generate' || req.method !== 'POST') {
    return sendJson(res, 404, { error: 'not_found' });
  }

  if (rateLimited(ip)) return sendJson(res, 429, { error: 'Muitos pedidos. Tente de novo em um minuto.' });

  let fields;
  try {
    fields = validateRequest(await readBody(req));
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
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
      console.error('[ai-proxy] provedor recusou:', detail);
      return sendJson(res, 502, { error: detail });
    }
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    });
    for await (const text of streamText(upstream, extract)) res.write(text);
    res.end();
  } catch (err) {
    if (controller.signal.aborted) { res.destroy(); return; }
    console.error('[ai-proxy] erro:', err.message);
    if (!res.headersSent) return sendJson(res, 502, { error: err.message });
    res.end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[ai-proxy] ${PROVIDER} escutando em 127.0.0.1:${PORT}`);
});
