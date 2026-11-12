// Isolated teacher self-registration, course ownership, code enrollment and privacy regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-teacher-signup-'));
process.env.DATA_FILE = path.join(temp, 'platform.json');
delete process.env.DEMO_SEED;
const { server } = require('../server');
const cookies = new Map();
let base;
async function api(method, route, body, actor) {
  const headers = {};
  if (actor && cookies.has(actor)) headers.cookie = cookies.get(actor);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (actor && response.headers.has('set-cookie')) cookies.set(actor, response.headers.get('set-cookie').split(';')[0]);
  return { status: response.status, data: await response.json() };
}
async function run() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await api('GET', '/api/courses')).data.courses.length, 0, 'fresh site has no public demo teacher or courses');
  const first = await api('POST', '/api/auth/register', { role: 'teacher', accountId: 'tch202601', name: '教师甲', email: 'teacher.one@example.edu', password: 'StrongPass123!' }, 'teacher1');
  assert.equal(first.status, 201);
  assert.equal(first.data.user.role, 'teacher');
  assert.equal(first.data.user.studentId, null);
  assert.equal((await api('POST', '/api/auth/register', { role: 'teacher', accountId: 'tch202603', name: '重复', email: 'teacher.one@example.edu', password: 'StrongPass123!' })).status, 409);
  assert.equal((await api('POST', '/api/auth/register', { role: 'admin', name: '非法身份', email: 'admin@example.edu', password: 'StrongPass123!' })).status, 400);
  assert.equal((await api('POST', '/api/auth/register', { role: 'teacher', name: '非法学号', email: 'bad@example.edu', studentId: 'TEST123', password: 'StrongPass123!' })).status, 400);
  const second = await api('POST', '/api/auth/register', { role: 'teacher', accountId: 'tch202602', name: '教师乙', email: 'teacher.two@example.edu', password: 'StrongPass123!' }, 'teacher2');
  assert.equal(second.status, 201);
  const student = await api('POST', '/api/auth/register', { role: 'student', name: '学生甲', email: 'student@example.edu', studentId: '20260001', password: 'StrongPass123!' }, 'student');
  assert.equal(student.status, 201);
  const course = await api('POST', '/api/courses', { title: '新课', description: '课程介绍', category: '测试', enrollmentCode: 'HELLO2026' }, 'teacher1');
  assert.equal(course.status, 201);
  assert.equal(course.data.course.teacherId, first.data.user.id);
  assert.equal((await api('POST', '/api/courses/' + course.data.course.id + '/enroll', { code: 'HELLO2026' }, 'student')).status, 200);
  assert.equal((await api('GET', '/api/teacher/overview', undefined, 'teacher1')).data.stats.totalStudents, 1);
  assert.equal((await api('GET', '/api/teacher/overview', undefined, 'teacher2')).data.stats.totalStudents, 0);
  assert.equal((await api('GET', '/api/teacher/students', undefined, 'teacher2')).data.students.length, 0);
  assert.equal((await api('GET', '/api/teacher/students', undefined, 'teacher1')).data.students.length, 1);
  assert.equal((await api('PATCH', '/api/courses/' + course.data.course.id, { title: '非法修改' }, 'teacher2')).status, 403);
  const persisted = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
  assert.equal(persisted.users.length, 3);
  assert.equal(persisted.courses[0].teacherId, first.data.user.id);
  console.log('PASS: teacher registration, no default demo, private roster and course-code enrollment');
}
run().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => server.close());
