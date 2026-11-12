// Isolated school organization signup, binding, and administrator-scope regression.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-organization-'));
process.env.DATA_FILE = path.join(temp, 'platform.json');
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.ADMIN_EMAIL = 'root@example.edu';
process.env.ADMIN_PASSWORD = 'RootAdminPass123!';
delete process.env.DEMO_SEED;
const { server } = require('../server');
const cookies = new Map();
let base;

async function api(method, route, body, actor) {
  const headers = {};
  if (actor && cookies.has(actor)) headers.cookie = cookies.get(actor);
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (actor && response.headers.get('set-cookie')) cookies.set(actor, response.headers.get('set-cookie').split(';')[0]);
  return { status: response.status, data: await response.json() };
}
function expect(result, status, label) {
  assert.equal(result.status, status, `${label}: HTTP ${result.status} ${JSON.stringify(result.data)}`);
  return result.data;
}
function registerBody(role, name, email, extra = {}) {
  return { role, name, email, password: 'StrongPassword123!', ...extra };
}

async function main() {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = 'http://127.0.0.1:' + server.address().port;

  const root = expect(await api('POST', '/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }, 'root'), 200, 'global admin login').user;
  assert.equal(root.role, 'admin');
  assert.equal((await api('POST', '/api/auth/register', registerBody('admin', 'Rejected', 'rejected@example.edu'))).status, 400, 'generic signup cannot elevate role');

  const adminA = expect(await api('POST', '/api/auth/register-admin', {
    accountId: 'sch20260011', name: 'Peking Admin', email: 'admin-a@example.edu', password: 'StrongPassword123!', schoolName: 'Peking University', schoolCode: '1008611'
  }, 'adminA'), 201, 'school admin registers').user;
  assert.equal(adminA.school.name, 'Peking University');
  assert.equal(adminA.school.code, '1008611');
  assert.equal((await api('POST', '/api/auth/register-admin', {
    accountId: 'sch20260012', name: 'Duplicate Admin', email: 'admin-a2@example.edu', password: 'StrongPassword123!', schoolName: ' peking university ', schoolCode: 'PKU-2'
  })).status, 409, 'school names are unique');

  const adminB = expect(await api('POST', '/api/auth/register-admin', {
    accountId: 'sch20260013', name: 'Oxford Admin', email: 'admin-b@example.edu', password: 'StrongPassword123!', schoolName: 'Oxford University', schoolCode: 'OXF2026'
  }, 'adminB'), 201, 'second school admin registers').user;
  assert.equal(adminB.school.code, 'OXF2026');
  assert.equal((await api('POST', '/api/auth/register', registerBody('teacher', 'Conflicting School', 'conflict@example.edu', { accountId: 'tch20260010', school: '1008611', schoolName: 'Oxford University' }))).status, 400, 'conflicting school identifiers rejected');

  const teacherA = expect(await api('POST', '/api/auth/register', registerBody('teacher', 'Peking Instructor', 'teacher-a@example.edu', { accountId: 'tch20260011', school: '1008611' }), 'teacherA'), 201, 'teacher joins by code').user;
  const teacherB = expect(await api('POST', '/api/auth/register', registerBody('teacher', 'Oxford Instructor', 'teacher-b@example.edu', { accountId: 'tch20260012', school: 'oxford university' }), 'teacherB'), 201, 'teacher joins by exact school name').user;
  const studentA = expect(await api('POST', '/api/auth/register', registerBody('student', 'Peking Student', 'student-a@example.edu', { studentId: '20260011', school: 'Peking University' }), 'studentA'), 201, 'student joins by school name').user;
  const studentB = expect(await api('POST', '/api/auth/register', registerBody('student', 'Oxford Student', 'student-b@example.edu', { studentId: '20260012', school: 'OXF2026' }), 'studentB'), 201, 'student joins by school code').user;
  const unbound = expect(await api('POST', '/api/auth/register', registerBody('student', 'Existing Student', 'existing@example.edu', { studentId: '20260013' }), 'unbound'), 201, 'student registers without school').user;
  assert.equal(unbound.school, null);
  assert.equal((await api('POST', '/api/auth/register', registerBody('student', 'Bad School', 'badschool@example.edu', { studentId: '20260014', school: 'Unknown Institute' }))).status, 404, 'unknown school rejected');

  const courseA = expect(await api('POST', '/api/courses', { title: 'Peking Course', description: 'A test course', category: 'Test', enrollmentCode: 'PKU-COURSE' }, 'teacherA'), 201, 'school A course').course;
  const courseB = expect(await api('POST', '/api/courses', { title: 'Oxford Course', description: 'A test course', category: 'Test', enrollmentCode: 'OXF-COURSE' }, 'teacherB'), 201, 'school B course').course;

  const linked = expect(await api('POST', '/api/profile/organization', { school: '1008611' }, 'unbound'), 200, 'existing student binds by code').profile;
  assert.equal(linked.school.id, adminA.school.id);
  assert.equal((await api('POST', '/api/profile/organization', { school: 'Oxford University' }, 'unbound')).status, 409, 'account cannot transfer to another organization');
  assert.equal((await api('GET', '/api/profile', undefined, 'studentA')).data.profile.school.code, '1008611');

  const preOverviewA = expect(await api('GET', '/api/admin/overview', undefined, 'adminA'), 200, 'school A pending overview');
  assert.deepEqual(preOverviewA.pendingTeachers.map(x => x.id), [teacherA.id]);
  assert.equal((await api('POST', `/api/admin/teacher-requests/${teacherB.id}/approve`, {}, 'adminA')).status, 403, 'school A admin cannot approve school B request');
  expect(await api('POST', `/api/admin/teacher-requests/${teacherA.id}/approve`, {}, 'adminA'), 200, 'school A admin approves teacher A');
  expect(await api('POST', `/api/admin/teacher-requests/${teacherB.id}/approve`, {}, 'adminB'), 200, 'school B admin approves teacher B');
  const overviewA = expect(await api('GET', '/api/admin/overview', undefined, 'adminA'), 200, 'school A overview');
  assert.deepEqual(overviewA.teachers.map(x => x.id), [teacherA.id]);
  assert.deepEqual(new Set(overviewA.students.map(x => x.id)), new Set([studentA.id, unbound.id]));
  assert.deepEqual(overviewA.courses.map(x => x.id), [courseA.id]);
  assert.equal(overviewA.organization.code, '1008611');
  assert.equal((await api('PATCH', `/api/admin/users/${studentB.id}/password`, { password: 'ChangedPassword123!' }, 'adminA')).status, 404, 'school admin cannot reset another school password');
  assert.equal((await api('DELETE', `/api/admin/teachers/${teacherB.id}`, undefined, 'adminA')).status, 404, 'school admin cannot deactivate another school instructor');
  assert.equal((await api('POST', `/api/admin/students/${studentB.id}/enrollments/${courseB.id}`, {}, 'adminA')).status, 404, 'school admin cannot adjust another school enrollment');

  const rootOverview = expect(await api('GET', '/api/admin/overview', undefined, 'root'), 200, 'global admin overview');
  assert.equal(rootOverview.stats.teachers, 2);
  assert.equal(rootOverview.stats.students, 3);
  assert.equal(rootOverview.stats.courses, 2);
  assert.equal(rootOverview.organizations.length, 2);
  const saved = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
  assert.equal(saved.schools.length, 2);
  assert.equal(saved.users.find(u => u.id === unbound.id).schoolId, adminA.school.id);
  console.log('PASS: admin school creation, code/name signup, existing account binding, organization-scoped management, global admin access');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
});
