// Isolated profile API regression; never changes the live database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-profile-'));
process.env.DATA_FILE = path.join(tempDir, 'platform.json');
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');
process.env.DEMO_SEED = '1';
process.env.DEMO_SEED = '1';
const { server } = require('../server');
const cookies = new Map();
let base;
async function request(method, route, body, actor, type = 'application/json') {
  const headers = {};
  if (actor && cookies.has(actor)) headers.cookie = cookies.get(actor);
  if (body !== undefined) headers['content-type'] = type;
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : type === 'application/json' ? JSON.stringify(body) : body });
  const cookie = response.headers.get('set-cookie');
  if (actor && cookie) cookies.set(actor, cookie.split(';')[0]);
  const bytes = Buffer.from(await response.arrayBuffer());
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { data = bytes; }
  return { status: response.status, data, headers: response.headers };
}
function expect(result, status, label) {
  assert.equal(result.status, status, label + ': HTTP ' + result.status + ' ' + JSON.stringify(result.data));
  return result.data;
}
async function main() {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  base = 'http://127.0.0.1:' + server.address().port;
  assert.equal((await request('GET', '/api/profile')).status, 401, 'profile requires login');
  const original = expect(await request('POST', '/api/auth/register', {
    name: '个人资料测试', email: 'profile.student@example.edu', studentId: '20260026', password: 'StrongPass123!'
  }, 'student'), 201, 'register').user;
  assert.equal(original.role, 'student');
  const before = expect(await request('GET', '/api/profile', undefined, 'student'), 200, 'student profile').profile;
  assert.equal(before.studentId, '20260026');
  assert.equal(before.name, '个人资料测试');
  assert.equal(before.grade ?? '', '', 'new user grade is empty');
  assert.equal(before.gender ?? '', '', 'new user gender is empty');
  const changed = expect(await request('PATCH', '/api/profile', {
    name: '修改后的姓名', gender: '女', grade: '2026级'
  }, 'student'), 200, 'update profile').profile;
  assert.equal(changed.name, '修改后的姓名');
  assert.equal(changed.gender, '女');
  assert.equal(changed.grade, '2026级');
  assert.equal(changed.studentId, '20260026');
  for (const [key, value] of Object.entries({ studentId:'HACK2026', role:'teacher', email:'changed@example.edu' })) {
    const result = await request('PATCH', '/api/profile', { [key]:value }, 'student');
    assert.equal(result.status, 400, key + ' cannot be modified');
  }
  const retained = expect(await request('GET', '/api/profile', undefined, 'student'), 200, 'profile after rejected changes').profile;
  assert.equal(retained.studentId, '20260026');
  assert.equal(retained.email, 'profile.student@example.edu');
  assert.equal(retained.role, 'student');
  expect(await request('POST', '/api/auth/login', { email:'teacher@university.edu', password:'Teacher123!' }, 'teacher'), 200, 'teacher login');
  const teacherBefore = expect(await request('GET', '/api/profile', undefined, 'teacher'), 200, 'teacher profile').profile;
  assert.equal(teacherBefore.studentId, null, 'teacher should not have a student ID');
  const teacherAfter = expect(await request('PATCH', '/api/profile', { name:'新教师姓名', gender:'男', grade:'2026级' }, 'teacher'), 200, 'teacher update').profile;
  assert.equal(teacherAfter.name, '新教师姓名');
  assert.equal(teacherAfter.studentId, null);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
  const uploaded = expect(await request('POST', '/api/profile/avatar', png, 'student', 'image/png'), 200, 'upload PNG avatar');
  const avatarUrl = uploaded.profile?.avatarUrl || uploaded.user?.avatarUrl || uploaded.avatarUrl;
  assert.ok(avatarUrl?.startsWith('/api/'), 'avatar URL returned');
  const avatar = await request('GET', avatarUrl, undefined, 'student');
  assert.equal(avatar.status, 200, 'student reads avatar');
  assert.match(avatar.headers.get('content-type') || '', /^image\/png/);
  assert.ok(Buffer.isBuffer(avatar.data) && avatar.data.equals(png), 'stored avatar roundtrip');
  assert.equal((await request('GET', avatarUrl)).status, 401, 'guest cannot read avatar');
  assert.equal((await request('GET', avatarUrl, undefined, 'teacher')).status, 403, 'another account cannot read avatar');
  const badType = await request('POST', '/api/profile/avatar', Buffer.from('not-image'), 'student', 'application/octet-stream');
  assert.equal(badType.status, 415, 'unsupported avatar type rejected');
  const badBody = await request('POST', '/api/profile/avatar', Buffer.from('not-image'), 'student', 'image/png');
  assert.equal(badBody.status, 415, 'bad PNG signature rejected');
  const tooBig = await request('POST', '/api/profile/avatar', Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)]), 'student', 'image/png');
  assert.equal(tooBig.status, 413, 'oversized avatar rejected');
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  const jpegUpload = expect(await request('POST', '/api/profile/avatar', jpeg, 'student', 'image/jpeg'), 200, 'replace with JPEG avatar');
  assert.equal(jpegUpload.profile.avatarUrl, avatarUrl, 'avatar URL stays stable after replacement');
  const jpegRead = await request('GET', avatarUrl, undefined, 'student');
  assert.equal(jpegRead.status, 200);
  assert.match(jpegRead.headers.get('content-type') || '', /^image\/jpeg/);
  assert.ok(jpegRead.data.equals(jpeg));
  const webp = Buffer.from('RIFF1234WEBP', 'ascii');
  expect(await request('POST', '/api/profile/avatar', webp, 'student', 'image/webp'), 200, 'replace with WebP avatar');
  const webpRead = await request('GET', avatarUrl, undefined, 'student');
  assert.equal(webpRead.status, 200);
  assert.match(webpRead.headers.get('content-type') || '', /^image\/webp/);
  assert.ok(webpRead.data.equals(webp));
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, 1, 'old avatar file removed on replacement');
  const saved = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
  const savedStudent = saved.users.find(u => u.id === original.id);
  assert.equal(savedStudent.studentId, '20260026');
  assert.equal(savedStudent.name, '修改后的姓名');
  assert.equal(savedStudent.gender, '女');
  assert.equal(savedStudent.grade, '2026级');
  assert.ok(savedStudent.avatarFile?.storedName, 'avatar metadata persisted');
  console.log('PASS: student/teacher profiles, immutable identity, PNG/JPEG/WebP avatar replacement, validation, storage and read permissions');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});
