// Run from the project root with Node 18+ in an environment permitting localhost sockets.
// Uses a temporary database and upload directory, never the user's live platform data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-v2-'));
process.env.DATA_FILE = path.join(tempDir, 'db.json');
process.env.UPLOAD_DIR = path.join(tempDir, 'uploads');
process.env.DEMO_SEED = '1';
process.env.DEMO_SEED = '1';
const { server } = require('../server');

let base;
const cookies = new Map();
async function api(method, route, body, actor, contentType = 'application/json', extraHeaders = {}) {
  const headers = { ...extraHeaders };
  if (actor && cookies.has(actor)) headers.cookie = cookies.get(actor);
  if (body !== undefined) headers['content-type'] = contentType;
  const response = await fetch(base + route, {
    method,
    headers,
    body: body === undefined ? undefined : contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const setCookie = response.headers.get('set-cookie');
  if (actor && setCookie) cookies.set(actor, setCookie.split(';')[0]);
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = raw; }
  return { status: response.status, data, headers: response.headers };
}
function expect(response, status, label) {
  assert.equal(response.status, status, label + ': HTTP ' + response.status + ' ' + JSON.stringify(response.data));
  return response.data;
}
function forbidden(response, label) {
  assert.ok([401, 403].includes(response.status), label + ': expected 401/403, got ' + response.status);
}
function closeEnough(actual, expected, label) {
  assert.equal(typeof actual, 'number', label + ' should be numeric');
  assert.ok(Math.abs(actual - expected) <= 0.51, label + ': expected about ' + expected + ', got ' + actual);
}

async function main() {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  base = 'http://127.0.0.1:' + server.address().port;
  expect(await api('GET', '/api/health'), 200, 'health');
  expect(await api('POST', '/api/auth/login', { email: 'teacher@university.edu', password: 'Teacher123!' }, 'teacher'), 200, 'teacher login');
  const first = expect(await api('POST', '/api/auth/register', { name: '学生甲', email: 'v2a@example.edu', studentId: 'V2STU0001', password: 'SafePassword123!' }, 'studentA'), 201, 'student A registration').user;
  expect(await api('POST', '/api/auth/register', { name: '学生乙', email: 'v2b@example.edu', studentId: 'V2STU0002', password: 'SafePassword123!' }, 'studentB'), 201, 'student B registration');

  // Enrollment codes are teacher-owned secrets and gates for joining a course.
  const created = expect(await api('POST', '/api/courses', {
    title: 'V2 集成测试课', description: '用于验证选课与成绩', category: '测试课程',
    cover: '📘', color: '#123456', enrollmentCode: 'JOIN-V2-47',
  }, 'teacher'), 201, 'teacher creates course').course;
  const courseId = created.id;
  assert.equal(created.enrollmentCode, 'JOIN-V2-47', 'teacher sees chosen enrollment code');
  const duplicate = await api('POST', '/api/courses', {
    title: '重复选课码课程', description: '验证唯一性', category: '测试课程',
    cover: '📘', color: '#123456', enrollmentCode: 'JOIN-V2-47',
  }, 'teacher');
  assert.equal(duplicate.status, 409, 'enrollment code must be unique');
  const publicCourse = expect(await api('GET', '/api/courses/' + courseId), 200, 'public course detail').course;
  assert.equal(publicCourse.enrollmentCode, undefined, 'public cannot read enrollment code');
  const studentCourse = expect(await api('GET', '/api/courses/' + courseId, undefined, 'studentA'), 200, 'student course detail').course;
  assert.equal(studentCourse.enrollmentCode, undefined, 'student cannot read enrollment code');
  forbidden(await api('POST', '/api/courses', { title:'No', description:'No', category:'No' }, 'studentA'), 'student cannot create course');
  const oldRoute = await api('POST', '/api/courses/' + courseId + '/enroll', {}, 'studentA');
  assert.ok(oldRoute.status >= 400, 'legacy enroll route must require a code');
  const wrongCode = await api('POST', '/api/courses/enroll-by-code', { code: 'WRONG-V2-CODE' }, 'studentA');
  assert.ok(wrongCode.status >= 400, 'wrong code is rejected');
  expect(await api('POST', '/api/courses/enroll-by-code', { code: 'JOIN-V2-47' }, 'studentA'), 200, 'student A joins with code');
  expect(await api('POST', '/api/courses/enroll-by-code', { code: 'JOIN-V2-47' }, 'studentB'), 200, 'student B joins with code');
  assert.equal(expect(await api('GET', '/api/courses/' + courseId, undefined, 'studentA'), 200, 'joined course').course.enrolled, true);
  expect(await api('POST', '/api/courses/' + courseId + '/unenroll', {}, 'studentB'), 200, 'student B withdraws');
  assert.equal(expect(await api('GET', '/api/courses/' + courseId, undefined, 'studentB'), 200, 'withdrawn course').course.enrolled, false);
  expect(await api('POST', '/api/courses/enroll-by-code', { code: 'JOIN-V2-47' }, 'studentB'), 200, 'student B rejoins');

  // Assignments, submission files, teacher feedback and assignment statistics.
  const assignment = expect(await api('POST', '/api/courses/' + courseId + '/assignments', {
    title: '分析报告', instructions: '提交 200 字报告', dueAt: '', maxScore: 100,
  }, 'teacher'), 201, 'teacher creates assignment').assignment;
  assert.ok(assignment.id);
  forbidden(await api('POST', '/api/courses/' + courseId + '/assignments', {
    title: '学生非法作业', instructions: '不应该成功', dueAt: '', maxScore: 100,
  }, 'studentA'), 'student cannot create assignment');
  const studentAssignments = expect(await api('GET', '/api/courses/' + courseId + '/assignments', undefined, 'studentA'), 200, 'student assignment list').assignments;
  assert.equal(studentAssignments.length, 1);
  assert.equal(studentAssignments[0].stats, undefined, 'student cannot see whole-class statistics');
  const submission = expect(await api('POST', '/api/assignments/' + assignment.id + '/submit', { content: '我的第一份分析报告' }, 'studentA'), 200, 'student submits assignment').submission;
  assert.ok(submission.id);
  const uploadBody = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
  const fileUpload = await api('POST', '/api/assignments/' + assignment.id + '/submission/file', uploadBody, 'studentA', 'application/pdf', { 'X-File-Name': 'report.pdf' });
  expect(fileUpload, 200, 'student uploads assignment file');
  const submissionFileUrl = fileUpload.data.submission.fileUrl;
  assert.ok(submissionFileUrl, 'submission file URL is provided');
  const privateFile = await api('GET', submissionFileUrl, undefined, 'studentB');
  forbidden(privateFile, 'other student cannot read submission file');
  const teacherFile = expect(await api('GET', submissionFileUrl, undefined, 'teacher'), 200, 'teacher downloads assignment file');
  assert.ok(teacherFile);
  const listing = expect(await api('GET', '/api/assignments/' + assignment.id + '/submissions', undefined, 'teacher'), 200, 'teacher submission list').submissions;
  assert.equal(listing.length, 1);
  const gradeSubmission = expect(await api('PATCH', '/api/submissions/' + submission.id + '/grade', { score: 82, feedback: '分析结构清楚，可补充参考文献。' }, 'teacher'), 200, 'teacher grades assignment').submission;
  assert.equal(gradeSubmission.score, 82);
  assert.match(gradeSubmission.feedback, /参考文献/);
  forbidden(await api('PATCH', '/api/submissions/' + submission.id + '/grade', { score: 99, feedback: '非法评分' }, 'studentB'), 'student cannot grade');
  const teacherAssignments = expect(await api('GET', '/api/courses/' + courseId + '/assignments', undefined, 'teacher'), 200, 'teacher assignment stats').assignments;
  assert.equal(teacherAssignments[0].stats.submitted, 1);
  assert.equal(teacherAssignments[0].stats.graded, 1);
  assert.equal(teacherAssignments[0].stats.totalStudents, 2);
  const ownAssignment = expect(await api('GET', '/api/courses/' + courseId + '/assignments', undefined, 'studentA'), 200, 'student sees own grade').assignments[0];
  assert.equal(ownAssignment.submission.score, 82);

  const authoredQuiz = expect(await api('PUT', '/api/courses/' + courseId + '/quiz', {
    questions: [
      { text: '知识点一？', options: ['错误', '正确'], correctIndex: 1 },
      { text: '知识点二？', options: ['正确', '错误'], correctIndex: 0 },
    ],
  }, 'teacher'), 200, 'teacher creates quiz').quiz;
  assert.equal(authoredQuiz.questions.length, 2);
  const learnerQuiz = expect(await api('GET', '/api/courses/' + courseId + '/quiz', undefined, 'studentA'), 200, 'student fetches quiz').quiz;
  assert.ok(learnerQuiz.questions.every(q => q.correctIndex === undefined), 'answer key hidden');
  expect(await api('POST', '/api/courses/' + courseId + '/quiz/submit', {
    answers: learnerQuiz.questions.map((q, i) => ({ questionId: q.id, optionIndex: i === 0 ? 1 : 1 })),
  }, 'studentA'), 201, 'student completes quiz');
  const autoRow = expect(await api('GET', '/api/courses/' + courseId + '/gradebook', undefined, 'teacher'), 200, 'automatic gradebook').students.find(s => s.userId === first.id);
  assert.equal(autoRow.scores.usual, 82, 'assignment average populates usual score');
  assert.equal(autoRow.scores.quiz, 50, 'quiz result populates class quiz score');
  assert.equal(autoRow.total, null, 'overall grade remains pending until weighted categories are complete');

  // Gradebook weights and per-student category scores.
  forbidden(await api('GET', '/api/courses/' + courseId + '/gradebook', undefined, 'studentA'), 'student cannot see teacher gradebook');
  const badWeights = await api('PUT', '/api/courses/' + courseId + '/gradebook/weights', { weights: { usual: 20, quiz: 20, midterm: 20, final: 20 } }, 'teacher');
  assert.equal(badWeights.status, 400, 'weights not totaling 100 are rejected');
  expect(await api('PUT', '/api/courses/' + courseId + '/gradebook/weights', { weights: { usual: 20, quiz: 20, midterm: 25, final: 35 } }, 'teacher'), 200, 'teacher sets weights');
  const gradeRow = expect(await api('PATCH', '/api/courses/' + courseId + '/gradebook/' + first.id, {
    scores: { usual: 80, quiz: 70, midterm: 90, final: 100 },
  }, 'teacher'), 200, 'teacher grades student').student;
  if (gradeRow) closeEnough(gradeRow.total, 87.5, 'returned weighted grade');
  const gradebook = expect(await api('GET', '/api/courses/' + courseId + '/gradebook', undefined, 'teacher'), 200, 'teacher gradebook');
  const row = gradebook.students.find(s => s.userId === first.id);
  assert.ok(row, 'student appears in gradebook');
  closeEnough(row.total, 87.5, 'teacher weighted grade');
  const ownGrades = expect(await api('GET', '/api/student/grades', undefined, 'studentA'), 200, 'student own grades').courses;
  const ownCourse = ownGrades.find(c => c.courseId === courseId);
  assert.ok(ownCourse);
  closeEnough(ownCourse.total, 87.5, 'student weighted grade');
  assert.deepEqual(ownCourse.weights, { usual: 20, quiz: 20, midterm: 25, final: 35 });
  assert.equal(ownCourse.assignmentAverage, 82);
  const otherGrades = expect(await api('GET', '/api/student/grades', undefined, 'studentB'), 200, 'other student grades').courses;
  assert.ok(!otherGrades.some(c => c.courseId === courseId && c.total === 87.5), 'student B cannot view student A result');
  forbidden(await api('GET', '/api/student/grades', undefined, 'teacher'), 'teacher cannot use student-only grade endpoint');

  // Video upload is served only to an enrolled learner or course teacher.
  const lesson = expect(await api('POST', '/api/courses/' + courseId + '/lessons', {
    title: '视频课', type: 'video', duration: '1 分钟', content: '请观看视频', videoUrl: '',
  }, 'teacher'), 201, 'teacher creates video lesson').lesson;
  const mp4Header = Buffer.from([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
  const videoUpload = expect(await api('POST', '/api/lessons/' + lesson.id + '/video', mp4Header, 'teacher', 'video/mp4', { 'X-File-Name': 'intro.mp4' }), 200, 'teacher uploads video');
  assert.ok(videoUpload.lesson.videoFileUrl);
  const videoUrl = videoUpload.lesson.videoFileUrl;
  expect(await api('GET', videoUrl, undefined, 'studentA'), 200, 'enrolled student streams video');
  forbidden(await api('GET', videoUrl, undefined), 'guest cannot stream video');
  const studentVideoUpload = await api('POST', '/api/lessons/' + lesson.id + '/video', mp4Header, 'studentA', 'video/mp4', { 'X-File-Name': 'illegal.mp4' });
  forbidden(studentVideoUpload, 'student cannot change lesson video');
  expect(await api('POST', '/api/courses/' + courseId + '/unenroll', {}, 'studentB'), 200, 'student B withdraws again');
  forbidden(await api('GET', videoUrl, undefined, 'studentB'), 'withdrawn student cannot stream video');
  forbidden(await api('GET', '/api/courses/' + courseId + '/assignments', undefined, 'studentB'), 'withdrawn student cannot see assignments');
  assert.ok(!expect(await api('GET', '/api/student/grades', undefined, 'studentB'), 200, 'withdrawn student grade list').courses.some(c => c.courseId === courseId));
  const resubmitted = expect(await api('POST', '/api/assignments/' + assignment.id + '/submit', { content: '修订后的分析报告' }, 'studentA'), 200, 'student A resubmits').submission;
  assert.equal(resubmitted.score, null, 'resubmission invalidates previous score');
  assert.equal(resubmitted.feedback, '', 'resubmission clears prior feedback');
  assert.equal(resubmitted.id, submission.id, 'resubmission keeps submission identity');
  const persisted = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
  assert.ok(persisted.assignments.length);
  assert.ok(persisted.submissions.length);
  console.log('PASS: enrollment codes, unsubscribe/rejoin, assignment submission/upload/grading/stats, weighted teacher/student grades, video upload/read, access control');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  fs.rmSync(tempDir, { recursive: true, force: true });
});
