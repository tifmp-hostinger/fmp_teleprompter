// Trechos compartilhados entre o gerador de roteiro do navegador (js/ai.js)
// e o proxy que roda no contêiner (server/ai-proxy.mjs).

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';

// Preferência de modelos da OpenAI, do mais indicado para o menos.
// A lista de modelos da conta é consultada em /v1/models e o primeiro
// que casar aqui é usado — assim o app não quebra quando a OpenAI
// renomeia ou aposenta modelos. Sobrescreva com AI_MODEL se quiser outro.
export const OPENAI_MODEL_PREFERENCE = [
  /^gpt-5\.6.*(luna|nano)/i,
  /^gpt-5\.6.*terra/i,
  /^gpt-5\.6/i,
  /^gpt-5\.5/i,
  /^gpt-5\.4[.-]?mini/i,
  /^gpt-5\.4/i,
  /^gpt-5/i,
  /^gpt-4o[.-]?mini/i,
  /^gpt-4o/i,
  /^gpt-4/i,
];

/** Escolhe o melhor modelo disponível a partir dos ids devolvidos pela API. */
export function pickOpenAiModel(ids) {
  const list = (ids || []).filter(Boolean);
  for (const re of OPENAI_MODEL_PREFERENCE) {
    // Entre os que casam, prefere o id mais curto (costuma ser o alias estável).
    const hits = list.filter((id) => re.test(id) && !/audio|realtime|image|tts|whisper|embedding|moderation/i.test(id));
    if (hits.length) return hits.sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  }
  return list.find((id) => /^gpt/i.test(id)) || null;
}

export const SYSTEM_PROMPT =
  'Você é um roteirista profissional de vídeos para YouTube, Instagram, aulas e apresentações corporativas. '
  + 'Escreve textos para serem lidos em voz alta num teleprompter.';

const LANG_NAMES = { 'pt-BR': 'português do Brasil', en: 'English', es: 'español' };

/** Monta o pedido enviado ao modelo. */
export function buildPrompt({ topic, minutes, tone, language }) {
  const words = Math.round((Number(minutes) || 3) * 150);
  const langName = LANG_NAMES[language] || language || 'português do Brasil';
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

/** Valida os campos vindos do formulário (usado pelo proxy). */
export function validateRequest(body) {
  const topic = String(body?.topic || '').trim();
  if (!topic) throw new Error('topic_required');
  if (topic.length > 2000) throw new Error('topic_too_long');
  const minutes = Math.min(60, Math.max(0.5, Number(body?.minutes) || 3));
  const tone = String(body?.tone || '').trim().slice(0, 60) || 'profissional';
  const language = ['pt-BR', 'en', 'es'].includes(body?.language) ? body.language : 'pt-BR';
  return { topic, minutes, tone, language };
}
