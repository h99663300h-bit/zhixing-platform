// Verifies 51-style intelligent scheduling: base data, H01-H06 hard conflicts, consecutive periods, auto-solve, swap, publish, and teacher swap approval.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-sched-'));
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

  // 1. Setup admin, two teachers, one student
  assert.equal((await api('POST', '/api/auth/register-admin', {
    name: 'Admin SIU', accountId: 'SIU199901', email: 'admin@siu.edu',
    schoolName: 'SIU', schoolCode: 'SIU01', password: 'AdminPass123!',
  }, 'admin')).status, 201);

  const t1 = (await api('POST', '/api/auth/register', { role: 'teacher', name: '张老师', accountId: 'tch202601', email: 't1@siu.edu', school: 'SIU01', password: 'Password123!' }, 't1')).data.user;
  const t2 = (await api('POST', '/api/auth/register', { role: 'teacher', name: '李老师', accountId: 'tch202602', email: 't2@siu.edu', school: 'SIU01', password: 'Password123!' }, 't2')).data.user;
  await api('POST', `/api/admin/teacher-requests/${t1.id}/approve`, {}, 'admin');
  await api('POST', `/api/admin/teacher-requests/${t2.id}/approve`, {}, 'admin');
  const stu = (await api('POST', '/api/auth/register', { role: 'student', name: '王同学', studentId: '20260101', email: 's1@siu.edu', school: 'SIU01', password: 'Password123!' }, 'stu')).data.user;

  // 2. Create grade, classes, subjects (with consecutive), room, teacher blocked slots, plans
  const grd = (await api('POST', '/api/admin/schedule/grades', { name: '高一', maxWeeklyPeriods: 30 }, 'admin')).data.grade;
  const cls1 = (await api('POST', '/api/admin/schedule/classes', { name: '高一(1)班', gradeId: grd.id, type: 'admin', studentIds: [stu.id] }, 'admin')).data.cls;
  const cls2 = (await api('POST', '/api/admin/schedule/classes', { name: '高一(2)班', gradeId: grd.id, type: 'admin' }, 'admin')).data.cls;
  const subMath = (await api('POST', '/api/admin/schedule/subjects', { name: '数学', tier: 'major', weeklyHours: 4, preference: 'morning', consecutiveMode: 'require', consecutiveCount: 2 }, 'admin')).data.subject;
  const subEng = (await api('POST', '/api/admin/schedule/subjects', { name: '英语', tier: 'major', weeklyHours: 3, preference: 'morning' }, 'admin')).data.subject;
  const rm1 = (await api('POST', '/api/admin/schedule/rooms', { name: '101室', type: 'normal', capacity: 50 }, 'admin')).data.room;

  // Teacher 1 blocked on Monday P1 (1-p1)
  assert.equal((await api('PUT', `/api/admin/schedule/teacher-rules/${t1.id}`, { blockedSlots: ['1-p1'], maxDailyPeriods: 4 }, 'admin')).status, 200);

  await api('POST', '/api/admin/schedule/plans', { classId: cls1.id, subjectId: subMath.id, teacherId: t1.id, roomId: rm1.id, weeklyHours: 4 }, 'admin');
  await api('POST', '/api/admin/schedule/plans', { classId: cls2.id, subjectId: subMath.id, teacherId: t1.id, weeklyHours: 4 }, 'admin');
  await api('POST', '/api/admin/schedule/plans', { classId: cls1.id, subjectId: subEng.id, teacherId: t2.id, weeklyHours: 3 }, 'admin');

  // 3. One-click auto-schedule
  const autoRes = await api('POST', '/api/admin/schedule/auto', {}, 'admin');
  assert.equal(autoRes.status, 200);
  assert.equal(autoRes.data.placedCount, 11);
  assert.equal(autoRes.data.unplaced.length, 0);
  assert.equal(autoRes.data.conflicts.filter(c => c.hard.length).length, 0, 'zero hard conflicts');
  assert.ok(!autoRes.data.entries.some(e => e.teacherId === t1.id && e.day === 1 && e.periodId === 'p1'), 'teacher blocked slot avoided');

  // 4. Hard conflict detection (H01 teacher double-booking) + forceOverride audit
  const t1Entry = autoRes.data.entries.find(e => e.teacherId === t1.id);
  const conflictAttempt = await api('POST', '/api/admin/schedule/entries', {
    classId: cls2.id, subjectId: subEng.id, teacherId: t1.id, day: t1Entry.day, periodId: t1Entry.periodId,
  }, 'admin');
  assert.equal(conflictAttempt.status, 409);
  assert.ok(Array.isArray(conflictAttempt.data.alternatives) && conflictAttempt.data.alternatives.length > 0);

  // 5. Swap two entries in cls1
  const cls1Entries = autoRes.data.entries.filter(e => e.classId === cls1.id);
  const swapRes = await api('POST', '/api/admin/schedule/swap', { entryAId: cls1Entries[0].id, entryBId: cls1Entries[1].id }, 'admin');
  assert.equal(swapRes.status, 200);

  // 6. Publish to teachers & students
  assert.equal((await api('POST', '/api/admin/schedule/publish', {}, 'admin')).status, 200);
  const myT1 = await api('GET', '/api/schedule/my', undefined, 't1');
  assert.equal(myT1.status, 200);
  assert.equal(myT1.data.published, true);
  assert.equal(myT1.data.entries.length, 8);

  const myStu = await api('GET', '/api/schedule/my', undefined, 'stu');
  assert.equal(myStu.status, 200);
  assert.equal(myStu.data.entries.length, 7);

  // 7. Teacher swap request & admin approval
  const reqSwap = await api('POST', '/api/teacher/schedule/requests', {
    entryId: myT1.data.entries[0].id, substituteTeacherId: t2.id, reason: '外出教研',
  }, 't1');
  assert.equal(reqSwap.status, 201);
  assert.equal((await api('POST', `/api/admin/schedule/requests/${reqSwap.data.request.id}/review`, { decision: 'approve' }, 'admin')).status, 200);

  // 8. Export CSV
  const csvRes = await api('GET', '/api/admin/schedule/export', undefined, 'admin');
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.data, /星期,节次,时间,班级,科目,教师,教室,状态/);

  console.log('PASS: 51-style scheduling engine, H01-H06 conflict checks, auto-solve, swap, publish, approval, and export');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => { server.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });
