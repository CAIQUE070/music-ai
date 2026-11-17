const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const tempDir = path.join(os.tmpdir(), `music-ai-midi-${process.pid}`);
const midiPath = path.join(tempDir, 'generated-bass.mid');
const originalLoad = Module._load;
Module._load = function loadWithElectronMock(request, parent, isMain) {
  if (request === 'electron') {
    return { dialog: { showSaveDialog: async () => ({ canceled: false, filePath: midiPath }) } };
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const { generateBass, exportBassMidi } = require('../src/main/music-engine');
  await fs.mkdir(tempDir, { recursive: true });

  for (const register of ['sub', 'mid', 'upper']) {
    const pattern = generateBass({ style: 'brazilian', root: 6, scale: 'minor', bars: 4, bpm: 126, register });
    assert.equal(pattern.register, register);
    assert.equal(pattern.bars, 4);
    assert(pattern.notes.length > 0);
    assert(pattern.notes.every(note => note.pitch >= 0 && note.pitch <= 127));
    assert(pattern.notes.every(note => note.start >= 0 && note.start < pattern.bars * 4));
  }

  const pattern = generateBass({ style: 'brazilian', root: 6, scale: 'minor', bars: 4, bpm: 126, register: 'sub' });
  const exportResult = await exportBassMidi(pattern);
  assert.equal(exportResult.canceled, false);
  const midi = await fs.readFile(midiPath);
  assert.equal(midi.subarray(0, 4).toString(), 'MThd');
  assert.equal(midi.subarray(14, 18).toString(), 'MTrk');
  await fs.rm(tempDir, { recursive: true, force: true });
  console.log(`OK: Brazilian Bass generator (${pattern.notes.length} notes) and MIDI export.`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  Module._load = originalLoad;
});
