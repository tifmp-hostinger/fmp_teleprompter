# FMP Teleprompter

Teleprompter profissional **100 % web**, sem instalação, sem conta e sem servidor: abre em qualquer navegador (desktop, tablet, celular), funciona offline como PWA e pode ser hospedado em qualquer hosting estático (Hostinger, GitHub Pages, Netlify…).

Foi desenhado a partir do que os líderes do mercado oferecem (Teleprompter.com, PromptSmart, BIGVU, Speakflow, CuePrompter, Elegant Teleprompter) e vai além em alguns pontos.

## Comparativo com o mercado

| Recurso | Teleprompter.com | PromptSmart | BIGVU | Speakflow | CuePrompter | **FMP Teleprompter** |
|---|---|---|---|---|---|---|
| Rolagem em velocidade fixa (ppm) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Rolagem cronometrada (caber em X min) | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ |
| **Rolagem por voz** (segue a sua fala) | ❌ | ✅ | ✅ | ✅ | ❌ | ✅ pt-BR, en, es + 6 idiomas |
| Modo manual (rolar com gesto/teclado) | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| Espelhamento horizontal/vertical (vidro beam-splitter) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Câmera atrás do texto + gravação | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (download .webm) |
| Contagem regressiva 3-2-1 | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ (0 a 10 s) |
| Marcações de palco coloridas `[pausa]` | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ com cores por tipo |
| Negrito / destaque no texto | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| Controle remoto por outro dispositivo | ✅ Bluetooth | ✅ | ❌ | ✅ | ❌ | ✅ celular (QR/código) + Bluetooth |
| Linha de leitura + escurecimento | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ posição ajustável |
| ppm ao vivo (ritmo real da fala) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Marcadores de seção na barra de progresso | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ clicáveis |
| **Janela flutuante** sobre Zoom/Meet/OBS | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (Document Picture-in-Picture) |
| **Saída para segundo monitor** sincronizada | Pago | ❌ | ❌ | ❌ | ❌ | ✅ |
| Relatório pós-apresentação (duração, ritmo, pausas) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Gerador de roteiro com IA | Pago | ❌ | Pago | ❌ | Pago | ✅ OpenAI ou Anthropic, com a sua chave |
| Funciona offline / instalável (PWA) | App nativo | App nativo | App nativo | ❌ | ❌ | ✅ Android, iPhone, iPad, Mac e PC |
| Velocidade por arrasto (sem ficar clicando) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Tema preto e branco puro | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Auto-hospedável (Docker / EasyPanel) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Configurações por roteiro (velocidade, fonte) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ |
| Preço | Assinatura | Assinatura | Assinatura | Assinatura | Grátis/limitado | **Grátis, código aberto** |

## Funcionalidades

**Editor e biblioteca**
- Vários roteiros salvos no navegador, busca, duplicar, excluir, importar `.txt`/`.md` (inclusive arrastando), exportar `.txt`, backup/restauração `.json`.
- Sintaxe simples: `**negrito**`, `==destaque==`, `[pausa]`/`[sorria]`/`[olhar câmera]` (marcações que aparecem mas não são lidas), `# Seção`, `---` divisor.
- Estatísticas ao vivo: palavras, caracteres, duração estimada e calculadora “caber em X minutos → ppm necessário”.
- Gerador de roteiro com IA (OpenAI ou Anthropic) com escolha de tema, duração e tom. A chave pode ficar no servidor (Docker) ou só no navegador de quem usa.

**Apresentação**
- 4 modos de rolagem: velocidade fixa (40–400 ppm), cronometrado, por voz e manual.
- Velocidade ajustada por arrasto, com o valor no cursor; no modo cronometrado o mesmo controle define a duração.
- Modo por voz com Web Speech API: o texto acompanha a sua fala, tolera erros de reconhecimento, ignora marcações e continua devagar se você improvisar.
- Fonte, espaçamento, largura, alinhamento, cores, maiúsculas, negrito global, linha de leitura ajustável, escurecimento fora da linha.
- Espelhamento horizontal e vertical para vidro de teleprompter.
- Câmera ao fundo com opacidade do texto ajustável e gravação em vídeo (baixa `.webm`).
- Contagem regressiva, cronômetro decorrido/restante, progresso com marcadores clicáveis, ppm ao vivo.
- HUD que se esconde sozinho, gestos de toque (tocar = play/pausa, arrastar = navegar), roda do mouse, tela cheia.
- Atalhos compatíveis com controles Bluetooth (PageUp/PageDown, setas, espaço).
- Janela flutuante (PiP) para ler sobre qualquer aplicativo; janela de saída para o monitor do teleprompter com espelhamento independente.
- Controle remoto pelo celular: QR code / código de 6 letras, mostra o trecho atual, play/pausa, velocidade, fonte, navegação e modo.
- Relatório ao final: duração, palavras lidas, ritmo médio, pausas e uma dica de ritmo.

**Geral**
- Interface em português (Brasil), inglês e espanhol; temas escuro (azul iOS), claro e preto e branco.
- PWA instalável, funciona offline (as bibliotecas do QR code e do WebRTC vêm de CDN e só são necessárias para o controle remoto entre dispositivos).
- Zero dependências de build: HTML + CSS + JavaScript (ES modules).

## Como rodar

```bash
npm start          # servidor estático em http://localhost:8080
npm test           # testes unitários do parser e do rastreamento por voz (Node 18+)
```

Ou simplesmente sirva a pasta com qualquer servidor estático. **Câmera, microfone e PiP exigem HTTPS** (ou `localhost`).

## Docker

A imagem é um nginx servindo os arquivos estáticos, sem etapa de build.

```bash
docker build -t fmp-teleprompter .
docker run -d --name teleprompter -p 8080:80 fmp-teleprompter
# http://localhost:8080
```

Ou com Compose:

```bash
docker compose up --build -d
```

O que a imagem já entrega pronto:

- Tipo MIME correto para `manifest.webmanifest` e módulos ES, mais gzip.
- `Cache-Control: no-cache` com ETag no HTML, CSS e JS, para que um novo deploy apareça sem limpar cache. Ícones ficam em cache por uma semana.
- `Permissions-Policy` liberando câmera, microfone, tela cheia, PiP e wake lock, que alguns proxies bloqueiam por padrão.
- Content-Security-Policy restrita ao que o app usa de fato.
- `/healthz` respondendo `ok` para o healthcheck do orquestrador.
- URLs limpas: `/remote` e `/output` funcionam sem o `.html`.

Variáveis de ambiente:

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `80` | Porta que o nginx escuta dentro do contêiner |
| `PEER_HOST` | vazio | Domínio de um servidor PeerJS próprio para o controle remoto |
| `PEER_PORT` | `443` | Porta desse servidor |
| `PEER_PATH` | `/` | Caminho desse servidor |
| `PEER_SECURE` | `true` | Usar TLS na conexão com ele |
| `PEER_KEY` | vazio | Chave, se você configurou uma |

Sem `PEER_HOST` o controle remoto usa o broker público do PeerJS. Ele só troca as mensagens de conexão; os comandos viajam direto entre os aparelhos por WebRTC.

### Chave de IA no ambiente (OpenAI ou Anthropic)

| Variável | Padrão | Para que serve |
|---|---|---|
| `OPENAI_API_KEY` | vazio | Chave da OpenAI |
| `ANTHROPIC_API_KEY` | vazio | Chave da Anthropic |
| `AI_PROVIDER` | o que tiver chave | `openai` ou `anthropic`, se você configurar as duas |
| `AI_MODEL` | automático | Força um modelo; sem isso o melhor disponível na conta é escolhido |
| `AI_RATE_PER_MIN` | `10` | Gerações por IP por minuto |

**Por que a chave não vai no front-end.** Um site estático não consegue esconder uma chave: qualquer pessoa que abrir a página consegue lê-la e gastar os seus créditos. Por isso a imagem sobe um processo Node pequeno (`server/ai-proxy.mjs`) que guarda a chave e fala com o provedor; o navegador só chama `/api/ai`. A chave nunca sai do contêiner.

Com a chave configurada, o campo de chave some do app e quem usa só clica em **Gerar**. Sem chave no ambiente, o app volta a pedir a chave de cada pessoa, guardada apenas no navegador dela.

O modelo não é fixo no código: o proxy consulta os modelos da sua conta e escolhe o melhor disponível, então nada quebra quando o provedor renomeia ou aposenta modelos. Para fixar um, use `AI_MODEL`.

## Publicar no EasyPanel

1. No EasyPanel, crie um **App** e aponte a origem para este repositório do GitHub, na branch desejada.
2. Em **Build**, escolha **Dockerfile**. O arquivo já está na raiz do projeto.
3. Em **Domains**, adicione o seu domínio e defina a porta do contêiner como **80**. Deixe o HTTPS ligado, o EasyPanel emite o certificado Let's Encrypt.
4. Clique em **Deploy**.

O HTTPS não é opcional: sem ele o navegador bloqueia câmera, microfone, rolagem por voz, janela flutuante e a instalação como PWA.

Não há banco de dados nem volumes a configurar. Os roteiros ficam no `localStorage` do navegador de cada usuário, e o botão **Backup (.json)** exporta tudo.

Se quiser o controle remoto sem depender do broker público, suba também o serviço `peerjs` (já descrito no `docker-compose.yml`), publique-o em um subdomínio com HTTPS e preencha `PEER_HOST` no app. Nesse caso, acrescente esse domínio ao `connect-src` da CSP em `docker/default.conf.template`.

## Instalar no celular (PWA)

O app é um PWA completo: ícones próprios, tela cheia sem barra do navegador, funcionamento offline e atalho para o controle remoto. Precisa estar em HTTPS.

- **Android (Chrome):** aparece o botão **Instalar app** na barra do topo; ou menu ⋮ → *Instalar app*.
- **iPhone, iPad e Mac (Safari):** botão **Compartilhar** → *Adicionar à Tela de Início*. O próprio app mostra esse passo a passo quando você toca em **Instalar app**.
- **Windows, Mac e Linux (Chrome/Edge):** ícone de instalar na barra de endereço.

Depois de instalado o ícone fica junto dos outros aplicativos, abre em tela cheia e continua funcionando sem internet. Os roteiros ficam no aparelho.

No celular a interface se adapta sozinha: a fonte inicial do teleprompter é proporcional à tela, o editor rola por inteiro e os controles que não existem no celular (janela flutuante e segundo monitor) somem.

## Temas

Três temas, em **Preferências → Tema**:

| Tema | Uso |
|---|---|
| **Escuro** (padrão) | Fundo preto com azul do iOS. Melhor para gravação e para o vidro do teleprompter. |
| **Claro** | Fundo claro com azul do iOS, para ambientes muito iluminados. |
| **Preto e branco** | Sem cor nenhuma. Contraste máximo, útil em vidro beam-splitter e para quem tem dificuldade com cores. |

As cores do texto e do fundo do teleprompter continuam ajustáveis à parte, no painel de configurações.

## Velocidade por arrasto

A velocidade não depende mais de ficar clicando em − e +: é um controle que você **arrasta com o dedo ou com o mouse**, com o valor sempre visível no cursor. Em modo cronometrado o mesmo controle passa a ajustar a duração alvo. Ele também aparece no controle remoto do celular, e funciona pelo teclado (setas quando está focado).

## Publicar na Hostinger (ou qualquer hosting estático)

1. Envie todos os arquivos do repositório para a pasta pública (`public_html` ou uma subpasta).
2. Garanta HTTPS ativo (Let's Encrypt no painel da Hostinger).
3. Acesse `https://seudominio/teleprompter/` — o app já é instalável como PWA.

Nada de banco de dados ou PHP: tudo fica no navegador do usuário (`localStorage`).

## Atalhos de teclado

| Tecla | Ação |
|---|---|
| `Espaço` | Iniciar / pausar |
| `↑` / `↓` | Velocidade + / − |
| `←` / `→` | Voltar / avançar |
| `PgUp` / `PgDn` | Página anterior / seguinte (controles Bluetooth) |
| `Home` / `End` | Início / fim |
| `+` / `−` | Fonte maior / menor |
| `F` | Tela cheia |
| `M` | Espelhar horizontal |
| `R` | Reiniciar |
| `V` | Ligar / desligar modo por voz |
| `C` | Ligar / desligar câmera |
| `Esc` | Fechar painel / sair |
| `Ctrl+B`, `Ctrl+H`, `Ctrl+Enter` (editor) | Negrito, destaque, apresentar |

## Estrutura do projeto

```
index.html            app (editor + teleprompter)
output.html           janela de saída para segundo monitor
remote.html           controle remoto (celular)
css/styles.css
js/app.js             cola da interface
js/prompter.js        motor de rolagem e renderização
js/script-parser.js   parser do roteiro + casamento de palavras (voz)
js/voice.js           Web Speech API
js/camera.js          getUserMedia + MediaRecorder
js/remote.js          PeerJS (WebRTC) + BroadcastChannel
js/pip.js             Document Picture-in-Picture
js/ai.js              geração de roteiro (API Anthropic, streaming)
js/ai-shared.js       prompt e escolha de modelo (navegador + servidor)
js/slider.js          controle de velocidade por arrasto
js/i18n.js            traduções pt-BR / en / es
js/storage.js         localStorage (roteiros, ajustes, sessões)
server/ai-proxy.mjs   proxy da IA (mantém a chave fora do navegador)
config.js             configuração de runtime (servidor PeerJS próprio)
sw.js, manifest.webmanifest, icons/   PWA
tests/                testes unitários (node --test)
server.mjs            servidor estático de desenvolvimento
Dockerfile            imagem nginx para EasyPanel / Docker
docker/               config do nginx e entrypoint que gera o config.js
docker-compose.yml    execução local e servidor PeerJS opcional
```

## Compatibilidade

| Recurso | Chrome / Edge | Safari | Firefox |
|---|---|---|---|
| Teleprompter, editor, espelho, câmera, gravação | ✅ | ✅ | ✅ |
| Rolagem por voz | ✅ | ✅ (iOS 14.5+) | ❌ |
| Janela flutuante (PiP de documento) | ✅ 116+ | ❌ | ❌ |
| Controle remoto / segundo monitor | ✅ | ✅ | ✅ |

## Licença

MIT.
