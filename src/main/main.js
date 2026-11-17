const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const fs = require('node:fs/promises');
const { autoUpdater } = require('electron-updater');
const { generateBass, exportBassMidi } = require('./music-engine');
const { chooseAndAnalyzeAudio } = require('./audio-analyzer');
const path = require('node:path');
const { Client, Server } = require('node-osc');

const OSC_HOST = '127.0.0.1';
const OSC_SEND_PORT = 11000;
const OSC_RECEIVE_PORT = 11001;
const MAX_TRACKS_TO_READ = 48;
const MAX_SCENES_TO_READ = 48;
const POLL_INTERVAL_MS = 2200;

let mainWindow;
let oscClient;
let oscServer;
let pollTimer;
let bridgeStarted = false;
let bridgeReadyPromise;
let lastResponseAt = null;
const oscWaiters = new Set();
let updateState = { status: 'idle', message: 'Atualizações automáticas aguardando instalação empacotada.' };
let latestAudioAnalysis = null;
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const sessionState = {
  connected: false,
  bpm: null,
  trackCount: null,
  sceneCount: null,
  isPlaying: null,
  trackNames: [],
  tracks: [],
  scenes: [],
  signatureNumerator: null,
  signatureDenominator: null,
  rootNote: null,
  scaleName: null,
  selectedTrackIndex: null,
  selectedSceneIndex: null,
  selectedDeviceIndex: null,
  currentSongTime: null,
  loop: null,
  loopStart: null,
  loopLength: null,
  metronome: null,
  lastMessage: 'Aguardando conexão com o Ableton.',
  lastUpdated: null
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publishState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ableton:state', structuredClone(sessionState));
  }
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBoolean(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number !== 0 : Boolean(value);
}

function getTrack(index) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_TRACKS_TO_READ) return null;
  if (!sessionState.tracks[index]) {
    sessionState.tracks[index] = {
      index,
      name: sessionState.trackNames[index] || `Faixa ${index + 1}`,
      volume: null,
      panning: null,
      mute: null,
      solo: null,
      deviceCount: null,
      devices: [],
      clips: []
    };
  }
  return sessionState.tracks[index];
}

function normalizeStringList(values) {
  return values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
}

function parseOscMessage(message) {
  if (!Array.isArray(message) || typeof message[0] !== 'string') return;

  const [address, ...args] = message;
  let changed = false;
  lastResponseAt = Date.now();
  for (const waiter of [...oscWaiters]) {
    if (waiter.address === address && waiter.matches(args)) {
      clearTimeout(waiter.timer);
      oscWaiters.delete(waiter);
      waiter.resolve(args);
    }
  }

  switch (address) {
    case '/live/test':
      sessionState.connected = true;
      sessionState.lastMessage = 'AbletonOSC respondeu ao teste de conexão.';
      changed = true;
      break;

    case '/live/startup':
      sessionState.connected = true;
      sessionState.lastMessage = 'AbletonOSC foi iniciado no Live.';
      changed = true;
      break;

    case '/live/error':
      sessionState.lastMessage = `AbletonOSC informou: ${String(args[0] ?? 'erro desconhecido')}`;
      changed = true;
      break;

    case '/live/song/get/tempo':
      sessionState.bpm = toFiniteNumber(args[0]);
      changed = true;
      break;
    case '/live/song/get/num_tracks':
      sessionState.trackCount = toFiniteNumber(args[0]);
      changed = true;
      break;
    case '/live/song/get/num_scenes':
      sessionState.sceneCount = toFiniteNumber(args[0]);
      changed = true;
      break;
    case '/live/song/get/is_playing':
      sessionState.isPlaying = toBoolean(args[0]);
      changed = true;
      break;
    case '/live/song/get/track_names': {
      const names = normalizeStringList(args);
      if (names.length) {
        sessionState.trackNames = names;
        names.forEach((name, index) => {
          const track = getTrack(index);
          if (track && (!track.name || track.name.startsWith('Faixa '))) track.name = name;
        });
      }
      changed = true;
      break;
    }
    case '/live/song/get/signature_numerator':
      sessionState.signatureNumerator = toFiniteNumber(args[0]);
      changed = true;
      break;
    case '/live/song/get/signature_denominator':
      sessionState.signatureDenominator = toFiniteNumber(args[0]);
      changed = true;
      break;
    case '/live/song/get/root_note':
      sessionState.rootNote = toFiniteNumber(args[0]);
      changed = true;
      break;
    case '/live/song/get/scale_name':
      sessionState.scaleName = typeof args[0] === 'string' ? args[0].trim() : null;
      changed = true;
      break;
    case '/live/song/get/current_song_time':
      sessionState.currentSongTime = toFiniteNumber(args[0]);
      changed = true;
      break;
    case '/live/song/get/loop':
      sessionState.loop = toBoolean(args[0]);
      changed = true;
      break;
    case '/live/song/get/loop_start':
      sessionState.loopStart = toFiniteNumber(args[0]);
      changed = true;
      break;
    case '/live/song/get/loop_length':
      sessionState.loopLength = toFiniteNumber(args[0]);
      changed = true;
      break;
    case '/live/song/get/metronome':
      sessionState.metronome = toBoolean(args[0]);
      changed = true;
      break;

    case '/live/view/get/selected_track':
      sessionState.selectedTrackIndex = toFiniteNumber(args[0]);
      changed = true;
      break;
    case '/live/view/get/selected_scene':
      sessionState.selectedSceneIndex = toFiniteNumber(args[0]);
      changed = true;
      break;
    case '/live/view/get/selected_device':
      sessionState.selectedTrackIndex = toFiniteNumber(args[0]);
      sessionState.selectedDeviceIndex = toFiniteNumber(args[1]);
      changed = true;
      break;

    case '/live/track/get/name':
    case '/live/track/get/volume':
    case '/live/track/get/panning':
    case '/live/track/get/mute':
    case '/live/track/get/solo':
    case '/live/track/get/num_devices': {
      const index = toFiniteNumber(args[0]);
      const track = getTrack(index);
      if (!track) break;
      const value = args[1];
      if (address.endsWith('/name')) track.name = String(value ?? track.name);
      if (address.endsWith('/volume')) track.volume = toFiniteNumber(value);
      if (address.endsWith('/panning')) track.panning = toFiniteNumber(value);
      if (address.endsWith('/mute')) track.mute = toBoolean(value);
      if (address.endsWith('/solo')) track.solo = toBoolean(value);
      if (address.endsWith('/num_devices')) track.deviceCount = toFiniteNumber(value);
      changed = true;
      break;
    }
    case '/live/track/get/devices/name':
    case '/live/track/get/clips/name': {
      const index = toFiniteNumber(args[0]);
      const track = getTrack(index);
      if (!track) break;
      const values = normalizeStringList(args.slice(1));
      if (address.endsWith('/devices/name')) track.devices = values;
      else track.clips = values;
      changed = true;
      break;
    }
    case '/live/clip_slot/get/has_clip':
      changed = false;
      break;

    case '/live/scene/get/name': {
      const index = toFiniteNumber(args[0]);
      const name = args[1];
      if (Number.isInteger(index) && index >= 0 && typeof name === 'string') {
        sessionState.scenes[index] = { index, name: name.trim() || `Cena ${index + 1}` };
        changed = true;
      }
      break;
    }
    default:
      return;
  }

  if (changed) {
    sessionState.lastUpdated = new Date().toISOString();
    publishState();
  }
}

function startOscBridge() {
  if (bridgeStarted) return bridgeReadyPromise;

  bridgeStarted = true;
  oscServer = new Server(OSC_RECEIVE_PORT, OSC_HOST);
  oscClient = new Client(OSC_HOST, OSC_SEND_PORT);

  bridgeReadyPromise = new Promise((resolve, reject) => {
    const readyTimeout = setTimeout(() => {
      reject(new Error(`A porta UDP ${OSC_RECEIVE_PORT} não ficou disponível.`));
    }, 3000);

    oscServer.once('listening', () => {
      clearTimeout(readyTimeout);
      resolve();
    });

    oscServer.once('error', (error) => {
      clearTimeout(readyTimeout);
      reject(error);
    });
  });

  oscServer.on('message', parseOscMessage);
  oscServer.on('error', (error) => {
    sessionState.connected = false;
    sessionState.lastMessage = `Erro na porta OSC ${OSC_RECEIVE_PORT}: ${error.message}`;
    publishState();
  });

  return bridgeReadyPromise;
}

async function sendOsc(address, ...args) {
  if (!bridgeStarted || !oscClient) {
    throw new Error('A ponte OSC ainda não foi inicializada.');
  }
  await oscClient.send(address, ...args);
}

function requestOscResponse(address, args = [], matches = () => true, timeoutMs = 1800) {
  return new Promise((resolve, reject) => {
    const waiter = {
      address,
      matches,
      resolve,
      timer: setTimeout(() => {
        oscWaiters.delete(waiter);
        reject(new Error(`Tempo esgotado aguardando ${address}.`));
      }, timeoutMs)
    };
    oscWaiters.add(waiter);
    try {
      sendOsc(address, ...args).catch(error => {
        clearTimeout(waiter.timer);
        oscWaiters.delete(waiter);
        reject(error);
      });
    } catch (error) {
      clearTimeout(waiter.timer);
      oscWaiters.delete(waiter);
      reject(error);
    }
  });
}

async function requestQuickSessionData() {
  const requests = [
    '/live/song/get/tempo',
    '/live/song/get/num_tracks',
    '/live/song/get/num_scenes',
    '/live/song/get/is_playing',
    '/live/song/get/signature_numerator',
    '/live/song/get/signature_denominator',
    '/live/song/get/root_note',
    '/live/song/get/scale_name',
    '/live/song/get/current_song_time',
    '/live/song/get/loop',
    '/live/song/get/loop_start',
    '/live/song/get/loop_length',
    '/live/song/get/metronome',
    '/live/view/get/selected_track',
    '/live/view/get/selected_scene',
    '/live/view/get/selected_device'
  ];

  for (const address of requests) await sendOsc(address);
}

async function requestTrackData(trackIndex) {
  if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= MAX_TRACKS_TO_READ) return;
  const requests = [
    ['/live/track/get/name', trackIndex],
    ['/live/track/get/volume', trackIndex],
    ['/live/track/get/panning', trackIndex],
    ['/live/track/get/mute', trackIndex],
    ['/live/track/get/solo', trackIndex],
    ['/live/track/get/num_devices', trackIndex],
    ['/live/track/get/devices/name', trackIndex],
    ['/live/track/get/clips/name', trackIndex]
  ];
  for (const [address, index] of requests) await sendOsc(address, index);
}

async function requestFullSessionData() {
  await requestQuickSessionData();
  await sendOsc('/live/song/get/track_names', 0, MAX_TRACKS_TO_READ);

  const trackCount = Math.min(sessionState.trackCount || 0, MAX_TRACKS_TO_READ);
  const sceneCount = Math.min(sessionState.sceneCount || 0, MAX_SCENES_TO_READ);

  for (let index = 0; index < trackCount; index += 1) {
    await requestTrackData(index);
  }
  for (let index = 0; index < sceneCount; index += 1) {
    await sendOsc('/live/scene/get/name', index);
  }
  return { tracksRead: trackCount, scenesRead: sceneCount };
}

async function connectToAbleton() {
  await startOscBridge();
  sessionState.connected = false;
  sessionState.lastMessage = 'Testando comunicação OSC com o Ableton Live...';
  publishState();

  await sendOsc('/live/test');
  await wait(750);

  if (!sessionState.connected) {
    sessionState.lastMessage = 'Sem resposta do AbletonOSC. Confira se ele está selecionado em Control Surface.';
    publishState();
    return structuredClone(sessionState);
  }

  await requestQuickSessionData();
  await wait(450);
  const result = await requestFullSessionData();
  await wait(850);
  sessionState.lastMessage = `Conectado. ${result.tracksRead} faixas e ${result.scenesRead} cenas sincronizadas.`;
  sessionState.lastUpdated = new Date().toISOString();
  publishState();

  if (!pollTimer) {
    pollTimer = setInterval(async () => {
      if (!sessionState.connected) return;
      try {
        await requestQuickSessionData();
        const selected = sessionState.selectedTrackIndex;
        if (Number.isInteger(selected) && selected >= 0 && selected < MAX_TRACKS_TO_READ) {
          await sendOsc('/live/track/get/volume', selected);
          await sendOsc('/live/track/get/panning', selected);
          await sendOsc('/live/track/get/mute', selected);
          await sendOsc('/live/track/get/solo', selected);
        }
        if (lastResponseAt && Date.now() - lastResponseAt > 9000) {
          sessionState.connected = false;
          sessionState.lastMessage = 'Sem respostas recentes do Ableton. Verifique se o Live continua aberto.';
          publishState();
        }
      } catch (error) {
        sessionState.lastMessage = `Falha ao consultar o Live: ${error.message}`;
        publishState();
      }
    }, POLL_INTERVAL_MS);
  }

  return structuredClone(sessionState);
}



async function readSettings() {
  try {
    const raw = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
    let apiKey = '';
    if (raw.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
      apiKey = safeStorage.decryptString(Buffer.from(raw.apiKeyEncrypted, 'base64'));
    }
    const storedModel = raw.model === 'llama-3.3-70b-versatile' ? 'openai/gpt-oss-120b' : (raw.model || 'openai/gpt-oss-120b');
    return { apiBaseUrl: raw.apiBaseUrl || 'https://api.groq.com/openai/v1', model: storedModel, reasoningEffort: raw.reasoningEffort || 'low', apiKey };
  } catch { return { apiBaseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', reasoningEffort: 'low', apiKey: '' }; }
}

async function saveSettings(settings) {
  const apiBaseUrl = String(settings.apiBaseUrl || '').trim().replace(/\/+$/, '');
  const model = String(settings.model || 'openai/gpt-oss-120b').trim();
  const reasoningEffort = ['low', 'medium', 'high'].includes(settings.reasoningEffort) ? settings.reasoningEffort : 'low';
  let apiKey = String(settings.apiKey || '').trim();
  if (!apiKey) apiKey = (await readSettings()).apiKey;
  if (!/^https:\/\//i.test(apiBaseUrl)) throw new Error('A URL do provedor precisa começar com https://');
  if (!model) throw new Error('Informe o nome do modelo.');
  if (!safeStorage.isEncryptionAvailable()) throw new Error('O armazenamento seguro do Windows não está disponível.');
  const apiKeyEncrypted = apiKey ? safeStorage.encryptString(apiKey).toString('base64') : '';
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify({ apiBaseUrl, model, reasoningEffort, apiKeyEncrypted }, null, 2), 'utf8');
  return { apiBaseUrl, model, reasoningEffort, configured: Boolean(apiKey) };
}

async function askMusicAI(payload) {
  const request = typeof payload === 'string' ? { message: payload } : (payload || {});
  const prompt = String(request.message || '').trim();
  if (!prompt || prompt.length > 8000) throw new Error('A mensagem está vazia ou é longa demais.');
  const settings = await readSettings();
  if (!settings.apiKey) throw new Error('Configure sua chave de API Groq em Configurações antes de conversar com a IA.');
  const context = {
    daw: 'Ableton Live 12 Suite', connected: sessionState.connected,
    bpm: sessionState.bpm,
    key: sessionState.rootNote === null ? null : `${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][sessionState.rootNote]} ${sessionState.scaleName || ''}`.trim(),
    timeSignature: `${sessionState.signatureNumerator || '?'} / ${sessionState.signatureDenominator || '?'}`,
    trackCount: sessionState.trackCount,
    sceneCount: sessionState.sceneCount,
    tracks: (sessionState.tracks || []).filter(Boolean).map(t => ({ name: t.name, devices: t.devices, clips: t.clips, mute: t.mute, solo: t.solo })).slice(0, 32),
    selectedTrack: sessionState.selectedTrackIndex,
    referenceAudioAnalysis: latestAudioAnalysis
  };
  const suppliedMessages = Array.isArray(request.messages) ? request.messages : [];
  const history = suppliedMessages
    .filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
    .slice(-12)
    .map(item => ({ role: item.role, content: item.content.slice(0, 6000) }));
  const systemPrompt = [
    'Você é o Music AI, produtor musical e professor de música eletrônica. Responda em português brasileiro, com orientação prática, objetiva e didática.',
    'Seu foco inclui Brazilian Bass como gênero amplo, EDM, house, remix, sound design, Serum, MIDI, arranjo, mixagem e masterização.',
    'Ajude o usuário a planejar remixes completos: mapear seções (intro, groove, build, drop, break, segundo drop, outro), energia, transições, bateria, baixo, harmonia, vocais e automações. Dê planos que possam ser executados em etapas no Ableton.',
    'Para basslines, descreva groove, notas e oitavas, relação com kick, duração, síncopes, sub e mid-bass, além de sidechain. Se houver resumo de análise WAV no contexto, use apenas as métricas fornecidas e explique suas limitações; não invente BPM, tonalidade, acordes ou stems.',
    'Crie material musical original usando características gerais do gênero. Não transcreva melodias, basslines, arranjos distintivos ou gravações de músicas existentes. Não afirme imitar exatamente artistas ou faixas específicas; traduza referências em características musicais amplas.',
    'Não invente parâmetros da sessão. Separe claramente recomendações de ações realmente executadas. Nesta versão, você pode orientar e preparar ideias, mas só o recurso explícito de envio MIDI pode criar uma nova faixa e clip no Ableton.',
    'Contexto atual do Ableton: ' + JSON.stringify(context)
  ].join('\n');
  const messages = [{ role: 'system', content: systemPrompt }, ...history, { role: 'user', content: prompt }];
  const body = { model: settings.model, messages, max_completion_tokens: 3500 };
  if (settings.model.includes('gpt-oss')) body.reasoning_effort = settings.reasoningEffort || 'low';
  else body.temperature = 0.55;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  let response;
  try {
    response = await fetch(`${settings.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('A IA demorou demais para responder. Tente novamente.');
    throw new Error(`Falha de conexão com Groq: ${error.message}`);
  } finally { clearTimeout(timeout); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Groq respondeu HTTP ${response.status}.`);
  return data.choices?.[0]?.message?.content || 'A IA não retornou texto.';
}

async function sendBassToAbleton(pattern) {
  if (!sessionState.connected || !bridgeStarted) throw new Error('Conecte o Ableton antes de enviar a bassline.');
  if (!pattern || !Array.isArray(pattern.notes) || pattern.notes.length < 1 || pattern.notes.length > 128) {
    throw new Error('Bassline inválida ou com quantidade de notas fora do limite. Gere novamente.');
  }
  const bars = Math.max(1, Math.min(8, Number(pattern.bars) || 4));
  const safeNotes = pattern.notes.map((note) => ({
    pitch: Math.max(0, Math.min(127, Math.round(Number(note.pitch)))),
    start: Math.max(0, Number(note.start)),
    duration: Math.max(0.05, Math.min(8, Number(note.duration))),
    velocity: Math.max(1, Math.min(127, Math.round(Number(note.velocity) || 96)))
  }));
  if (safeNotes.some(note => !Number.isFinite(note.pitch) || !Number.isFinite(note.start) || !Number.isFinite(note.duration))) {
    throw new Error('A bassline contém notas inválidas. Gere novamente.');
  }

  // Read current count, then always create a brand-new MIDI track to avoid touching existing work.
  const beforeArgs = await requestOscResponse('/live/song/get/num_tracks', [], args => Number.isFinite(Number(args[0])));
  const beforeCount = Number(beforeArgs[0]);
  await sendOsc('/live/song/create_midi_track', -1);

  let afterCount = beforeCount;
  for (let attempt = 0; attempt < 6 && afterCount <= beforeCount; attempt += 1) {
    await wait(250);
    const args = await requestOscResponse('/live/song/get/num_tracks', [], value => Number.isFinite(Number(value[0])), 2000);
    afterCount = Number(args[0]);
  }
  if (afterCount <= beforeCount) throw new Error('O Ableton não confirmou a criação da nova faixa MIDI.');

  const trackIndex = afterCount - 1;
  const clipIndex = 0;
  await sendOsc('/live/view/set/selected_track', trackIndex);
  await sendOsc('/live/view/get/selected_track');
  const slotArgs = await requestOscResponse(
    '/live/clip_slot/get/has_clip', [trackIndex, clipIndex],
    args => Number(args[0]) === trackIndex && Number(args[1]) === clipIndex && args.length >= 3,
    2500
  );
  if (Number(slotArgs[2]) !== 0) throw new Error('O primeiro slot da nova faixa não está vazio. Nenhuma nota foi inserida.');

  await sendOsc('/live/clip_slot/create_clip', trackIndex, clipIndex, bars * 4);
  await wait(350);
  const createdArgs = await requestOscResponse(
    '/live/clip_slot/get/has_clip', [trackIndex, clipIndex],
    args => Number(args[0]) === trackIndex && Number(args[1]) === clipIndex && args.length >= 3,
    2500
  );
  if (Number(createdArgs[2]) !== 1) throw new Error('O Ableton não confirmou a criação do clip MIDI.');

  const label = `Music AI - ${String(pattern.style || 'Bass').toUpperCase()} ${pattern.register || 'mid'} ${pattern.root || ''} ${pattern.scale || ''}`.trim().slice(0, 70);
  await sendOsc('/live/clip/set/name', trackIndex, clipIndex, label);
  for (let offset = 0; offset < safeNotes.length; offset += 8) {
    const args = safeNotes.slice(offset, offset + 8).flatMap(note => [note.pitch, note.start, note.duration, note.velocity, false]);
    await sendOsc('/live/clip/add/notes', trackIndex, clipIndex, ...args);
    await wait(35);
  }
  await wait(150);
  const insertedNotes = await requestOscResponse(
    '/live/clip/get/notes', [trackIndex, clipIndex],
    args => Number(args[0]) === trackIndex && Number(args[1]) === clipIndex,
    3000
  );
  const confirmedNoteCount = Math.floor(Math.max(0, insertedNotes.length - 2) / 5);
  if (confirmedNoteCount !== safeNotes.length) {
    throw new Error(`O clip foi criado, mas o Ableton confirmou ${confirmedNoteCount} de ${safeNotes.length} notas. Confira o clip na faixa MIDI recém-criada.`);
  }

  sessionState.trackCount = afterCount;
  sessionState.lastMessage = `Bassline criada no Ableton: nova faixa MIDI ${afterCount}, clip na cena 1.`;
  await requestTrackData(trackIndex);
  await sendOsc('/live/song/get/track_names', 0, MAX_TRACKS_TO_READ);
  await wait(350);
  publishState();
  return { ok: true, trackIndex, clipIndex, trackName: label, noteCount: safeNotes.length, bars };
}

function publishUpdateState(status, message, extra = {}) {
  updateState = { status, message, ...extra };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:state', updateState);
}

function setupAutoUpdater() {
  const publishConfig = require('../../package.json').build?.publish?.[0];
  if (!publishConfig || !publishConfig.owner || publishConfig.owner === 'SEU_USUARIO_GITHUB') {
    publishUpdateState('setup', 'Auto-updater implementado; configure seu repositório GitHub em package.json para ativar.');
    return;
  }
  if (!app.isPackaged) {
    publishUpdateState('development', 'Auto-updater disponível na versão instalada; no modo de desenvolvimento ele não executa.');
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => publishUpdateState('checking', 'Verificando atualizações...'));
  autoUpdater.on('update-available', info => publishUpdateState('available', `Versão ${info.version} encontrada. Baixando em segundo plano...`, { version: info.version }));
  autoUpdater.on('download-progress', progress => publishUpdateState('downloading', `Baixando atualização: ${Math.round(progress.percent)}%`, { percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', info => publishUpdateState('downloaded', `Versão ${info.version} pronta para instalar. Reinicie o Music AI para concluir.`, { version: info.version }));
  autoUpdater.on('update-not-available', () => publishUpdateState('current', 'Você já está usando a versão mais recente.'));
  autoUpdater.on('error', error => publishUpdateState('error', `Falha na atualização: ${error.message}`));
  setTimeout(() => autoUpdater.checkForUpdates().catch(error => publishUpdateState('error', error.message)), 5000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 1040,
    minWidth: 1120,
    minHeight: 780,
    backgroundColor: '#080b10',
    title: 'Music AI · Ableton Companion',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('ableton:connect', async () => {
  try {
    return await connectToAbleton();
  } catch (error) {
    sessionState.connected = false;
    sessionState.lastMessage = `Não foi possível iniciar a conexão: ${error.message}`;
    publishState();
    return structuredClone(sessionState);
  }
});

ipcMain.handle('ableton:refresh', async () => {
  if (!sessionState.connected) {
    return { ...structuredClone(sessionState), lastMessage: 'Conecte ao Ableton antes de sincronizar.' };
  }
  try {
    const result = await requestFullSessionData();
    await wait(850);
    sessionState.lastMessage = `Sessão atualizada: ${result.tracksRead} faixas e ${result.scenesRead} cenas consultadas.`;
    sessionState.lastUpdated = new Date().toISOString();
    publishState();
    return structuredClone(sessionState);
  } catch (error) {
    sessionState.lastMessage = `Falha ao sincronizar a sessão: ${error.message}`;
    publishState();
    return structuredClone(sessionState);
  }
});

ipcMain.handle('ableton:transport', async (_event, action) => {
  if (!sessionState.connected) return { ok: false, message: 'O Ableton não está conectado.' };
  const commands = { play: '/live/song/start_playing', stop: '/live/song/stop_playing' };
  const address = commands[action];
  if (!address) return { ok: false, message: 'Comando não permitido.' };
  try {
    await sendOsc(address);
    await wait(180);
    await sendOsc('/live/song/get/is_playing');
    return { ok: true, message: action === 'play' ? 'Reprodução iniciada.' : 'Reprodução parada.' };
  } catch (error) {
    return { ok: false, message: `Erro ao enviar comando: ${error.message}` };
  }
});

ipcMain.handle('ableton:select-track', async (_event, trackIndex) => {
  if (!sessionState.connected) return { ok: false, message: 'Conecte o Ableton primeiro.' };
  if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= Math.min(sessionState.trackCount || 0, MAX_TRACKS_TO_READ)) {
    return { ok: false, message: 'Índice de faixa inválido.' };
  }
  try {
    await sendOsc('/live/view/set/selected_track', trackIndex);
    await wait(120);
    await sendOsc('/live/view/get/selected_track');
    await requestTrackData(trackIndex);
    return { ok: true, message: `Faixa ${trackIndex + 1} selecionada no Ableton.` };
  } catch (error) {
    return { ok: false, message: `Não foi possível selecionar a faixa: ${error.message}` };
  }
});

ipcMain.handle('ableton:select-scene', async (_event, sceneIndex) => {
  if (!sessionState.connected) return { ok: false, message: 'Conecte o Ableton primeiro.' };
  if (!Number.isInteger(sceneIndex) || sceneIndex < 0 || sceneIndex >= Math.min(sessionState.sceneCount || 0, MAX_SCENES_TO_READ)) {
    return { ok: false, message: 'Índice de cena inválido.' };
  }
  try {
    await sendOsc('/live/view/set/selected_scene', sceneIndex);
    await wait(120);
    await sendOsc('/live/view/get/selected_scene');
    return { ok: true, message: `Cena ${sceneIndex + 1} selecionada. Ela não foi disparada.` };
  } catch (error) {
    return { ok: false, message: `Não foi possível selecionar a cena: ${error.message}` };
  }
});


ipcMain.handle('ai:get-settings', async () => {
  const settings = await readSettings();
  return { apiBaseUrl: settings.apiBaseUrl, model: settings.model, reasoningEffort: settings.reasoningEffort, configured: Boolean(settings.apiKey) };
});
ipcMain.handle('ai:save-settings', async (_event, settings) => saveSettings(settings || {}));
ipcMain.handle('ai:chat', async (_event, message) => ({ reply: await askMusicAI(message) }));
ipcMain.handle('audio:analyze-reference', async () => {
  const result = await chooseAndAnalyzeAudio();
  if (!result.canceled) latestAudioAnalysis = result.analysis;
  return result;
});
ipcMain.handle('audio:get-analysis', async () => latestAudioAnalysis);
ipcMain.handle('music:generate-bass', async (_event, options) => generateBass(options || {}, sessionState));
ipcMain.handle('music:export-bass', async (_event, pattern) => exportBassMidi(pattern));
ipcMain.handle('music:send-bass-to-ableton', async (_event, pattern) => sendBassToAbleton(pattern));
ipcMain.handle('update:get-state', async () => updateState);
ipcMain.handle('update:check', async () => {
  const publishConfig = require('../../package.json').build?.publish?.[0];
  if (!publishConfig || publishConfig.owner === 'SEU_USUARIO_GITHUB') return { ok: false, message: 'Configure seu usuário e repositório GitHub em package.json primeiro.' };
  if (!app.isPackaged) return { ok: false, message: 'Instale a versão empacotada para testar o atualizador.' };
  try { await autoUpdater.checkForUpdates(); return { ok: true, message: 'Verificação iniciada.' }; }
  catch (error) { return { ok: false, message: error.message }; }
});
ipcMain.handle('update:install', async () => {
  if (updateState.status !== 'downloaded') return { ok: false, message: 'Nenhuma atualização está pronta.' };
  autoUpdater.quitAndInstall(); return { ok: true };
});

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', async () => {
  if (pollTimer) clearInterval(pollTimer);
  try {
    if (oscClient) await oscClient.close();
    if (oscServer) await oscServer.close();
  } catch (error) {
    console.error('Erro ao fechar a ponte OSC:', error);
  }
});
