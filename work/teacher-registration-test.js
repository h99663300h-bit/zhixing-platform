// Isolated acceptance test for teacher self-registration and course-code enrollment.
// Uses temporary data and upload directories; never touches the live installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-teacher-registration-'));
process.env.DATA_FILE = path.join(tempDir, 'platform.json');
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');
const { server } = require('../server');
let base;
const cookies = new Map();

async function api(method, route, body, actor) {
  const headers = {};
  if (actor && cookies.has(actor)) headers.cookie = cookies.get(actor);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (actor && response.headers.get('set-cookie')) cookies.set(actor, response.headers.get('set-cookie').split(';')[0]);
  return { status: response.status, data: await response.json() };
}
function expect(response, status, label) {
  assert.equal(response.status, status, `${label}: HTTP ${response.status} ${JSON.stringify(response.data)}`);
  return response.data;
}
function courseInput(title, enrollmentCode) {
  return { title, description: '教师自行创建的教学课程', category: '测试课程', enrollmentCode };
}
async function main() {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  const teacherA = expect(await api('POST', '/api/auth/register', { role: 'teacher', name: '甲教师', email: 'teacher-a@example.edu', password: 'SafePassword123!' }, 'teacherA'), 201, 'teacher A registers').user;
  const teacherB = expect(await api('POST', '/api/auth/register', { role: 'teacher', name: '乙教师', email: 'teacher-b@example.edu', password: 'SafePassword123!' }, 'teacherB'), 201, 'teacher B registers').user;
  assert.equal(teacherA.role, 'teacher');
  assert.equal(teacherA.studentId, null);
  assert.equal(teacherB.role, 'teacher');
  assert.equal((await api('GET', '/api/auth/me', undefined, 'teacherA')).data.user?.id, teacherA.id, 'teacher registration starts own session');
  assert.equal((await api('POST', '/api/auth/register', { role: 'teacher', name: '重复教师', email: 'teacher-a@example.edu', password: 'SafePassword123!' })).status, 409, 'duplicate email rejected');
  assert.equal((await api('POST', '/api/auth/register', { role: 'admin', name: '非法角色', email: 'bad-role@example.edu', password: 'SafePassword123!' })).status, 400, 'unrecognized role rejected');
  assert.equal((await api('POST', '/api/auth/register', { role: 'teacher', name: '非法学号', email: 'bad-id@example.edu', studentId: '20260001', password: 'SafePassword123!' })).status, 400, 'teacher registration rejects student ID');
  const student = expect(await api('POST', '/api/auth/register', { role: 'student', name: '测试学生', email: 'student@example.edu', studentId: 'NEWSTU2026', password: 'SafePassword123!' }, 'student'), 201, 'student registers').user;
  assert.equal(student.role, 'student');
  assert.equal(student.studentId, 'NEWSTU2026');

  const ownA = expect(await api('POST', '/api/courses', courseInput('甲教师课程', 'CODE-A-26'), 'teacherA'), 201, 'teacher A creates own course').course;
  const ownB = expect(await api('POST', '/api/courses', courseInput('乙教师课程', 'CODE-B-26'), 'teacherB'), 201, 'teacher B creates own course').course;
  assert.equal(ownA.enrollmentCode, 'CODE-A-26');
  assert.equal(ownB.enrollmentCode, 'CODE-B-26');
  assert.equal((await api('GET', `/api/courses/${ownA.id}`, undefined, 'teacherB')).data.course.enrollmentCode, undefined, 'other teacher cannot read private code');
  assert.equal((await api('PATCH', `/api/courses/${ownA.id}`, { title: '不应成功' }, 'teacherB')).status, 403, 'other teacher cannot edit course');
  assert.equal((await api('POST', '/api/courses', courseInput('重复代码', 'CODE-A-26'), 'teacherB')).status, 409, 'course codes are globally unique');
  assert.equal((await api('POST', '/api/courses/enroll-by-code', { code: 'NOT-A-CODE' }, 'student')).status, 404, 'invalid code rejected');
  expect(await api('POST', '/api/courses/enroll-by-code', { code: 'CODE-A-26' }, 'student'), 200, 'student joins teacher A by code');
  assert.equal((await api('GET', `/api/courses/${ownA.id}`, undefined, 'student')).data.course.enrolled, true);
  assert.equal((await api('GET', `/api/courses/${ownB.id}`, undefined, 'student')).data.course.enrolled, false);
  assert.equal((await api('GET', `/api/courses/${ownA.id}`, undefined, 'student')).data.course.enrollmentCode, undefined, 'student cannot read private code');
  const aStudents = expect(await api('GET', '/api/teacher/students', undefined, 'teacherA'), 200, 'teacher A student list').students;
  const bStudents = expect(await api('GET', '/api/teacher/students', undefined, 'teacherB'), 200, 'teacher B student list').students;
  assert.ok(aStudents.some(s => s.id === student.id), 'teacher A sees enrolled student');
  assert.ok(!bStudents.some(s => s.id === student.id), 'teacher B cannot see another teacher student');
  assert.equal((await api('GET', '/api/teacher/overview', undefined, 'teacherA')).data.stats.totalStudents, 1, 'teacher A count scoped to own courses');
  assert.equal((await api('GET', '/api/teacher/overview', undefined, 'teacherB')).data.stats.totalStudents, 0, 'teacher B count excludes other courses');
  expect(await api('POST', `/api/courses/${ownA.id}/unenroll`, {}, 'student'), 200, 'student withdraws');
  assert.ok(!(await api('GET', '/api/teacher/students', undefined, 'teacherA')).data.students.some(s => s.id === student.id), 'withdrawn student disappears from teacher list');

  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.ok(!app.includes('教师体验账号'), 'teacher demo card removed from UI');
  assert.ok(!app.includes('使用体验账号填入表单'), 'teacher demo shortcut removed from UI');
  assert.ok(app.includes('authRole') && app.includes('register'), 'registration UI selects role');
  console.log('PASS: teacher signup, role isolation, owned course codes, student join and withdraw, demo card removal');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});
