import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScript, parseInlines, normalizeWord, estimateSeconds, wpmForDuration,
  formatTime, wordsMatch, findVoicePosition, stripMarkup, cueClass, levenshtein,
} from '../js/script-parser.js';

test('normalizeWord remove acentos, pontuação e caixa', () => {
  assert.equal(normalizeWord('Ação,'), 'acao');
  assert.equal(normalizeWord('"Olá!"'), 'ola');
  assert.equal(normalizeWord('—'), '');
  assert.equal(normalizeWord('2026'), '2026');
});

test('parseInlines reconhece negrito, destaque e marcações', () => {
  const inl = parseInlines('Olá **mundo** ==importante== [pausa] fim');
  assert.deepEqual(inl.map((i) => i.type), ['text', 'bold', 'text', 'highlight', 'text', 'cue', 'text']);
  assert.equal(inl[5].text, 'pausa');
  assert.equal(inl[5].cls, 'cue-pause');
});

test('cueClass mapeia sinônimos em três idiomas', () => {
  assert.equal(cueClass('Pausa longa'), 'cue-pause');
  assert.equal(cueClass('look left'), 'cue-camera');
  assert.equal(cueClass('sonríe'), 'cue-smile');
  assert.equal(cueClass('qualquer coisa'), 'cue-default');
});

test('parseScript conta palavras faladas e ignora marcações/títulos', () => {
  const src = `# Abertura\n\nOlá, **bem-vindos** ao canal. [sorria]\n\n---\n\nHoje falamos de ==teleprompter==.`;
  const r = parseScript(src);
  assert.equal(r.wordCount, 8);
  assert.deepEqual(r.words.map((w) => w.norm), ['ola', 'bemvindos', 'ao', 'canal', 'hoje', 'falamos', 'de', 'teleprompter']);
  assert.deepEqual(r.markers.map((m) => m.type), ['heading', 'cue', 'divider']);
  assert.equal(r.markers[1].wordIndex, 4);
  assert.deepEqual(r.blocks.map((b) => b.type), ['heading', 'paragraph', 'divider', 'paragraph']);
});

test('parseScript preserva espaços e pontuação como tokens', () => {
  const r = parseScript('Um, dois - três.');
  const tokens = r.blocks[0].inlines[0].tokens;
  assert.deepEqual(tokens.map((t) => t.type), ['word', 'space', 'word', 'space', 'punct', 'space', 'word']);
  assert.equal(r.wordCount, 3);
});

test('parseScript aceita quebras de linha simples e CRLF', () => {
  const r = parseScript('linha um\r\nlinha dois\r\n\r\nparágrafo');
  assert.equal(r.blocks.length, 3);
  assert.equal(r.wordCount, 5);
});

test('estimativas de tempo e WPM são coerentes', () => {
  assert.equal(estimateSeconds(160, 160), 60);
  assert.equal(wpmForDuration(300, 120), 150);
  assert.equal(formatTime(65), '1:05');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(-3), '0:00');
});

test('wordsMatch tolera pequenas variações do reconhecimento', () => {
  assert.ok(wordsMatch('teleprompter', 'teleprompter'));
  assert.ok(wordsMatch('apresentacao', 'apresentacoes'));
  assert.ok(wordsMatch('canal', 'canau'));
  assert.ok(!wordsMatch('de', 'do'));
  assert.ok(!wordsMatch('casa', 'carro'));
  assert.equal(levenshtein('gato', 'pato'), 1);
});

test('findVoicePosition avança pelo roteiro conforme as palavras faladas', () => {
  const { words } = parseScript('Bom dia a todos, hoje vamos falar sobre produtividade no trabalho remoto.');
  // Fala: "hoje vamos falar" -> próximo índice esperado é o de "sobre" (7)
  const next = findVoicePosition(words, 0, ['hoje', 'vamos', 'falar']);
  assert.equal(next, 7);
  // Uma palavra curta isolada não deve pular ("a")
  assert.equal(findVoicePosition(words, 0, ['a']), -1);
  // Palavra longa isolada perto do cursor casa
  assert.equal(findVoicePosition(words, 6, ['produtividade']), 9);
  // Fala fora do roteiro não casa
  assert.equal(findVoicePosition(words, 0, ['banana', 'abacaxi']), -1);
});

test('findVoicePosition prefere a posição mais próxima em caso de empate', () => {
  const { words } = parseScript('sim senhor. não senhor. sim senhor. talvez senhor.');
  // Estamos no índice 4 ("sim" da 3ª frase); "sim senhor" deve casar aí, não no início.
  assert.equal(findVoicePosition(words, 4, ['sim', 'senhor']), 6);
});

test('stripMarkup remove a sintaxe e mantém o texto', () => {
  assert.equal(stripMarkup('# T\n\nOlá **a** ==b== [pausa] c\n\n---\n\nfim'), 'T\n\nOlá a b  c\n\nfim');
});
