// Verifies Combined Classes, Smart Student Placement (twins/mutex/balance), and Exam Proctoring (rules + clash avoidance).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-sched-pro-'));
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

  const t1 = (await api('POST', '/api/auth/register', { role: 'teacher', name: '张老师', accountId: 'tch202601', email: 't1@siu.edu', school: 'SIU01', password: 'Password123!' }, 't1')).data.user;
  const t2 = (await api('POST', '/api/auth/register', { role: 'teacher', name: '李老师', accountId: 'tch202602', email: 't2@siu.edu', school: 'SIU01', password: 'Password123!' }, 't2')).data.user;
  const t3 = (await api('POST', '/api/auth/register', { role: 'teacher', name: '王老师', accountId: 'tch202603', email: 't3@siu.edu', school: 'SIU01', password: 'Password123!' }, 't3')).data.user;
  for (const tid of [t1.id, t2.id, t3.id]) await api('POST', `/api/admin/teacher-requests/${tid}/approve`, {}, 'admin');

  // 1. Smart Student Placement (twins bound, same-name mutex, gender/score balance)
  const csv = '\uFEFF姓名,性别,学号,总分,语文,数学,英语,名次,特长标签,绑定组,互斥组,备注\n' +
    '双胞胎A,男,20260001,620,120,135,125,10,信息,twin1,,双胞胎\n' +
    '双胞胎B,女,20260002,615,118,130,128,12,,twin1,,双胞胎\n' +
    '李明1,男,20260003,600,115,125,120,20,体育,,mutex_lm,\n' +
    '李明2,女,20260004,598,114,124,121,22,体育,,mutex_lm,\n' +
    '学生5,男,20260005,580,110,120,115,30,,,\n' +
    '学生6,女,20260006,575,112,118,114,35,,,';
  assert.equal((await api('POST', '/api/admin/schedule/placement/import', { csv }, 'admin')).status, 200);
  const prev = await api('POST', '/api/admin/schedule/placement/preview', { classCount: 2, classPrefix: '高一', mode: 'total', genderBalance: true }, 'admin');
  assert.equal(prev.status, 200);
  const [b1, b2] = prev.data.result;
  // Twins must be in the same class
  const b1Names = new Set(b1.students.map(s => s.name));
  assert.equal(b1Names.has('双胞胎A'), b1Names.has('双胞胎B'), 'twins placed in same class');
  // Mutex students must be in different classes
  assert.notEqual(b1Names.has('李明1'), b1Names.has('李明2'), 'mutex students separated');
  const committed = await api('POST', '/api/admin/schedule/placement/commit', {}, 'admin');
  assert.equal(committed.status, 201);
  const [cls1, cls2] = committed.data.classes;

  // 2. Combined Classes (合班排课)
  const subTech = (await api('POST', '/api/admin/schedule/subjects', { name: '通用技术', tier: 'public', weeklyHours: 2 }, 'admin')).data.subject;
  const subMath = (await api('POST', '/api/admin/schedule/subjects', { name: '数学', tier: 'major', weeklyHours: 2 }, 'admin')).data.subject;
  const hall = (await api('POST', '/api/admin/schedule/rooms', { name: '阶梯教室', type: 'normal', capacity: 120 }, 'admin')).data.room;

  const p1 = (await api('POST', '/api/admin/schedule/plans', { classId: cls1.id, subjectId: subTech.id, teacherId: t1.id, weeklyHours: 2 }, 'admin')).data.plan;
  const p2 = (await api('POST', '/api/admin/schedule/plans', { classId: cls2.id, subjectId: subTech.id, teacherId: t1.id, weeklyHours: 2 }, 'admin')).data.plan;
  const p3 = (await api('POST', '/api/admin/schedule/plans', { classId: cls1.id, subjectId: subMath.id, teacherId: t2.id, weeklyHours: 2 }, 'admin')).data.plan;

  // Reject combining different teachers/subjects
  assert.equal((await api('POST', '/api/admin/schedule/combined', { planIds: [p1.id, p3.id] }, 'admin')).status, 400);
  const comb = await api('POST', '/api/admin/schedule/combined', { planIds: [p1.id, p2.id], shortName: '高一1+2班/通用技术', roomId: hall.id }, 'admin');
  assert.equal(comb.status, 201);

  const autoRes = await api('POST', '/api/admin/schedule/auto', {}, 'admin');
  assert.equal(autoRes.status, 200);
  const grpEntries = autoRes.data.entries.filter(e => e.groupId === comb.data.group.id);
  assert.equal(grpEntries.length, 4); // 2 weekly hours * 2 classes
  const c1First = grpEntries.find(e => e.classId === cls1.id);
  const c2Match = grpEntries.find(e => e.classId === cls2.id && e.day === c1First.day && e.periodId === c1First.periodId);
  assert.ok(c2Match, 'combined class scheduled in identical slot across both classes');

  // 3. Exam Proctoring (监考安排)
  const examRes = await api('POST', '/api/admin/schedule/exams', {
    name: '期中考试',
    slots: [
      { dateLabel: '第1场', startTime: '08:30', endTime: '10:30', dayOfWeek: c1First.day, periodId: c1First.periodId, subjectId: subMath.id, subjectName: '数学' },
    ],
    rooms: [
      { name: cls1.name, classId: cls1.id, capacity: 40 },
      { name: cls2.name, classId: cls2.id, capacity: 40 },
    ],
    teacherIds: [t1.id, t2.id, t3.id],
    rules: { taughtClass: 'avoid', taughtSubject: 'avoid', proctorsPerRoom: 1 },
  }, 'admin');
  assert.equal(examRes.status, 201);
  const proRes = await api('POST', `/api/admin/schedule/exams/${examRes.data.exam.id}/auto`, {}, 'admin');
  assert.equal(proRes.status, 200);
  // t1 is teaching combined class at (c1First.day, c1First.periodId) -> MUST NOT be assigned as proctor in that slot!
  const assignedIds = proRes.data.assignments.flatMap(a => a.teacherIds);
  assert.ok(!assignedIds.includes(t1.id), 'teacher teaching a class at exam slot is excluded from proctoring');
  assert.equal(new Set(assignedIds).size, 2, 'two distinct proctors assigned to two rooms');

  console.log('PASS: Combined Classes, Smart Student Placement, and Exam Proctoring');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => { server.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });
