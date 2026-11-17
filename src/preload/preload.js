const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('musicAI', {
  ableton: {
    connect: () => ipcRenderer.invoke('ableton:connect'),
    refresh: () => ipcRenderer.invoke('ableton:refresh'),
    transport: (action) => ipcRenderer.invoke('ableton:transport', action),
    selectTrack: (index) => ipcRenderer.invoke('ableton:select-track', index),
    selectScene: (index) => ipcRenderer.invoke('ableton:select-scene', index),
    onStateChange: (callback) => subscribe('ableton:state', callback)
  },
  ai: {
    getSettings: () => ipcRenderer.invoke('ai:get-settings'),
    saveSettings: (settings) => ipcRenderer.invoke('ai:save-settings', settings),
    chat: (message) => ipcRenderer.invoke('ai:chat', message)
  },
  audio: {
    analyzeReference: () => ipcRenderer.invoke('audio:analyze-reference'),
    getAnalysis: () => ipcRenderer.invoke('audio:get-analysis')
  },
  music: {
    generateBass: (options) => ipcRenderer.invoke('music:generate-bass', options),
    exportBass: (pattern) => ipcRenderer.invoke('music:export-bass', pattern),
    sendBassToAbleton: (pattern) => ipcRenderer.invoke('music:send-bass-to-ableton', pattern)
  },
  updates: {
    getState: () => ipcRenderer.invoke('update:get-state'),
    check: () => ipcRenderer.invoke('update:check'),
    install: () => ipcRenderer.invoke('update:install'),
    onStateChange: (callback) => subscribe('update:state', callback)
  }
});
