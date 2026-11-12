// Zero-dependency S3-compatible object storage (Cloudflare R2, AWS S3, Backblaze B2, MinIO) using AWS Signature V4.
const crypto = require('node:crypto');

function getConfig() {
  const endpoint = (process.env.S3_ENDPOINT || '').trim().replace(/\/+$/, '');
  const bucket = (process.env.S3_BUCKET || '').trim();
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY || '').trim();
  const region = (process.env.S3_REGION || 'auto').trim();
  const dbKey = (process.env.S3_DB_KEY || '_db/platform.json').trim().replace(/^\/+/, '');
  const enabled = Boolean(endpoint && bucket && accessKeyId && secretAccessKey);
  return { enabled, endpoint, bucket, accessKeyId, secretAccessKey, region, dbKey };
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function encodeS3Path(key) {
  return key.split('/').map(seg => encodeURIComponent(seg)).join('/');
}

function signRequest(method, key, body = Buffer.alloc(0), contentType = '') {
  const cfg = getConfig();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const urlObj = new URL(`${cfg.endpoint}/${cfg.bucket}/${encodeS3Path(key)}`);
  const payloadHash = sha256Hex(body);
  const headers = {
    host: urlObj.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (contentType) headers['content-type'] = contentType;
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map(k => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = sortedKeys.join(';');
  const canonicalRequest = [method, urlObj.pathname, urlObj.search ? urlObj.search.slice(1) : '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, cfg.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: urlObj.toString(), headers };
}

async function putObject(key, data, contentType = 'application/octet-stream') {
  const cfg = getConfig();
  if (!cfg.enabled) return false;
  const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
  const { url, headers } = signRequest('PUT', key, body, contentType);
  const res = await fetch(url, { method: 'PUT', headers, body });
  if (!res.ok) throw new Error(`S3 PUT ${key} failed (${res.status})`);
  return true;
}

async function getObject(key) {
  const cfg = getConfig();
  if (!cfg.enabled) return null;
  const { url, headers } = signRequest('GET', key);
  const res = await fetch(url, { method: 'GET', headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`S3 GET ${key} failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

async function deleteObject(key) {
  const cfg = getConfig();
  if (!cfg.enabled) return false;
  const { url, headers } = signRequest('DELETE', key);
  const res = await fetch(url, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE ${key} failed (${res.status})`);
  return true;
}

module.exports = { getConfig, putObject, getObject, deleteObject };
