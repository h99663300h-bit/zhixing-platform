const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { execFileSync } = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-new-backend-'));
process.env.DATA_FILE = path.join(temp, 'db.json');
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
process.env.ADMIN_EMAIL = 'admin@example.org';
process.env.ADMIN_PASSWORD = 'A-secure-admin-password-2026!';
const { server } = require('../server');
const cookies = new Map();
let base, smtp;
async function api(method, route, body, actor, contentType = 'application/json', headers = {}) {
  const options = { method, headers: { ...headers } };
  if (actor && cookies.has(actor)) options.headers.cookie = cookies.get(actor);
  if (body !== undefined) {
    options.headers['content-type'] = contentType;
    options.body = contentType === 'application/json' ? JSON.stringify(body) : body;
  }
  const response = await fetch(base + route, options);
  if (actor && response.headers.get('set-cookie')) cookies.set(actor, response.headers.get('set-cookie').split(';')[0]);
  const bytes = Buffer.from(await response.arrayBuffer());
  let data; try { data = JSON.parse(bytes.toString()); } catch { data = bytes; }
  return { status: response.status, data, headers: response.headers };
}
function ok(result, status, label) { assert.equal(result.status, status, `${label}: ${result.status} ${JSON.stringify(result.data)}`); return result.data; }
async function startFakeSmtp() {
  const messages = [];
  smtp = net.createServer(socket => {
    socket.write('220 fake SMTP\r\n');
    let buffer = '', dataMode = false, mail = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      let position;
      while ((position = buffer.indexOf('\r\n')) >= 0) {
        const row = buffer.slice(0, position); buffer = buffer.slice(position + 2);
        if (dataMode) {
          if (row === '.') { messages.push(mail); mail = ''; dataMode = false; socket.write('250 queued\r\n'); }
          else mail += row + '\r\n';
          continue;
        }
        if (/^EHLO /i.test(row)) socket.write('250-fake\r\n250 AUTH LOGIN\r\n');
        else if (/^MAIL FROM:/i.test(row) || /^RCPT TO:/i.test(row)) socket.write('250 ok\r\n');
        else if (row === 'DATA') { dataMode = true; socket.write('354 go\r\n'); }
        else if (row === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('500 unknown\r\n');
      }
    });
  });
  await new Promise(resolve => smtp.listen(0, '127.0.0.1', resolve));
  return messages;
}
async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  const admin = ok(await api('POST', '/api/auth/login', { email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }, 'admin'), 200, 'admin login').user;
  assert.equal(admin.role, 'admin');
  assert.equal((await api('GET', '/api/admin/overview')).status, 401, 'admin page requires login');
  const teacher = ok(await api('POST', '/api/admin/teachers', { name:'Instructor A', email:'teacher@outlook.com', password:'TeacherPass123!' }, 'admin'), 201, 'admin adds teacher').user;
  assert.equal(teacher.role, 'teacher');
  ok(await api('POST', '/api/auth/login', { email:'teacher@outlook.com', password:'TeacherPass123!' }, 'teacher'), 200, 'teacher login with common provider');
  const student = ok(await api('POST', '/api/auth/register', { role:'student', name:'Student A', email:'student@gmail.com', studentId:'STUD2026001', password:'StudentPass123!' }, 'student'), 201, 'student signup with common provider').user;
  const peer = ok(await api('POST', '/api/auth/register', { role:'student', name:'Student B', email:'peer@yahoo.com', studentId:'STUD2026002', password:'StudentPass123!' }, 'peer'), 201, 'second student signup').user;
  const course = ok(await api('POST', '/api/courses', { title:'Biology 101', category:'Science', description:'Test course', enrollmentCode:'BIO-2026' }, 'teacher'), 201, 'teacher creates course').course;
  const lesson = ok(await api('POST', `/api/courses/${course.id}/lessons`, { title:'Unit 1', type:'reading', content:'Lesson content' }, 'teacher'), 201, 'teacher creates lesson').lesson;
  const folders = `/api/lessons/${lesson.id}/folders`;
  assert.equal((await api('GET', folders, undefined, 'student')).status, 403, 'unenrolled student cannot view folders');
  const folder = ok(await api('POST', folders, { name:'Lecture Notes' }, 'teacher'), 201, 'teacher creates folder').folder;
  assert.equal((await api('POST', folders, { name:'Another' }, 'student')).status, 403, 'student cannot create folder');
  assert.equal((await api('POST', folders, { name:'Lecture Notes' }, 'teacher')).status, 409, 'duplicate folder rejected');
  const file = ok(await api('POST', `${folders}/${folder.id}/files`, Buffer.from('Study materials'), 'teacher', 'text/plain', { 'x-file-name':'notes.txt' }), 201, 'teacher uploads file').file;
  assert.equal(file.name, 'notes.txt');
  const listing = ok(await api('GET', folders, undefined, 'teacher'), 200, 'teacher lists folders').folders;
  assert.equal(listing[0].files[0].id, file.id);
  assert.equal((await api('GET', `${folders}/${folder.id}/download`, undefined, 'student')).status, 403, 'unenrolled student cannot download');
  ok(await api('POST', `/api/admin/students/${student.id}/enrollments/${course.id}`, {}, 'admin'), 200, 'admin enrolls student');
  ok(await api('POST', '/api/courses/enroll-by-code', { code:'BIO-2026' }, 'peer'), 200, 'peer enrolls by code');
  const zipped = ok(await api('GET', `${folders}/${folder.id}/download`, undefined, 'student'), 200, 'student downloads folder zip');
  assert.equal(zipped.subarray(0, 4).toString('hex'), '504b0304', 'ZIP local header');
  assert.ok(zipped.includes(Buffer.from('Study materials')), 'ZIP contains file bytes');
  assert.ok(zipped.includes(Buffer.from('notes.txt')), 'ZIP contains file name');
  const zipPath = path.join(temp, 'folder.zip');
  fs.writeFileSync(zipPath, zipped);
  assert.match(execFileSync('unzip', ['-t', zipPath], { encoding:'utf8' }), /No errors detected/, 'ZIP passes archive integrity check');
  const assignment = ok(await api('POST', `/api/courses/${course.id}/assignments`, { title:'Homework 1', instructions:'Write an answer', maxScore:100 }, 'teacher'), 201, 'create assignment').assignment;
  const submission = ok(await api('POST', `/api/assignments/${assignment.id}/submit`, { content:'First attempt' }, 'student'), 200, 'submit assignment').submission;
  ok(await api('PATCH', `/api/submissions/${submission.id}/grade`, { score:80, feedback:'Good' }, 'teacher'), 200, 'grade first attempt');
  let grades = ok(await api('GET', '/api/student/grades', undefined, 'student'), 200, 'student grades').courses[0];
  assert.equal(grades.classSize, 2); assert.equal(grades.rank, null, 'unpublished grade has no rank');
  assert.equal(grades.assignments[0].score, 80); assert.equal(grades.scores.usual, 80, 'assignment grade syncs to gradebook');
  ok(await api('POST', `/api/assignments/${assignment.id}/submit`, { content:'Second attempt' }, 'student'), 200, 'resubmit assignment');
  grades = ok(await api('GET', '/api/student/grades', undefined, 'student'), 200, 'grades after resubmit').courses[0];
  assert.equal(grades.assignments.length, 2); assert.equal(grades.assignments[0].score, null); assert.equal(grades.assignments[1].score, 80);
  assert.equal(grades.scores.usual, null, 'current coursework score resets on resubmission');
  ok(await api('PATCH', `/api/submissions/${submission.id}/grade`, { score:90 }, 'teacher'), 200, 'grade second attempt');
  grades = ok(await api('GET', '/api/student/grades', undefined, 'student'), 200, 'grades after second grading').courses[0];
  assert.equal(grades.scores.usual, 90);
  ok(await api('POST', `/api/assignments/${assignment.id}/submit`, { content:'Third attempt, ungraded' }, 'student'), 200, 'third assignment submission');
  ok(await api('POST', `/api/assignments/${assignment.id}/submit`, { content:'Fourth attempt, also ungraded' }, 'student'), 200, 'resubmit ungraded assignment');
  grades = ok(await api('GET', '/api/student/grades', undefined, 'student'), 200, 'all attempt history').courses[0];
  assert.equal(grades.assignments.length, 4, 'ungraded attempts remain visible');
  assert.equal(grades.assignments[0].score, null);
  assert.equal(grades.assignments[1].score, null);
  assert.equal(grades.assignments[2].score, 90);
  ok(await api('PATCH', `/api/submissions/${submission.id}/grade`, { score:90 }, 'teacher'), 200, 'grade fourth attempt');
  const quiz = ok(await api('PUT', `/api/courses/${course.id}/quiz`, { questions:[{ text:'Question?', options:['No','Yes'], correctIndex:1 }] }, 'teacher'), 200, 'create quiz').quiz;
  ok(await api('POST', `/api/courses/${course.id}/quiz/submit`, { answers:[{ questionId:quiz.questions[0].id, optionIndex:1 }] }, 'student'), 201, 'student quiz attempt');
  grades = ok(await api('GET', '/api/student/grades', undefined, 'student'), 200, 'quiz history').courses[0];
  assert.equal(grades.quizAttempts.length, 1); assert.equal(grades.quizAttempts[0].percent, 100);
  ok(await api('PUT', `/api/courses/${course.id}/gradebook/weights`, { weights:{ usual:100, quiz:0, midterm:0, final:0 } }, 'teacher'), 200, 'publish coursework only');
  grades = ok(await api('GET', '/api/student/grades', undefined, 'student'), 200, 'published total').courses[0];
  assert.equal(grades.total, 90); assert.equal(grades.rank, 1); assert.equal(grades.classSize, 2);
  ok(await api('PATCH', `/api/courses/${course.id}/gradebook/${peer.id}`, { scores:{ usual:95 } }, 'teacher'), 200, 'set peer score');
  grades = ok(await api('GET', '/api/student/grades', undefined, 'student'), 200, 'rank after peer score').courses[0];
  assert.equal(grades.rank, 2);
  const overview = ok(await api('GET', '/api/admin/overview', undefined, 'admin'), 200, 'admin overview');
  assert.equal(overview.stats.teachers, 1); assert.equal(overview.stats.students, 2); assert.equal(overview.stats.courses, 1);
  assert.equal(overview.students.find(s => s.id === student.id).enrollments.length, 1);
  ok(await api('DELETE', `/api/admin/students/${student.id}/enrollments/${course.id}`, undefined, 'admin'), 200, 'admin unenrolls student');
  assert.equal(ok(await api('GET', '/api/student/grades', undefined, 'student'), 200, 'grades after unenrollment').courses.length, 0);
  assert.equal((await api('POST', '/api/auth/forgot-password', { email:'unknown@gmail.com' })).status, 503, 'forgot password unavailable without SMTP');
  assert.equal((await api('POST', '/api/auth/forgot-password', { email:'student@gmail.com' })).status, 503, 'same unavailable for known address');
  const messages = await startFakeSmtp();
  process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(smtp.address().port); process.env.SMTP_FROM = 'noreply@example.org'; process.env.SMTP_ALLOW_PLAINTEXT = '1'; process.env.PUBLIC_BASE_URL = base;
  const forgot = ok(await api('POST', '/api/auth/forgot-password', { email:'student@gmail.com' }), 200, 'request reset via fake SMTP');
  assert.equal(forgot.token, undefined, 'reset token never returned in API');
  assert.equal(messages.length, 1);
  const link = messages[0].split('\r\n').find(line => line.startsWith(base + '/?reset='));
  assert.ok(link, 'email contains reset URL');
  const token = new URL(link).searchParams.get('reset');
  ok(await api('POST', '/api/auth/reset-password', { token, password:'NewStudentPass2026!' }), 200, 'reset password');
  assert.equal((await api('GET', '/api/auth/me', undefined, 'student')).data.user, null, 'reset invalidates old session');
  assert.equal((await api('POST', '/api/auth/login', { email:'student@gmail.com', password:'StudentPass123!' })).status, 401, 'old password rejected');
  ok(await api('POST', '/api/auth/login', { email:'student@gmail.com', password:'NewStudentPass2026!' }, 'student'), 200, 'new password logs in');
  assert.equal((await api('POST', '/api/auth/reset-password', { token, password:'Again12345!' })).status, 400, 'token one use only');
  ok(await api('PATCH', `/api/admin/users/${student.id}/password`, { password:'AdminSetPass2026!' }, 'admin'), 200, 'admin resets student password');
  ok(await api('DELETE', `/api/admin/teachers/${teacher.id}`, undefined, 'admin'), 200, 'admin deactivates teacher');
  assert.equal((await api('GET', '/api/auth/me', undefined, 'teacher')).data.user, null, 'deactivated teacher session invalid');
  assert.equal((await api('POST', '/api/auth/login', { email:'teacher@outlook.com', password:'TeacherPass123!' })).status, 401, 'deactivated teacher cannot log in');
  assert.equal(ok(await api('GET', '/api/admin/overview', undefined, 'admin'), 200, 'overview after deletion').teachers[0].active, false);
  console.log('PASS: admin bootstrap/manage, file folder ZIP permissions, rank/grade history, SMTP password reset');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (smtp) await new Promise(resolve => smtp.close(resolve));
  if (server.listening) await new Promise(resolve => server.close(resolve));
  fs.rmSync(temp, { recursive: true, force: true });
});
