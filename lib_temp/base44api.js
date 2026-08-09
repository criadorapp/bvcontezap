// ══════════════════════════════════════════════════════
// Base44 REST API Client
// ══════════════════════════════════════════════════════

const BASE44_API_BASE = 'https://api.base44.com/api/apps';
const APP_ID = process.env.BASE44_APP_ID;
const API_TOKEN = process.env.BASE44_API_TOKEN;

if (!APP_ID || !API_TOKEN) console.error('❌ BASE44_APP_ID ou BASE44_API_TOKEN não configurados!');

function authHeaders() {
  return { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' };
}

async function listEntities(entityName, sort, limit) {
  let url = `${BASE44_API_BASE}/${APP_ID}/entities/${entityName}`;
  const params = new URLSearchParams();
  if (sort) params.append('sort', sort);
  if (limit) params.append('limit', String(limit));
  const qs = params.toString(); if (qs) url += `?${qs}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) { const txt = await res.text(); throw new Error(`Base44 list ${entityName} ${res.status}: ${txt}`); }
  const data = await res.json();
  return Array.isArray(data) ? data : (data.data || data.items || []);
}

async function filterEntities(entityName, query, sort, limit) {
  let url = `${BASE44_API_BASE}/${APP_ID}/entities/${entityName}/filter`;
  const params = new URLSearchParams();
  if (sort) params.append('sort', sort);
  if (limit) params.append('limit', String(limit));
  const qs = params.toString(); if (qs) url += `?${qs}`;
  const res = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ query }) });
  if (!res.ok) { const txt = await res.text(); throw new Error(`Base44 filter ${entityName} ${res.status}: ${txt}`); }
  const data = await res.json();
  return Array.isArray(data) ? data : (data.data || data.items || []);
}

async function getEntity(entityName, id) {
  const res = await fetch(`${BASE44_API_BASE}/${APP_ID}/entities/${entityName}/${id}`, { headers: authHeaders() });
  if (!res.ok) { const txt = await res.text(); throw new Error(`Base44 get ${entityName} ${res.status}: ${txt}`); }
  return res.json();
}

async function createEntity(entityName, data) {
  const res = await fetch(`${BASE44_API_BASE}/${APP_ID}/entities/${entityName}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ data }) });
  if (!res.ok) { const txt = await res.text(); throw new Error(`Base44 create ${entityName} ${res.status}: ${txt}`); }
  return res.json();
}

async function updateEntity(entityName, id, data) {
  const res = await fetch(`${BASE44_API_BASE}/${APP_ID}/entities/${entityName}/${id}`, { method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ data }) });
  if (!res.ok) { const txt = await res.text(); throw new Error(`Base44 update ${entityName} ${res.status}: ${txt}`); }
  return res.json();
}

async function deleteEntity(entityName, id) {
  const res = await fetch(`${BASE44_API_BASE}/${APP_ID}/entities/${entityName}/${id}`, { method: 'DELETE', headers: authHeaders() });
  if (!res.ok) { const txt = await res.text(); throw new Error(`Base44 delete ${entityName} ${res.status}: ${txt}`); }
  return res.json();
}

async function invokeFunction(functionName, payload) {
  const res = await fetch(`${BASE44_API_BASE}/${APP_ID}/functions/${functionName}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  if (!res.ok) { const txt = await res.text(); throw new Error(`Base44 invokeFunction ${functionName} ${res.status}: ${txt}`); }
  return res.json();
}

async function invokeIntegration(integration, endpoint, payload) {
  const res = await fetch(`${BASE44_API_BASE}/${APP_ID}/integrations/${integration}/${endpoint}`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(payload) });
  if (!res.ok) { const txt = await res.text(); throw new Error(`Base44 integration ${integration}.${endpoint} ${res.status}: ${txt}`); }
  return res.json();
}

async function uploadFile(fileBuffer, filename, mimeType) {
  const url = `${BASE44_API_BASE}/${APP_ID}/files/upload`;
  const boundary = '----FormBoundary' + Math.random().toString(16).slice(2);
  const header = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const body = Buffer.concat([Buffer.from(header, 'utf8'), Buffer.from(fileBuffer), Buffer.from(footer, 'utf8')]);
  const res = await fetch(url, { method: 'POST', headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` }, body });
  if (!res.ok) { const txt = await res.text(); throw new Error(`Base44 uploadFile ${res.status}: ${txt}`); }
  return res.json();
}

module.exports = {
  listEntities, filterEntities, getEntity, createEntity, updateEntity, deleteEntity, invokeFunction, invokeIntegration, uploadFile,
  Subscription: { list: (sort, limit) => listEntities('Subscription', sort, limit), filter: (q, s, l) => filterEntities('Subscription', q, s, l) },
  Transaction: { list: (s, l) => listEntities('Transaction', s, l), filter: (q, s, l) => filterEntities('Transaction', q, s, l), get: (id) => getEntity('Transaction', id), create: (d) => createEntity('Transaction', d), update: (i, d) => updateEntity('Transaction', i, d), delete: (id) => deleteEntity('Transaction', id) },
  Bill: { list: (s, l) => listEntities('Bill', s, l), filter: (q, s, l) => filterEntities('Bill', q, s, l), get: (id) => getEntity('Bill', id), create: (d) => createEntity('Bill', d), update: (i, d) => updateEntity('Bill', i, d), delete: (id) => deleteEntity('Bill', id) },
  Receivable: { list: (s, l) => listEntities('Receivable', s, l), filter: (q, s, l) => filterEntities('Receivable', q, s, l), get: (id) => getEntity('Receivable', id), create: (d) => createEntity('Receivable', d), update: (i, d) => updateEntity('Receivable', i, d), delete: (id) => deleteEntity('Receivable', id) },
  MeetingSession: { list: (s, l) => listEntities('MeetingSession', s, l), filter: (q, s, l) => filterEntities('MeetingSession', q, s, l), create: (d) => createEntity('MeetingSession', d), update: (i, d) => updateEntity('MeetingSession', i, d) },
  Meeting: { list: (s, l) => listEntities('Meeting', s, l), filter: (q, s, l) => filterEntities('Meeting', q, s, l), create: (d) => createEntity('Meeting', d) },
  InvokeLLM: (payload) => invokeIntegration('Core', 'InvokeLLM', payload),
  UploadFileViaIntegration: (payload) => invokeIntegration('Core', 'UploadFile', payload),
};
