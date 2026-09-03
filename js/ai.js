// Geração de roteiro com IA (API da Anthropic, chamada direta do navegador).
// App estático sem etapa de build, por isso usa fetch + SSE em vez do SDK.
// A chave é do próprio usuário e fica apenas no localStorage dele.
const API_URL = 'https://api.anthropic.com/v1/messages';
export const AI_MODEL = 'claude-opus-5';

const LANG_NAMES = { 'pt-BR': 'português do Brasil', en: 'English', es: 'español' };

function buildPrompt({ topic, minutes, tone, language }) {
  const words = Math.round(minutes * 150);
  const langName = LANG_NAMES[language] || language;
  return [
    `Escreva um roteiro de vídeo para teleprompter em ${langName}.`,
    `Tema: ${topic}`,
    `Duração alvo: ${minutes} minuto(s), aproximadamente ${words} palavras faladas.`,
    `Tom: ${tone}.`,
    '',
    'Regras de formato (obrigatórias):',
    '- Escreva exatamente como se fala: frases curtas, linguagem natural, sem jargão desnecessário.',
    '- Use "# Título" para marcar seções (abertura, desenvolvimento, encerramento).',
    '- Use marcações de palco entre colchetes onde fizer sentido: [pausa], [sorria], [olhar câmera], [ênfase].',
    '- Use **negrito** para as palavras-chave e ==destaque== para a frase mais importante de cada seção.',
    '- Separe parágrafos com uma linha em branco. Não use listas com marcadores nem tabelas.',
    '- Responda apenas com o roteiro, sem introdução nem comentários.',
  ].join('\n');
}

/**
 * Gera o roteiro em streaming. Itera pedaços de texto conforme chegam.
 * @param {{apiKey:string, topic:string, minutes:number, tone:string, language:string, signal?:AbortSignal}} params
 */
export async function* generateScript({ apiKey, topic, minutes, tone, language, signal }) {
  if (!apiKey) throw new Error('missing_api_key');
  const res = await fetch(API_URL, {
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
      model: AI_MODEL,
      max_tokens: 8000,
      stream: true,
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: 'Você é um roteirista profissional de vídeos para YouTube, Instagram, aulas e apresentações corporativas. Escreve textos para serem lidos em voz alta num teleprompter.',
      messages: [{ role: 'user', content: buildPrompt({ topic, minutes, tone, language }) }],
    }),
  });

  if (!res.ok) {
    let detail = `${res.status}`;
    try { detail = (await res.json()).error?.message || detail; } catch { /* ignore */ }
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let stopReason = null;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = event.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      let data;
      try { data = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') {
        yield data.delta.text;
      } else if (data.type === 'message_delta') {
        stopReason = data.delta?.stop_reason || stopReason;
      } else if (data.type === 'error') {
        throw new Error(data.error?.message || 'stream_error');
      }
    }
  }
  if (stopReason === 'refusal') throw new Error('refusal');
}
