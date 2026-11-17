const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog } = require('electron');

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  'natural minor': [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  'minor pentatonic': [0, 3, 5, 7, 10],
  'major pentatonic': [0, 2, 4, 7, 9]
};

function vlq(value) {
  let buffer = value & 0x7f;
  const bytes = [];
  while ((value >>= 7)) { buffer <<= 8; buffer |= ((value & 0x7f) | 0x80); }
  while (true) { bytes.push(buffer & 0xff); if (buffer & 0x80) buffer >>= 8; else break; }
  return bytes;
}

function makeMidi(notes, bpm, bars) {
  const ppq = 480;
  const events = [];
  for (const note of notes) {
    events.push({ tick: note.start * ppq, bytes: [0x90, note.pitch, note.velocity] });
    events.push({ tick: (note.start + note.duration) * ppq, bytes: [0x80, note.pitch, 0] });
  }
  events.sort((a, b) => a.tick - b.tick || a.bytes[0] - b.bytes[0]);
  const track = [];
  const micros = Math.round(60000000 / bpm);
  track.push(0x00, 0xff, 0x51, 0x03, (micros >> 16) & 255, (micros >> 8) & 255, micros & 255);
  let previous = 0;
  for (const event of events) { track.push(...vlq(event.tick - previous), ...event.bytes); previous = event.tick; }
  track.push(...vlq(Math.max(0, bars * 4 * ppq - previous)), 0xff, 0x2f, 0x00);
  const header = Buffer.from([0x4d,0x54,0x68,0x64,0,0,0,6,0,0,0,1,1,0xe0]);
  const chunk = Buffer.alloc(8 + track.length);
  chunk.write('MTrk', 0); chunk.writeUInt32BE(track.length, 4); Buffer.from(track).copy(chunk, 8);
  return Buffer.concat([header, chunk]);
}

function generateBass(options = {}, session = {}) {
  const root = Number.isInteger(options.root)
    ? Math.max(0, Math.min(11, options.root))
    : (Number.isInteger(session.rootNote) ? session.rootNote : 0);
  const scaleName = String(options.scale || session.scaleName || 'minor').toLowerCase();
  const scale = SCALES[scaleName] || SCALES.minor;
  const bpm = Math.max(60, Math.min(200, Number(options.bpm || session.bpm || 125)));
  const bars = Math.max(1, Math.min(8, Number(options.bars || 4)));
  const style = ['brazilian', 'driving', 'minimal', 'syncopated'].includes(options.style)
    ? options.style
    : 'brazilian';

  // Patterns are original genre-level starting points, not transcriptions of a song.
  const patterns = {
    brazilian: [
      { beat: 0, degree: 0, octave: 0, duration: 0.66, velocity: 118 },
      { beat: 0.75, degree: 4, octave: 0, duration: 0.32, velocity: 92 },
      { beat: 1.5, degree: 2, octave: 0, duration: 0.34, velocity: 101 },
      { beat: 2, degree: 0, octave: 12, duration: 0.48, velocity: 112 },
      { beat: 2.75, degree: 4, octave: 0, duration: 0.30, velocity: 88 },
      { beat: 3.5, degree: 0, octave: 0, duration: 0.36, velocity: 105 }
    ],
    driving: [
      { beat: 0, degree: 0, octave: 0, duration: 0.78, velocity: 116 },
      { beat: 1, degree: 4, octave: 0, duration: 0.38, velocity: 88 },
      { beat: 2, degree: 0, octave: 12, duration: 0.62, velocity: 108 },
      { beat: 3, degree: 4, octave: 0, duration: 0.38, velocity: 90 }
    ],
    syncopated: [
      { beat: 0, degree: 0, octave: 0, duration: 0.48, velocity: 116 },
      { beat: 0.5, degree: 2, octave: 0, duration: 0.26, velocity: 82 },
      { beat: 1.25, degree: 4, octave: 0, duration: 0.32, velocity: 96 },
      { beat: 2, degree: 0, octave: 12, duration: 0.48, velocity: 110 },
      { beat: 2.5, degree: 2, octave: 0, duration: 0.26, velocity: 84 },
      { beat: 3.25, degree: 4, octave: 0, duration: 0.32, velocity: 97 },
      { beat: 3.75, degree: 0, octave: 0, duration: 0.20, velocity: 86 }
    ],
    minimal: [
      { beat: 0, degree: 0, octave: 0, duration: 1.55, velocity: 112 },
      { beat: 2, degree: 4, octave: 0, duration: 1.20, velocity: 92 }
    ]
  };

  const register = ['sub', 'mid', 'upper'].includes(options.register) ? options.register : 'mid';
  const rootMidi = (register === 'sub' ? 24 : register === 'upper' ? 48 : 36) + root; // C1/C2/C3-based register
  const notes = [];
  for (let bar = 0; bar < bars; bar += 1) {
    for (let i = 0; i < patterns[style].length; i += 1) {
      const step = patterns[style][i];
      // Subtle two-bar variation prevents every bar from feeling mechanically identical.
      if (style === 'brazilian' && bar % 2 === 1 && i === 4) continue;
      const degree = step.degree % scale.length;
      const pitch = rootMidi + scale[degree] + step.octave;
      const start = bar * 4 + step.beat;
      notes.push({
        start: Number(start.toFixed(3)),
        duration: step.duration,
        pitch,
        velocity: step.velocity,
        note: NOTES[pitch % 12],
        octave: Math.floor(pitch / 12) - 1
      });
    }
  }

  const styleLabel = style === 'brazilian'
    ? 'Brazilian Bass bounce: sub firme, síncopes e acentos de mid-bass'
    : `${style} bassline`;
  return {
    bpm, bars, root: NOTES[root], rootIndex: root, scale: scaleName, style, register, notes,
    explanation: `${styleLabel} em ${NOTES[root]} ${scaleName}, ${bpm} BPM. Padrão original de referência: confira a relação com o kick e ajuste as notas ao groove do remix.`
  };
}

async function exportBassMidi(pattern) {
  const result = await dialog.showSaveDialog({ title: 'Exportar bassline MIDI', defaultPath: `Music-AI-Bass-${pattern.root}-${pattern.scale}.mid`, filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  await fs.writeFile(result.filePath, makeMidi(pattern.notes, pattern.bpm, pattern.bars));
  return { canceled: false, filePath: result.filePath };
}

module.exports = { generateBass, exportBassMidi };
