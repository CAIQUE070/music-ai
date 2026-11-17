const fs = require('node:fs/promises');
const path = require('node:path');

function parseWav(buffer) {
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Arquivo não é WAV/RIFF válido. Nesta versão, importe WAV PCM ou IEEE Float.');
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > buffer.length) throw new Error('Arquivo WAV incompleto ou corrompido.');
    if (id === 'fmt ') {
      fmt = {
        format: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4), byteRate: buffer.readUInt32LE(start + 8),
        blockAlign: buffer.readUInt16LE(start + 12), bits: buffer.readUInt16LE(start + 14)
      };
      if (fmt.format === 0xfffe && size >= 40) fmt.format = buffer.readUInt16LE(start + 24);
    }
    if (id === 'data') data = { start, size };
    offset = start + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('O WAV não contém os blocos fmt/data necessários.');
  if (![1, 3].includes(fmt.format) || ![8, 16, 24, 32].includes(fmt.bits) || (fmt.format === 3 && fmt.bits !== 32)) {
    throw new Error('Formato WAV não suportado. Use PCM 8/16/24/32-bit ou IEEE Float 32-bit.');
  }
  if (!fmt.channels || !fmt.sampleRate || !fmt.blockAlign) throw new Error('Cabeçalho WAV inválido.');
  return { fmt, data };
}

function sampleAt(buffer, byteOffset, format, bits) {
  if (format === 3) return buffer.readFloatLE(byteOffset);
  if (bits === 8) return (buffer.readUInt8(byteOffset) - 128) / 128;
  if (bits === 16) return buffer.readInt16LE(byteOffset) / 32768;
  if (bits === 24) {
    let value = buffer[byteOffset] | (buffer[byteOffset + 1] << 8) | (buffer[byteOffset + 2] << 16);
    if (value & 0x800000) value |= 0xff000000;
    return value / 8388608;
  }
  return buffer.readInt32LE(byteOffset) / 2147483648;
}

function analyzeBuffer(buffer, fileName) {
  const { fmt, data } = parseWav(buffer);
  const bytesPerSample = fmt.bits / 8;
  const frames = Math.floor(data.size / fmt.blockAlign);
  const duration = frames / fmt.sampleRate;
  if (!Number.isFinite(duration) || duration < 1) throw new Error('O áudio precisa ter pelo menos 1 segundo.');
  if (duration > 60 * 60) throw new Error('Por segurança, o limite desta versão é 60 minutos por arquivo.');

  const readMono = (frame) => {
    let sum = 0;
    for (let channel = 0; channel < fmt.channels; channel += 1) {
      const pos = data.start + frame * fmt.blockAlign + channel * bytesPerSample;
      sum += sampleAt(buffer, pos, fmt.format, fmt.bits);
    }
    return Math.max(-1, Math.min(1, sum / fmt.channels));
  };

  let sumSquares = 0;
  let peak = 0;
  let clipped = 0;
  let previous = 0;
  let crossings = 0;
  const hopSeconds = 8;
  const sections = [];
  const totalSamples = frames;
  const sectionFrames = Math.max(1, Math.floor(fmt.sampleRate * hopSeconds));

  for (let sectionStart = 0; sectionStart < totalSamples; sectionStart += sectionFrames) {
    const sectionEnd = Math.min(totalSamples, sectionStart + sectionFrames);
    let sectionSquares = 0;
    let sectionPeak = 0;
    let sectionCount = 0;
    const sampled = [];
    const sampleStride = Math.max(1, Math.floor((sectionEnd - sectionStart) / 2048));
    for (let frame = sectionStart; frame < sectionEnd; frame += 1) {
      const value = readMono(frame);
      const abs = Math.abs(value);
      sumSquares += value * value;
      sectionSquares += value * value;
      peak = Math.max(peak, abs);
      sectionPeak = Math.max(sectionPeak, abs);
      if (abs >= 0.999) clipped += 1;
      if ((value >= 0 && previous < 0) || (value < 0 && previous >= 0)) crossings += 1;
      previous = value;
      sectionCount += 1;
      if ((frame - sectionStart) % sampleStride === 0) sampled.push(value);
    }
    sections.push({
      startSeconds: Number((sectionStart / fmt.sampleRate).toFixed(1)),
      endSeconds: Number((sectionEnd / fmt.sampleRate).toFixed(1)),
      rms: Number(Math.sqrt(sectionSquares / Math.max(1, sectionCount)).toFixed(4)),
      peak: Number(sectionPeak.toFixed(4))
    });
  }
  const rms = Math.sqrt(sumSquares / totalSamples);
  const db = (value) => value > 0 ? Number((20 * Math.log10(value)).toFixed(1)) : -Infinity;
  const averageZcr = crossings / totalSamples;
  const energyValues = sections.map(s => s.rms);
  const minEnergy = Math.min(...energyValues);
  const maxEnergy = Math.max(...energyValues);
  const dynamicRangeProxy = maxEnergy - minEnergy;
  return {
    fileName: path.basename(fileName), durationSeconds: Number(duration.toFixed(2)),
    sampleRate: fmt.sampleRate, channels: fmt.channels, bitDepth: fmt.bits,
    format: fmt.format === 3 ? 'IEEE Float' : 'PCM',
    peak: Number(peak.toFixed(4)), peakDbfs: db(peak), rms: Number(rms.toFixed(4)), rmsDbfs: db(rms),
    clippedSamples: clipped, clippingDetected: clipped > 0,
    zeroCrossingRate: Number(averageZcr.toFixed(5)),
    sectionWindowSeconds: hopSeconds, sections,
    energyVariation: Number(dynamicRangeProxy.toFixed(4)),
    limitations: [
      'Análise técnica de amplitude e energia por trecho; não identifica automaticamente acordes, tonalidade, BPM ou stems.',
      'O áudio completo permanece no computador. Somente o resumo numérico é usado no contexto da IA quando você conversar com ela.'
    ]
  };
}

async function chooseAndAnalyzeAudio() {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({
    title: 'Analisar áudio de referência', properties: ['openFile'],
    filters: [{ name: 'Áudio WAV', extensions: ['wav', 'wave'] }]
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const stat = await fs.stat(filePath);
  if (stat.size > 500 * 1024 * 1024) throw new Error('O arquivo excede o limite de 500 MB.');
  const buffer = await fs.readFile(filePath);
  return { canceled: false, analysis: analyzeBuffer(buffer, filePath) };
}

module.exports = { analyzeBuffer, chooseAndAnalyzeAudio };
