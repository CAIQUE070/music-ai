const assert = require('node:assert/strict');
const { analyzeBuffer } = require('../src/main/audio-analyzer');
function makeWav() {
  const sampleRate = 8000, frames = sampleRate * 2, channels = 1, bits = 16;
  const dataSize = frames * 2;
  const b = Buffer.alloc(44 + dataSize);
  b.write('RIFF',0); b.writeUInt32LE(36 + dataSize,4); b.write('WAVE',8);
  b.write('fmt ',12); b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(channels,22);
  b.writeUInt32LE(sampleRate,24); b.writeUInt32LE(sampleRate*2,28); b.writeUInt16LE(2,32); b.writeUInt16LE(bits,34);
  b.write('data',36); b.writeUInt32LE(dataSize,40);
  for(let i=0;i<frames;i++) b.writeInt16LE(Math.round(Math.sin(2*Math.PI*110*i/sampleRate)*12000),44+i*2);
  return b;
}
const result = analyzeBuffer(makeWav(), 'test-reference.wav');
assert.equal(result.fileName, 'test-reference.wav');
assert.equal(result.durationSeconds, 2);
assert.equal(result.sampleRate, 8000);
assert.ok(result.rms > 0.2 && result.rms < 0.4);
assert.equal(result.clippingDetected, false);
assert.equal(result.sections.length, 1);
console.log('Audio analyzer smoke test passed.');
