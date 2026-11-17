const connectButton = document.getElementById('connectButton');
const refreshButton = document.getElementById('refreshButton');
const playButton = document.getElementById('playButton');
const stopButton = document.getElementById('stopButton');
const sendBassToAbletonButton = document.getElementById('sendBassToAbletonButton');

const ui = {
  bpm: document.getElementById('bpmValue'),
  keyScale: document.getElementById('keyScaleValue'),
  timeSignature: document.getElementById('timeSignatureValue'),
  position: document.getElementById('positionValue'),
  trackCount: document.getElementById('trackCountValue'),
  sceneCount: document.getElementById('sceneCountValue'),
  playState: document.getElementById('playStateValue'),
  trackTableBody: document.getElementById('trackTableBody'),
  trackLimitNote: document.getElementById('trackLimitNote'),
  connectionText: document.getElementById('connectionText'),
  sidebarConnection: document.getElementById('sidebarConnection'),
  message: document.getElementById('messageText'),
  updated: document.getElementById('updatedText'),
  sidebarDot: document.getElementById('sidebarDot'),
  topDot: document.getElementById('topDot'),
  footerIndicator: document.getElementById('footerIndicator'),
  transportDot: document.getElementById('transportDot'),
  loop: document.getElementById('loopValue'),
  metronome: document.getElementById('metronomeValue'),
  selectedTrackTitle: document.getElementById('selectedTrackTitle'),
  selectedVolume: document.getElementById('selectedVolume'),
  selectedPan: document.getElementById('selectedPan'),
  selectedMute: document.getElementById('selectedMute'),
  selectedSolo: document.getElementById('selectedSolo'),
  deviceList: document.getElementById('deviceList'),
  clipList: document.getElementById('clipList'),
  sceneList: document.getElementById('sceneList')
};

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
let latestState = null;

function makeCell(text, className = '') {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  return cell;
}

function makeChip(text, className = '') {
  const chip = document.createElement('span');
  chip.className = className ? `data-chip ${className}` : 'data-chip';
  chip.textContent = text;
  return chip;
}

function setConnectionStatus(connected) {
  const status = connected ? 'online' : '';
  ui.connectionText.textContent = connected ? 'Ableton conectado' : 'Ableton desconectado';
  ui.sidebarConnection.textContent = connected ? 'Conectado' : 'Desconectado';
  ui.sidebarDot.classList.toggle('online', connected);
  ui.topDot.classList.toggle('online', connected);
  ui.footerIndicator.classList.toggle('online', connected);
  ui.transportDot.classList.toggle('online', connected && Boolean(latestState?.isPlaying));
  connectButton.disabled = false;
  refreshButton.disabled = !connected;
  playButton.disabled = !connected;
  stopButton.disabled = !connected;
  sendBassToAbletonButton.disabled = !connected || !currentBassPattern;
  if (!status) ui.transportDot.classList.remove('online');
}

function formatKeyScale(rootNote, scaleName) {
  const root = Number(rootNote);
  const hasRoot = Number.isInteger(root) && root >= 0 && root <= 11;
  const scale = typeof scaleName === 'string' && scaleName.trim() ? scaleName.trim() : null;
  if (hasRoot && scale) return `${NOTE_NAMES[root]} ${scale}`;
  if (scale) return scale;
  if (hasRoot) return NOTE_NAMES[root];
  return '—';
}

function formatSongPosition(beats, numerator) {
  if (!Number.isFinite(beats)) return '—';
  const beatsPerBar = Number.isFinite(numerator) && numerator > 0 ? numerator : 4;
  const safeBeats = Math.max(0, beats);
  const bar = Math.floor(safeBeats / beatsPerBar) + 1;
  const beat = Math.floor(safeBeats % beatsPerBar) + 1;
  return `${String(bar).padStart(3, '0')}.${beat}`;
}

function formatVolume(value) {
  if (!Number.isFinite(value)) return '—';
  const db = value <= 0 ? '-∞ dB' : `${(20 * Math.log10(value)).toFixed(1)} dB`;
  return db;
}

function formatPan(value) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 0.015) return 'Centro';
  const percent = Math.round(Math.abs(value) * 100);
  return value < 0 ? `${percent}% L` : `${percent}% R`;
}

function setChips(container, values, emptyText) {
  container.replaceChildren();
  if (!Array.isArray(values) || values.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'muted-text';
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }
  values.forEach((value, index) => container.appendChild(makeChip(value || `Item ${index + 1}`)));
}

function renderTracks(state) {
  const count = Math.min(Number.isFinite(state.trackCount) ? state.trackCount : 0, 48);
  const tracks = Array.isArray(state.tracks) ? state.tracks : [];
  const names = Array.isArray(state.trackNames) ? state.trackNames : [];
  ui.trackTableBody.replaceChildren();

  if (count === 0) {
    const row = document.createElement('tr');
    const cell = makeCell('Conecte o Ableton e sincronize a sessão.', 'table-empty');
    cell.colSpan = 7;
    row.appendChild(cell);
    ui.trackTableBody.appendChild(row);
    ui.trackLimitNote.textContent = 'Aguardando dados do Ableton.';
    return;
  }

  for (let index = 0; index < count; index += 1) {
    const track = tracks[index] || { index };
    const name = track.name || names[index] || `Faixa ${index + 1}`;
    const row = document.createElement('tr');
    if (index === state.selectedTrackIndex) row.classList.add('selected-row');
    row.appendChild(makeCell(String(index + 1).padStart(2, '0'), 'index-cell'));
    row.appendChild(makeCell(name, 'track-name-cell'));
    row.appendChild(makeCell(Number.isFinite(track.deviceCount) ? String(track.deviceCount) : (track.devices?.length ? String(track.devices.length) : '—')));
    row.appendChild(makeCell(formatVolume(track.volume)));
    row.appendChild(makeCell(formatPan(track.panning)));

    const stateCell = document.createElement('td');
    const flags = [];
    if (track.mute === true) flags.push('MUTE');
    if (track.solo === true) flags.push('SOLO');
    stateCell.textContent = flags.length ? flags.join(' · ') : 'NORMAL';
    stateCell.className = flags.length ? 'flag-cell' : 'normal-cell';
    row.appendChild(stateCell);

    const actionCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'select-button';
    button.textContent = index === state.selectedTrackIndex ? 'Selecionada' : 'Selecionar';
    button.disabled = !state.connected || index === state.selectedTrackIndex;
    button.addEventListener('click', () => selectTrack(index));
    actionCell.appendChild(button);
    row.appendChild(actionCell);
    ui.trackTableBody.appendChild(row);
  }

  ui.trackLimitNote.textContent = state.trackCount > 48
    ? `Mostrando as primeiras 48 de ${state.trackCount} faixas para manter a sincronização leve.`
    : `${count} faixa(s) consultada(s) · dados de volume, pan, mute, solo, dispositivos e clips.`;
}

function renderSelectedTrack(state) {
  const index = state.selectedTrackIndex;
  const track = Number.isInteger(index) && Array.isArray(state.tracks) ? state.tracks[index] : null;
  if (!track) {
    ui.selectedTrackTitle.textContent = 'Nenhuma faixa selecionada';
    ui.selectedVolume.textContent = '—';
    ui.selectedPan.textContent = '—';
    ui.selectedMute.textContent = '—';
    ui.selectedSolo.textContent = '—';
    setChips(ui.deviceList, [], 'Selecione uma faixa para consultar os dispositivos.');
    setChips(ui.clipList, [], 'Selecione uma faixa para consultar os clips.');
    return;
  }
  ui.selectedTrackTitle.textContent = `${index + 1}. ${track.name || `Faixa ${index + 1}`}`;
  ui.selectedVolume.textContent = formatVolume(track.volume);
  ui.selectedPan.textContent = formatPan(track.panning);
  ui.selectedMute.textContent = track.mute === null || track.mute === undefined ? '—' : (track.mute ? 'Ligado' : 'Desligado');
  ui.selectedSolo.textContent = track.solo === null || track.solo === undefined ? '—' : (track.solo ? 'Ligado' : 'Desligado');
  setChips(ui.deviceList, track.devices, 'Nenhum dispositivo informado nesta faixa.');
  setChips(ui.clipList, track.clips, 'Nenhum clip nomeado nesta faixa.');
}

function renderScenes(state) {
  ui.sceneList.replaceChildren();
  const scenes = Array.isArray(state.scenes) ? state.scenes.filter(Boolean) : [];
  if (!scenes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'As cenas aparecerão aqui após a sincronização.';
    ui.sceneList.appendChild(empty);
    return;
  }

  scenes.forEach((scene) => {
    const item = document.createElement('div');
    item.className = 'scene-item';
    if (scene.index === state.selectedSceneIndex) item.classList.add('selected');
    const details = document.createElement('div');
    const number = document.createElement('span');
    number.className = 'scene-number';
    number.textContent = `CENA ${String(scene.index + 1).padStart(2, '0')}`;
    const name = document.createElement('strong');
    name.textContent = scene.name || `Cena ${scene.index + 1}`;
    details.append(number, name);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'select-button';
    button.textContent = scene.index === state.selectedSceneIndex ? 'Selecionada' : 'Selecionar';
    button.disabled = !state.connected || scene.index === state.selectedSceneIndex;
    button.addEventListener('click', () => selectScene(scene.index));
    item.append(details, button);
    ui.sceneList.appendChild(item);
  });
}

function renderState(state) {
  if (!state) return;
  latestState = state;
  setConnectionStatus(Boolean(state.connected));

  ui.bpm.textContent = Number.isFinite(state.bpm) ? Number(state.bpm).toFixed(1).replace('.0', '') : '—';
  ui.keyScale.textContent = formatKeyScale(state.rootNote, state.scaleName);
  ui.timeSignature.textContent = Number.isFinite(state.signatureNumerator) && Number.isFinite(state.signatureDenominator)
    ? `${state.signatureNumerator}/${state.signatureDenominator}` : '—';
  ui.position.textContent = formatSongPosition(state.currentSongTime, state.signatureNumerator);
  ui.trackCount.textContent = Number.isFinite(state.trackCount) ? String(state.trackCount) : '—';
  ui.sceneCount.textContent = Number.isFinite(state.sceneCount) ? String(state.sceneCount) : '—';
  ui.playState.textContent = state.isPlaying === null ? 'AGUARDANDO' : (state.isPlaying ? 'TOCANDO' : 'PARADO');
  ui.transportDot.classList.toggle('online', Boolean(state.connected && state.isPlaying));
  ui.loop.textContent = state.loop === null ? '—' : (state.loop ? 'Ligado' : 'Desligado');
  ui.metronome.textContent = state.metronome === null ? '—' : (state.metronome ? 'Ligado' : 'Desligado');
  ui.message.textContent = state.lastMessage || 'Aguardando dados do Ableton.';
  ui.updated.textContent = state.lastUpdated
    ? `ATUALIZADO ${new Date(state.lastUpdated).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
    : 'SEM SINCRONIZAÇÃO';

  renderTracks(state);
  renderSelectedTrack(state);
  renderScenes(state);
}

async function connect() {
  connectButton.disabled = true;
  connectButton.innerHTML = '<span>↻</span> Conectando...';
  ui.message.textContent = 'Testando a comunicação local com AbletonOSC...';
  try {
    renderState(await window.musicAI.ableton.connect());
  } catch (error) {
    ui.message.textContent = `Erro: ${error.message}`;
  } finally {
    connectButton.disabled = false;
    connectButton.innerHTML = '<span>↔</span> Conectar ao Ableton';
  }
}

async function refresh() {
  refreshButton.disabled = true;
  refreshButton.textContent = 'Sincronizando...';
  try {
    renderState(await window.musicAI.ableton.refresh());
  } catch (error) {
    ui.message.textContent = `Erro ao sincronizar: ${error.message}`;
  } finally {
    refreshButton.disabled = !latestState?.connected;
    refreshButton.innerHTML = 'Sincronizar sessão <span>↻</span>';
  }
}

async function transport(action) {
  playButton.disabled = true;
  stopButton.disabled = true;
  try {
    const result = await window.musicAI.ableton.transport(action);
    ui.message.textContent = result.message;
  } catch (error) {
    ui.message.textContent = `Erro no transporte: ${error.message}`;
  } finally {
    const connected = Boolean(latestState?.connected);
    playButton.disabled = !connected;
    stopButton.disabled = !connected;
    sendBassToAbletonButton.disabled = !connected || !currentBassPattern;
  }
}

async function selectTrack(index) {
  try {
    const result = await window.musicAI.ableton.selectTrack(index);
    ui.message.textContent = result.message;
  } catch (error) {
    ui.message.textContent = `Erro ao selecionar faixa: ${error.message}`;
  }
}

async function selectScene(index) {
  try {
    const result = await window.musicAI.ableton.selectScene(index);
    ui.message.textContent = result.message;
  } catch (error) {
    ui.message.textContent = `Erro ao selecionar cena: ${error.message}`;
  }
}

connectButton.addEventListener('click', connect);
refreshButton.addEventListener('click', refresh);
playButton.addEventListener('click', () => transport('play'));
stopButton.addEventListener('click', () => transport('stop'));
window.musicAI.ableton.onStateChange(renderState);

const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');
const sendChatButton = document.getElementById('sendChatButton');
const generateBassButton = document.getElementById('generateBassButton');
const exportBassButton = document.getElementById('exportBassButton');
const bassPreview = document.getElementById('bassPreview');
const updateStatus = document.getElementById('updateStatus');
let currentBassPattern = null;
let bassRootTouched = false;
let bassScaleTouched = false;
document.getElementById('bassRoot').addEventListener('change', () => { bassRootTouched = true; });
document.getElementById('bassScale').addEventListener('change', () => { bassScaleTouched = true; });

function addChatMessage(text, role = 'assistant') {
  const bubble = document.createElement('div');
  bubble.className = `chat-bubble ${role}`;
  bubble.textContent = text;
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return bubble;
}

let chatHistory = [];

async function sendAssistantPrompt(prompt, displayText = prompt) {
  const cleanPrompt = String(prompt || '').trim();
  if (!cleanPrompt) return;
  addChatMessage(displayText, 'user');
  sendChatButton.disabled = true;
  const waiting = addChatMessage('O GPT-OSS 120B está organizando as ideias…', 'assistant');
  const historyForRequest = chatHistory.slice(-12);
  try {
    const result = await window.musicAI.ai.chat({ message: cleanPrompt, messages: historyForRequest });
    waiting.textContent = result.reply;
    chatHistory.push({ role: 'user', content: cleanPrompt }, { role: 'assistant', content: result.reply });
    chatHistory = chatHistory.slice(-12);
  } catch (error) {
    waiting.classList.add('error');
    waiting.textContent = `Não consegui consultar a IA: ${error.message}`;
  } finally {
    sendChatButton.disabled = false;
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}

chatForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message) return;
  chatInput.value = '';
  await sendAssistantPrompt(message);
});

const createRemixPlanButton = document.getElementById('createRemixPlanButton');
createRemixPlanButton.addEventListener('click', async () => {
  const title = document.getElementById('remixTrackName').value.trim() || 'Projeto sem título';
  const bpmInput = document.getElementById('remixOriginalBpm').value;
  const bpm = bpmInput ? `${bpmInput} BPM` : (latestState?.bpm ? `${latestState.bpm} BPM (sessão Ableton)` : 'a definir');
  const key = document.getElementById('remixKey').value.trim() || formatKeyScale(latestState?.rootNote, latestState?.scaleName) || 'a identificar';
  const direction = document.getElementById('remixDirection').value;
  const notes = document.getElementById('remixNotes').value.trim() || 'Proponha uma direção criativa equilibrada e explique suas escolhas.';
  const prompt = `Quero desenvolver um remix completo chamado "${title}".\nBPM de referência: ${bpm}.\nTonalidade: ${key}.\nDireção desejada: ${direction}.\nPreferências: ${notes}.\n\nCrie um blueprint de produção completo e executável no Ableton Live 12 Suite. Organize por seções com compassos aproximados e objetivo de energia: intro DJ-friendly, groove inicial, build 1, drop 1, break, build 2, drop 2 e outro. Para cada seção, especifique kick/drums, bass (sub e mid-bass), harmonia, lead/vocal, FX/transições, automações e elementos que entram/saem. Proponha uma paleta de timbres e cadeia de efeitos com alternativas nativas do Ableton e Serum. Inclua um plano de mixagem com prioridades e uma checklist em ordem de execução. Use características gerais e originais de Brazilian Bass (baixo sincopado, sub firme, mid-bass percussivo, sidechain musical e drop energético), sem reproduzir melodia, bassline ou arranjo identificável de uma faixa existente. Diferencie o que é hipótese do que vem dos dados reais da sessão.`;
  createRemixPlanButton.disabled = true;
  createRemixPlanButton.textContent = 'Montando blueprint…';
  try {
    await sendAssistantPrompt(prompt, `Criar plano de remix · ${title} · ${direction}`);
    document.getElementById('assistantPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    createRemixPlanButton.disabled = false;
    createRemixPlanButton.textContent = 'Criar plano completo do remix ↗';
  }
});

async function loadAISettings() {
  try {
    const settings = await window.musicAI.ai.getSettings();
    document.getElementById('apiBaseUrl').value = settings.apiBaseUrl;
    document.getElementById('apiModel').value = settings.model;
    document.getElementById('reasoningEffort').value = settings.reasoningEffort || 'low';
    document.getElementById('settingsFeedback').textContent = settings.configured ? 'Chave de API configurada e armazenada localmente.' : 'Nenhuma chave configurada.';
    document.getElementById('settingsFeedback').className = `settings-feedback ${settings.configured ? 'ok' : ''}`;
  } catch (error) {
    document.getElementById('settingsFeedback').textContent = error.message;
  }
}

document.getElementById('saveSettingsButton').addEventListener('click', async () => {
  const button = document.getElementById('saveSettingsButton');
  const feedback = document.getElementById('settingsFeedback');
  button.disabled = true;
  try {
    const result = await window.musicAI.ai.saveSettings({
      apiBaseUrl: document.getElementById('apiBaseUrl').value,
      model: document.getElementById('apiModel').value,
      reasoningEffort: document.getElementById('reasoningEffort').value,
      apiKey: document.getElementById('apiKey').value
    });
    document.getElementById('apiKey').value = '';
    feedback.textContent = `Configuração salva: ${result.model} · reasoning ${result.reasoningEffort}. ${result.configured ? 'Chave protegida no armazenamento local.' : 'Adicione uma chave para habilitar o chat.'}`;
    feedback.className = 'settings-feedback ok';
  } catch (error) {
    feedback.textContent = error.message;
    feedback.className = 'settings-feedback error';
  } finally { button.disabled = false; }
});

generateBassButton.addEventListener('click', async () => {
  if (latestState?.rootNote !== null && latestState?.rootNote !== undefined && !bassRootTouched) document.getElementById('bassRoot').value = String(latestState.rootNote);
  if (latestState?.scaleName && !bassScaleTouched) {
    const scaleOption = [...document.getElementById('bassScale').options].find(option => option.value.toLowerCase() === latestState.scaleName.toLowerCase());
    if (scaleOption) document.getElementById('bassScale').value = scaleOption.value;
  }
  generateBassButton.disabled = true;
  generateBassButton.textContent = 'Criando…';
  try {
    currentBassPattern = await window.musicAI.music.generateBass({
      style: document.getElementById('bassStyle').value,
      root: Number(document.getElementById('bassRoot').value),
      scale: document.getElementById('bassScale').value,
      register: document.getElementById('bassRegister').value,
      bars: Number(document.getElementById('bassBars').value),
      bpm: latestState?.bpm || 125
    });
    bassPreview.replaceChildren();
    const summary = document.createElement('div');
    summary.className = 'bass-summary';
    summary.textContent = `${currentBassPattern.explanation} ${currentBassPattern.notes.length} notas.`;
    const grid = document.createElement('div');
    grid.className = 'note-grid';
    currentBassPattern.notes.forEach(note => {
      const pill = document.createElement('span');
      pill.className = 'note-pill';
      pill.textContent = `${note.note}${note.octave} · ${note.start.toFixed(2)}b`;
      grid.appendChild(pill);
    });
    bassPreview.append(summary, grid);
    exportBassButton.disabled = false;
    sendBassToAbletonButton.disabled = !latestState?.connected;
  } catch (error) {
    bassPreview.textContent = `Erro ao gerar: ${error.message}`;
  } finally {
    generateBassButton.disabled = false;
    generateBassButton.textContent = 'Gerar bassline';
  }
});

exportBassButton.addEventListener('click', async () => {
  if (!currentBassPattern) return;
  try {
    const result = await window.musicAI.music.exportBass(currentBassPattern);
    if (!result.canceled) addChatMessage(`Arquivo MIDI exportado: ${result.filePath}. Importe-o em uma faixa MIDI do Ableton.`, 'assistant');
  } catch (error) { addChatMessage(`Falha ao exportar MIDI: ${error.message}`, 'error'); }
});

sendBassToAbletonButton.addEventListener('click', async () => {
  if (!currentBassPattern || !latestState?.connected) return;
  const accepted = confirm('O Music AI vai criar uma NOVA faixa MIDI no final da sessão e inserir o clip na primeira cena. Nenhuma faixa ou clip existente será substituído. Continuar?');
  if (!accepted) return;
  sendBassToAbletonButton.disabled = true;
  sendBassToAbletonButton.textContent = 'Enviando…';
  try {
    const result = await window.musicAI.music.sendBassToAbleton(currentBassPattern);
    addChatMessage(`Bassline inserida no Ableton! Nova faixa: ${result.trackName}. ${result.noteCount} notas em ${result.bars} compassos.`, 'assistant');
  } catch (error) {
    addChatMessage(`Não foi possível inserir no Ableton: ${error.message}`, 'error');
  } finally {
    sendBassToAbletonButton.disabled = !latestState?.connected || !currentBassPattern;
    sendBassToAbletonButton.textContent = 'Enviar ao Ableton ↗';
  }
});

function renderUpdateState(state) {
  if (!state || !updateStatus) return;
  updateStatus.textContent = state.message.toUpperCase();
  updateStatus.title = state.message;
  if (state.status === 'downloaded') {
    updateStatus.style.color = '#71dfb3';
    updateStatus.style.cursor = 'pointer';
    updateStatus.onclick = async () => {
      if (confirm('A atualização foi baixada. Reiniciar o Music AI para instalar agora?')) await window.musicAI.updates.install();
    };
  } else {
    updateStatus.style.color = state.status === 'error' ? '#ffad9d' : '';
    updateStatus.onclick = null;
  }
}

window.musicAI.updates.onStateChange(renderUpdateState);
window.musicAI.updates.getState().then(renderUpdateState).catch(() => {});
document.getElementById('checkUpdatesButton').addEventListener('click', async () => {
  const result = await window.musicAI.updates.check();
  updateStatus.textContent = (result.message || 'Verificação solicitada').toUpperCase();
});


const analyzeAudioButton = document.getElementById('analyzeAudioButton');
const audioAnalysisResult = document.getElementById('audioAnalysisResult');
function renderAudioAnalysis(analysis) {
  audioAnalysisResult.replaceChildren();
  if (!analysis) {
    const empty = document.createElement('div'); empty.className = 'empty-state';
    empty.textContent = 'Nenhuma referência analisada.'; audioAnalysisResult.appendChild(empty); return;
  }
  const file = document.createElement('p'); file.className = 'audio-file-label';
  file.textContent = `${analysis.fileName} · ${analysis.format} ${analysis.bitDepth}-bit · ${analysis.sampleRate.toLocaleString('pt-BR')} Hz · ${analysis.channels} canal(is)`;
  const grid = document.createElement('div'); grid.className = 'audio-analysis-grid';
  const metrics = [
    ['DURAÇÃO', `${Math.floor(analysis.durationSeconds / 60)}:${String(Math.floor(analysis.durationSeconds % 60)).padStart(2,'0')}`],
    ['PEAK', `${analysis.peakDbfs} dBFS`], ['RMS', `${analysis.rmsDbfs} dBFS`],
    ['CLIPPING', analysis.clippingDetected ? 'Detectado' : 'Não detectado'],
    ['ZERO CROSSING', String(analysis.zeroCrossingRate)]
  ];
  metrics.forEach(([label,value]) => { const card=document.createElement('div'); card.className='audio-metric'; const l=document.createElement('span');l.textContent=label;const v=document.createElement('strong');v.textContent=value;card.append(l,v);grid.appendChild(card); });
  const chart = document.createElement('div'); chart.className='energy-chart';
  const max = Math.max(...analysis.sections.map(s=>s.rms),0.0001);
  analysis.sections.forEach(section=>{const bar=document.createElement('div');bar.className='energy-bar';bar.style.height=`${Math.max(5,section.rms/max*100)}%`;bar.title=`${section.startSeconds}s–${section.endSeconds}s · RMS ${section.rms}`;chart.appendChild(bar);});
  const caption=document.createElement('div');caption.className='energy-caption';caption.textContent=`ENERGIA POR TRECHO · JANELAS DE ${analysis.sectionWindowSeconds}s · ${analysis.sections.length} TRECHOS`;
  const limitations=document.createElement('div');limitations.className='audio-limitations';limitations.textContent=analysis.limitations.join(' ');
  audioAnalysisResult.append(file,grid,chart,caption,limitations);
}
analyzeAudioButton.addEventListener('click', async () => {
  analyzeAudioButton.disabled = true; analyzeAudioButton.textContent = 'Analisando WAV…';
  try {
    const result = await window.musicAI.audio.analyzeReference();
    if (!result.canceled) { renderAudioAnalysis(result.analysis); addChatMessage(`Referência ${result.analysis.fileName} analisada localmente. Duração ${result.analysis.durationSeconds}s, pico ${result.analysis.peakDbfs} dBFS e RMS ${result.analysis.rmsDbfs} dBFS. Posso usar essas métricas para planejar o remix; ainda não detecto tonalidade, acordes ou separo stems automaticamente.`, 'assistant'); }
  } catch (error) { audioAnalysisResult.replaceChildren(); const box=document.createElement('div');box.className='audio-error';box.textContent=error.message;audioAnalysisResult.appendChild(box); }
  finally { analyzeAudioButton.disabled = false; analyzeAudioButton.textContent = 'Selecionar WAV e analisar ↗'; }
});
window.musicAI.audio.getAnalysis().then(renderAudioAnalysis).catch(()=>{});

loadAISettings();

