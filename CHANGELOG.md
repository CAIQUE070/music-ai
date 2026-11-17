# Changelog

## 0.5.0
- Adicionado analisador local de referência WAV (PCM 8/16/24/32-bit e IEEE Float 32-bit).
- Métricas: duração, sample rate, canais, pico, RMS, clipping, zero-crossing e energia em janelas de 8 segundos.
- Gráfico de energia por trecho para orientar decisões de arranjo e dinâmica.
- Resumo técnico é incluído no contexto do Groq GPT-OSS quando o usuário conversa ou solicita um blueprint de remix.
- O áudio completo permanece local; apenas métricas numéricas resumidas entram no prompt.
- Análise não afirma detectar BPM, tonalidade, acordes, stems ou estrutura harmônica.

## 0.4.0
- Groq GPT-OSS 120B, Remix Studio, gerador de bassline e inserção MIDI via AbletonOSC.
