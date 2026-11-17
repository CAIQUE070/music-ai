# ═══ MUSIC AI 0.6.0 — Aplicador automatico ═══
$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)
function WriteFile($path, $content) {
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) $path), $content, $utf8)
}
Write-Host "== Music AI 0.6.0 ==" -ForegroundColor Yellow

# ── [1/6] src/main/dev-reload.js (novo) ──
WriteFile "src\main\dev-reload.js" @'
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const DEV_MODE = process.env.MUSICAI_DEV === '1';

function setupDevReload(app, getMainWindow) {
  if (!DEV_MODE || app.isPackaged) return;
  const rendererDir = path.join(__dirname, '../renderer');
  let reloadTimer = null;
  let restarting = false;

  function scheduleRendererReload(file) {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        console.log('[dev-reload] Interface atualizada: ' + file);
        win.webContents.reloadIgnoringCache();
      }
    }, 250);
  }

  function restartApp(file) {
    if (restarting) return;
    restarting = true;
    console.log('[dev-reload] Processo principal alterado (' + file + '). Reiniciando...');
    const child = spawn(process.execPath, process.argv.slice(1), {
      detached: true, stdio: 'inherit',
      env: Object.assign({}, process.env, { MUSICAI_DEV: '1' })
    });
    child.unref();
    app.removeAllListeners('window-all-closed');
    app.exit(0);
  }

  function watchDir(dir, onChange) {
    try {
      fs.watch(dir, { persistent: false }, function (_e, filename) {
        if (!filename || !/\.(js|html|css)$/i.test(filename)) return;
        onChange(filename);
      });
      console.log('[dev-reload] Monitorando: ' + dir);
    } catch (error) {
      console.warn('[dev-reload] Falha ao monitorar ' + dir + ': ' + error.message);
    }
  }

  watchDir(rendererDir, scheduleRendererReload);
  watchDir(__dirname, restartApp);
  watchDir(path.join(__dirname, '../preload'), restartApp);
}

module.exports = { setupDevReload };
'@
Write-Host "[1/6] dev-reload.js criado" -ForegroundColor Green

# ── [2/6] main.js — 3 edicoes pontuais ──
$f = "src\main\main.js"
$c = [System.IO.File]::ReadAllText((Join-Path (Get-Location) $f))
if ($c -notmatch "dev-reload") {
  $anchor = "const { Client, Server } = require('node-osc');"
  if (-not $c.Contains($anchor)) { throw "Ancora OSC nao encontrada em main.js" }
  $c = $c.Replace($anchor, $anchor + "`nconst { setupDevReload } = require('./dev-reload');")
  $readyOld = "  createWindow();`n  setupAutoUpdater();"
  $readyOldCRLF = "  createWindow();`r`n  setupAutoUpdater();"
  if ($c.Contains($readyOldCRLF)) {
    $c = $c.Replace($readyOldCRLF, $readyOldCRLF + "`r`n  setupDevReload(app, () => mainWindow);")
  } elseif ($c.Contains($readyOld)) {
    $c = $c.Replace($readyOld, $readyOld + "`n  setupDevReload(app, () => mainWindow);")
  } else { throw "Bloco whenReady nao encontrado em main.js" }
  $c = $c.Replace("backgroundColor: '#080b10'", "backgroundColor: '#070506'")
  WriteFile $f $c
}
Write-Host "[2/6] main.js atualizado" -ForegroundColor Green

# ── [3/6] renderer.js — navegacao + fluxo remix ──
$f = "src\renderer\renderer.js"
$c = [System.IO.File]::ReadAllText((Join-Path (Get-Location) $f))
if ($c -notmatch "function showScreen") {
  $nav = @'
/* MUSIC AI 0.6 - Navegacao por telas (menu lateral fixo) */
const screenTitle = document.getElementById('screenTitle');
const navButtons = [...document.querySelectorAll('.nav-item[data-screen]')];
const screens = [...document.querySelectorAll('.screen')];

function showScreen(screenId, title) {
  screens.forEach(s => s.classList.toggle('active', s.id === screenId));
  navButtons.forEach(b => b.classList.toggle('active', b.dataset.screen === screenId));
  if (screenTitle && title) screenTitle.textContent = title;
  window.scrollTo({ top: 0 });
}

navButtons.forEach(button => {
  button.addEventListener('click', () => showScreen(button.dataset.screen, button.dataset.title));
});

'@
  $oldCall = "document.getElementById('assistantPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });"
  if (-not $c.Contains($oldCall)) { throw "Chamada scrollIntoView nao encontrada em renderer.js" }
  $c = $nav + $c.Replace($oldCall, "showScreen('assistantScreen', 'Assistente IA');")
  WriteFile $f $c
}
Write-Host "[3/6] renderer.js atualizado" -ForegroundColor Green

# ── [4/6] package.json v0.6.0 ──
WriteFile "package.json" @'
{
  "name": "music-ai-assistant",
  "version": "0.6.0",
  "description": "Assistente musical com análise WAV local, Groq e integração Ableton Live 12",
  "main": "src/main/main.js",
  "author": "Music AI",
  "license": "UNLICENSED",
  "scripts": {
    "start": "electron .",
    "dev": "cross-env MUSICAI_DEV=1 electron .",
    "atualizar": "git pull --ff-only origin main && npm install && npm start",
    "check": "node --check src/main/main.js && node --check src/main/dev-reload.js && node --check src/preload/preload.js && node --check src/renderer/renderer.js && node --check src/main/music-engine.js && node --check src/main/audio-analyzer.js",
    "dist": "electron-builder --win nsis --x64",
    "publish": "electron-builder --win nsis --x64 --publish always",
    "test:bass": "node tests/bass-generator-smoke.cjs",
    "test:audio": "node tests/audio-analyzer-smoke.cjs"
  },
  "build": {
    "appId": "com.musicai.assistant",
    "productName": "Music AI",
    "directories": { "output": "dist" },
    "files": ["src/**/*", "package.json"],
    "win": {
      "target": [{ "target": "nsis", "arch": ["x64"] }],
      "artifactName": "Music-AI-Setup-${version}.${ext}"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true
    },
    "publish": [{ "provider": "github", "owner": "CAIQUE070", "repo": "music-ai" }],
    "artifactName": "Music-AI-Setup-${version}.${ext}"
  },
  "devDependencies": {
    "cross-env": "^7.0.3",
    "electron": "^45.3.3",
    "electron-builder": "^26.0.12"
  },
  "dependencies": {
    "electron-updater": "^6.6.2",
    "node-osc": "^11.7.1"
  }
}
'@
Write-Host "[4/6] package.json v0.6.0" -ForegroundColor Green

# ── [5/6] index.html — 6 telas separadas ──
WriteFile "src\renderer\index.html" @'
<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:;" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Music AI · Ableton Companion</title>
  <link rel="stylesheet" href="./styles.css" />
  <script src="./renderer.js" defer></script>
</head>
<body>
  <div class="app-shell">
    <aside class="sidebar">
      <div class="brand-lockup">
        <div class="brand-mark"><span></span><span></span><span></span></div>
        <div><div class="brand-name">MUSIC<span>AI</span></div><div class="brand-caption">PERSONAL MUSIC ASSISTANT</div></div>
      </div>

      <div class="side-label">WORKSPACE</div>
      <button class="nav-item active" type="button" data-screen="overviewScreen" data-title="Visão geral"><span class="nav-icon">◈</span> Visão geral</button>
      <button class="nav-item" type="button" data-screen="audioScreen" data-title="Análise de áudio"><span class="nav-icon">∿</span> Análise de áudio</button>
      <button class="nav-item" type="button" data-screen="remixScreen" data-title="Remix Studio"><span class="nav-icon">◉</span> Remix Studio</button>
      <button class="nav-item" type="button" data-screen="assistantScreen" data-title="Assistente IA"><span class="nav-icon">✳</span> Assistente IA</button>
      <button class="nav-item" type="button" data-screen="bassScreen" data-title="Gerador de Bass"><span class="nav-icon">⌁</span> Gerador de Bass</button>
      <button class="nav-item" type="button" data-screen="settingsScreen" data-title="Configurações"><span class="nav-icon">⚙</span> Configurações</button>

      <div class="nav-item disabled"><span class="nav-icon">▤</span> Biblioteca <small>PRÓXIMA FASE</small></div>

      <div class="sidebar-bottom">
        <div class="mini-status"><span class="status-dot" id="sidebarDot"></span><div><strong id="sidebarConnection">Desconectado</strong><small>Ableton Live 12 Suite</small></div></div>
        <div class="version-label">BUILD 0.6.0 · BETA</div>
      </div>
    </aside>

    <main class="main-content">
      <header class="topbar">
        <div><div class="eyebrow">SEU ESTÚDIO, CONECTADO</div><h1 id="screenTitle">Visão geral</h1></div>
        <div class="topbar-right"><div class="update-pill" id="updateStatus">ATUALIZAÇÕES · INICIALIZANDO</div>
          <div class="connection-pill"><span class="status-dot" id="topDot"></span><span id="connectionText">Ableton desconectado</span></div>
          <button class="button button-primary" id="connectButton" type="button"><span>↔</span> Conectar ao Ableton</button>
        </div>
      </header>

      <div class="screens">

      <!-- TELA · VISÃO GERAL -->
      <section class="screen active" id="overviewScreen">
        <section class="hero-panel">
          <div class="hero-copy">
            <div class="hero-kicker"><span class="pulse-dot"></span> MUSIC AI SYSTEM · BUILD 0.6</div>
            <h2>Seu estúdio.<br />Sua música. <em>Mais contexto.</em></h2>
            <p>Planeje remixes completos, crie basslines originais e envie clips MIDI diretamente para uma nova faixa no Ableton Live.</p>
            <div class="hero-actions"><button class="button button-outline" id="refreshButton" type="button" disabled>Sincronizar sessão <span>↻</span></button><button class="button button-quiet" id="checkUpdatesButton" type="button">Verificar atualizações</button></div>
          </div>
          <div class="orb-wrap" aria-hidden="true"><div class="orb-ring ring-one"></div><div class="orb-ring ring-two"></div><div class="orb-core"><div class="orb-core-inner"></div></div><div class="orb-spark spark-one"></div><div class="orb-spark spark-two"></div><div class="orb-caption">SESSION AWARENESS</div></div>
        </section>

        <section class="section-heading"><div><div class="eyebrow">LIVE SESSION</div><h3>Contexto musical</h3></div><span class="live-tag"><span></span> ATUALIZAÇÃO AUTOMÁTICA</span></section>
        <section class="stats-grid">
          <article class="stat-card"><div class="stat-label">ANDAMENTO</div><div class="stat-value"><span id="bpmValue">—</span><small> BPM</small></div><div class="stat-foot">Tempo da sessão</div></article>
          <article class="stat-card"><div class="stat-label">TONALIDADE</div><div class="stat-value state-value" id="keyScaleValue">—</div><div class="stat-foot">Raiz e escala informadas pelo Live</div></article>
          <article class="stat-card"><div class="stat-label">COMPASSO</div><div class="stat-value" id="timeSignatureValue">—</div><div class="stat-foot">Fórmula de compasso</div></article>
          <article class="stat-card"><div class="stat-label">POSIÇÃO</div><div class="stat-value state-value" id="positionValue">—</div><div class="stat-foot">Compasso · tempo</div></article>
          <article class="stat-card"><div class="stat-label">FAIXAS</div><div class="stat-value" id="trackCountValue">—</div><div class="stat-foot">Tracks na sessão</div></article>
          <article class="stat-card"><div class="stat-label">CENAS</div><div class="stat-value" id="sceneCountValue">—</div><div class="stat-foot">Cenas no Session View</div></article>
        </section>

        <section class="workspace-grid">
          <article class="panel tracks-panel">
            <div class="panel-heading"><div><div class="eyebrow">TRACK OVERVIEW</div><h3>Faixas da sessão</h3><p class="panel-subtitle">Selecione uma faixa para acompanhar dispositivos, clips e estado.</p></div><span class="panel-icon">▤</span></div>
            <div class="table-wrap">
              <table class="track-table">
                <thead><tr><th>#</th><th>FAIXA</th><th>DISPOSITIVOS</th><th>VOLUME</th><th>PAN</th><th>ESTADO</th><th></th></tr></thead>
                <tbody id="trackTableBody"><tr><td colspan="7" class="table-empty">Conecte o Ableton e sincronize a sessão.</td></tr></tbody>
              </table>
            </div>
            <div class="table-note" id="trackLimitNote">Aguardando dados do Ableton.</div>
          </article>

          <article class="panel transport-panel">
            <div class="panel-heading"><div><div class="eyebrow">REMOTE CONTROL</div><h3>Transporte</h3></div><span class="panel-icon">◉</span></div>
            <div class="transport-state"><span class="state-dot" id="transportDot"></span><strong id="playStateValue">AGUARDANDO</strong></div>
            <div class="transport-actions"><button id="playButton" class="transport-button play" type="button" disabled>▶ <span>Play</span></button><button id="stopButton" class="transport-button" type="button" disabled>■ <span>Stop</span></button></div>
            <div class="transport-meta"><div><span>LOOP</span><strong id="loopValue">—</strong></div><div><span>METRÔNOMO</span><strong id="metronomeValue">—</strong></div></div>
            <div class="safety-note"><span>i</span> Play e Stop controlam apenas a reprodução. Selecionar uma faixa ou cena não dispara clips nem altera notas.</div>
          </article>
        </section>

        <section class="detail-grid">
          <article class="panel selected-panel">
            <div class="panel-heading"><div><div class="eyebrow">SELECTED TRACK</div><h3 id="selectedTrackTitle">Nenhuma faixa selecionada</h3></div><span class="panel-icon">⌁</span></div>
            <div class="detail-metrics"><div><span>VOLUME</span><strong id="selectedVolume">—</strong></div><div><span>PAN</span><strong id="selectedPan">—</strong></div><div><span>MUTE</span><strong id="selectedMute">—</strong></div><div><span>SOLO</span><strong id="selectedSolo">—</strong></div></div>
            <div class="detail-section"><div class="detail-label">INSTRUMENTOS E EFEITOS</div><div class="chip-list" id="deviceList"><span class="muted-text">Nenhum dado recebido.</span></div></div>
            <div class="detail-section"><div class="detail-label">CLIPS DA FAIXA</div><div class="chip-list" id="clipList"><span class="muted-text">Nenhum dado recebido.</span></div></div>
          </article>

          <article class="panel scenes-panel">
            <div class="panel-heading"><div><div class="eyebrow">SESSION VIEW</div><h3>Cenas</h3><p class="panel-subtitle">Clique para selecionar uma cena no Ableton, sem reproduzi-la.</p></div><span class="panel-icon">▦</span></div>
            <div id="sceneList" class="scene-list"><div class="empty-state">As cenas aparecerão aqui após a sincronização.</div></div>
          </article>
        </section>
      </section>

      <!-- TELA · ANÁLISE DE ÁUDIO -->
      <section class="screen" id="audioScreen">
        <section class="panel audio-panel screen-panel" id="audioPanel">
          <div class="panel-heading"><div><div class="eyebrow">REFERENCE AUDIO INTELLIGENCE</div><h3>Analisador de áudio</h3><p class="panel-subtitle">Importe um WAV para medir duração, pico, RMS e variação de energia ao longo da faixa. O áudio fica local.</p></div><span class="panel-icon">∿</span></div>
          <div class="audio-import-row"><button class="button button-primary" id="analyzeAudioButton" type="button">Selecionar WAV e analisar ↗</button><span class="chat-footnote">Suporta WAV PCM 8/16/24/32-bit e IEEE Float 32-bit · máximo 500 MB · até 60 min.</span></div>
          <div class="audio-analysis-result" id="audioAnalysisResult"><div class="empty-state">Nenhuma referência analisada. Depois da análise, peça à IA um plano de remix baseado nas métricas.</div></div>
        </section>
      </section>

      <!-- TELA · REMIX STUDIO -->
      <section class="screen" id="remixScreen">
        <section class="panel remix-panel screen-panel" id="remixPanel">
          <div class="panel-heading"><div><div class="eyebrow">FULL TRACK WORKFLOW</div><h3>Remix Studio</h3><p class="panel-subtitle">Monte um plano de produção para a faixa inteira, usando os dados da sessão e as informações que você fornecer. Nesta versão, a IA ainda não recebe o áudio de referência.</p></div><span class="panel-icon">◉</span></div>
          <div class="remix-form-grid">
            <label>Nome ou referência da faixa<input id="remixTrackName" type="text" maxlength="100" placeholder="Nome do projeto ou da faixa"></label>
            <label>BPM original<input id="remixOriginalBpm" type="number" min="50" max="220" placeholder="Detectado pelo Ableton quando conectado"></label>
            <label>Tonalidade<input id="remixKey" type="text" maxlength="24" placeholder="Ex.: F# minor"></label>
            <label>Direção do remix<select id="remixDirection"><option value="Brazilian Bass / EDM de pista">Brazilian Bass / EDM de pista</option><option value="Brazilian Bass melódico">Brazilian Bass melódico</option><option value="House / club">House / club</option><option value="Progressive house">Progressive house</option><option value="Dance pop eletrônico">Dance pop eletrônico</option></select></label>
            <label class="remix-wide">O que deseja preservar ou mudar?<textarea id="remixNotes" rows="3" maxlength="1800" placeholder="Ex.: preservar o vocal e a harmonia principal; reconstruir bateria e baixo; drop energético; intro DJ-friendly..."></textarea></label>
          </div>
          <div class="remix-actions"><button class="button button-primary" id="createRemixPlanButton" type="button">Criar plano completo do remix ↗</button><span class="chat-footnote">O plano cobre intro, groove, build, drops, break, transições e outro. Se houver WAV analisado, o resumo técnico será incluído no contexto da IA. Use áudio que você tenha direito de utilizar.</span></div>
        </section>
      </section>

      <!-- TELA · ASSISTENTE IA -->
      <section class="screen" id="assistantScreen">
        <article class="panel assistant-panel screen-panel" id="assistantPanel">
          <div class="panel-heading"><div><div class="eyebrow">MUSIC INTELLIGENCE</div><h3>Assistente musical</h3><p class="panel-subtitle">Converse sobre produção. A IA recebe o contexto atual da sua sessão.</p></div><span class="panel-icon">✳</span></div>
          <div class="chat-messages" id="chatMessages"><div class="chat-bubble assistant">Olá! Sou seu co-produtor musical. Posso ajudar com planejamento de remix, basslines, Serum, harmonia, arranjo e mixagem. Configure o Groq GPT-OSS 120B em Configurações para começar.</div></div>
          <form class="chat-form" id="chatForm"><textarea id="chatInput" rows="2" maxlength="6000" placeholder="Ex.: Me ensina a criar um mid bass de Brazilian Bass no Serum..."></textarea><button class="button button-primary" id="sendChatButton" type="submit">Enviar ↗</button></form>
          <div class="chat-footnote">A IA sugere e explica. Nenhuma alteração no Ableton é executada automaticamente.</div>
        </article>
      </section>

      <!-- TELA · GERADOR DE BASS -->
      <section class="screen" id="bassScreen">
        <article class="panel bass-panel screen-panel" id="bassPanel">
          <div class="panel-heading"><div><div class="eyebrow">MIDI LAB</div><h3>Gerador de bassline</h3><p class="panel-subtitle">Crie uma linha original e envie como clip MIDI para uma nova faixa no Ableton.</p></div><span class="panel-icon">⌁</span></div>
          <div class="bass-controls">
            <label>Estilo<select id="bassStyle"><option value="brazilian">Brazilian Bass Bounce</option><option value="driving">Driving / Four on the floor</option><option value="syncopated">Syncopated</option><option value="minimal">Minimal</option></select></label>
            <label>Tonalidade<select id="bassRoot"><option value="0">C</option><option value="1">C#</option><option value="2">D</option><option value="3">D#</option><option value="4">E</option><option value="5">F</option><option value="6">F#</option><option value="7">G</option><option value="8">G#</option><option value="9">A</option><option value="10">A#</option><option value="11">B</option></select></label>
            <label>Registro<select id="bassRegister"><option value="sub">Sub bass · C1</option><option value="mid" selected>Mid bass · C2</option><option value="upper">High bass · C3</option></select></label>
            <label>Escala<select id="bassScale"><option value="minor">Minor</option><option value="major">Major</option><option value="dorian">Dorian</option><option value="phrygian">Phrygian</option><option value="minor pentatonic">Minor pentatonic</option><option value="major pentatonic">Major pentatonic</option></select></label>
            <label>Compassos<select id="bassBars"><option>2</option><option selected>4</option><option>8</option></select></label>
          </div>
          <div class="bass-preview" id="bassPreview"><div class="empty-state">Gere uma bassline para visualizar as notas.</div></div>
          <div class="bass-actions"><button class="button button-outline" id="generateBassButton" type="button">Gerar bassline</button><button class="button button-primary" id="sendBassToAbletonButton" type="button" disabled>Enviar ao Ableton ↗</button><button class="button button-quiet" id="exportBassButton" type="button" disabled>Exportar .mid</button></div>
          <p class="chat-footnote">O envio cria uma nova faixa MIDI e um clip na primeira cena. Não substitui faixas nem clips existentes.</p>
        </article>
      </section>

      <!-- TELA · CONFIGURAÇÕES -->
      <section class="screen" id="settingsScreen">
        <section class="panel settings-panel screen-panel" id="settingsPanel">
          <div class="panel-heading"><div><div class="eyebrow">PREFERENCES & AI PROVIDER</div><h3>Configurações do assistente</h3><p class="panel-subtitle">Use uma API compatível com OpenAI. Endpoint Groq + modelo GPT-OSS 120B. A chave fica criptografada localmente no Windows.</p></div><span class="panel-icon">⚙</span></div>
          <div class="settings-grid">
            <label>Endpoint da API<input id="apiBaseUrl" type="url" value="https://api.groq.com/openai/v1" placeholder="https://api.groq.com/openai/v1"></label>
            <label>Modelo<input id="apiModel" type="text" value="openai/gpt-oss-120b" placeholder="openai/gpt-oss-120b"></label>
            <label>Raciocínio<select id="reasoningEffort"><option value="low">Low · mais rápido</option><option value="medium">Medium · equilibrado</option><option value="high">High · mais profundo</option></select></label>
            <label class="key-field">Chave da API<input id="apiKey" type="password" placeholder="Cole sua chave (fica local e criptografada)"></label>
            <button class="button button-primary save-settings" id="saveSettingsButton" type="button">Salvar configuração</button>
          </div>
          <div class="settings-feedback" id="settingsFeedback">Nenhuma chave configurada.</div>
        </section>
      </section>

      </div>

      <footer class="status-footer"><span class="footer-indicator" id="footerIndicator"></span><span id="messageText">Aguardando conexão com o Ableton.</span><span class="footer-right" id="updatedText">SEM SINCRONIZAÇÃO</span></footer>
    </main>
  </div>
</body>
</html>
'@
Write-Host "[5/6] index.html substituido" -ForegroundColor Green

# ── [6/6] styles.css — tema preto/vermelho/dourado ──
WriteFile "src\renderer\styles.css" @'
/* MUSIC AI 0.6 — PRETO / VERMELHO / DOURADO · telas separadas · scrollbar custom */
:root{
  font-family:'Segoe UI',Arial,sans-serif;color:#f2ece4;background:#070506;
  font-synthesis:none;text-rendering:optimizeLegibility;
  --bg:#070506;--panel:#120c0d;--panel2:#0d0809;
  --muted:#93867c;--line:rgba(212,175,55,.13);--line-soft:rgba(212,175,55,.07);
  --red:#e5383b;--red-deep:#a4161a;--red-glow:rgba(229,56,59,.35);
  --gold:#d4af37;--gold-soft:#e9cd7a;--gold-dim:rgba(212,175,55,.45);
  --green:#6fe0a8;--text:#f2ece4;--text-dim:#b3a89d
}
*{box-sizing:border-box}
body{margin:0;min-width:1120px;min-height:100vh;background:radial-gradient(ellipse at 72% -20%,rgba(164,22,26,.14),transparent 42%),radial-gradient(ellipse at 8% 110%,rgba(212,175,55,.05),transparent 38%),var(--bg)}
::-webkit-scrollbar{width:6px;height:6px}
::-webkit-scrollbar-track{background:rgba(255,255,255,.02);border-radius:6px}
::-webkit-scrollbar-thumb{background:linear-gradient(180deg,var(--red-deep),var(--red));border-radius:6px;border:1px solid rgba(212,175,55,.25)}
::-webkit-scrollbar-thumb:hover{background:linear-gradient(180deg,var(--red),var(--gold))}
::-webkit-scrollbar-corner{background:transparent}
*{scrollbar-width:thin;scrollbar-color:var(--red-deep) rgba(255,255,255,.02)}
.app-shell{display:flex;min-height:100vh}
.sidebar{width:248px;flex-shrink:0;border-right:1px solid var(--line);background:linear-gradient(180deg,rgba(16,9,10,.98),rgba(9,6,7,.98));padding:28px 18px 20px;display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.brand-lockup{display:flex;align-items:center;gap:12px;padding:2px 7px 44px}
.brand-mark{width:34px;height:34px;border:1px solid var(--gold-dim);border-radius:10px;display:flex;align-items:center;justify-content:center;gap:3px;transform:rotate(-8deg);box-shadow:0 0 20px rgba(212,175,55,.12),inset 0 0 12px rgba(229,56,59,.08)}
.brand-mark span{width:3px;border-radius:5px;background:linear-gradient(180deg,var(--gold),var(--red));display:block}
.brand-mark span:nth-child(1){height:10px}.brand-mark span:nth-child(2){height:18px}.brand-mark span:nth-child(3){height:13px}
.brand-name{font-size:16px;font-weight:800;letter-spacing:2px;color:var(--text)}
.brand-name span{color:var(--gold)}
.brand-caption,.side-label,.eyebrow,.stat-label,.version-label,.footer-right,.detail-label{font-family:Consolas,monospace;letter-spacing:1.4px;font-size:9px;color:#8d7f6d}
.brand-caption{font-size:7px;letter-spacing:1.05px;margin-top:3px;color:#7a6c58}
.side-label{padding:0 10px 13px}
.nav-item{height:43px;width:100%;border:0;background:transparent;color:#9a8d80;border-radius:8px;padding:0 11px;text-align:left;font:600 12px 'Segoe UI',Arial,sans-serif;display:flex;align-items:center;gap:11px;margin-bottom:5px;cursor:pointer;transition:background .18s,color .18s,box-shadow .18s}
.nav-item:hover{color:#f5e9d8;background:rgba(229,56,59,.07)}
.nav-item.active{color:#fdf6ec;background:linear-gradient(90deg,rgba(229,56,59,.18),rgba(212,175,55,.05));box-shadow:inset 2px 0 var(--red),0 0 18px rgba(229,56,59,.06)}
.nav-icon{font-size:17px;color:var(--gold);width:17px;text-align:center}
.nav-item.active .nav-icon{color:var(--red);text-shadow:0 0 10px var(--red-glow)}
.nav-item.disabled{opacity:.42;cursor:default}
.nav-item small{font:8px Consolas,monospace;letter-spacing:.5px;margin-left:auto;color:#77684f}
.sidebar-bottom{margin-top:auto}
.mini-status{display:flex;align-items:center;gap:10px;padding:14px 9px;border:1px solid var(--line);border-radius:9px;background:rgba(212,175,55,.025)}
.mini-status strong,.mini-status small{display:block}
.mini-status strong{font-size:10px;font-weight:700;color:var(--text)}
.mini-status small{font-size:9px;color:var(--muted);margin-top:3px}
.status-dot,.footer-indicator,.state-dot{width:7px;height:7px;border-radius:50%;background:#5c5148;display:inline-block;flex-shrink:0}
.status-dot.online,.footer-indicator.online,.state-dot.online{background:var(--green);box-shadow:0 0 10px rgba(111,224,168,.55)}
.version-label{font-size:8px;margin:17px 8px 0;color:#6b5d49}
.main-content{flex:1;max-width:1800px;margin:0 auto;padding:30px 38px 20px;display:flex;flex-direction:column;min-width:0}
.topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.eyebrow{color:#9c8a6a}
.topbar h1{font-size:25px;letter-spacing:-.8px;margin:7px 0 0;font-weight:700;color:var(--text)}
.topbar-right{display:flex;align-items:center;gap:16px}
.connection-pill{height:34px;border:1px solid var(--line);border-radius:99px;padding:0 12px;display:flex;align-items:center;gap:8px;color:#b0a394;font-size:10px;background:rgba(212,175,55,.02)}
.screens{flex:1;display:flex;flex-direction:column;min-height:0}
.screen{display:none}
.screen.active{display:block;animation:screenIn .32s cubic-bezier(.22,.8,.36,1)}
@keyframes screenIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.screen-panel{margin:0 0 14px}
.button{font:700 10px 'Segoe UI',Arial,sans-serif;border-radius:7px;padding:11px 15px;cursor:pointer;transition:.2s;border:1px solid transparent}
.button-primary{color:#fff5f0;background:linear-gradient(115deg,#c1121f,#e5383b 60%,#d4af37 140%);box-shadow:0 5px 20px rgba(197,18,31,.28),inset 0 1px 0 rgba(233,205,122,.25)}
.button-primary:hover{filter:brightness(1.12);transform:translateY(-1px);box-shadow:0 7px 24px rgba(229,56,59,.35)}
.button-primary:disabled{opacity:.55;cursor:wait;transform:none}
.button-primary span{font-size:14px;margin-right:7px}
.button-outline{border-color:var(--gold-dim);color:var(--gold-soft);background:rgba(212,175,55,.06)}
.button-outline:hover{background:rgba(212,175,55,.13);border-color:var(--gold)}
.button-outline:disabled{opacity:.38;cursor:not-allowed}
.button-outline span{font-size:16px;margin-left:12px}
.button-quiet{background:rgba(255,255,255,.035);border-color:var(--line);color:#a99c8d}
.button-quiet:hover{border-color:var(--gold-dim);color:var(--gold-soft)}
.hero-actions{display:flex;align-items:center;gap:9px}
.update-pill{font:8px Consolas,monospace;letter-spacing:.7px;color:#a08e72;border:1px solid var(--line);border-radius:30px;padding:9px 11px;white-space:nowrap}
.hero-panel{position:relative;min-height:210px;border:1px solid rgba(212,175,55,.22);border-radius:13px;overflow:hidden;background:radial-gradient(ellipse at 74% 55%,rgba(164,22,26,.26),transparent 44%),linear-gradient(115deg,#170e0f,#0f090a 65%,#0b0708);display:flex;justify-content:space-between;padding:27px 34px;margin-bottom:23px}
.hero-panel:after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(90deg,rgba(7,5,6,.12),transparent 62%),repeating-linear-gradient(0deg,transparent 0,transparent 34px,rgba(212,175,55,.03) 35px)}
.hero-copy{position:relative;z-index:2;max-width:510px}
.hero-kicker{font:9px Consolas,monospace;letter-spacing:1.8px;color:#c9a86a;display:flex;align-items:center;gap:8px}
.pulse-dot,.live-tag span{width:6px;height:6px;border-radius:50%;background:var(--red);box-shadow:0 0 9px var(--red)}
.hero-copy h2{font-size:30px;line-height:1.16;letter-spacing:-1.3px;margin:13px 0 8px;color:var(--text)}
.hero-copy h2 em{font-style:normal;background:linear-gradient(100deg,var(--gold-soft),var(--gold));-webkit-background-clip:text;background-clip:text;color:transparent}
.hero-copy p{max-width:450px;color:#a3968a;font-size:10px;line-height:1.7;margin:0 0 14px}
.orb-wrap{position:absolute;width:250px;height:195px;right:10%;top:5px;display:flex;align-items:center;justify-content:center;z-index:1;opacity:.95}
.orb-core{width:83px;height:83px;border-radius:50%;background:radial-gradient(circle at 37% 30%,#ffe9c9 0,#f0b95c 7%,#d43a35 31%,#6d1114 59%,#2a0708 75%);box-shadow:0 0 25px rgba(229,56,59,.5),0 0 75px rgba(212,175,55,.18),inset -12px -13px 25px rgba(0,0,0,.7);display:grid;place-items:center}
.orb-core-inner{height:55px;width:55px;border:1px solid rgba(233,205,122,.55);border-radius:50%;box-shadow:inset 0 0 21px rgba(229,56,59,.3),0 0 12px rgba(212,175,55,.3)}
.orb-ring{position:absolute;border:1px solid rgba(212,175,55,.3);border-radius:50%;transform:rotate(-22deg)}
.ring-one{width:200px;height:70px}
.ring-two{width:220px;height:110px;transform:rotate(39deg);border-color:rgba(229,56,59,.22)}
.orb-spark{position:absolute;width:5px;height:5px;border-radius:50%;background:#ffe9c9;box-shadow:0 0 12px var(--gold)}
.spark-one{top:32px;right:67px}.spark-two{bottom:40px;left:60px}
.orb-caption{position:absolute;bottom:0;font:8px Consolas,monospace;letter-spacing:2px;color:#9c8a6a}
.section-heading{display:flex;align-items:end;justify-content:space-between;margin-bottom:11px}
.section-heading h3,.panel-heading h3{margin:5px 0 0;font-size:14px;letter-spacing:-.3px;color:var(--text)}
.live-tag{display:flex;align-items:center;gap:8px;color:#8d7f6d;font:8px Consolas,monospace;letter-spacing:1px}
.live-tag span{width:5px;height:5px}
.stats-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-bottom:14px}
.stat-card,.panel{border:1px solid var(--line);border-radius:10px;background:linear-gradient(145deg,rgba(24,14,15,.94),rgba(13,8,9,.97))}
.stat-card{min-height:93px;padding:13px 15px;transition:border-color .2s}
.stat-card:hover{border-color:rgba(212,175,55,.3)}
.stat-label{font-size:8px}
.stat-value{font-size:24px;font-weight:700;letter-spacing:-.8px;margin-top:9px;color:#f7f0e6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.stat-value small{font:9px Consolas,monospace;color:#a08e72;letter-spacing:.5px}
.state-value{font-size:16px;letter-spacing:0}
.stat-foot{font-size:8px;color:#84766a;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.workspace-grid{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(260px,.85fr);gap:12px;margin-bottom:12px}
.detail-grid{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(300px,.8fr);gap:12px}
.panel{padding:16px 18px;min-width:0}
.tracks-panel{min-height:270px}
.panel-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}
.panel-heading h3{font-size:13px}
.panel-subtitle{font-size:9px;color:#93867c;margin:5px 0 0;line-height:1.45}
.panel-icon{width:28px;height:28px;flex-shrink:0;border-radius:7px;display:grid;place-items:center;color:var(--gold);background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.14);font-size:15px}
.table-wrap{width:100%;overflow:auto;margin-top:13px}
.track-table{width:100%;border-collapse:collapse;min-width:640px;text-align:left}
.track-table th{font:8px Consolas,monospace;letter-spacing:1px;color:#8d7f6d;font-weight:500;padding:8px 9px;border-bottom:1px solid var(--line);white-space:nowrap}
.track-table td{padding:9px;border-bottom:1px solid var(--line-soft);font-size:9px;color:#bdb1a4;white-space:nowrap}
.track-table tr:last-child td{border-bottom:0}
.track-table tbody tr{transition:background .15s}
.track-table tbody tr:hover{background:rgba(229,56,59,.05)}
.track-table tbody tr.selected-row{background:rgba(229,56,59,.1);box-shadow:inset 2px 0 var(--red)}
.track-table .index-cell{font:9px Consolas,monospace;color:#9c8a6a}
.track-table .track-name-cell{font-weight:650;color:#f0e8dc;max-width:190px;overflow:hidden;text-overflow:ellipsis}
.track-table .flag-cell{color:var(--gold-soft);font:8px Consolas,monospace}
.track-table .normal-cell{color:#7d8a77;font:8px Consolas,monospace}
.table-empty{text-align:center!important;color:#84766a!important;padding:24px!important}
.select-button{border:1px solid rgba(212,175,55,.28);border-radius:5px;background:rgba(212,175,55,.06);color:var(--gold-soft);padding:5px 8px;font:8px 'Segoe UI',Arial,sans-serif;cursor:pointer;white-space:nowrap;transition:.15s}
.select-button:hover:not(:disabled){background:rgba(229,56,59,.14);border-color:rgba(229,56,59,.4);color:#ffd9d0}
.select-button:disabled{opacity:.4;cursor:default}
.table-note{font-size:8px;color:#77685a;margin-top:7px}
.transport-panel{min-height:270px}
.transport-state{display:flex;align-items:center;gap:9px;margin:20px 0 16px}
.transport-state strong{font:700 16px Consolas,monospace;letter-spacing:.8px;color:#f7f0e6}
.state-dot{width:8px;height:8px}
.transport-actions{display:flex;gap:8px}
.transport-button{border:1px solid rgba(212,175,55,.16);border-radius:7px;background:#1a1011;color:#d8ccbe;padding:10px 16px;font:700 10px 'Segoe UI',Arial,sans-serif;cursor:pointer;transition:.15s}
.transport-button.play{background:rgba(229,56,59,.14);border-color:rgba(229,56,59,.38);color:#ffc9c2}
.transport-button.play:hover:not(:disabled){background:rgba(229,56,59,.24)}
.transport-button:disabled{opacity:.4;cursor:not-allowed}
.transport-button span{margin-left:6px}
.transport-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:19px}
.transport-meta div,.detail-metrics div{padding:10px;border:1px solid var(--line-soft);border-radius:7px;background:rgba(212,175,55,.02)}
.transport-meta span,.detail-metrics span{display:block;font:8px Consolas,monospace;color:#8d7f6d;letter-spacing:1px}
.transport-meta strong,.detail-metrics strong{display:block;font-size:10px;color:#e8dfd2;margin-top:5px}
.safety-note{display:flex;align-items:flex-start;gap:7px;font-size:8px;line-height:1.5;color:#84766a;margin-top:13px}
.safety-note span{width:13px;height:13px;flex-shrink:0;border-radius:50%;border:1px solid var(--gold-dim);color:var(--gold-soft);display:grid;place-items:center;font:9px Georgia}
.selected-panel,.scenes-panel{min-height:230px}
.detail-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:13px}
.detail-section{margin-top:14px}
.detail-label{font-size:8px;margin-bottom:7px}
.chip-list{display:flex;flex-wrap:wrap;gap:6px;min-height:22px}
.data-chip{font-size:8px;color:#e3d6c2;background:#1c1210;border:1px solid rgba(212,175,55,.2);border-radius:5px;padding:6px 8px;max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.muted-text{font-size:9px;color:#7d7062;padding:4px 0}
.scene-list{display:flex;flex-direction:column;gap:6px;margin-top:13px;max-height:245px;overflow:auto}
.scene-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 9px;border:1px solid var(--line-soft);border-radius:7px;background:rgba(212,175,55,.015)}
.scene-item.selected{border-color:rgba(229,56,59,.4);background:rgba(229,56,59,.08)}
.scene-item>div{display:flex;align-items:center;gap:10px;min-width:0}
.scene-number{font:8px Consolas,monospace;letter-spacing:.6px;color:#9c8a6a;white-space:nowrap}
.scene-item strong{font-size:9px;font-weight:600;color:#e8dfd2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty-state{font-size:9px;color:#84766a;border:1px dashed rgba(212,175,55,.2);border-radius:7px;padding:17px;text-align:center;width:100%}
.status-footer{border-top:1px solid var(--line);margin-top:auto;padding-top:14px;display:flex;align-items:center;gap:8px;color:#93867c;font-size:9px;min-height:33px}
.footer-indicator{width:5px;height:5px;background:#5c5148}
.footer-right{margin-left:auto;font-size:8px;color:#6b5d49}
.assistant-panel{min-height:390px}
.chat-messages{height:340px;overflow:auto;display:flex;flex-direction:column;gap:9px;padding:12px 2px;margin-top:10px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.chat-bubble{max-width:88%;border:1px solid rgba(212,175,55,.16);border-radius:10px;padding:10px 12px;font-size:10px;line-height:1.65;color:#e6dccd;white-space:pre-wrap}
.chat-bubble.assistant{align-self:flex-start;background:rgba(212,175,55,.05)}
.chat-bubble.user{align-self:flex-end;background:rgba(229,56,59,.12);border-color:rgba(229,56,59,.28)}
.chat-bubble.error{border-color:rgba(229,56,59,.5);color:#ffb0a6;background:rgba(164,22,26,.12)}
.chat-form{display:flex;gap:8px;margin-top:11px;align-items:stretch}
.chat-form textarea{resize:vertical;min-height:46px;max-height:110px;flex:1;background:#0d0809;border:1px solid var(--line);border-radius:8px;color:#f2ece4;padding:10px;font:10px 'Segoe UI',Arial;outline:none;transition:border-color .15s}
.chat-form textarea:focus,.settings-grid input:focus,.settings-grid select:focus,.bass-controls select:focus{border-color:rgba(229,56,59,.55);box-shadow:0 0 0 3px rgba(229,56,59,.08)}
.chat-footnote{font-size:8px;line-height:1.5;color:#84766a;margin:9px 0 0}
.bass-panel{min-height:390px}
.bass-controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:17px}
.bass-controls label,.settings-grid label{display:flex;flex-direction:column;gap:6px;font:8px Consolas,monospace;letter-spacing:.6px;color:#9c8a6a}
.bass-controls select,.settings-grid input,.settings-grid select{height:36px;background:#0d0809;border:1px solid var(--line);border-radius:6px;color:#e8dfd2;padding:0 9px;font:10px 'Segoe UI',Arial;outline:none;transition:border-color .15s}
.bass-preview{min-height:110px;max-height:190px;overflow:auto;margin-top:13px;padding:10px;border:1px solid var(--line-soft);border-radius:8px;background:rgba(0,0,0,.3)}
.note-grid{display:flex;flex-wrap:wrap;gap:5px}
.note-pill{font:8px Consolas,monospace;color:var(--gold-soft);background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.25);border-radius:4px;padding:5px 7px}
.bass-summary{font-size:9px;color:#a3968a;margin-bottom:9px}
.bass-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:11px}
.bass-actions button{flex:1;min-width:118px}
#sendBassToAbletonButton:not(:disabled){background:linear-gradient(120deg,#a4161a,#e5383b);border-color:rgba(233,205,122,.35);color:#fff5f0;box-shadow:0 5px 18px rgba(229,56,59,.25)}
#sendBassToAbletonButton:disabled{opacity:.42;cursor:not-allowed}
.settings-panel{margin-bottom:15px}
.settings-grid{display:grid;grid-template-columns:1.25fr 1.2fr .85fr 1.35fr auto;gap:9px;align-items:end;margin-top:16px}
#apiModel{font-family:Consolas,monospace;font-size:9px}
.save-settings{height:36px;white-space:nowrap}
.settings-feedback{font-size:9px;color:#a3968a;margin-top:10px}
.settings-feedback.ok{color:var(--green)}
.settings-feedback.error{color:#ffad9d}
.remix-panel{border-color:rgba(212,175,55,.24);background:linear-gradient(135deg,rgba(26,14,15,.98),rgba(12,8,9,.98))}
.remix-form-grid{display:grid;grid-template-columns:1.25fr .72fr .82fr 1.15fr;gap:11px;margin-top:16px}
.remix-form-grid label{display:flex;flex-direction:column;gap:6px;font:8px Consolas,monospace;letter-spacing:.6px;color:#9c8a6a}
.remix-form-grid input,.remix-form-grid select,.remix-form-grid textarea{width:100%;background:#0d0809;border:1px solid rgba(212,175,55,.18);border-radius:7px;color:#eee5d8;padding:9px 10px;font:10px 'Segoe UI',Arial;outline:none;transition:border-color .15s}
.remix-form-grid input,.remix-form-grid select{height:36px}
.remix-form-grid textarea{resize:vertical;min-height:66px;line-height:1.5}
.remix-form-grid input:focus,.remix-form-grid select:focus,.remix-form-grid textarea:focus{border-color:rgba(229,56,59,.55);box-shadow:0 0 0 3px rgba(229,56,59,.08)}
.remix-wide{grid-column:1/-1}
.remix-actions{display:flex;align-items:center;gap:14px;margin-top:13px}
.remix-actions .chat-footnote{margin:0;max-width:560px}
.audio-panel{border-color:rgba(212,175,55,.22);background:linear-gradient(130deg,rgba(23,13,14,.97),rgba(11,7,8,.98))}
.audio-import-row{display:flex;align-items:center;gap:13px;flex-wrap:wrap;margin-top:15px}
.audio-analysis-result{margin-top:14px}
.audio-analysis-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.audio-metric{padding:11px;border:1px solid rgba(212,175,55,.15);border-radius:8px;background:rgba(212,175,55,.02)}
.audio-metric span{display:block;font:8px Consolas,monospace;color:#9c8a6a;letter-spacing:.7px}
.audio-metric strong{display:block;margin-top:6px;color:#f7f0e6;font:600 16px 'Segoe UI',Arial}
.audio-file-label{font-size:10px;color:#e8dfd2;margin:0 0 10px}
.energy-chart{display:flex;align-items:flex-end;gap:4px;height:86px;padding:10px 8px;border:1px solid rgba(212,175,55,.14);border-radius:8px;background:rgba(0,0,0,.25);margin-top:12px}
.energy-bar{flex:1;min-width:3px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,var(--gold),var(--red-deep));opacity:.9;transition:opacity .15s}
.energy-bar:hover{opacity:1}
.energy-caption{font:8px Consolas,monospace;color:#8d7f6d;margin-top:6px}
.audio-limitations{font-size:8px;line-height:1.6;color:#84766a;margin-top:10px}
.audio-error{color:#ffad9d;font-size:10px;padding:12px;border:1px solid rgba(229,56,59,.4);border-radius:7px;background:rgba(164,22,26,.1)}
@media(max-width:1450px){.settings-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.save-settings{width:max-content}}
@media(max-width:1350px){.main-content{padding-left:24px;padding-right:24px}.sidebar{width:220px}.stats-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.workspace-grid{grid-template-columns:minmax(0,1.4fr) minmax(245px,.8fr)}.orb-wrap{right:3%;transform:scale(.85)}.topbar-right{gap:8px}.update-pill{display:none}}
@media(max-width:1100px){.remix-form-grid{grid-template-columns:1fr 1fr}.remix-actions{align-items:flex-start;flex-direction:column}.audio-analysis-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.bass-controls{grid-template-columns:1fr 1fr}}
@media(max-width:900px){body{min-width:760px}.sidebar{width:190px;padding:20px 12px}.main-content{padding:20px 16px}.stats-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.settings-grid{grid-template-columns:1fr}.workspace-grid,.detail-grid{grid-template-columns:1fr}}
'@
Write-Host "[6/6] styles.css substituido" -ForegroundColor Green

# ── Validacao + dependencias + commit ──
Write-Host "`nInstalando dependencias..." -ForegroundColor Cyan
npm install
Write-Host "Validando sintaxe..." -ForegroundColor Cyan
npm run check
if ($LASTEXITCODE -ne 0) { throw "Falha na validacao. Nao faca push ate corrigir." }

git add src/main/dev-reload.js src/main/main.js src/renderer/renderer.js src/renderer/index.html src/renderer/styles.css package.json package-lock.json
git commit -m "Music AI 0.6.0 - tema preto/vermelho/dourado, telas separadas, hot-reload e npm run atualizar"

Write-Host "`n== PRONTO! Agora rode: ==" -ForegroundColor Yellow
Write-Host "  git push origin main   (publica no GitHub)" -ForegroundColor White
Write-Host "  npm run dev            (abre com hot-reload)" -ForegroundColor White

