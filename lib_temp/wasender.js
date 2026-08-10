// ══════════════════════════════════════════════════════
// Wasender API helpers
// ══════════════════════════════════════════════════════

const WASENDER_API_KEY = () => process.env.WASENDER_API_KEY;

function getApiKey() {
  const key = WASENDER_API_KEY();
  if (!key) console.error('❌ WASENDER_API_KEY não configurada');
  return key;
}

// Envia uma mensagem de texto via WhatsApp
async function sendWhatsAppMessage(phone, text) {
  const apiKey = getApiKey();
  if (!apiKey) return;
  const botPhone = process.env.WASENDER_BOT_PHONE;
  console.log('🤖 BOT PHONE CONFIG:', botPhone);

  let cleanPhone = String(phone).replace(/@.*$/, '').replace(/\D/g, '');
  if (!cleanPhone.startsWith('55')) cleanPhone = '55' + cleanPhone;
  if (cleanPhone.length < 12 || cleanPhone.length > 15) {
    console.error('❌ Telefone inválido:', cleanPhone);
    return;
  }

  console.log('📤 [SEND] Enviando para:', cleanPhone, '| Texto:', text.substring(0, 50));

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch('https://www.wasenderapi.com/api/send-message', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: cleanPhone, text }),
      signal: controller.signal
    });
    clearTimeout(timeout);
    const resBody = await res.json();
    console.log('✅ Wasender response:', res.status, JSON.stringify(resBody).substring(0, 200));
    if (!res.ok) console.error('❌ Erro Wasender:', JSON.stringify(resBody));
  } catch (err) {
    console.error('❌ Erro ao enviar:', err.message);
  }
}

// Descriptografa mídia (imagem/áudio/documento) do Wasender
async function decryptMedia(messagesPayload) {
  const apiKey = getApiKey();
  if (!apiKey) return null;

  try {
    const res = await fetch('https://www.wasenderapi.com/api/decrypt-media', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ data: { messages: messagesPayload } })
    });
    const json = await res.json();
    if (json.success && (json.publicUrl || json.url)) {
      return json.publicUrl || json.url;
    }
    return null;
  } catch (err) {
    console.log('❌ Decrypt exception:', err.message);
    return null;
  }
}

// Transcreve áudio via Groq Whisper
async function transcribeAudioViaGroq(audioUrl) {
  const groqApiKey = process.env.GROQ_API_KEY;
  if (!groqApiKey) throw new Error('GROQ_API_KEY não configurada');

  const wasenderApiKey = getApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  const audioResponse = await fetch(audioUrl, {
    signal: controller.signal,
    headers: wasenderApiKey ? { 'Authorization': `Bearer ${wasenderApiKey}` } : {}
  });
  clearTimeout(timeout);

  if (!audioResponse.ok) throw new Error(`Falha ao baixar áudio: ${audioResponse.status}`);

  const audioBuffer = await audioResponse.arrayBuffer();
  const formData = new FormData();
  formData.append('file', new Blob([audioBuffer], { type: 'audio/ogg' }), 'audio.ogg');
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('language', 'pt');
  formData.append('response_format', 'json');

  const groqController = new AbortController();
  const groqTimeout = setTimeout(() => groqController.abort(), 60000);
  const groqResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${groqApiKey}` },
    body: formData,
    signal: groqController.signal
  });
  clearTimeout(groqTimeout);

  if (!groqResponse.ok) throw new Error(`Groq error ${groqResponse.status}`);
  const result = JSON.parse(await groqResponse.text());
  return (result.text || '').trim();
}

module.exports = {
  sendWhatsAppMessage,
  decryptMedia,
  transcribeAudioViaGroq,
};
