// Verifies admin course creation, multi-teacher assignment, enrollment stats, and course deletion.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-admin-courses-'));
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

  assert.equal((await api('POST', '/api/auth/register-admin', {
    name: 'Admin SIU', accountId: 'SIU199901', email: 'admin@siu.edu',
    schoolName: 'SIU', schoolCode: 'SIU01', password: 'AdminPass123!',
  }, 'admin')).status, 201);

  const t1 = (await api('POST', '/api/auth/register', { role: 'teacher', name: 'Teacher One', accountId: 'tch202601', email: 't1@siu.edu', school: 'SIU01', password: 'Password123!' }, 't1')).data.user;
  const t2 = (await api('POST', '/api/auth/register', { role: 'teacher', name: 'Teacher Two', accountId: 'tch202602', email: 't2@siu.edu', school: 'SIU01', password: 'Password123!' }, 't2')).data.user;
  await api('POST', `/api/admin/teacher-requests/${t1.id}/approve`, {}, 'admin');
  await api('POST', `/api/admin/teacher-requests/${t2.id}/approve`, {}, 'admin');
  await api('PATCH', `/api/admin/users/${t1.id}/department`, { department: '计算机学院' }, 'admin');
  await api('PATCH', `/api/admin/users/${t2.id}/department`, { department: '数学学院' }, 'admin');

  const stu = (await api('POST', '/api/auth/register', { role: 'student', name: 'Student A', studentId: '20260101', email: 's1@siu.edu', school: 'SIU01', password: 'Password123!' }, 'stu')).data.user;
  assert.ok(stu.id);

  // Admin creates a course with two co-teachers
  const created = await api('POST', '/api/admin/courses', {
    title: '联合授课 AI', category: 'CS', description: 'Co-taught course',
    enrollmentCode: 'AI-CO-01', teacherIds: [t1.id, t2.id],
  }, 'admin');
  assert.equal(created.status, 201);
  const courseId = created.data.course.id;
  assert.deepEqual(created.data.course.teacherIds, [t1.id, t2.id]);

  // Admin can run the full teacher course workflow (lessons, quiz, assignments, announcements)
  assert.equal((await api('POST', `/api/courses/${courseId}/lessons`, { title: 'Unit 1 by Admin', type: 'reading', content: 'Intro' }, 'admin')).status, 201);
  assert.equal((await api('PUT', `/api/courses/${courseId}/quiz`, { questions: [{ text: 'Q1?', options: ['A','B','C','D'], correctIndex: 0 }] }, 'admin')).status, 200);
  assert.equal((await api('POST', `/api/courses/${courseId}/assignments`, { title: 'HW1', description: 'Do HW1', maxScore: 100 }, 'admin')).status, 201);
  assert.equal((await api('POST', `/api/courses/${courseId}/announcements`, { title: 'Admin Course Notice', content: 'Syllabus' }, 'admin')).status, 201);

  // Both co-teachers can manage the course
  assert.equal((await api('POST', `/api/courses/${courseId}/announcements`, { title: 'T2 Notice', content: 'Welcome' }, 't2')).status, 201);
  assert.equal((await api('GET', '/api/teacher/overview', undefined, 't2')).data.courses.length, 1);

  // Student enrolls and admin overview reflects studentCount + departments
  assert.equal((await api('POST', '/api/courses/enroll-by-code', { code: 'AI-CO-01' }, 'stu')).status, 200);
  const ov = await api('GET', '/api/admin/overview', undefined, 'admin');
  assert.equal(ov.status, 200);
  assert.equal(ov.data.courses.length, 1);
  assert.equal(ov.data.courses[0].studentCount, 1);
  assert.deepEqual(new Set(ov.data.courses[0].departments), new Set(['计算机学院', '数学学院']));
  assert.equal(ov.data.courses[0].enrolledStudents[0].name, 'Student A');

  // Admin updates and deletes course
  assert.equal((await api('PATCH', `/api/admin/courses/${courseId}`, { title: '联合授课 AI 2', teacherIds: [t1.id] }, 'admin')).status, 200);
  assert.equal((await api('DELETE', `/api/admin/courses/${courseId}`, undefined, 'admin')).status, 200);
  assert.equal((await api('GET', '/api/admin/overview', undefined, 'admin')).data.courses.length, 0);

  // Deactivate, restore, and permanently delete a resigned instructor
  assert.equal((await api('DELETE', `/api/admin/teachers/${t2.id}`, undefined, 'admin')).status, 200);
  assert.equal((await api('POST', `/api/admin/teachers/${t2.id}/restore`, undefined, 'admin')).status, 200);
  assert.equal((await api('DELETE', `/api/admin/teachers/${t2.id}`, undefined, 'admin')).status, 200);
  assert.equal((await api('DELETE', `/api/admin/teachers/${t2.id}/permanent`, undefined, 'admin')).status, 200);
  assert.ok(!(await api('GET', '/api/admin/overview', undefined, 'admin')).data.teachers.some(t => t.id === t2.id));

  console.log('PASS: admin course management, multi-teacher assignment, department metadata, and enrollment count');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => { server.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });
