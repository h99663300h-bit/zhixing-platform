// Verifies Teacher Group Fixed No-Class / Research & Meeting Time Reservations.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-tgroup-'));
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

  await api('POST', '/api/auth/register-admin', {
    name: 'Admin SIU', accountId: 'SIU199901', email: 'admin@siu.edu',
    schoolName: 'SIU', schoolCode: 'SIU01', password: 'AdminPass123!',
  }, 'admin');

  const t1 = (await api('POST', '/api/auth/register', { role: 'teacher', name: '林老师', accountId: 'tch202601', email: 't1@siu.edu', school: 'SIU01', password: 'Password123!' }, 't1')).data.user;
  const t2 = (await api('POST', '/api/auth/register', { role: 'teacher', name: '陈老师', accountId: 'tch202602', email: 't2@siu.edu', school: 'SIU01', password: 'Password123!' }, 't2')).data.user;
  await api('POST', `/api/admin/teacher-requests/${t1.id}/approve`, {}, 'admin');
  await api('POST', `/api/admin/teacher-requests/${t2.id}/approve`, {}, 'admin');

  const cls = (await api('POST', '/api/admin/schedule/classes', { name: '高一(1)班', type: 'admin' }, 'admin')).data.cls;
  const sub = (await api('POST', '/api/admin/schedule/subjects', { name: '语文', tier: 'major', weeklyHours: 5 }, 'admin')).data.subject;
  await api('POST', '/api/admin/schedule/plans', { classId: cls.id, subjectId: sub.id, teacherId: t1.id, weeklyHours: 5 }, 'admin');

  // Create teacher group & reserve Wednesday p5, p6 for 语文组教研
  const grp = (await api('POST', '/api/admin/schedule/teacher-groups', { name: '语文教研组', teacherIds: [t1.id, t2.id] }, 'admin')).data.group;
  const blk = (await api('POST', '/api/admin/schedule/group-blocks', {
    groupId: grp.id, day: 3, periodIds: ['p5', 'p6'], cycle: 'weekly', activityType: '教研活动', label: '语文组教研', icon: '🔔', color: '#fef3c7',
  }, 'admin')).data.block;

  // Auto schedule must avoid day 3 p5 & p6 for t1
  const autoRes = await api('POST', '/api/admin/schedule/auto', {}, 'admin');
  assert.equal(autoRes.status, 200);
  assert.ok(!autoRes.data.entries.some(e => e.teacherId === t1.id && e.day === 3 && ['p5', 'p6'].includes(e.periodId)));

  // Manual placement in reserved group slot triggers 409 conflict with group name
  const clash = await api('POST', '/api/admin/schedule/entries', {
    classId: cls.id, subjectId: sub.id, teacherId: t1.id, day: 3, periodId: 'p5',
  }, 'admin');
  assert.equal(clash.status, 409);
  assert.match(clash.data.error, /语文教研组/);

  // Publish & verify teacher's My Timetable receives groupActivities
  await api('POST', '/api/admin/schedule/publish', {}, 'admin');
  const myT1 = await api('GET', '/api/schedule/my', undefined, 't1');
  assert.equal(myT1.status, 200);
  assert.equal(myT1.data.groupActivities.length, 1);
  assert.equal(myT1.data.groupActivities[0].label, '语文组教研');

  // Pausing the block allows scheduling
  assert.equal((await api('PATCH', `/api/admin/schedule/group-blocks/${blk.id}/toggle`, {}, 'admin')).data.block.active, false);
  const okAfterPause = await api('POST', '/api/admin/schedule/entries', {
    classId: cls.id, subjectId: sub.id, teacherId: t1.id, day: 3, periodId: 'p5',
  }, 'admin');
  assert.equal(okAfterPause.status, 200);

  console.log('PASS: teacher group fixed no-class / research & meeting reservations');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => { server.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });
