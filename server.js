// ═══════════════════════════════════════════════════════════════
// BV.conte — Webhook Externo (Node.js + Express)
// Substitui a backend function wasenderWebhook da Base44
// Elimina o erro HTTP 402 do plano gratuito
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const crypto = require('crypto');
const { sendWhatsAppMessage, decryptMedia, transcribeAudioViaGroq } = require('./lib/wasender');
const { detectCategoryFromText, hasFinancialIntent, isBotMessage } = require('./lib/patterns');
const b44 = require('./lib/base44api');

const app = express();

// Aceita raw body para validação de assinatura
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);

const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'bv-conte-webhook', timestamp: new Date().toISOString() });
});

app.get('/webhook', (req, res) => {
  res.json({ status: 'ok', message: 'Webhook ativo. Configure a URL no painel Wasender.' });
});

// ─────────────────────────────────────────────────────────────
// Normalização de telefone
// ─────────────────────────────────────────────────────────────
function cleanPhone(p) {
  if (!p || typeof p !== 'string') return '';
  let digits = p.replace(/@.*$/, '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  return digits;
}

// ─────────────────────────────────────────────────────────────
// WEBHOOK PRINCIPAL
// ─────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  try {
    console.log('🔔 WEBHOOK ACIONADO -', new Date().toISOString());

    // Validação de assinatura (opcional, se WASENDER_SECRET_KEY estiver configurado)
    const secretKey = process.env.WASENDER_SECRET_KEY;
    if (secretKey && req.rawBody) {
      const signature = req.headers['x-wasender-signature'] || req.headers['x-signature'] || '';
      const expectedSig = crypto
        .createHmac('sha256', secretKey)
        .update(req.rawBody)
        .digest('hex');
      if (signature && signature !== expectedSig) {
        console.log('❌ Assinatura inválida');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const payload = req.body;
    console.log('📥 Evento recebido:', payload.event);

    const isNewFormat = payload.event === 'messages.received' || payload.event === 'messages.upsert';
    const isOldFormat = payload.event === 'message';
    if (!isNewFormat && !isOldFormat) {
      return res.json({ success: true, skipped: 'not a message event' });
    }

    let incomingPhoneRaw, messageText, fromMe, imageUrl = null, audioUrl = null;

    if (isNewFormat) {
      const msgData = payload.data?.messages;
      if (!msgData) return res.json({ success: true });
      fromMe = msgData.key?.fromMe;
      const msg = msgData.message || {};
      const extText = msg.extendedTextMessage?.text || msg.conversation || '';
      messageText = (msgData.messageBody || extText || '').trim();
      incomingPhoneRaw = msgData.key?.cleanedSenderPn || msgData.key?.remoteJid || '';
      const remoteJid = msgData.key?.remoteJid || '';
      if (remoteJid.endsWith('@g.us')) return res.json({ success: true, skipped: 'group message' });

      const imgMsg = msg.imageMessage || msg.documentMessage;
      if (imgMsg && imgMsg.mediaKey) {
        const isPdf = imgMsg.mimetype === 'application/pdf' || (imgMsg.fileName && imgMsg.fileName.toLowerCase().endsWith('.pdf'));
        if (!messageText && imgMsg.caption) messageText = imgMsg.caption;
        const rawMediaUrl = await decryptMedia(msgData);
        if (rawMediaUrl) imageUrl = isPdf ? '__PDF__' + rawMediaUrl : rawMediaUrl;
      }

      const audioMsg = msg.audioMessage || msg.pttMessage;
      if (audioMsg) {
        audioUrl = await decryptMedia(msgData);
      }
    } else {
      if (payload.data?.isGroupMsg) return res.json({ success: true });
      fromMe = payload.data?.fromMe;
      messageText = payload.data?.body || '';
      incomingPhoneRaw = payload.data?.from || '';
      if (payload.data?.type === 'image' || payload.data?.type === 'document') {
        imageUrl = payload.data?.mediaUrl || payload.data?.body || null;
        if (!messageText) messageText = payload.data?.caption || '';
      }
    }

    const incomingPhoneDigits = cleanPhone(incomingPhoneRaw);
    const phoneWithDDI = '55' + incomingPhoneDigits;
    const replyPhone = phoneWithDDI;

    // Transcreve áudio via Groq
    if (audioUrl && audioUrl.startsWith('http')) {
      try {
        messageText = await transcribeAudioViaGroq(audioUrl);
        if (!messageText) return res.json({ success: true });
      } catch (e) {
        console.error('❌ Erro na transcrição:', e.message);
        return res.json({ success: true });
      }
    }

    const hasImage = !!imageUrl;
    if (!messageText?.trim() && !hasImage) return res.json({ success: true });
    if (fromMe === true) return res.json({ success: true, skipped: 'fromMe' });

    console.log('📱 Mensagem de:', incomingPhoneRaw, '-> dígitos:', incomingPhoneDigits);
    console.log('📝 Texto:', messageText ? messageText.substring(0, 150) : '(vazio)');

    // Ignora mensagens do próprio bot
    if (isBotMessage(messageText)) return res.json({ success: true, skipped: 'bot pattern' });

    // ─────────────────────────────────────────────
    // Busca subscription — gera todas as variantes do número
    // ─────────────────────────────────────────────
    const rawDigits = incomingPhoneRaw.replace(/@.*$/, '').replace(/\D/g, '');
    let localPhone = incomingPhoneDigits;
    if (localPhone.startsWith('55') && localPhone.length >= 12) localPhone = localPhone.slice(2);

    let localPhoneNo9 = localPhone;
    if (localPhone.length === 11 && localPhone[2] === '9') localPhoneNo9 = localPhone.slice(0, 2) + localPhone.slice(3);

    let localPhoneWith9 = localPhone;
    if (localPhone.length === 10) localPhoneWith9 = localPhone.slice(0, 2) + '9' + localPhone.slice(2);

    const variants = new Set([
      phoneWithDDI,
      incomingPhoneDigits,
      rawDigits,
      localPhone,
      localPhoneNo9,
      localPhoneWith9,
      '55' + localPhone,
      '55' + localPhoneNo9,
      '55' + localPhoneWith9,
    ]);

    let userSubs = [];
    try {
      const allSubs = await b44.Subscription.list(undefined, 1000);
      userSubs = Array.isArray(allSubs) ? allSubs.filter(s => s && s.phone && variants.has(s.phone)) : [];
    } catch (e) {
      console.log('❌ Erro ao buscar subscription:', e.message);
      userSubs = [];
    }

    userSubs.sort((a, b) => (b?.expiry_date ? new Date(b.expiry_date).getTime() : 0) - (a?.expiry_date ? new Date(a.expiry_date).getTime() : 0));
    const now = new Date();
    const activeSubscription = userSubs.find(s => s && s.status === 'active' && s.expiry_date && new Date(s.expiry_date) >= now);
    const subscription = activeSubscription || (userSubs.length > 0 ? userSubs[0] : null);
    const userEmail = subscription?.user_email || null;
    if (!userEmail) return res.status(400).json({ error: 'User not found' });

    // ═════════════════════════════════════════════
    // MODO REUNIÃO/AULA — sessão ativa em tempo real
    // ═════════════════════════════════════════════
    const looksLikeScheduling = /\d{1,2}\s*(h|:00|horas)|amanhã|hoje\s+às|marcar\s+para|agendar\s+para|\bdia\s+\d{1,2}\b/i.test(messageText || '');
    const triggerWordsPattern = /\b(reuni(a|ã)o|aula|hist[oó]ria|palestra|curso|semin[aá]rio|treinamento|serm[aã]o)\b/i;
    const mentionsTrigger = triggerWordsPattern.test(messageText || '');
    const endSessionPattern = /\b(finalizar|encerrar|terminar|fim)\b/i;

    let activeSession = null;
    try {
      const sessions = await b44.MeetingSession.filter({ user_email: userEmail, status: 'active' }, '-created_date', 1);
      const candidate = sessions && sessions[0] ? sessions[0] : null;
      if (candidate) {
        const lastActivity = new Date(candidate.updated_date || candidate.created_date).getTime();
        const hoursInactive = (Date.now() - lastActivity) / (1000 * 60 * 60);
        if (hoursInactive > 2) {
          try { await b44.MeetingSession.update(candidate.id, { status: 'closed' }); } catch (e) { /* ignore */ }
        } else {
          activeSession = candidate;
        }
      }
    } catch (e) {
      console.log('⚠️ Erro ao buscar MeetingSession:', e.message);
    }

    if (activeSession) {
      if (messageText && endSessionPattern.test(messageText)) {
        try {
          await sendWhatsAppMessage(replyPhone, '⏳ Encerrando e gerando a ata executiva... alguns segundos!');
          const fullText = activeSession.transcript_buffer || '';
          await b44.MeetingSession.update(activeSession.id, { status: 'closed' });
          const isStudySession = activeSession.session_type === 'study';
          const functionName = isStudySession ? 'generateStudySummary' : 'generateMeetingMinutes';
          let generatedText = null;
          try {
            const genResult = await b44.invokeFunction(functionName, { text: fullText, user_email: userEmail });
            generatedText = isStudySession ? genResult?.data?.summary : genResult?.data?.minutes;
          } catch (e) {
            console.log('⚠️ Função backend bloqueada (402) — gerando via LLM direto:');
            generatedText = await generateMinutesViaLLM(fullText, isStudySession);
          }
          if (generatedText) {
            await sendWhatsAppMessage(replyPhone, generatedText + '\n\n━━━━━━━━━━━━━━━━━━\n✅ *Terminei!* 🤖 *bv.conte*');
            await sendWhatsAppMessage(replyPhone, isStudySession ? '📄 Quer receber esse resumo em arquivo? Responda *PDF* ou *WORD*.' : '📄 Quer receber essa ata em arquivo? Responda *PDF* ou *WORD*.');
          } else {
            await sendWhatsAppMessage(replyPhone, '⚠️ Não consegui gerar. Tente novamente enviando mais detalhes.');
          }
        } catch (e) {
          console.log('⚠️ Erro ao encerrar sessão:', e.message);
        }
        return res.json({ success: true });
      }
      if (messageText && messageText.trim()) {
        try {
          const updatedBuffer = (activeSession.transcript_buffer || '') + '\n' + messageText;
          await b44.MeetingSession.update(activeSession.id, { transcript_buffer: updatedBuffer });
          await sendWhatsAppMessage(replyPhone, '📝 Anotado... pode continuar.');
        } catch (e) {
          console.log('⚠️ Erro ao atualizar buffer:', e.message);
        }
      }
      return res.json({ success: true });
    }

    const isAtaCommand = messageText && !looksLikeScheduling && mentionsTrigger;
    if (isAtaCommand) {
      try {
        const studyTriggerPattern = /\b(aula|hist[oó]ria|palestra|curso|semin[aá]rio|treinamento|serm[aã]o)\b/i;
        const sessionType = studyTriggerPattern.test(messageText) && !/\breuni(a|ã)o\b/i.test(messageText) ? 'study' : 'meeting';
        await b44.MeetingSession.create({ phone: phoneWithDDI, user_email: userEmail, status: 'active', transcript_buffer: messageText || '', session_type: sessionType });
        await sendWhatsAppMessage(replyPhone, sessionType === 'study'
          ? '🎙️ *Modo Aula/Estudo iniciado!*\n\n🔴 Transcrição contínua ativada — pode falar à vontade que vou registrando tudo automaticamente.\n\nQuando terminar, diga *"Finalizar"* que eu gero um resumo organizado. 📚'
          : '🎙️ *Modo Reunião/Aula iniciado!*\n\n🔴 Transcrição contínua ativada — pode falar à vontade que vou registrando tudo automaticamente.\n\nQuando terminar, diga *"Finalizar"* que eu gero a ata completa. 📋');
        return res.json({ success: true });
      } catch (e) {
        console.log('⚠️ Erro ao iniciar sessão:', e.message);
      }
    }

    // Geração de arquivo (PDF/Word) — requer função backend (pode falhar com 402)
    const wantsDocFormat = /\bpdf\b/i.test(messageText) ? 'pdf' : (/\bword\b|\bdocx\b/i.test(messageText) ? 'word' : null);
    if (wantsDocFormat) {
      try {
        const recentMeetings = await b44.Meeting.filter({ created_by: userEmail }, '-created_date', 1);
        const lastMeeting = recentMeetings && recentMeetings[0];
        if (lastMeeting) {
          await sendWhatsAppMessage(replyPhone, `⏳ Gerando o arquivo em ${wantsDocFormat === 'pdf' ? 'PDF' : 'Word'}...`);
          try {
            const docResult = await b44.invokeFunction('generateMeetingDocument', { meeting_id: lastMeeting.id, format: wantsDocFormat });
            if (docResult?.data?.file_url) {
              await sendWhatsAppMessage(replyPhone, `📄 *Arquivo pronto!*\n\n${docResult.data.file_url}\n\n✅ *Terminei!* 🤖 *bv.conte*`);
              return res.json({ success: true });
            }
          } catch (e) {
            console.log('⚠️ generateMeetingDocument bloqueado (402):', e.message);
          }
          await sendWhatsAppMessage(replyPhone, '⚠️ Geração de arquivo indisponível no plano atual. A ata foi enviada em texto acima.');
          return res.json({ success: true });
        }
      } catch (e) {
        console.log('⚠️ Erro ao gerar documento:', e.message);
      }
    }

    // Agendamento de reunião
    const agendaKeywords = ['agendar', 'agenda', 'reunião', 'meeting', 'marcar reunião', 'agende', 'marcar'];
    const isMeetingCommand = messageText && agendaKeywords.some(k => messageText.toLowerCase().includes(k));
    if (isMeetingCommand) {
      try {
        const ext = await b44.InvokeLLM({
          prompt: `Extraia dados de reunião: "${messageText}"\nData atual: ${new Date().toISOString()}\nRetorne JSON: {title, start_time (ISO), description, attendees[]}`,
          response_json_schema: { type: 'object', properties: { title: { type: 'string' }, start_time: { type: 'string' }, description: { type: 'string' }, attendees: { type: 'array', items: { type: 'string' } } } }
        });
        if (ext?.title && ext?.start_time) {
          const mtg = await b44.Meeting.create({ title: ext.title, description: ext.description || '', start_time: new Date(ext.start_time).toISOString(), attendees: ext.attendees || [], reminder_sent: false, created_by: userEmail });
          const dt = new Date(mtg.start_time).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
          await sendWhatsAppMessage(replyPhone, `📅 *Reunião Agendada!*\n\n📝 *${mtg.title}*\n🕐 ${dt}\n${mtg.attendees?.length ? '👥 ' + mtg.attendees.join(', ') + '\n' : ''}\n━━━━━━━━━━━━━━━━━━\n✅ *Terminei!* 🤖 *bv.conte*`);
          return res.json({ success: true });
        }
      } catch (e) {
        console.log('⚠️ Erro reunião:', e.message);
      }
    }

    // Verifica assinatura ativa
    const isExpired = subscription.expiry_date && new Date(subscription.expiry_date) < now;
    const isInactive = subscription.status !== 'active';
    if (isExpired || isInactive) {
      const expiryDate = subscription.expiry_date ? new Date(subscription.expiry_date).toLocaleDateString('pt-BR') : 'não informada';
      await sendWhatsAppMessage(replyPhone,
        `⏰ *Seu período gratuito expirou!*\n\nSeu acesso ao BV.contezap venceu em ${expiryDate}.\n\n🚀 *Renove agora e continue usando!*\n\n🔗 *Acesse o link para renovar:*\nhttps://bv-contezap.base44.app/Checkout\n\n💳 Planos disponíveis:\n• Mensal - R$ 29,90/mês\n• Anual - R$ 238,90/ano (economize 33%!)\n\n✨ Após o pagamento, seu acesso será liberado automaticamente!\n\n🤖 *bv.conte — Seu Assistente Financeiro*`
      );
      return res.status(403).json({ error: 'Subscription expired', message_sent: true });
    }

    // Confirmação de apagar tudo
    if (/^sim[,\s]+apagar?\s+tudo[.!]?$/i.test(messageText.trim())) {
      const allTxToDelete = await b44.Transaction.list('-created_date', 5000);
      const userTx = allTxToDelete.filter(t => (t.notes && (t.notes.includes(phoneWithDDI) || t.notes.includes(incomingPhoneDigits))) || t.created_by === userEmail);
      let deletedTx = 0;
      for (const tx of userTx) { await b44.Transaction.delete(tx.id); deletedTx++; }
      const allBills = await b44.Bill.filter({ created_by: userEmail });
      let deletedBills = 0;
      for (const b of allBills) { await b44.Bill.delete(b.id); deletedBills++; }
      const allReceivables = await b44.Receivable.filter({ created_by: userEmail });
      let deletedReceivables = 0;
      for (const r of allReceivables) { await b44.Receivable.delete(r.id); deletedReceivables++; }
      await sendWhatsAppMessage(replyPhone, `🗑️ *Todos os registros foram apagados!*\n\n✅ ${deletedTx} transação(ões)\n✅ ${deletedBills} conta(s) a pagar\n✅ ${deletedReceivables} conta(s) a receber\n\n📊 Total: ${deletedTx + deletedBills + deletedReceivables} registro(s) excluído(s).\n\n━━━━━━━━━━━━━━━━━━\n🤖 *bv.conte — Seu Assistente Financeiro*`);
      return res.json({ success: true });
    }

    // Saudações / pedidos de atendimento humano
    const greetingPatterns = [/^ol[aá][\s!.]*$/i, /^oi[\s!.]*$/i, /^bom dia[\s!.]*$/i, /^boa tarde[\s!.]*$/i, /^boa noite[\s!.]*$/i, /quero usar o bv/i, /^ajuda$/i, /^help$/i, /^menu$/i, /^start$/i, /^começar$/i, /^iniciar$/i, /gostaria de começar/i, /como funciona/i, /^ol[aá][!.\s]/i, /^oi[!.\s]/i, /atendimento/i, /vendas/i, /comprar/i, /suporte/i];
    if (greetingPatterns.some(p => p.test(messageText.trim()))) {
      await sendWhatsAppMessage(replyPhone, `👋 *Olá! Tudo bem?*\n\nEste número é exclusivo para o registro automático de suas finanças (despesas e receitas).\n\n📝 *Como usar:*\n*Despesas:* "Gastei 50 no mercado"\n*Receitas:* "Recebi 1500 de salário"\n*Contas:* "Tenho aluguel 800 dia 10"\n*Saldo:* "Qual meu saldo?"\n\nPara *vendas, suporte ou tirar dúvidas*, fale com nossa equipe:\n👉 https://wa.me/5599981099632?text=Olá!%20Vim%20pelo%20site%20do%20Bv.ConteZap%20e%20preciso%20de%20ajuda.`);
      return res.json({ success: true });
    }

    // Listar contas a pagar
    const isBillListOnly = /^.*(?:lista|mostra|quais|quanto|quantas|vê|ver|minha).*contas?.*pagar/i.test(messageText) || /^.*(?:contas? pendentes|contas? a pagar|minhas contas)$/i.test(messageText);
    if (isBillListOnly) {
      const todayStr2 = new Date().toISOString().split('T')[0];
      const bills = await b44.Bill.filter({ created_by: userEmail });
      const pending = bills.filter(b => !b.paid).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
      if (pending.length === 0) { await sendWhatsAppMessage(replyPhone, '✅ Você não tem contas a pagar pendentes!'); return res.json({ success: true }); }
      let msg = `📋 *Suas Contas a Pagar:*\n\n`;
      let total = 0;
      pending.forEach(b => { const due = b.due_date ? b.due_date.split('-').reverse().join('/') : 'sem data'; const over = b.due_date && b.due_date < todayStr2; msg += `${over ? '🔴' : '🟡'} ${b.name}\n   💵 R$ ${(b.amount || 0).toFixed(2)} | 📅 Vence: ${due}\n\n`; total += (b.amount || 0); });
      msg += `━━━━━━━━━━━━━━━━━━\n💸 Total: R$ ${total.toFixed(2)}\n\n✅ *Terminei!*`;
      await sendWhatsAppMessage(replyPhone, msg);
      return res.json({ success: true });
    }

    // Marcar conta como paga
    const isBillPaidOnly = /^(?:paguei|quitei|liquidei|marquei como pago)\s.+/i.test(messageText);
    if (isBillPaidOnly) {
      const bills = await b44.Bill.filter({ created_by: userEmail });
      const found = bills.filter(b => !b.paid).find(b => b.name && messageText.toLowerCase().includes(b.name.toLowerCase().split(' ')[0]));
      if (found) {
        await b44.Bill.update(found.id, { paid: true });
        await b44.Transaction.create({ description: found.name, amount: found.amount, type: 'expense', category: found.category || 'outros', date: new Date().toISOString().split('T')[0], notes: 'Gerado ao marcar conta como paga via WhatsApp', created_by: userEmail });
        await sendWhatsAppMessage(replyPhone, `✅ *Conta paga e despesa registrada!*\n\n📝 ${found.name}\n💵 R$ ${(found.amount || 0).toFixed(2)}\n💸 Lançado como despesa automaticamente`);
        return res.json({ success: true });
      }
    }

    // Listar contas a receber
    const isReceivableListOnly = /^.*(?:lista|mostra|quais|quanto|quantas|vê|ver|minha).*(?:contas? a receber|receber)/i.test(messageText) || /^.*contas? a receber$/i.test(messageText);
    if (isReceivableListOnly) {
      const todayStr2 = new Date().toISOString().split('T')[0];
      const receivables = await b44.Receivable.filter({ created_by: userEmail });
      const pending = receivables.filter(r => !r.received).sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
      if (pending.length === 0) { await sendWhatsAppMessage(replyPhone, '✅ Você não tem contas a receber pendentes!'); return res.json({ success: true }); }
      let msg = `💰 *Suas Contas a Receber:*\n\n`;
      let total = 0;
      pending.forEach(r => { const due = r.due_date ? r.due_date.split('-').reverse().join('/') : 'sem data'; const over = r.due_date && r.due_date < todayStr2; msg += `${over ? '🔴' : '🟢'} ${r.name}\n   💵 R$ ${(r.amount || 0).toFixed(2)} | 📅 Previsto: ${due}\n\n`; total += (r.amount || 0); });
      msg += `━━━━━━━━━━━━━━━━━━\n💰 Total: R$ ${total.toFixed(2)}\n\n✅ *Terminei!*`;
      await sendWhatsAppMessage(replyPhone, msg);
      return res.json({ success: true });
    }

    // Marcar conta a receber como recebida
    const isReceivableReceivedOnly = /^(?:recebi|chegou|caiu|liquidaram|pagaram)\s+.+(?:receber|parcela|cliente)/i.test(messageText);
    if (isReceivableReceivedOnly) {
      const receivables = await b44.Receivable.filter({ created_by: userEmail });
      const found = receivables.filter(r => !r.received).find(r => r.name && messageText.toLowerCase().includes(r.name.toLowerCase().split(' ')[0]));
      if (found) { await b44.Receivable.update(found.id, { received: true }); await sendWhatsAppMessage(replyPhone, `✅ *Conta marcada como recebida!*\n\n📝 ${found.name}\n💵 R$ ${(found.amount || 0).toFixed(2)}`); return res.json({ success: true }); }
    }

    // Criar conta a pagar
    const billKeywords = /(?:cadastr|registr|cria|adiciona|anota|guarda).*(?:conta|pagar|boleto)|(?:pagar|paguei|tenho que pagar|preciso pagar|vou pagar).*\d/i;
    if (billKeywords.test(messageText) && /\d|dia|mês|mes|semana/i.test(messageText)) {
      try {
        const billResult = await b44.InvokeLLM({
          prompt: `Extraia dados de uma conta a pagar desta mensagem: "${messageText}"\nRetorne JSON: {"name":"...","amount":0,"due_date":"YYYY-MM-DD","category":"moradia|energia|agua|internet|telefone|saude|educacao|transporte|outros","installments":1,"error":null}\nSe não conseguir extrair name e amount, retorne error: "sem dados"`,
          response_json_schema: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'number' }, due_date: { type: 'string' }, category: { type: 'string' }, installments: { type: 'integer' }, error: { type: 'string' } } }
        });
        if (!billResult.error && billResult.name && billResult.amount > 0) {
          const todayStr = new Date().toISOString().split('T')[0];
          const count = billResult.installments || 1;
          if (count > 1) {
            const amt = billResult.amount / count;
            const start = new Date(billResult.due_date || todayStr);
            let msg = `✅ *Conta a Pagar Parcelada Registrada!*\n\n💳 ${billResult.name}\n💵 R$ ${billResult.amount.toFixed(2).replace('.', ',')} em ${count}x de R$ ${amt.toFixed(2).replace('.', ',')}\n\n`;
            const billIds = [];
            for (let i = 0; i < count; i++) { const d = new Date(start); d.setMonth(d.getMonth() + i); const ds = d.toISOString().split('T')[0]; const bc = await b44.Bill.create({ name: `${billResult.name} (${i + 1}/${count})`, amount: amt, due_date: ds, frequency: 'once', category: billResult.category || 'outros', paid: false, created_by: userEmail }); msg += `📌 Parcela ${i + 1}: R$ ${amt.toFixed(2).replace('.', ',')} - ${ds.split('-').reverse().join('/')}\n`; billIds.push({ label: `Parcela ${i + 1}`, id: bc.id }); }
            msg += `\n━━━━━━━━━━━━━━━━━━\n🗑️ _Para apagar uma parcela: *Apagar [ID]*_`;
            billIds.forEach(b => { msg += `\n_${b.label}: ${b.id}_`; });
            msg += `\n🤖 *bv.conte*`;
            await sendWhatsAppMessage(replyPhone, msg);
          } else {
            const billCreated = await b44.Bill.create({ name: billResult.name, amount: billResult.amount, due_date: billResult.due_date || todayStr, frequency: 'once', category: billResult.category || 'outros', paid: false, created_by: userEmail });
            await sendWhatsAppMessage(replyPhone, `✅ *Conta a Pagar Registrada!*\n\n💳 ${billResult.name}\n💵 R$ ${billResult.amount.toFixed(2).replace('.', ',')}\n📅 Vence: ${(billResult.due_date || todayStr).split('-').reverse().join('/')}\n\n━━━━━━━━━━━━━━━━━━\n🗑️ _Para apagar: *Apagar ${billCreated.id}*_\n🤖 *bv.conte*`);
          }
          return res.json({ success: true });
        }
      } catch (e) { console.log('Erro conta a pagar:', e.message); }
    }

    // Criar conta a receber
    const hasReceivableFutureIntent = /(?:vou receber|a receber|à receber|prazo|parcela[s]?|em \d+x|em \d+ vez|próximo mês|semana que vem|dia \d{1,2}(?:\s+(?:do\s+)?(?:próximo|que vem))?|amanhã recebo|cliente vai pagar|vai me pagar)/i.test(messageText);
    const receivableKeywords = /(?:cadastr|registr|cria|adiciona|anota|guarda).*(?:receber|venda|cliente)|(?:tenho a receber|à receber|a receber|vou receber|cliente.*pagar|parcela[s]?).*\d/i;
    if ((receivableKeywords.test(messageText) || hasReceivableFutureIntent) && /\d|dia|mês|mes|semana/i.test(messageText) && hasReceivableFutureIntent) {
      try {
        const recResult = await b44.InvokeLLM({
          prompt: `Extraia dados de uma conta a receber desta mensagem: "${messageText}"\nRetorne JSON: {"name":"...","amount":0,"due_date":"YYYY-MM-DD","category":"freelance|vendas|aluguel|investimentos|outros","installments":1,"error":null}\nSe não conseguir extrair name e amount, retorne error: "sem dados"`,
          response_json_schema: { type: 'object', properties: { name: { type: 'string' }, amount: { type: 'number' }, due_date: { type: 'string' }, category: { type: 'string' }, installments: { type: 'integer' }, error: { type: 'string' } } }
        });
        if (!recResult.error && recResult.name && recResult.amount > 0) {
          const todayStr = new Date().toISOString().split('T')[0];
          const count = recResult.installments || 1;
          if (count > 1) {
            const parentSaleId = 'sale_' + Date.now();
            const amt = recResult.amount / count;
            const start = new Date(recResult.due_date || todayStr);
            const dates = [];
            for (let i = 0; i < count; i++) { dates.push(start.toISOString().split('T')[0]); start.setMonth(start.getMonth() + 1); }
            let msg = `💰 *Venda Parcelada Registrada!*\n\n📝 ${recResult.name}\n💵 R$ ${recResult.amount.toFixed(2).replace('.', ',')} em ${count}x\n\n`;
            const recIds = [];
            for (let i = 0; i < count; i++) { const rc = await b44.Receivable.create({ name: `${recResult.name} (Parcela ${i + 1}/${count})`, amount: amt, due_date: dates[i], frequency: 'once', category: recResult.category || 'outros', received: false, is_installment_plan: true, total_sale_amount: recResult.amount, installment_number: i + 1, total_installments: count, parent_sale_id: parentSaleId, created_by: userEmail }); msg += `📌 Parcela ${i + 1}: R$ ${amt.toFixed(2).replace('.', ',')} - ${dates[i].split('-').reverse().join('/')}\n`; recIds.push(rc.id); }
            msg += `\n━━━━━━━━━━━━━━━━━━\n🗑️ _Para apagar uma parcela: *Apagar [ID]*_`;
            recIds.forEach((id, i) => { msg += `\n_Parcela ${i + 1}: ${id}_`; });
            msg += `\n🤖 *bv.conte*`;
            await sendWhatsAppMessage(replyPhone, msg);
          } else {
            const recCreated = await b44.Receivable.create({ name: recResult.name, amount: recResult.amount, due_date: recResult.due_date || todayStr, frequency: 'once', category: recResult.category || 'outros', received: false, created_by: userEmail });
            await sendWhatsAppMessage(replyPhone, `✅ *Conta a Receber Registrada!*\n\n📝 ${recResult.name}\n💵 R$ ${recResult.amount.toFixed(2).replace('.', ',')}\n📅 Previsto: ${(recResult.due_date || todayStr).split('-').reverse().join('/')}\n\n━━━━━━━━━━━━━━━━━━\n🗑️ _Para apagar: *Apagar ${recCreated.id}*_\n🤖 *bv.conte*`);
          }
          return res.json({ success: true });
        }
      } catch (e) { console.log('Erro conta a receber:', e.message); }
    }

    // Corrigir transação
    const correctPatterns = [/(?:corrige|ajusta|muda|altera)\s+(?:a última|último|aquela|essa|a transação)/i, /(?:corrige|ajusta|muda)\s+o valor|a data|a categoria/i, /(?:era|é)\s+(\d+(?:,\d+)?)\s+e não\s+(\d+(?:,\d+)?)/i];
    if (correctPatterns.some(p => p.test(messageText))) {
      const allTx = await b44.Transaction.list('-created_date', 500);
      const phoneVariants = [phoneWithDDI, incomingPhoneDigits, '55' + incomingPhoneDigits];
      const txs = allTx.filter(t => t.created_by === userEmail || (t.notes && phoneVariants.some(v => t.notes.includes(v))));
      if (txs.length > 0) {
        const last = txs[0];
        const cr = await b44.InvokeLLM({ prompt: `Mensagem: "${messageText}"\nTransação anterior: ${last.description} - R$ ${last.amount} - ${last.category}\nO usuário quer corrigir. Retorne JSON: {"new_description":null,"new_amount":null,"new_category":null,"new_date":null}`, response_json_schema: { type: 'object', properties: { new_description: { type: ['string', 'null'] }, new_amount: { type: ['number', 'null'] }, new_category: { type: ['string', 'null'] }, new_date: { type: ['string', 'null'] } } } });
        const upd = {};
        if (cr.new_description) upd.description = cr.new_description;
        if (cr.new_amount) upd.amount = cr.new_amount;
        if (cr.new_category) upd.category = cr.new_category;
        if (cr.new_date) upd.date = cr.new_date;
        if (Object.keys(upd).length > 0) {
          await b44.Transaction.update(last.id, upd);
          let msg = `✏️ *Transação Corrigida!*\n\n`;
          if (upd.description) msg += `📝 ${upd.description}\n`;
          if (upd.amount) msg += `💵 R$ ${upd.amount.toFixed(2)}\n`;
          if (upd.category) msg += `📂 ${upd.category}\n`;
          msg += `\n✅ Obrigado!`;
          await sendWhatsAppMessage(replyPhone, msg);
          return res.json({ success: true });
        }
      }
    }

    // Apagar todos (com confirmação)
    const deleteAllPatterns = [/^apag[ar]*\s+tud[oa]/i, /^delet[ar]*\s+tud[oa]/i, /^remov[er]*\s+tud[oa]/i, /^limpa[r]?\s+tud[oa]/i, /^apag[ar]*\s+todos?\s+(?:os\s+)?(?:registro|lançamento|transaç)/i, /^delet[ar]*\s+todos?\s+(?:os\s+)?(?:registro|lançamento|transaç)/i, /^zerai?\s+(?:tud[oa]|meus?\s+registro|meus?\s+lançamento)/i, /^exclu[ir]*\s+tud[oa]/i];
    const isConfirmMsg = /^sim[,\s]+apagar?\s+tudo/i.test(messageText.trim());
    if (!isConfirmMsg && deleteAllPatterns.some(p => p.test(messageText.trim()))) {
      await sendWhatsAppMessage(replyPhone, `⚠️ *ATENÇÃO — Ação Irreversível!*\n\nVocê está prestes a *apagar TODOS os seus registros financeiros*.\n\n🚨 *Esta ação NÃO poderá ser desfeita!*\n\nPara confirmar, responda exatamente:\n*sim, apagar tudo*\n\nPara cancelar, ignore esta mensagem.`);
      return res.json({ success: true, awaiting_confirmation: true });
    }

    // Apagar última transação
    const deletePatterns = [/(?:apag[ar]*|delet[ar]*|remov[er]*|cancel[ar]*|desfaz[er]*|tir[ar]*)\s+(?:o\s+|a\s+)?(?:aquela[s]?|[uú]ltim[oa]s?)\s*(?:transa[çc][aã]o|lan[çc]amento|registro|entrada|lan[çc]ado|cadastro)?/i, /(?:apag[ar]*|delet[ar]*|remov[er]*|cancel[ar]*)\s+(?:o\s+|a\s+)?[uú]ltim[oa]s?\s*(?:transa[çc][aã]o|lan[çc]amento|registro)?/i, /desfaz[er]*\s+(?:o\s+)?[uú]ltim[oa]s?\s*(?:lan[çc]amento|transa[çc][aã]o|registro)?/i, /(?:apagar?|deletar?|remover?|cancelar?|desfazer?|tira[r]?)\s+(?:o\s+)?[uú]ltim[oa]s?/i, /(?:errei|errado|foi errado|coloquei errado|lancei errado|registrei errado)/i, /^(?:corrige|corrigir|corrigi|desfaz|desfazer|volta|voltar|cancela|cancelar)\s*[.!]?$/i, /^(?:n[aã]o era isso|n[aã]o [eé] isso|foi engano|foi erro|lancei errado|registrei errado)[.!]?$/i, /^(?:apaga|deleta|remove|cancela)[.!]?$/i];
    if (deletePatterns.some(p => p.test(messageText))) {
      const allTxD = await b44.Transaction.list('-created_date', 2000);
      const phoneVariants = [phoneWithDDI, incomingPhoneDigits, '55' + incomingPhoneDigits];
      const txs = (Array.isArray(allTxD) ? allTxD : []).filter(t => t.created_by === userEmail || (t.notes && phoneVariants.some(v => t.notes.includes(v)))).sort((a, b) => new Date(b.created_date) - new Date(a.created_date));
      if (txs.length > 0) {
        const last = txs[0];
        await b44.Transaction.delete(last.id);
        await sendWhatsAppMessage(replyPhone, `🗑️ *Transação Apagada!*\n\n${last.type === 'income' ? '💰' : '💸'} ${last.description}\nR$ ${last.amount.toFixed(2)}\n\n✅ Obrigado!`);
        return res.json({ success: true, deleted: true });
      }
      return res.json({ success: true });
    }

    // Apagar registro por ID
    const deleteByIdWithCmd = messageText.trim().match(/^(?:apag[ar]*|exclu[ir]*|delet[ar]*|remov[er]*|cancel[ar]*)\s+(?:🔑\s*)?([a-zA-Z0-9_-]{10,})\s*[.!]?$/i);
    const deleteByIdCmdReversed = messageText.trim().match(/^(?:🔑\s*)?([a-zA-Z0-9_-]{10,})\s+(?:apag[ar]*|exclu[ir]*|delet[ar]*|remov[er]*|cancel[ar]*)\s*[.!]?$/i);
    const deleteByIdOnly = messageText.trim().match(/^([a-zA-Z0-9_-]{20,})\s*[.!]?$/);
    const deleteByIdMatch = deleteByIdWithCmd || deleteByIdCmdReversed || deleteByIdOnly;
    if (deleteByIdMatch) {
      const targetId = (deleteByIdWithCmd ? deleteByIdWithCmd[1] : deleteByIdCmdReversed ? deleteByIdCmdReversed[1] : deleteByIdOnly[1]).trim();
      let deleted = false;
      try {
        const tx = await b44.Transaction.get(targetId);
        if (tx && (tx.created_by === userEmail || (tx.notes && tx.notes.includes(incomingPhoneDigits)))) {
          await b44.Transaction.delete(targetId);
          await sendWhatsAppMessage(replyPhone, `🗑️ *Transação Apagada!*\n\n${tx.type === 'income' ? '💰' : '💸'} ${tx.description}\nR$ ${(tx.amount || 0).toFixed(2)} | 📅 ${(tx.date || '').split('-').reverse().join('/')}\n\n✅ Registro removido com sucesso!\n\n🤖 *bv.conte*`);
          deleted = true;
        }
      } catch (e) { /* não é transaction */ }
      if (!deleted) {
        try {
          const bill = await b44.Bill.get(targetId);
          if (bill && bill.created_by === userEmail) {
            await b44.Bill.delete(targetId);
            await sendWhatsAppMessage(replyPhone, `🗑️ *Conta a Pagar Apagada!*\n\n💳 ${bill.name}\nR$ ${(bill.amount || 0).toFixed(2)}\n\n✅ Registro removido com sucesso!\n\n🤖 *bv.conte*`);
            deleted = true;
          }
        } catch (e) { /* não é bill */ }
      }
      if (!deleted) {
        try {
          const rec = await b44.Receivable.get(targetId);
          if (rec && rec.created_by === userEmail) {
            await b44.Receivable.delete(targetId);
            await sendWhatsAppMessage(replyPhone, `🗑️ *Conta a Receber Apagada!*\n\n📝 ${rec.name}\nR$ ${(rec.amount || 0).toFixed(2)}\n\n✅ Registro removido com sucesso!\n\n🤖 *bv.conte*`);
            deleted = true;
          }
        } catch (e) { /* não é receivable */ }
      }
      if (!deleted) {
        await sendWhatsAppMessage(replyPhone, `❌ *Registro não encontrado!*\n\nID: \`${targetId}\`\n\nVerifique o ID e tente novamente.\n💡 O ID aparece nas confirmações de lançamento após o 🔑\n\n🤖 *bv.conte*`);
      }
      return res.json({ success: true, deleted });
    }

    // Relatório/saldo
    const isReportCommand = /relatório|relatorio|resumo|saldo|quanto tenho|balanço|balanco|extrato|quanto ganhei|quanto gastei|me passe|passar|relatório geral|relatorio geral|relatório de gastos|relatorio de gastos|gastos por item|itens/i.test(messageText);
    if (isReportCommand) {
      const today = new Date();
      const todayStr2 = today.toISOString().split('T')[0];
      let firstDay, lastDay, periodLabel;
      const isHoje = /\bhoje\b|\bdo dia\b|\bde hoje\b/i.test(messageText);
      const isSemana = /\bsemana\b|\bessa semana\b|\besta semana\b/i.test(messageText);
      const isAno = /\bano\b|\bdeste ano\b|\besse ano\b|\bde \d{4}\b/i.test(messageText) && !/\bmês\b|\bmes\b|\bmensal\b/i.test(messageText);
      const monthNames = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
      const monthMatch = messageText.toLowerCase().match(/\b(janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/);
      const specificMonth = monthMatch ? monthNames.indexOf(monthMatch[1].replace('marco', 'março')) : -1;
      if (isHoje) { firstDay = lastDay = todayStr2; periodLabel = `HOJE — ${todayStr2.split('-').reverse().join('/')}`; }
      else if (isSemana) { const dow = today.getDay(); const mon = new Date(today); mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1)); firstDay = mon.toISOString().split('T')[0]; lastDay = todayStr2; periodLabel = `ESTA SEMANA (${firstDay.split('-').reverse().join('/')} a ${lastDay.split('-').reverse().join('/')})`; }
      else if (isAno) { firstDay = `${today.getFullYear()}-01-01`; lastDay = `${today.getFullYear()}-12-31`; periodLabel = `ANO DE ${today.getFullYear()}`; }
      else if (specificMonth >= 0) { const ms = String(specificMonth + 1).padStart(2, '0'); firstDay = `${today.getFullYear()}-${ms}-01`; lastDay = `${today.getFullYear()}-${ms}-${String(new Date(today.getFullYear(), specificMonth + 1, 0).getDate()).padStart(2, '0')}`; periodLabel = `${monthNames[specificMonth].toUpperCase()} de ${today.getFullYear()}`; }
      else { const ms = String(today.getMonth() + 1).padStart(2, '0'); firstDay = `${today.getFullYear()}-${ms}-01`; lastDay = `${today.getFullYear()}-${ms}-${String(new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()).padStart(2, '0')}`; periodLabel = `${['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][today.getMonth()].toUpperCase()} de ${today.getFullYear()}`; }
      const phoneSuffix = incomingPhoneDigits.slice(-8);
      let allTxRaw = [];
      try { allTxRaw = await b44.Transaction.list('-date', 5000); } catch (e) { }
      const periodTx = (Array.isArray(allTxRaw) ? allTxRaw : []).filter(t => { const inPeriod = t.date >= firstDay && t.date <= lastDay; if (!inPeriod) return false; return t.created_by === userEmail || (t.notes && t.notes.includes(phoneSuffix)); }).sort((a, b) => new Date(b.date) - new Date(a.date));
      const income = periodTx.filter(t => t.type === 'income').reduce((s, t) => s + (t.amount || 0), 0);
      const expenses = periodTx.filter(t => t.type === 'expense').reduce((s, t) => s + (t.amount || 0), 0);
      const balance = income - expenses;
      let reportMsg = `📊 *RELATÓRIO — ${periodLabel}*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💰 RECEITAS: R$ ${income.toFixed(2)}\n💸 DESPESAS: R$ ${expenses.toFixed(2)}\n${balance >= 0 ? '🟢' : '🔴'} SALDO: R$ ${balance.toFixed(2)}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n📋 *${periodTx.length} TRANSAÇÕES:*\n\n`;
      periodTx.forEach(tx => { reportMsg += `${tx.type === 'income' ? '💚' : '❤️'} ${tx.description}\n   R$ ${tx.amount.toFixed(2)} | ${tx.date.split('-').reverse().join('/')}\n\n`; });
      reportMsg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ *Terminei!* 🤖 *bv.conte*`;
      if (reportMsg.length > 4096) {
        const header = `📊 *RELATÓRIO — ${periodLabel}*\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n💰 RECEITAS: R$ ${income.toFixed(2)}\n💸 DESPESAS: R$ ${expenses.toFixed(2)}\n${balance >= 0 ? '🟢' : '🔴'} SALDO: R$ ${balance.toFixed(2)}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        await sendWhatsAppMessage(replyPhone, header);
        let chunk = `📋 *DETALHAMENTO (${periodTx.length} transações):*\n\n`;
        for (const tx of periodTx) { const line = `${tx.type === 'income' ? '💚' : '❤️'} ${tx.description}\n   R$ ${tx.amount.toFixed(2)} | ${tx.date.split('-').reverse().join('/')}\n\n`; if ((chunk + line).length > 4096) { await sendWhatsAppMessage(replyPhone, chunk); chunk = line; } else chunk += line; }
        await sendWhatsAppMessage(replyPhone, chunk + `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✅ *Terminei!* 🤖 *bv.conte*`);
      } else { await sendWhatsAppMessage(replyPhone, reportMsg); }
      return res.json({ success: true });
    }

    // Processamento de imagem/comprovante/extrato
    const isPdfFile = imageUrl && imageUrl.startsWith('__PDF__');
    const realImageUrl = isPdfFile ? imageUrl.replace('__PDF__', '') : imageUrl;
    const hasRealImage = !!realImageUrl;
    const isStatementKeyword = /extrato|minhas transa[çc][oõ]es|movimenta[çc][aã]o|histórico|lançamentos do (banco|conta|mês|mes)/i.test(messageText);
    const isStatement = isStatementKeyword && realImageUrl;

    // Re-upload de mídia para Base44
    let processableUrl = realImageUrl;
    if (realImageUrl && realImageUrl.startsWith('http')) {
      try {
        const wasenderApiKeyMedia = process.env.WASENDER_API_KEY;
        const mediaFetchRes = await fetch(realImageUrl, { headers: wasenderApiKeyMedia ? { Authorization: `Bearer ${wasenderApiKeyMedia}` } : {} });
        if (mediaFetchRes.ok) {
          const mediaBuffer = await mediaFetchRes.arrayBuffer();
          const mimeType = isPdfFile ? 'application/pdf' : (mediaFetchRes.headers.get('content-type') || 'image/jpeg');
          const ext = isPdfFile ? 'pdf' : (mimeType.includes('png') ? 'png' : 'jpg');
          try {
            const uploadRes = await b44.uploadFile(Buffer.from(mediaBuffer), `media_${Date.now()}.${ext}`, mimeType);
            if (uploadRes.file_url) processableUrl = uploadRes.file_url;
          } catch (e) {
            console.log('⚠️ Upload via API falhou, tentando URL original:', e.message);
          }
        }
      } catch (e) { console.log('⚠️ Erro no re-upload:', e.message); }
    }

    // Extrato bancário
    if (isStatement && realImageUrl) {
      await sendWhatsAppMessage(replyPhone, '⏳ Processando seu extrato... pode levar alguns segundos!');
      const stPrompt = isPdfFile
        ? `Analise este PDF de extrato bancário e extraia TODAS as transações. Para cada transação: transaction_type (expense/income), amount, date (YYYY-MM-DD), description, category. Retorne SOMENTE JSON: {"transactions":[...]}`
        : `Extraia TODAS as transações visíveis neste extrato bancário. Para cada linha: transaction_type (expense/income), amount, date (YYYY-MM-DD), description, category. Retorne SOMENTE JSON: {"transactions":[...]}`;
      try {
        const stResult = await b44.InvokeLLM({ prompt: stPrompt, file_urls: [processableUrl], model: 'gemini_3_flash', response_json_schema: { type: 'object', properties: { transactions: { type: 'array', items: { type: 'object', properties: { transaction_type: { type: 'string' }, amount: { type: 'number' }, date: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' } } } } } } });
        const stTxs = (stResult?.transactions || []).filter(tx => tx && tx.amount > 0 && ['income', 'expense'].includes(tx.transaction_type) && tx.date);
        if (stTxs.length > 0) {
          let saved = [], totalInc = 0, totalExp = 0;
          for (const tx of stTxs) { const c = await b44.Transaction.create({ description: tx.description || 'Transação extrato', amount: tx.amount, type: tx.transaction_type, category: tx.category || 'outros', date: tx.date, notes: `Importado do extrato bancário via WhatsApp\nTelefone: ${phoneWithDDI}`, created_by: userEmail }); saved.push({ ...tx, id: c.id }); if (tx.transaction_type === 'income') totalInc += tx.amount; else totalExp += tx.amount; }
          const saldo = totalInc - totalExp;
          let msg = `✅ *Extrato Importado!*\n\n📊 *${saved.length} transações registradas*\n\n💰 Receitas: R$ ${totalInc.toFixed(2)}\n💸 Despesas: R$ ${totalExp.toFixed(2)}\n${saldo >= 0 ? '🟢' : '🔴'} Saldo: R$ ${saldo.toFixed(2)}\n\n`;
          saved.forEach(tx => { msg += `${tx.transaction_type === 'income' ? '💚' : '❤️'} ${tx.description} — R$ ${tx.amount.toFixed(2)}\n`; });
          msg += `\n━━━━━━━━━━━━━━━━━━\n🗑️ _Para apagar, envie: *Apagar [ID]*_`;
          saved.forEach((tx, i) => { msg += `\n_${i + 1}. ${tx.id}_`; });
          msg += `\n🤖 *bv.conte*`;
          await sendWhatsAppMessage(replyPhone, msg);
          return res.json({ success: true, imported: saved.length });
        }
      } catch (e) { console.error('❌ Erro extrato:', e.message); }
      return res.json({ success: true });
    }

    // Comprovante (imagem única)
    const isSingleReceipt = hasRealImage && !isStatement;
    if (isSingleReceipt && realImageUrl && realImageUrl.startsWith('http')) {
      const todayRec = new Date().toISOString().split('T')[0];
      const recPrompt = `EXTRAÇÃO DE COMPROVANTE BANCÁRIO (${isPdfFile ? 'PDF' : 'IMAGEM'})\n\nExtraia a(s) transação(ões) financeira(s) visível(is).\nRETORNE JSON: {"receipts":[{"amount":NÚMERO,"date":"YYYY-MM-DD","type":"expense|income","description":"NOMES REAIS","category":"outros"}]}\n\nREGRAS:\n- AMOUNT: número puro (ex: 350, não "R$ 350")\n- DATE: YYYY-MM-DD. Se não encontrar, use: ${todayRec}\n- TYPE: expense (pagamento/envio) ou income (recebimento)\n- DESCRIPTION: use SEMPRE nomes reais de pessoas/empresas visíveis\n- Se não houver transação clara, retorne {"receipts":[]}\n- NUNCA invente valores`;
      try {
        let recData = await b44.InvokeLLM({ prompt: recPrompt, file_urls: [processableUrl], model: isPdfFile ? 'gemini_3_1_pro' : 'claude_opus_4_7', response_json_schema: { type: 'object', properties: { receipts: { type: 'array', items: { type: 'object', properties: { amount: { type: 'number' }, date: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' } } } } } } });
        let normalized = Array.isArray(recData) ? { receipts: recData } : recData;
        if (!normalized.receipts || normalized.receipts.length === 0) {
          const fb = isPdfFile ? 'claude_opus_4_7' : 'gemini_3_1_pro';
          recData = await b44.InvokeLLM({ prompt: recPrompt, file_urls: [processableUrl], model: fb, response_json_schema: { type: 'object', properties: { receipts: { type: 'array', items: { type: 'object', properties: { amount: { type: 'number' }, date: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, category: { type: 'string' } } } } } } });
          normalized = Array.isArray(recData) ? { receipts: recData } : recData;
        }
        if (!normalized.receipts || normalized.receipts.length === 0) { await sendWhatsAppMessage(replyPhone, '⚠️ Não consegui extrair transações dessa imagem. Tente enviar uma imagem mais clara do comprovante.'); return res.json({ success: true }); }
        const created = [];
        for (const r of normalized.receipts) {
          if (!r.amount || r.amount <= 0) continue;
          let txType = r.type && r.type.toLowerCase().includes('income') ? 'income' : 'expense';
          const dl = (r.description || '').toLowerCase();
          if (/recebido|recebimento|creditado|entrada|depósito|salário|recebi/i.test(dl)) txType = 'income';
          if (/enviado|enviada|pagamento|debitado|saída|compra|débito|enviei/i.test(dl)) txType = 'expense';
          let vd = r.date;
          if (!vd || !/^\d{4}-\d{2}-\d{2}$/.test(vd)) vd = todayRec;
          const c = await b44.Transaction.create({ description: r.description || 'Comprovante', amount: parseFloat(r.amount), type: txType, category: r.category || 'outros', date: vd, notes: `Importado do comprovante via WhatsApp\nTelefone: ${phoneWithDDI}`, created_by: userEmail });
          created.push({ ...r, id: c.id, type: txType });
        }
        if (created.length === 0) return res.json({ success: true });
        let msg = `✅ *${created.length} Lançamento(s) Registrado(s)!*\n\n`;
        const generic = ['comprovante', 'transação', 'pix - comprovante de pagamento', 'pix', 'transferência', 'pagamento', 'comprovante de pagamento'];
        created.forEach(tx => { const dp = tx.date.split('-'); msg += `${tx.type === 'income' ? '💰' : '💸'} *${tx.type === 'income' ? 'Receita' : 'Despesa'}* — R$ ${tx.amount.toFixed(2)}\n`; if (!generic.includes((tx.description || '').toLowerCase().trim())) msg += `📝 ${tx.description}\n`; msg += `📅 ${dp[2]}/${dp[1]}/${dp[0]}\n\n`; });
        if (created.length === 1) {
          msg += `━━━━━━━━━━━━━━━━━━\n🗑️ _Para apagar: *Apagar ${created[0].id}*_\n🤖 *bv.conte*`;
        } else {
          msg += `━━━━━━━━━━━━━━━━━━\n🗑️ _Para apagar, envie: *Apagar [ID]*_`;
          created.forEach((tx, i) => { msg += `\n_${i + 1}. ${tx.id}_`; });
          msg += `\n🤖 *bv.conte*`;
        }
        await sendWhatsAppMessage(replyPhone, msg);
        return res.json({ success: true });
      } catch (e) { console.error('❌ Erro comprovante:', e.message); return res.json({ success: true }); }
    }

    // Filtro pré-LLM
    if (!hasRealImage && !hasFinancialIntent(messageText)) {
      console.log('🚫 Filtro pré-LLM: sem intenção financeira, ignorando silenciosamente.');
      return res.json({ success: true, skipped: 'no_financial_intent' });
    }

    // LLM para texto
    const todayDate = new Date().toISOString().split('T')[0];
    const llmPrompt = `Mensagem recebida via WhatsApp: "${messageText}"
DATA: ${todayDate}

⚠️ REGRA MAIS IMPORTANTE: Se a mensagem NÃO contiver uma transação financeira real com VALOR NUMÉRICO EXPLÍCITO (em algarismos ou por extenso), retorne OBRIGATORIAMENTE: {"transactions": []}

RETORNE JSON: {"transactions":[...]}

=== PADRÕES DE DESPESA ===
"gastei 300 no supermercado" → expense 300 alimentacao
"paguei 150 de gasolina" → expense 150 transporte

=== PADRÕES DE RECEITA ===
"recebi 1000 do cliente" → income 1000 outros
"caiu 2000 de salário" → income 2000 salario

=== FORMATO DE CADA TRANSAÇÃO ===
{"transaction_type":"expense|income","amount":NÚMERO,"description":"texto","category":"alimentacao|transporte|moradia|saude|educacao|lazer|salario|trabalho_extra|investimentos|outros","date":"${todayDate}"}`;

    let parseResult;
    try {
      parseResult = await b44.InvokeLLM({
        prompt: llmPrompt,
        response_json_schema: { type: 'object', properties: { transactions: { type: 'array', items: { type: 'object', properties: { transaction_type: { type: 'string' }, amount: { type: 'number' }, description: { type: 'string' }, category: { type: 'string' }, date: { type: 'string' } } } } } }
      });
    } catch (e) {
      console.log('LLM falhou:', e.message);
      parseResult = { transactions: [] };
    }

    let transactions = [];
    if (parseResult?.transactions && Array.isArray(parseResult.transactions)) transactions = parseResult.transactions;
    else if (Array.isArray(parseResult)) transactions = parseResult;

    transactions = transactions.filter(tx => {
      if (!tx) return false;
      if (!['income', 'expense'].includes(tx.transaction_type)) return false;
      if (!tx.amount || tx.amount <= 0 || !isFinite(Number(tx.amount))) return false;
      if (!tx.date || !/^\d{4}-\d{2}-\d{2}$/.test(tx.date)) { tx.date = todayDate; }
      if (new Date(tx.date) > new Date(todayDate)) tx.date = todayDate;
      if (!tx.description || String(tx.description).trim().length === 0) return false;
      const valid = ['alimentacao', 'transporte', 'moradia', 'saude', 'educacao', 'lazer', 'salario', 'trabalho_extra', 'investimentos', 'outros'];
      if (!valid.includes(String(tx.category || '').toLowerCase())) tx.category = 'outros';
      tx.amount = Number(tx.amount);
      return true;
    });

    if (transactions.length === 0) {
      await sendWhatsAppMessage(replyPhone, `🤖 *Não entendi muito bem...*\n\nTente um desses formatos:\n\n💸 *Despesa:* "Gastei 50 no mercado"\n💰 *Receita:* "Recebi 200 de freelance"\n📊 *Saldo:* "Qual meu saldo?"\n📋 *Contas:* "Minhas contas a pagar"\n\nSe precisar de ajuda, diga *ajuda* 😊`);
      return res.json({ success: true });
    }

    const created = [];
    const catEmojis = { alimentacao: '🍽️', transporte: '🚗', moradia: '🏠', saude: '⚕️', educacao: '📚', lazer: '🎮', salario: '💼', trabalho_extra: '💪', investimentos: '📈', outros: '📌' };
    for (const tx of transactions) {
      let cat = tx.category || 'outros';
      if (!tx.category || tx.category === 'outros') cat = detectCategoryFromText(messageText, tx.transaction_type === 'income');
      const c = await b44.Transaction.create({ description: tx.description, amount: tx.amount, type: tx.transaction_type, category: cat, date: tx.date || todayDate, notes: `Registrado via WhatsApp\nTelefone: ${phoneWithDDI}`, created_by: userEmail });
      created.push({ ...tx, id: c.id, type: tx.transaction_type, category: cat });
    }

    if (created.length === 0) return res.json({ success: true });

    let msg = `💾 *${created.length} lançamento(s) registrado(s)!*\n\n`;
    const genericDesc = ['comprovante', 'transação', 'pix', 'transferência', 'pagamento'];
    created.forEach((tx, i) => {
      const df = tx.date ? tx.date.split('-').reverse().join('/') : '';
      const isGeneric = !tx.description || genericDesc.includes((tx.description || '').toLowerCase().trim());
      msg += `${i > 0 ? '\n' : ''}${tx.type === 'income' ? '💰' : '💸'} *${tx.type === 'income' ? 'Receita' : 'Despesa'}* — R$ ${tx.amount.toFixed(2)}\n`;
      if (!isGeneric) msg += `📝 ${tx.description}\n`;
      msg += `${catEmojis[tx.category] || '📌'} ${tx.category}${df ? ' | 📅 ' + df : ''}\n`;
    });
    if (created.length === 1) {
      msg += `\n━━━━━━━━━━━━━━━━━━\n🗑️ _Para apagar: *Apagar ${created[0].id}*_\n🤖 *bv.conte — Seu Assistente Financeiro*`;
    } else {
      msg += `\n━━━━━━━━━━━━━━━━━━\n🗑️ _Para apagar, envie: *Apagar [ID]*_\n🤖 *bv.conte — Seu Assistente Financeiro*`;
      created.forEach((tx, i) => { msg += `\n_ID ${i + 1}: ${tx.id}_`; });
    }
    await sendWhatsAppMessage(replyPhone, msg);
    return res.json({ success: true, transaction_ids: created.map(t => t.id) });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────
// Gera ata/resumo via LLM direto (fallback quando função backend 402)
// ─────────────────────────────────────────────────────────────
async function generateMinutesViaLLM(fullText, isStudy) {
  const prompt = isStudy
    ? `Você é um especialista em criar materiais de estudo. Transforme a transcrição abaixo em um resumo de estudo organizado com: título, resumo geral, tópicos principais, conceitos-chave e perguntas de revisão. Formato WhatsApp (use emojis e negrito).\n\nTranscrição:\n${fullText}`
    : `Você é um Secretário Executivo de elite. Transforme a transcrição da reunião abaixo em uma ATA EXECUTIVA com: título, resumo executivo, decisões tomadas, próximos passos com responsáveis e prazos. Linguagem corporativa, hierárquica e concisa. Formato WhatsApp (use emojis e negrito).\n\nTranscrição:\n${fullText}`;

  try {
    const result = await b44.InvokeLLM({
      prompt,
      model: 'claude_sonnet_4_6'
    });
    return typeof result === 'string' ? result : (result?.text || result?.minutes || result?.summary || null);
  } catch (e) {
    console.log('⚠️ Fallback LLM falhou:', e.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  🤖 BV.conte Webhook Externo — ONLINE       ║');
  console.log(`║  📡 Porta: ${PORT}                          ║`);
  console.log('║  🔗 Endpoint: POST /webhook                 ║');
  console.log('╚══════════════════════════════════════════════╝');
});
