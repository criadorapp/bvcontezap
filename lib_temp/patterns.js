// ══════════════════════════════════════════════════════
// Pattern Recognition - Categorização e Filtros
// ══════════════════════════════════════════════════════

// Categorias de despesa (regex - palavras-chave)
const EXPENSE_CATEGORIES = [
  { key: 'alimentacao', regex: /\b(almo[çc]o|jantar|lanche|comida|mercado|supermercado|restaurante|ifood|food|padaria|pao| caf[eé]|\bcafe\b|a[cç]ai|pizza|hamburger|hamb[uú]rguer|salgado|refei[cç][aã]o|cantina|sorvete|lanche|market|empresa aliment[íi]cia|padaria)\b/i },
  { key: 'transporte', regex: /\b(uber|99|t[aá]xi|combust[ií]vel|gasolina|[aá]lcool|etanol|diesel|estacionamento|ped[aá]gio|onibus|[ôo]nibus|metro|metr[ôo]|trem|bilhete [uú]nico|passagem|carro|moto|aluguel de carro|oficina|ipva|licenciamento|revis[aã]o)\b/i },
  { key: 'moradia', regex: /\b(aluguel|condom[ií]nio|ipta?u?|luz|energia|[eé]gua|a[gq]ua|gas|g[aá]s|internet|wifi|wi-fi|tv a cabo|telefonia|telefone fixo|net|oi|claro|vivo|tim|aluguel|hipoteca|financiamento im[oó]vel|m[óo]velis|moveis)\b/i },
  { key: 'saude', regex: /\b(plano de sa[uú]de|medico|m[eé]dico|dentista|hospital|farm[aá]cia|rem[eé]dio|consulta|exame|terapia|psic[oó]logo|psiquiatra|fisioterapia|vacina|lab|laborat[oó]rio|clinica|cl[ií]nica|oftalmo|ortopedia|plano saude|bradesco saude|sulamerica|unimed|am过于|hemo)\b/i },
  { key: 'educacao', regex: /\b(escola|faculdade|curso|faculd|i[nn]stituto|aula|matr[ií]cula|mensalidade|colegio|col[eé]gio|unisinos|universidade|curso online|udemy|alura|curso de|livro|apostila|workshop|treinamento|tutorial|licao|li[cç][aã]o)\b/i },
  { key: 'lazer', regex: /\b(cinema|teatro|show|bar|balada|viagem|passeio|parque|ingresso|jogo|stream|hbo max|netflix|spotify|deezer|amazon prime|globoplay|disney\+|disney plus|youtube premium|jogo digital|game|psn|xbox|nintendo|steam|hobby|diversao|divers[aã]o)\b/i },
  { key: 'outros', regex: /.*/i }
];

// Categorias de receita
const INCOME_CATEGORIES = [
  { key: 'salario', regex: /\b(sal[aá]rio|pagamento|salario|holerite|contra cheque|folio)\b/i },
  { key: 'freelance', regex: /\b(freelance|freela|projeto|prestador|servi[çc]o|consultoria|venda de servi[çc]o|bico|trabalho)\b/i },
  { key: 'investimentos', regex: /\b(investimento|dividendo|juros|rendimento|renda fixa|tesouro|cdb|lci|lca|lc|debenture|fundo|a[cç][õo]es|actions|fiis|fi iis|cripto|bitcoin|renda passiva|aplica[cç][aã]o)\b/i },
  { key: 'outros', regex: /.*/i }
];

// Detectores de intencao (texto cru)
const INTENT_PATTERNS = {
  hasExpense: /\b(gastei|gasto|gasta|despesa|paguei|pago|conta|contas|comprei|compra|comprar|paguei|aluguel|comida|almo[cç]o|jantar)\b/i,
  hasIncome: /\b(recebi|receita|recebi|ganhei|faturei|rende|rendimento|salario|sal[aá]rio|holarite|holerite|pre[pó]o|cobr[ée]\b|cobr[ée]i|cobrado|cobrada|pagamento recebido)\b/i,
  hasDelete: /\b(apagar|excluir|deletar|remover|cancelar)\b/i,
  hasBill: /\b(conta|aluguel|luz|energia|[eé]gua|a[gq]ua|gas|g[aá]s|internet|faculdade|escola|mensalidade|assinatura|plano|fixa|recorrente)\b/i,
  hasReceivable: /\b(a receber|recebimento|pendrar|pendente|futuro|previsto|a vencer|parcelas?|entradas?|futuro pagamento|a pagar|cr[eé]dito|creditos?|me devem|devendo)\b/i,
  hasCurrency: /\b(r\$|reais?|r\$?(0|1|2|3|4|5|6|7|8|9)\d)??\s*[\.,]??\d{0,3}(?:[\.,]\d{1,2})??|^\d+(?:[\.,]\d{1,2})?$/i
};

// Filtro: descarta mensagens do proprio bot
const BOT_RESPONSE_PATTERNS = [
  /^\s*✅/i,
  /^\s*🤖/i,
  /^\s*bv\.conte/i,
  /^\s*resumo/i,
  /^\s*pronto!/i,
  /^\s*anotei/i,
  /^\s*ol[aá]!/i,
  /^\s*oi!/i,
  /^\s*voc[êee]/i,
  /^\s*para come[cç]ar/i,
  /^\s*para finalizar/i,
  /^\s*comando invalido/i,
  /^\s*op[çc][aã]o/i,
  /^\s*t[aá] registrado/i,
  /^\s*t[aá] anotado/i,
  /^\s*j[aá] registrei/i
];

function detectCategory(text) {
  const lower = (text || '').toLowerCase();
  for (const c of EXPENSE_CATEGORIES) {
    if (c.regex.test(lower)) return c.key;
  }
  return 'outros';
}

function detectIncomeCategory(text) {
  const lower = (text || '').toLowerCase();
  for (const c of INCOME_CATEGORIES) {
    if (c.regex.test(lower)) return c.key;
  }
  return 'outros';
}

function isAutoResponse(text) {
  return (text && BOT_RESPONSE_PATTERNS.some(re => re.test(text)));
}

function parseAmount(text) {
  if (!text) return null;
  // Procura padrões de moeda (R$ 1.234,56 / 1234,56 / 1234.56 / 1234)
  const regex = /(?:r\$)?\s*(\d{1,3}(?:\.\d{3})*|\d+)(?:[,](\d{1,2}))?/i;
  const m = text.match(regex);
  if (!m) return null;
  const intPart = m[1].replace(/\./g, '');
  const decimalPart = m[2] ? m[2] : '00';
  const value = parseFloat(`${intPart}.${decimalPart}`);
  return isNaN(value) ? null : value;
}

 module.exports = {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  INTENT_PATTERNS,
  BOT_RESPONSE_PATTERNS,
  detectCategory,
  detectIncomeCategory,
  isAutoResponse,
  parseAmount,
};
