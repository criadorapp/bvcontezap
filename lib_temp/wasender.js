// ══════════════════════════════════════════════════════
// Wasender API + Groq Whisper - Utilitários
// ══════════════════════════════════════════════════════

const WASENDER_API_BASE = 'https://api.wa-sender.com';
const WASENDER_API_KEY = process.env.WASENDER_API_KEY;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

function normalizePhone(phone) {
  if (!phone) return null;
  let p = String(phone).replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('55')) p = p.slice(2);
  p = '55' + p;
  return p;
}

async function sendWhatsAppMessage(phone, message, timeoutMs = 15000) {
  if (!phone || !message) return { error: 'phone/message vazio' };
  const to = normalizePhone(phone);
  if (!to) return { error: 'telefone invalido' };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${WASENDER_API_BASE}/send-message`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WASENDER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to, message }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) {
      const txt = await res.text();
      return { error: `wasender ${res.status}: ${txt}` };
    }
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    return { error: e.message };
  }
}

async function decodeMedia(messageId, mimeType) {
  if (!messageId) return null;
  try {
    const res = await fetch(`${WASENDER_API_BASE}/decode-media`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WASENDER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message_id: messageId, mime_type: mimeType })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.file_url || data?.base64 || null;
  } catch {
    return null;
  }
}

async function downloadFile(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf;
  } catch {
    return null;
  }
}

async function transcribeAudio(audioBuffer, filename = 'audio.ogg') {
  if (!audioBuffer || !GROQ_API_KEY) return null;
  try {
    const form = new (require('form-data'))();
    form.append('file', audioBuffer, { filename, contentType: 'audio/ogg' });
    form.append('model', 'whisper-large-v3');
    form.append('language', 'pt');

    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        ...form.getHeaders()
      },
      body: form
    });
    if (!res.ok) {
      console.error('groq transcription failed:', res.status, await res.text());
      return null;
    }
    const data = await res.json();
    return data?.text || null;
  } catch (e) {
    console.error('transcribeAudio error:', e.message);
    return null;
  }
}

module.exports = {
  normalizePhone,
  sendWhatsAppMessage,
  decodeMedia,
  downloadFile,
  transcribeAudio,
};
