// Verifies unified login (accountId or email) and role-specific accountId registration rules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-unified-auth-'));
process.env.DATA_FILE = path.join(tempDir, 'db.json');
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');

const { server } = require('../server');
let base = '';

async function api(method, route, body) {
  const response = await fetch(base + route, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

async function main() {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  base = 'http://127.0.0.1:' + server.address().port;

  // 1. Student registration: pure digits only
  assert.equal((await api('POST', '/api/auth/register', { role: 'student', name: 'Bad Stu', email: 'badstu@example.edu', accountId: 'STU202601', password: 'Password123!' })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { role: 'student', name: 'Bad Stu 2', email: 'badstu2@example.edu', accountId: 'tch202601', password: 'Password123!' })).status, 400);
  const stu = await api('POST', '/api/auth/register', { role: 'student', name: 'Student One', email: 'stu1@example.edu', accountId: '20260101', password: 'Password123!' });
  assert.equal(stu.status, 201);
  assert.equal(stu.data.user.accountId, '20260101');
  assert.equal(stu.data.user.studentId, '20260101');

  // 2. Teacher registration: tch prefix + digits
  assert.equal((await api('POST', '/api/auth/register', { role: 'teacher', name: 'Bad Tch', email: 'badtch@example.edu', accountId: '20260102', password: 'Password123!' })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { role: 'teacher', name: 'Bad Tch 2', email: 'badtch2@example.edu', accountId: 'sch202601', password: 'Password123!' })).status, 400);
  const tch = await api('POST', '/api/auth/register', { role: 'teacher', name: 'Teacher One', email: 'tch1@example.edu', accountId: 'TCH202601', password: 'Password123!' });
  assert.equal(tch.status, 201);
  assert.equal(tch.data.user.accountId, 'tch202601');
  assert.equal(tch.data.user.studentId, null);

  // 3. Admin registration: sch prefix + digits
  assert.equal((await api('POST', '/api/auth/register-admin', { name: 'Bad Adm', email: 'badadm@example.edu', accountId: '199901SIU', schoolName: 'School X', password: 'Password123!' })).status, 400);
  const adm = await api('POST', '/api/auth/register-admin', { name: 'Admin One', email: 'adm1@example.edu', accountId: 'siu199901', schoolName: 'Zhixing High', schoolCode: 'ZX2026', password: 'Password123!' });
  assert.equal(adm.status, 201);
  assert.equal(adm.data.user.accountId, 'SIU199901');
  assert.equal(adm.data.user.role, 'admin');

  // 4. Duplicate accountId rejected
  assert.equal((await api('POST', '/api/auth/register', { role: 'teacher', name: 'Dup Tch', email: 'duptch@example.edu', accountId: 'tch202601', password: 'Password123!' })).status, 409);

  // 5. Unified login works with accountId AND email for all 3 roles
  for (const [identifier, expectedRole] of [
    ['20260101', 'student'],
    ['stu1@example.edu', 'student'],
    ['tch202601', 'teacher'],
    ['TCH202601', 'teacher'],
    ['tch1@example.edu', 'teacher'],
    ['SIU199901', 'admin'],
    ['siu199901', 'admin'],
    ['adm1@example.edu', 'admin'],
  ]) {
    const res = await api('POST', '/api/auth/login', { identifier, password: 'Password123!' });
    assert.equal(res.status, 200, `login failed for ${identifier}`);
    assert.equal(res.data.user.role, expectedRole);
  }

  console.log('PASS: unified login (accountId/email) and role-specific accountId registration rules');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => { server.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });
