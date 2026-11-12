// Verifies department assignment, admin-only school/college/academic announcements, and course announcements sync.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-dept-ann-'));
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

  // 1. Setup admin, teacher, student
  assert.equal((await api('POST', '/api/auth/register-admin', {
    name: 'School Admin', accountId: 'SIU199901', email: 'admin@siu.edu',
    schoolName: 'SIU University', schoolCode: 'SIU01', password: 'AdminPass123!',
  }, 'admin')).status, 201);

  const tch = await api('POST', '/api/auth/register', {
    role: 'teacher', name: 'Prof. Wang', accountId: 'tch202601', email: 'wang@siu.edu', school: 'SIU01', password: 'TeacherPass123!',
  }, 'teacher');
  assert.equal(tch.status, 201);
  assert.equal((await api('POST', `/api/admin/teacher-requests/${tch.data.user.id}/approve`, {}, 'admin')).status, 200);

  const stu = await api('POST', '/api/auth/register', {
    role: 'student', name: 'Student Li', studentId: '20260101', email: 'li@siu.edu', school: 'SIU01', password: 'StudentPass123!',
  }, 'student');
  assert.equal(stu.status, 201);

  // 2. Department management & assignment for teacher and student
  const deptRes = await api('POST', '/api/admin/departments', { name: '计算机学院' }, 'admin');
  assert.equal(deptRes.status, 201);
  assert.equal((await api('PATCH', `/api/admin/users/${tch.data.user.id}/department`, { department: '计算机学院', major: '人工智能' }, 'admin')).data.user.department, '计算机学院');
  assert.equal((await api('PATCH', `/api/admin/users/${stu.data.user.id}/department`, { department: '计算机学院', major: '软件工程' }, 'admin')).data.user.major, '软件工程');

  // 3. Admin-only platform announcements (school, college, academic)
  assert.equal((await api('POST', '/api/admin/announcements', { category: 'school', title: 'No', content: 'No' }, 'teacher')).status, 403);
  assert.equal((await api('POST', '/api/admin/announcements', { category: 'academic', title: 'No', content: 'No' }, 'student')).status, 403);

  const ann1 = await api('POST', '/api/admin/announcements', { category: 'school', title: '开学通知', content: '9月1日报到' }, 'admin');
  assert.equal(ann1.status, 201);
  const ann2 = await api('POST', '/api/admin/announcements', { category: 'college', title: '学院讲座', content: '周五下午两点' }, 'admin');
  assert.equal(ann2.status, 201);
  const ann3 = await api('POST', '/api/admin/announcements', { category: 'academic', title: '选课通知', content: '本周五截止' }, 'admin');
  assert.equal(ann3.status, 201);

  assert.equal((await api('PATCH', `/api/admin/announcements/${ann1.data.announcement.id}`, { title: '开学通知（更新）' }, 'admin')).status, 200);
  const stuAnns = await api('GET', '/api/announcements', undefined, 'student');
  assert.equal(stuAnns.status, 200);
  assert.equal(stuAnns.data.announcements.length, 3);
  const tchAnns = await api('GET', '/api/announcements', undefined, 'teacher');
  assert.equal(tchAnns.data.announcements.length, 3);

  // 4. Course announcements: teacher publishes, enrolled student sees it
  const course = await api('POST', '/api/courses', {
    title: '数据结构', category: 'CS', description: '核心课程', enrollmentCode: 'DS2026',
  }, 'teacher');
  assert.equal(course.status, 201);
  const courseId = course.data.course.id;

  assert.equal((await api('POST', `/api/courses/${courseId}/announcements`, { title: 'Unauthorized', content: 'Nope' }, 'student')).status, 403);
  const cann = await api('POST', `/api/courses/${courseId}/announcements`, { title: '第一次作业提醒', content: '下周一前提交' }, 'teacher');
  assert.equal(cann.status, 201);

  assert.equal((await api('POST', '/api/courses/enroll-by-code', { code: 'DS2026' }, 'student')).status, 200);
  const stuCourse = await api('GET', `/api/courses/${courseId}`, undefined, 'student');
  assert.equal(stuCourse.status, 200);
  assert.equal(stuCourse.data.course.announcements.length, 1);
  assert.equal(stuCourse.data.course.announcements[0].title, '第一次作业提醒');

  console.log('PASS: department assignment, admin-only announcements, and course announcement sync');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => { server.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });
