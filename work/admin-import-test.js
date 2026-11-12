// Verifies admin CSV template download, bulk student/teacher import, validation, and immediate login.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-import-'));
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
  return { status: res.status, data, headers: res.headers };
}

async function main() {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  base = 'http://127.0.0.1:' + server.address().port;

  // Register school admin
  const regAdm = await api('POST', '/api/auth/register-admin', {
    name: 'Admin ZX', accountId: 'sch20260101', email: 'adm@zx.edu',
    schoolName: 'Zhixing University', schoolCode: 'ZX1001', password: 'AdminPass123!',
  }, 'admin');
  assert.equal(regAdm.status, 201);

  // Download templates
  const stuTpl = await api('GET', '/api/admin/import/template?role=student', undefined, 'admin');
  assert.equal(stuTpl.status, 200);
  assert.match(stuTpl.data, /身份信息,名字,性别,学号,学校代码,院系,专业,账号,临时密码/);

  const tchTpl = await api('GET', '/api/admin/import/template?role=teacher', undefined, 'admin');
  assert.equal(tchTpl.status, 200);
  assert.match(tchTpl.data, /身份信息,名字,性别,学校代码,院系,专业,账号,临时密码/);

  // Invalid import should reject cleanly (wrong school code / mismatched accountId)
  const badStu = await api('POST', '/api/admin/import', {
    role: 'student',
    csv: '身份信息,名字,性别,学号,学校代码,院系,专业,账号,临时密码\nstudent,王五,男,20260999,ZX1001,计算机学院,软件工程,20260888,Pass202601!',
  }, 'admin');
  assert.equal(badStu.status, 400);
  assert.ok(Array.isArray(badStu.data.errors) && badStu.data.errors.length === 1);

  // Valid student import
  const okStu = await api('POST', '/api/admin/import', {
    role: 'student',
    csv: '\uFEFF身份信息,名字,性别,学号,学校代码,院系,专业,账号,临时密码\n' +
      'student,张三,男,20260101,ZX1001,计算机学院,软件工程,20260101,StuPass2026!\n' +
      'student,李四,女,20260102,ZX1001,数学学院,应用数学,20260102,StuPass2026!',
  }, 'admin');
  assert.equal(okStu.status, 201);
  assert.equal(okStu.data.importedCount, 2);
  assert.equal(okStu.data.users[0].department, '计算机学院');
  assert.equal(okStu.data.users[0].major, '软件工程');

  // Valid teacher import
  const okTch = await api('POST', '/api/admin/import', {
    role: 'teacher',
    csv: '\uFEFF身份信息,名字,性别,学校代码,院系,专业,账号,临时密码\n' +
      'teacher,赵老师,女,ZX1001,计算机学院,人工智能,tch202601,TchPass2026!',
  }, 'admin');
  assert.equal(okTch.status, 201);
  assert.equal(okTch.data.importedCount, 1);

  // Imported student & teacher can log in directly with accountId + temporary password
  const stuLogin = await api('POST', '/api/auth/login', { identifier: '20260101', password: 'StuPass2026!' });
  assert.equal(stuLogin.status, 200);
  assert.equal(stuLogin.data.user.role, 'student');
  assert.equal(stuLogin.data.user.department, '计算机学院');

  const tchLogin = await api('POST', '/api/auth/login', { identifier: 'tch202601', password: 'TchPass2026!' });
  assert.equal(tchLogin.status, 200);
  assert.equal(tchLogin.data.user.role, 'teacher');
  assert.equal(tchLogin.data.user.major, '人工智能');

  // Overview reflects imported personnel
  const overview = await api('GET', '/api/admin/overview', undefined, 'admin');
  assert.equal(overview.status, 200);
  assert.equal(overview.data.students.length, 2);
  assert.equal(overview.data.teachers.length, 1);

  console.log('PASS: admin CSV templates, bulk student/teacher import, validation, and direct login');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => { server.close(); fs.rmSync(tempDir, { recursive: true, force: true }); });
