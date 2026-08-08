// ══════════════════════════════════════════════════════
// Padrões de detecção (portado do wasenderWebhook original)
// ══════════════════════════════════════════════════════

const expensePatterns = {
  alimentacao: /gastei|paguei|comprei|mercado|comida|café|lanch|almoç|jant|refeiç|restaurante|pizzaria|hambúrger|fastfood|delivery|ifood|rappi/i,
  transporte: /uber|99|taxi|táxi|passagem|ônibus|metrô|gasolina|combustível|estacionamento|pedágio|carro|moto/i,
  moradia: /aluguel|IPTU|condomínio|água|luz|gás|telefone|internet|fibra|reforma|pintura/i,
  saude: /farmácia|farmacia|remédio|medicamento|médico|dentista|consulta|exame|vacina|hospital|clínica|óculos/i,
  educacao: /curso|aula|faculdade|universidade|escola|livro|apostila|material|mensalidade/i,
  lazer: /cinema|filme|teatro|show|música|jogo|videogame|game|piscina|academia|musculação|diversão/i,
  investimentos: /investimento|bolsa|ações|cripto|bitcoin|fundo|tesouro|dividendo|resgate/i
};

const incomePatterns = {
  salario: /salário|salario|vencimento|pagamento|holerite|folha|depósito/i,
  trabalho_extra: /bico|gig|trabalho extra|trabalho_extra|extra|renda extra|consultoria|freelance|por conta|por fora|job/i,
  investimentos: /investimento|resgate|dividendo|rendimento|bolsa|ações/i
};

function detectCategoryFromText(text, isIncome) {
  const patterns = isIncome ? incomePatterns : expensePatterns;
  for (const [category, pattern] of Object.entries(patterns)) {
    if (pattern.test(text)) return category;
  }
  return 'outros';
}

// Filtro pré-LLM: bloqueia msgs sem intenção financeira
function hasFinancialIntent(text) {
  if (!text || !text.trim()) return false;
  const hasNumber = /\d|um|dois|tr[eê]s|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|vinte|trinta|quarenta|cinquenta|cem|duzentos|trezentos|quinhentos|mil/i.test(text);
  const hasFinancialVerb = /gastei|paguei|comprei|recebi|ganhei|caiu|entrou|tirei|desembolsei|fiz|abasteci|custou|custa|vale|valeu|investei|deposite|depositei|transferi|mandei|enviei/i.test(text);
  const hasFinancialNoun = /reais|real|r\$|dinheiro|grana|salário|salario|freelance|bico|aluguel|mercado|supermercado|farmácia|farmacia|gasolina|conta|boleto|parcela|dividendo|lucro/i.test(text);
  if (text.trim().length <= 20 && !hasNumber) return false;
  return hasNumber || hasFinancialVerb || hasFinancialNoun;
}

// Padrões de mensagens geradas pelo próprio bot (para ignorar)
const botPatterns = [
  /^✅/, /^❌/, /^⏰/, /^🔑/,
  /despesa registrada/i, /receita registrada/i, /lançamentos registrados/i,
  /correção registrada/i, /se precisar de mais/i, /ID Parcela/i,
  /^Despesa:/m, /^Receita:/m, /^Valor: R\$/m, /^Categoria:/m,
  /Registrado via WhatsApp/i, /Bem-vindo ao.*BV/i
];

function isBotMessage(text) {
  return botPatterns.some(p => p.test(text));
}

module.exports = {
  expensePatterns,
  incomePatterns,
  detectCategoryFromText,
  hasFinancialIntent,
  isBotMessage,
};
