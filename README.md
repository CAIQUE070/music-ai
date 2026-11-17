# Music AI 0.5.0 — Reference Audio Analyzer & Remix Co-Producer

Aplicativo Electron para acompanhar o Ableton Live 12 Suite, planejar remixes e inserir basslines MIDI originais diretamente em uma nova faixa MIDI.

## Novidades 0.5.0

- Analisador de referência WAV local: duração, sample rate, canais, peak, RMS, clipping, zero-crossing rate e variação de energia em janelas de 8 segundos.
- Gráfico simples da energia por trecho para ajudar a localizar passagens mais intensas/baixas e orientar o arranjo do remix.
- O resumo técnico da análise fica no contexto local do Music AI e é incluído no próximo pedido ao Groq. O áudio inteiro não é enviado ao provedor.
- Formatos aceitos: WAV PCM 8/16/24/32-bit e IEEE Float 32-bit; limite 500 MB e 60 minutos.
- Não detecta automaticamente BPM, tonalidade, acordes, vocal/instrumental, stems ou compassos; essas funções ficam para versões futuras.

## Novidades 0.4.0

- Groq configurado por padrão com `openai/gpt-oss-120b`.
- Controle de `reasoning_effort` low / medium / high.
- Histórico curto de conversa enviado ao modelo para preservar o contexto.
- Remix Studio: cria um blueprint para a música inteira (intro, groove, builds, drops, break, outro, timbres, automações, mixagem e checklist).
- Bass Generator com padrões originais de Brazilian Bass bounce, driving, syncopated e minimal.
- Botão **Enviar ao Ableton**: cria uma nova faixa MIDI no final da sessão, cria um clip de 2/4/8 compassos na primeira cena e insere as notas via AbletonOSC.
- O envio não altera faixas existentes. O app confirma que a nova faixa/slot está vazio antes de criar o clip.
- Exportação .mid continua disponível.

## Requisitos

- Windows 10/11 64-bit
- Node.js 22 LTS ou superior
- Ableton Live 12 Suite
- AbletonOSC instalado e selecionado em Preferences → Link, Tempo & MIDI → Control Surface

## Instalar e executar

```bash
npm install
npm run check
npm run test:bass
npm run test:audio
npm start
```

## Configurar Groq GPT-OSS 120B

1. Crie/consulte sua chave no console do Groq.
2. No Music AI, abra Configurações.
3. Endpoint: `https://api.groq.com/openai/v1`
4. Modelo: `openai/gpt-oss-120b`
5. Escolha o nível de raciocínio e cole a chave.
6. Salve e teste no Assistente Musical.

O modelo e o endpoint são os padrões do projeto, mas é necessário fornecer a própria chave. Disponibilidade, limites e cobrança dependem das condições atuais da conta Groq. Confira os limites e preços no console antes de usar; o projeto não inclui crédito nem promete uso ilimitado gratuito. A chave é criptografada usando Electron `safeStorage` no Windows e não é incluída no projeto.

## Analisador de áudio e Remix Studio

Importe um WAV pelo painel Análise de áudio. O processamento ocorre localmente e calcula métricas técnicas e energia por janelas de 8 segundos. O resumo é incluído no contexto da IA para ajudar a sugerir distribuição de energia e decisões de arranjo. **Ainda não detecta BPM, tonalidade, acordes, seções musicais com confiança nem separa stems.** O Remix Studio combina essas métricas com o contexto consultado do Ableton e o briefing que você fornecer. Use somente gravações, stems e samples que você tenha direito de utilizar.

## Inserir bassline no Ableton

1. Abra o Ableton Live e conecte pelo botão do Music AI.
2. No Gerador de Bassline, escolha estilo, tonalidade, escala e compassos.
3. Clique em **Gerar bassline** e revise as notas.
4. Clique em **Enviar ao Ableton** e confirme.
5. O Music AI cria uma nova faixa MIDI no final da sessão e insere o clip na primeira cena (slot 0).

A integração usa os endpoints documentados do AbletonOSC: `/live/song/create_midi_track`, `/live/clip_slot/get/has_clip`, `/live/clip_slot/create_clip`, `/live/clip/set/name` e `/live/clip/add/notes`. A faixa criada recebe as notas em beats, com pitch, duração, velocity e mute. Se o slot não for confirmado como vazio, o processo é interrompido.

O gerador cria ideias originais com características gerais de Brazilian Bass (sub firme, groove sincopado, acentos e mid-bass percussivo). Ele não transcreve nem copia basslines, melodias ou arranjos de artistas/músicas específicos. Trate o resultado como ponto de partida: escute junto com o kick e o restante do arranjo, e ajuste no piano roll/Serum.

## Auto-updater (GitHub Releases)

O projeto está configurado para o repositório `CAIQUE070/music-ai`. O atualizador usa `electron-updater` e consulta GitHub Releases quando o app está empacotado/instalado (não funciona em `npm start`).

### Publicar a primeira versão

1. Crie no GitHub um repositório **público** chamado `music-ai`, sem README, licença ou `.gitignore` inicial. O repositório público permite que o atualizador baixe os artefatos sem token pessoal.
2. Na pasta do projeto, abra o terminal e execute:

```bash
git init
git add .
git commit -m "Music AI 0.5.0"
git branch -M main
git remote add origin https://github.com/CAIQUE070/music-ai.git
git push -u origin main
```

3. No GitHub, abra **Releases → Create a new release**. Crie a tag `v0.5.0`, selecione `main` e publique a release.
4. O workflow `.github/workflows/release.yml` executa no evento `release.published`, compila o instalador Windows e publica os artefatos usando `GITHUB_TOKEN`. Acompanhe em **Actions**.
5. Instale o `Music-AI-Setup-0.5.0.exe` gerado pela release. Essa instalação inicial é necessária para substituir qualquer cópia anterior que não tenha sido compilada com o endereço correto do atualizador.

### Atualizações seguintes

Para cada versão futura, atualize `version` em `package.json`, envie as alterações para `main` e publique uma nova Release com uma tag correspondente (por exemplo, `v0.6.0`). O workflow compila e publica os arquivos; o aplicativo instalado verifica atualizações automaticamente e baixa a nova versão. Ao fechar o Music AI, o instalador aplica a atualização.

**Importante:** não use `npm start` para testar atualizações; esse modo de desenvolvimento não executa o auto-updater. A chave Groq e configurações locais não devem ser commitadas. O `.gitignore` exclui `.env`, `node_modules` e `dist`.

## Segurança

- `contextIsolation: true`, `nodeIntegration: false` e `sandbox: true`.
- A IA apenas sugere e cria planos; não executa comandos autônomos.
- O envio MIDI exige clique e confirmação.
- Cada envio cria uma nova faixa MIDI; não sobrescreve clips/faixas existentes.
- A chave API é armazenada localmente com `safeStorage`.
