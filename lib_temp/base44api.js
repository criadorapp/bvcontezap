// ══════════════════════════════════════════════════════
// Base44 REST API Client
// Substitui o SDK nativo da Base44 por chamadas HTTP fetch
// ══════════════════════════════════════════════════════

const BASE44_API_BASE = 'https://api.base44.com/api/apps';
const APP_ID = process.env.BASE44_APP_ID;
const API_TOKEN = process.env.BASE44_API_TOKEN;

if (!APP_ID || !API_TOKEN) {
  console.error('❌ BASE44_APP_ID ou BASE44_API_TOKEN não configurados!');
}

function authHeaders() {
  return {
    'Authorization': `Bearer ${API_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

// Lista registros de uma entidade (com sort e limit opcionais)
async function listEntities(entityName, sort, limit) {
  let url = `${BASE44_API_BASE}/${APP_ID}/entities/${entityName}`;
  const params = new URLSearchParams();
  if (sort) params.append('sort', sort);
  if (limit) params.append('limit', String(limit));
  const qs = params.toString();
  if (qs) url += `?${qs}`;

  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Base44 list ${entityName} ${res.status}: ${txt}`);
  }
  const data = await res.json();
  // A API pode retornar { data: [...] } ou [...]
  return Array.isArray(data) ? data : (data.data || data.items || []);
}

// Filtra registros de uma entidade (query MongoDB-style)
async function filterEntities(entityName, query, sort, limit) {
  let url = `${BASE44_API_BASE}/${APP_ID}/entities/${entityName}/filter`;
  const params = new URLSearchParams();
  if (sort) params.append('sort', sort);
  if (limit) params.append('limit', String(limit));
  const qs = params.toString();
  if (qs) url += `?${qs}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ query })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Base44 filter ${entityName} ${res.status}: ${txt}`);
  }
  const data = await res.json();
  return Array.isArray(data) ? data : (data.data || data.items || []);
}

// Busca um registro por ID
async function getEntity(entityName, id) {
  const url = `${BASE44_API_BASE}/${APP_ID}/entities/${entityName}/${id}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Base44 get ${entityName} ${res.status}: ${txt}`);
  }
  return res.json();
}

// Cria um registro
async function createEntity(entityName, data) {
  const url = `${BASE44_API_BASE}/${APP_ID}/entities/${entityName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ data })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Base44 create ${entityName} ${res.status}: ${txt}`);
  }
  return res.json();
}

// Atualiza um registro
async function updateEntity(entityName, id, data) {
  const url = `${BASE44_API_BASE}/${APP_ID}/entities/${entityName}/${id}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ data })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Base44 update ${entityName} ${res.status}: ${txt}`);
  }
  return res.json();
}

// Deleta um registro
async function deleteEntity(entityName, id) {
  const url = `${BASE44_API_BASE}/${APP_ID}/entities/${entityName}/${id}`;
  const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Base44 delete ${entityName} ${res.status}: ${txt}`);
  }
  return res.json();
}

// Invoca uma função backend da Base44 (ex: generateMeetingMinutes, generateMeetingDocument)
// NOTA: funções backend ainda exigem plano Builder+ — pode falhar com 402.
// Use apenas para features que não dependem do plano gratuito.
async function invokeFunction(functionName, payload) {
  const url = `${BASE44_API_BASE}/${APP_ID}/functions/${functionName}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Base44 invokeFunction ${functionName} ${res.status}: ${txt}`);
  }
  return res.json();
}

// Invoca uma integração Core (InvokeLLM, UploadFile, etc.)
async function invokeIntegration(integration, endpoint, payload) {
  const url = `${BASE44_API_BASE}/${APP_ID}/integrations/${integration}/${endpoint}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Base44 integration ${integration}.${endpoint} ${res.status}: ${txt}`);
  }
  return res.json();
}

// Upload de arquivo para Base44
async function uploadFile(fileBuffer, filename, mimeType) {
  const url = `${BASE44_API_BASE}/${APP_ID}/files/upload`;
  const boundary = '----FormBoundary' + Math.random().toString(16).slice(2);
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([
    Buffer.from(header, 'utf8'),
    Buffer.from(fileBuffer),
    Buffer.from(footer, 'utf8')
  ]);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_TOKEN}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`
    },
    body
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Base44 uploadFile ${res.status}: ${txt}`);
  }
  return res.json();
}

module.exports = {
  listEntities,
  filterEntities,
  getEntity,
  createEntity,
  updateEntity,
  deleteEntity,
  invokeFunction,
  invokeIntegration,
  uploadFile,
  // Atalhos por entidade
  Subscription: {
    list: (sort, limit) => listEntities('Subscription', sort, limit),
    filter: (query, sort, limit) => filterEntities('Subscription', query, sort, limit),
  },
  Transaction: {
    list: (sort, limit) => listEntities('Transaction', sort, limit),
    filter: (query, sort, limit) => filterEntities('Transaction', query, sort, limit),
    get: (id) => getEntity('Transaction', id),
    create: (data) => createEntity('Transaction', data),
    update: (id, data) => updateEntity('Transaction', id, data),
    delete: (id) => deleteEntity('Transaction', id),
  },
  Bill: {
    list: (sort, limit) => listEntities('Bill', sort, limit),
    filter: (query, sort, limit) => filterEntities('Bill', query, sort, limit),
    get: (id) => getEntity('Bill', id),
    create: (data) => createEntity('Bill', data),
    update: (id, data) => updateEntity('Bill', id, data),
    delete: (id) => deleteEntity('Bill', id),
  },
  Receivable: {
    list: (sort, limit) => listEntities('Receivable', sort, limit),
    filter: (query, sort, limit) => filterEntities('Receivable', query, sort, limit),
    get: (id) => getEntity('Receivable', id),
    create: (data) => createEntity('Receivable', data),
    update: (id, data) => updateEntity('Receivable', id, data),
    delete: (id) => deleteEntity('Receivable', id),
  },
  MeetingSession: {
    list: (sort, limit) => listEntities('MeetingSession', sort, limit),
    filter: (query, sort, limit) => filterEntities('MeetingSession', query, sort, limit),
    create: (data) => createEntity('MeetingSession', data),
    update: (id, data) => updateEntity('MeetingSession', id, data),
  },
  Meeting: {
    list: (sort, limit) => listEntities('Meeting', sort, limit),
    filter: (query, sort, limit) => filterEntities('Meeting', query, sort, limit),
    create: (data) => createEntity('Meeting', data),
  },
  // Integrações Core
  InvokeLLM: (payload) => invokeIntegration('Core', 'InvokeLLM', payload),
  UploadFileViaIntegration: (payload) => invokeIntegration('Core', 'UploadFile', payload),
};
