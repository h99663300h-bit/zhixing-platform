// Verifies admin backup export and non-destructive merge restore.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-backup-'));
process.env.DATA_FILE = path.join(tempDir, 'db.json');
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');

const { server } = require('../server');
const cookies = new Map();
let base = '';

async function api(method, route, body, actor) {
  const headers = {};
  if (actor && cookies.has(actor)) headers.cookie = cookies.get(actor);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(base + route, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (actor && sc) cookies.set(actor, sc.split(';')[0]);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

async function main() {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  base = 'http://127.0.0.1:' + server.address().port;

  // Register admin + student
  assert.equal((await api('POST', '/api/auth/register-admin', {
    name: 'Admin SIU', accountId: 'SIU199901', email: 'admin@siu.edu',
    schoolName: 'SIU', schoolCode: 'SIU01', password: 'AdminPass123!',
  }, 'admin')).status, 201);

  assert.equal((await api('POST', '/api/auth/register', {
    role: 'student', name: 'Existing Stu', studentId: '20260101', email: 's1@siu.edu', school: 'SIU01', password: 'StudentPass123!',
  })).status, 201);

  // Export backup
  const exported = await api('GET', '/api/admin/backup/export', undefined, 'admin');
  assert.equal(exported.status, 200);
  assert.equal(exported.data.schools.length, 1);
  assert.equal(exported.data.users.length, 2);

  // Simulate historical backup containing an extra student and announcement from before redeploy
  const backup = structuredClone(exported.data);
  const oldStu = { ...backup.users[1], id: 'user_legacy_stu_99', name: 'Legacy Student', email: 'legacy@siu.edu', studentId: '20250999', accountId: '20250999' };
  backup.users.push(oldStu);
  backup.announcements.push({
    id: 'ann_legacy_1', schoolId: backup.schools[0].id, category: 'school',
    title: 'Historical Notice', content: 'Preserved across redeploy', authorName: 'Admin SIU',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });

  // Merge backup: existing records skipped, new historical records merged
  const merged = await api('POST', '/api/admin/backup/merge', { backup }, 'admin');
  assert.equal(merged.status, 200);
  assert.equal(merged.data.merged.schools, 0);
  assert.equal(merged.data.merged.users, 1);
  assert.equal(merged.data.merged.announcements, 1);

  // Merged legacy student can log in directly
  const loginRes = await api('POST', '/api/auth/login', { identifier: '20250999', password: 'StudentPass123!' });
  assert.equal(loginRes.status, 200);
  assert.equal(loginRes.data.user.name, 'Legacy Student');

  console.log('PASS: admin backup export and non-destructive merge restore');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => { server.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });
