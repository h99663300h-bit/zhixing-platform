// Small SMTP sender for password-reset mail. Configured by SMTP_HOST, SMTP_PORT,
// SMTP_USER, SMTP_PASS, SMTP_FROM, and PUBLIC_BASE_URL. No third-party packages.
const net = require('node:net');
const tls = require('node:tls');

function configured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM && process.env.PUBLIC_BASE_URL && (process.env.SMTP_USER ? process.env.SMTP_PASS : true));
}
function cleanAddress(value) {
  const text = String(value || '').trim();
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(text)) throw new Error('Invalid SMTP address');
  return text;
}
function line(text) { return String(text).replace(/[\r\n]/g, ' '); }
function waitLine(socket, timeout = 12000) {
  return new Promise((resolve, reject) => {
    let buffer = ''; let code = '';
    const timer = setTimeout(() => finish(new Error('SMTP timed out')), timeout);
    function finish(error, result) { clearTimeout(timer); socket.off('data', onData); socket.off('error', onError); socket.off('close', onClose); error ? reject(error) : resolve(result); }
    function onError(error) { finish(error); }
    function onClose() { finish(new Error('SMTP connection closed')); }
    function onData(chunk) {
      buffer += chunk.toString('utf8');
      if (buffer.length > 64 * 1024) return finish(new Error('SMTP response too large'));
      const rows = buffer.split('\r\n');
      buffer = rows.pop();
      for (const row of rows) {
        if (!/^\d{3}[ -]/.test(row)) continue;
        code = row.slice(0, 3);
        if (row[3] === ' ') return finish(null, { code: Number(code), text: row });
      }
    }
    socket.on('data', onData); socket.once('error', onError); socket.once('close', onClose);
  });
}
async function command(socket, value, expected) {
  const waiting = waitLine(socket);
  socket.write(value + '\r\n');
  const answer = await waiting;
  if (!expected.includes(answer.code)) throw new Error('SMTP rejected a command: ' + answer.code);
  return answer;
}
async function sendResetEmail(recipient, token) {
  if (!configured()) throw new Error('SMTP is not configured');
  const host = String(process.env.SMTP_HOST).trim();
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SMTP port');
  const from = cleanAddress(process.env.SMTP_FROM);
  const to = cleanAddress(recipient);
  const secure = process.env.SMTP_SECURE === '1' || port === 465;
  let socket = secure ? tls.connect({ host, port, servername: host, rejectUnauthorized: true }) : net.connect({ host, port });
  const ready = waitLine(socket);
  try {
    const greeting = await ready;
    if (greeting.code !== 220) throw new Error('SMTP greeting failed');
    await command(socket, 'EHLO localhost', [250]);
    if (!secure && process.env.SMTP_ALLOW_PLAINTEXT !== '1') {
      await command(socket, 'STARTTLS', [220]);
      socket = tls.connect({ socket, servername: host, rejectUnauthorized: true });
      await new Promise((resolve, reject) => { socket.once('secureConnect', resolve); socket.once('error', reject); });
      await command(socket, 'EHLO localhost', [250]);
    }
    if (process.env.SMTP_USER) {
      await command(socket, 'AUTH LOGIN', [334]);
      await command(socket, Buffer.from(process.env.SMTP_USER).toString('base64'), [334]);
      await command(socket, Buffer.from(process.env.SMTP_PASS).toString('base64'), [235]);
    }
    await command(socket, 'MAIL FROM:<' + from + '>', [250]);
    await command(socket, 'RCPT TO:<' + to + '>', [250, 251]);
    await command(socket, 'DATA', [354]);
    const base = new URL(process.env.PUBLIC_BASE_URL);
    if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Password-reset links require HTTPS');
    base.pathname = '/';
    base.search = '';
    base.hash = '';
    base.searchParams.set('reset', token);
    const body = [
      'From: ' + from, 'To: ' + to, 'Subject: Reset your Zhixing Learning password',
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '',
      'Use this link to set a new password. It expires in 30 minutes:',
      base.toString(), '', 'If you did not ask for a reset, ignore this email.'
    ].map(line).join('\r\n');
    await command(socket, body.replace(/(^|\r\n)\./g, '$1..') + '\r\n.', [250]);
    try { await command(socket, 'QUIT', [221]); } catch {}
  } finally { socket.destroy(); }
}
module.exports = { configured, sendResetEmail };
