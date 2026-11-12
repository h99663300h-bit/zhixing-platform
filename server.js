// A small, dependency-free learning platform API and static file server.
// Data is written atomically to data/platform.json on each change.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { streamZip } = require('./zip-stream');
const storage = require('./storage');
const sched = require('./scheduling');
const resetMail = require('./email-smtp');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = process.env.DATA_FILE ? path.resolve(process.env.DATA_FILE) : path.join(DATA_DIR, 'platform.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(path.dirname(DATA_FILE), 'uploads');
const sessions = new Map();
const loginFailures = new Map();
const SESSION_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_BODY = 1_000_000;
const MAX_VIDEO = 80 * 1024 * 1024;
const MAX_ASSIGNMENT_FILE = 15 * 1024 * 1024;
const MAX_AVATAR = 3 * 1024 * 1024;
const MAX_RESOURCE_FILE = 15 * 1024 * 1024;
const MAX_FOLDER_FILES = 50;
const RESET_MS = 30 * 60 * 1000;
const resetTokens = new Map();
const resetAttempts = new Map();
const DEFAULT_WEIGHTS = Object.freeze({ usual: 30, quiz: 20, midterm: 20, final: 30 });
const GRADE_KEYS = Object.keys(DEFAULT_WEIGHTS);

function id(prefix) { return `${prefix}_${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }
function newEnrollmentCode(existing) {
  let code;
  do { code = crypto.randomBytes(5).toString('hex').toUpperCase(); }
  while (existing.some(course => course.enrollmentCode === code));
  return code;
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, expected] = stored.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(actual, expectedBuffer);
}
function ensureSeed() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  if (process.env.DEMO_SEED !== '1') {
    const empty = { users: [], schools: [], courses: [], enrollments: [], quizzes: [], attempts: [], posts: [], activity: [], assignments: [], submissions: [], grades: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(empty, null, 2), { mode: 0o600 });
    return empty;
  }
  const teacher = {
    id: id('user'), role: 'teacher', name: process.env.DEMO_TEACHER_NAME || 'Instructor Lee',
    email: (process.env.DEMO_TEACHER_EMAIL || 'teacher@university.edu').toLowerCase(),
    studentId: null, passwordHash: hashPassword(process.env.DEMO_TEACHER_PASSWORD || 'Teacher123!'),
    createdAt: now()
  };
  const seedCourses = [
    { title: 'Learning in the Digital Age', category: 'General Education', description: 'Develop independent learning, research, and knowledge-management skills with clear feedback at every step.', cover: 'learning', color: '#6c5ce7', lessons: [
      ['Getting Started with Independent Learning', 'video', '12 min', 'University learning begins with clear goals. Set one measurable goal for this week and break it into daily actions.', ''],
      ['Finding and Evaluating Sources', 'reading', '18 min', 'Start with academic databases and primary sources. Check the author, publication date, and research methods. Keep citations and verify claims.', ''],
      ['Building a Personal Study Plan', 'reading', '15 min', 'Review your time, understanding, and next steps every week. Use spaced repetition and active recall to retain knowledge.', '']
    ], questions: [
      ['Which approach best checks whether you truly understand a concept?', ['Reread notes repeatedly', 'Recall and explain it without looking at notes', 'Only watch a video', 'Only save bookmarks'], 1],
      ['What should you check first when evaluating a source?', ['Page colors', 'The author and supporting evidence', 'Title length', 'Number of comments'], 1],
      ['What makes a study goal effective?', ['Keeping it vague', 'Making it measurable and time-bound', 'Never reviewing it', 'Depending entirely on peers'], 1]
    ] },
    { title: 'Introduction to Python Data Analysis', category: 'Digital Skills', description: 'Build practical data skills, from cleaning and visualization to interpreting results and solving real problems.', cover: 'data', color: '#198f86', lessons: [
      ['The Data Analysis Process', 'video', '14 min', 'Data analysis starts with defining a question, then collecting, cleaning, exploring, modeling, and communicating data. First decide what you need to answer.', ''],
      ['Cleaning and Organizing Data', 'reading', '20 min', 'Check missing values, duplicates, data types, and outliers. Document every decision so the result can be reproduced.', ''],
      ['Communicating Findings with Charts', 'reading', '17 min', 'Choose charts that fit the question: bars for comparison, lines for trends, and histograms for distributions. Label axes and units.', '']
    ], questions: [
      ['What is usually the first step in data analysis?', ['Choose chart colors', 'Define the question to solve', 'Train a model immediately', 'Delete all missing values'], 1],
      ['Which chart usually works best for trends over time?', ['Line chart', 'Pie chart', 'Word cloud', 'Scatter plot'], 0],
      ['What is the key principle when handling missing values?', ['Always delete them', 'Record and explain the chosen approach', 'Replace every value with zero', 'Ignore data types'], 1]
    ] },
    { title: 'Academic Research and Writing', category: 'Academic Skills', description: 'Learn to frame research questions, review literature, and cite sources responsibly in university-level work.', cover: 'research', color: '#dc8052', lessons: [
      ['Formulating a Research Question', 'video', '13 min', 'A research question should be clear, focused, and answerable with evidence. Define the subject, scope, and key concepts.', ''],
      ['Reading and Organizing Literature', 'reading', '22 min', 'Record each source’s argument, methods, and limitations, then compare how the studies connect.', ''],
      ['Citation and Academic Integrity', 'reading', '16 min', 'Cite ideas and data from others. Separate your own analysis from others’ work and retain complete references.', '']
    ], questions: [
      ['How should a good research question be framed?', ['As broadly as possible', 'Specifically enough to answer with evidence', 'As a personal opinion only', 'Without defining the scope'], 1],
      ['What is central to a literature review?', ['Copying studies in publication order', 'Comparing and synthesizing findings', 'Listing citations only', 'Ignoring research methods'], 1],
      ['What should you do when using someone else’s data?', ['Use it without explanation', 'Attribute and cite the source properly', 'Change the colors only', 'Mention it only in a presentation'], 1]
    ] }
  ];
  const db = { users: [teacher], schools: [], courses: [], enrollments: [], quizzes: [], attempts: [], posts: [], activity: [], assignments: [], submissions: [], grades: [] };
  for (const item of seedCourses) {
    const courseId = id('course');
    const { lessons: rawLessons, questions: rawQuestions, ...details } = item;
    const lessons = rawLessons.map(([title, type, duration, content, videoUrl], order) => ({ id: id('lesson'), title, type, duration, content, videoUrl, order, createdAt: now() }));
    db.courses.push({ id: courseId, ...details, teacherId: teacher.id, enrollmentCode: newEnrollmentCode(db.courses), gradeWeights: { ...DEFAULT_WEIGHTS }, lessons, createdAt: now(), updatedAt: now() });
    db.quizzes.push({ id: id('quiz'), courseId, title: `${item.title} · Knowledge Check`, questions: rawQuestions.map(([text, options, correctIndex]) => ({ id: id('question'), text, options, correctIndex })), updatedAt: now() });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), { mode: 0o600 });
  return db;
}
let db = ensureSeed();
let migrated = false;
if (!Array.isArray(db.schools)) { db.schools = []; migrated = true; }
for (const key of ['assignments', 'submissions', 'grades', 'departments', 'announcements']) if (!Array.isArray(db[key])) { db[key] = []; migrated = true; }
for (const user of db.users) {
  if (typeof user.gender !== 'string') { user.gender = ''; migrated = true; }
  if (typeof user.grade !== 'string') { user.grade = ''; migrated = true; }
  if (typeof user.department !== 'string') { user.department = ''; migrated = true; }
  if (typeof user.major !== 'string') { user.major = ''; migrated = true; }
  if (!user.accountId && user.studentId) { user.accountId = user.studentId; migrated = true; }
  if (user.role === 'admin' && !user.schoolId && !user.adminScope) { user.adminScope = 'global'; migrated = true; }
}
for (const course of db.courses) {
  if (!course.enrollmentCode) { course.enrollmentCode = newEnrollmentCode(db.courses); migrated = true; }
  if (!course.gradeWeights) { course.gradeWeights = { ...DEFAULT_WEIGHTS }; migrated = true; }
  if (!Array.isArray(course.announcements)) { course.announcements = []; migrated = true; }
}
// An administrator exists only if deployment credentials are explicitly provided.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD && !db.users.some(u => u.role === 'admin')) {
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || password.length > 128) throw new Error('ADMIN_EMAIL must be valid and ADMIN_PASSWORD must have 12–128 characters');
  if (db.users.some(u => u.email.toLowerCase() === email)) throw new Error('ADMIN_EMAIL is already assigned to another account');
  db.users.push({ id: id('user'), role: 'admin', adminScope: 'global', name: process.env.ADMIN_NAME?.trim().slice(0, 60) || 'Site Administrator', email, studentId: null, passwordHash: hashPassword(password), active: true, createdAt: now() });
  migrated = true;
}
function migrateDb(target) {
  let changed = false;
  if (!Array.isArray(target.schools)) { target.schools = []; changed = true; }
  if (!target.scheduling || typeof target.scheduling !== 'object') { target.scheduling = {}; changed = true; }
  for (const key of ['assignments', 'submissions', 'grades', 'departments', 'announcements']) {
    if (!Array.isArray(target[key])) { target[key] = []; changed = true; }
  }
  for (const user of (target.users || [])) {
    if (typeof user.gender !== 'string') { user.gender = ''; changed = true; }
    if (typeof user.grade !== 'string') { user.grade = ''; changed = true; }
    if (typeof user.department !== 'string') { user.department = ''; changed = true; }
    if (typeof user.major !== 'string') { user.major = ''; changed = true; }
    if (!user.accountId && user.studentId) { user.accountId = user.studentId; changed = true; }
    if (user.role === 'admin' && !user.schoolId && !user.adminScope) { user.adminScope = 'global'; changed = true; }
  }
  for (const course of (target.courses || [])) {
    if (!course.enrollmentCode) { course.enrollmentCode = newEnrollmentCode(target.courses); changed = true; }
    if (!course.gradeWeights) { course.gradeWeights = { ...DEFAULT_WEIGHTS }; changed = true; }
    if (!Array.isArray(course.announcements)) { course.announcements = []; changed = true; }
  }
  return changed;
}
let remoteSaveChain = Promise.resolve();
function queueRemoteDbSave() {
  const cfg = storage.getConfig();
  if (!cfg.enabled) return;
  const snapshot = JSON.stringify(db, null, 2);
  remoteSaveChain = remoteSaveChain
    .then(() => storage.putObject(cfg.dbKey, snapshot, 'application/json'))
    .catch(err => console.error('Remote DB sync error:', err.message));
}
function saveLocal() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, DATA_FILE);
}
function save() {
  saveLocal();
  queueRemoteDbSave();
}
if (migrated) saveLocal();
const readyPromise = (async () => {
  const cfg = storage.getConfig();
  if (!cfg.enabled) return;
  try {
    const raw = await storage.getObject(cfg.dbKey);
    if (raw) {
      const parsed = JSON.parse(raw.toString('utf8'));
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.users)) {
        db = parsed;
        migrateDb(db);
        saveLocal();
      }
    } else if (db.users.length || db.schools.length || db.courses.length) {
      await storage.putObject(cfg.dbKey, JSON.stringify(db, null, 2), 'application/json');
    }
  } catch (err) {
    console.error('Remote DB bootstrap error:', err.message);
  }
})();

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
function fail(status, message) { throw new HttpError(status, message); }
function json(res, status, value, extra = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin', ...extra
  });
  res.end(JSON.stringify(value));
}
function sessionCookie(req, token, maxAge) {
  const secure = Boolean(req.socket.encrypted || (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https'));
  return `lms_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
function getUser(req) {
  const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('lms_session='));
  if (!cookie) return null;
  const token = cookie.slice('lms_session='.length);
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const session = sessions.get(key);
  if (!session) return null;
  if (session.expiresAt < Date.now()) { sessions.delete(key); return null; }
  return db.users.find(u => u.id === session.userId && u.active !== false) || null;
}
function publicUser(user) {
  if (!user) return null;
  const school = db.schools.find(item => item.id === user.schoolId);
  const pendingSchool = user.pendingSchoolId ? db.schools.find(item => item.id === user.pendingSchoolId) : null;
  return { id: user.id, role: user.role, name: user.name, email: user.email, studentId: user.studentId, accountId: user.accountId || user.studentId || null, gender: user.gender || '', grade: user.grade || '', department: user.department || '', major: user.major || '', active: user.active !== false,
    school: school ? { id: school.id, name: school.name, code: school.code } : null,
    pendingSchool: pendingSchool ? { id: pendingSchool.id, name: pendingSchool.name, code: pendingSchool.code } : null,
    avatarUrl: user.avatarFile ? '/api/profile/avatar/' + encodeURIComponent(user.id) : '' };
}
function requireUser(user) { if (!user) fail(401, 'Please sign in first'); return user; }
function requireRole(user, role) { requireUser(user); if (user.role !== role) fail(403, 'You do not have permission to perform this action'); return user; }
function requireAdmin(user) { return requireRole(user, 'admin'); }
function isGlobalAdmin(user) { return user?.role === 'admin' && (user.adminScope === 'global' || !user.schoolId); }
function canAdminManage(admin, target) { return isGlobalAdmin(admin) || Boolean(admin?.schoolId && target?.schoolId === admin.schoolId); }
function invalidateSessions(userId) { for (const [key, session] of sessions) if (session.userId === userId) sessions.delete(key); }
function courseById(courseId) { const course = db.courses.find(c => c.id === courseId); if (!course) fail(404, 'Course not found'); return course; }
function quizByCourse(courseId) { return db.quizzes.find(q => q.courseId === courseId) || null; }
function enrollment(userId, courseId) { return db.enrollments.find(e => e.userId === userId && e.courseId === courseId); }
function courseTeacherIds(course) {
  const list = Array.isArray(course?.teacherIds) ? course.teacherIds.filter(Boolean) : [];
  if (course?.teacherId && !list.includes(course.teacherId)) list.unshift(course.teacherId);
  return list;
}
function isCourseTeacher(user, course) {
  return Boolean(user && user.role === 'teacher' && courseTeacherIds(course).includes(user.id));
}
function canManageCourse(user, course) {
  if (!user || !course) return false;
  if (user.role === 'teacher') return isCourseTeacher(user, course);
  if (user.role === 'admin') {
    if (isGlobalAdmin(user)) return true;
    const teachers = courseTeacherIds(course).map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
    return Boolean((user.schoolId && course.schoolId === user.schoolId) || teachers.some(t => canAdminManage(user, t)));
  }
  return false;
}
function ownedCourse(user, course) {
  requireUser(user);
  if (!canManageCourse(user, course)) fail(403, 'You can only manage courses in your own workspace');
  return course;
}
function courseByLesson(lessonId) {
  const course = db.courses.find(c => c.lessons.some(l => l.id === lessonId));
  if (!course) fail(404, 'Lesson not found');
  return { course, lesson: course.lessons.find(l => l.id === lessonId) };
}
function folderById(lesson, folderId) {
  const folder = (lesson.resourceFolders || []).find(f => f.id === folderId);
  if (!folder) fail(404, 'Folder not found');
  return folder;
}
function publicFolder(folder) { return { id: folder.id, name: folder.name, files: (folder.files || []).map(f => ({ id: f.id, name: f.name, size: f.size, mimeType: f.mimeType })) }; }
function publicFolders(lesson) { return (lesson.resourceFolders || []).map(publicFolder); }
function canStudy(user, course) { requireUser(user); if (['teacher', 'admin'].includes(user.role)) return ownedCourse(user, course); if (!enrollment(user.id, course.id)) fail(403, 'Enroll in the course first'); return course; }
function progressFor(userId, course) {
  const enrolled = enrollment(userId, course.id);
  const completed = enrolled ? enrolled.completedLessonIds.filter(lessonId => course.lessons.some(l => l.id === lessonId)) : [];
  return { enrolled: Boolean(enrolled), completedLessonIds: completed, progress: course.lessons.length ? Math.round(completed.length / course.lessons.length * 100) : 0 };
}
function serializeCourse(course, user) {
  const tIds = courseTeacherIds(course);
  const teachers = tIds.map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
  const teacherNames = teachers.map(t => t.name).join(', ') || 'Instructor';
  const p = user && user.role === 'student' ? progressFor(user.id, course) : { enrolled: false, completedLessonIds: [], progress: 0 };
  const canSeeLessonContent = Boolean(user && ((user.role === 'student' && p.enrolled) || canManageCourse(user, course)));
  const lessons = [...course.lessons].sort((a, b) => a.order - b.order).map(lesson =>
    canSeeLessonContent
      ? { ...lesson, videoFile: undefined, videoFileUrl: lesson.videoFile ? '/api/lessons/' + lesson.id + '/video' : '' }
      : { ...lesson, content: '', videoUrl: '', videoFile: undefined, videoFileUrl: '' });
  const { enrollmentCode, ...publicCourse } = course;
  const announcements = canSeeLessonContent ? (course.announcements || []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) : [];
  return { ...publicCourse, teacherIds: tIds, ...(canManageCourse(user, course) ? { enrollmentCode } : {}), teacherName: teacherNames, lessons, announcements, ...p,
    studentCount: db.enrollments.filter(e => e.courseId === course.id).length, quizAvailable: Boolean(quizByCourse(course.id)?.questions.length) };
}
function recentActivity(kind, userId, courseId, detail) {
  db.activity.unshift({ id: id('activity'), kind, userId, courseId, detail, createdAt: now() });
  db.activity = db.activity.slice(0, 100);
}
function safeText(value, label, max, required = true) {
  if (typeof value !== 'string') { if (!required && value == null) return ''; fail(400, `${label} has an invalid format`); }
  const text = value.trim();
  if (required && !text) fail(400, `${label} is required`);
  if (text.length > max) fail(400, `${label} must be no longer than ${max} characters`);
  return text;
}
function normalizeSchoolName(value) { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase(); }
function schoolCodeExists(code) { return db.schools.some(school => school.code.toUpperCase() === code.toUpperCase()); }
function schoolCode() {
  let code;
  do { code = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (schoolCodeExists(code));
  return code;
}
function resolveSchool(identifier) {
  const value = safeText(identifier ?? '', 'School code or name', 100, false);
  if (!value) return null;
  const byCode = db.schools.find(school => school.code.toUpperCase() === value.toUpperCase());
  if (byCode) return byCode;
  const matches = db.schools.filter(school => normalizeSchoolName(school.name) === normalizeSchoolName(value));
  if (matches.length > 1) fail(409, 'More than one school has this name. Use its school code instead.');
  if (!matches.length) fail(404, 'School not found. Check the school code or exact school name.');
  return matches[0];
}
function resolveSchoolFields(body) {
  const identifiers = [body.school, body.schoolCode, body.schoolName]
    .filter(value => value != null && !(typeof value === 'string' && !value.trim()));
  const matches = identifiers.map(resolveSchool);
  if (new Set(matches.map(school => school.id)).size > 1) fail(400, 'School code and school name refer to different organizations');
  return matches[0] || null;
}
function courseFields(body, existing = null) {
  const next = {};
  for (const [key, label, max, required] of [['title','Course title',100,true],['description','Course description',2000,true],['category','Course category',40,true],['cover','Cover type',80,false],['color','Theme color',16,false]]) {
    if (body[key] !== undefined || !existing) next[key] = safeText(body[key] ?? (required ? '' : ''), label, max, required);
  }
  if (next.color && !/^#[0-9a-fA-F]{6}$/.test(next.color)) fail(400, 'Theme color must use #RRGGBB format');
  if (body.enrollmentCode !== undefined) {
    const code = safeText(body.enrollmentCode, 'Enrollment code', 20).toUpperCase();
    if (!/^[A-Z0-9-]{4,20}$/.test(code)) fail(400, 'Enrollment code must contain 4–20 letters, numbers, or hyphens');
    if (db.courses.some(course => course.id !== existing?.id && course.enrollmentCode?.toUpperCase() === code)) fail(409, 'This enrollment code is already used by another course');
    next.enrollmentCode = code;
  } else if (!existing) next.enrollmentCode = newEnrollmentCode(db.courses);
  return next;
}
function lessonFields(body, existing = null) {
  const next = {};
  for (const [key, label, max, required] of [['title','Lesson title',120,true],['type','Lesson type',20,false],['duration','Lesson duration',30,false],['content','Lesson content',30000,false],['videoUrl','Video URL',1000,false]]) {
    if (body[key] !== undefined || !existing) next[key] = safeText(body[key] ?? '', label, max, required);
  }
  if (next.videoUrl && !/^https?:\/\//i.test(next.videoUrl)) fail(400, 'Video URL must start with http:// or https://');
  if (next.type && !['video', 'reading', 'assignment'].includes(next.type)) fail(400, 'Invalid lesson type');
  return next;
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0, chunks = [];
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Submitted content is too large')); req.destroy(); return; } chunks.push(chunk); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!body || Array.isArray(body) || typeof body !== 'object') fail(400, 'Invalid submission format'); resolve(body); }
      catch (error) { reject(error instanceof HttpError ? error : new HttpError(400, 'Please submit valid JSON')); }
    });
    req.on('error', reject);
  });
}
function readBinary(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let tooLarge = false;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { tooLarge = true; return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) reject(new HttpError(413, 'Uploaded file is too large'));
      else if (!size) reject(new HttpError(400, 'Please choose a file'));
      else resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}
function cleanFileName(req) {
  const raw = req.headers['x-file-name'];
  let decoded = Array.isArray(raw) ? raw[0] : (raw || 'File');
  try { decoded = decodeURIComponent(decoded); } catch {}
  return String(decoded).replace(/[\/\\\r\n\x00-\x1f]/g, '_').slice(0, 150) || 'File';
}
async function saveUpload(buffer, req, extension) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  const storedName = crypto.randomUUID() + extension;
  const mimeType = req.headers['content-type'].split(';')[0].trim().toLowerCase();
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer, { flag: 'wx', mode: 0o600 });
  if (storage.getConfig().enabled) {
    await storage.putObject(`uploads/${storedName}`, buffer, mimeType);
  }
  return { storedName, name: cleanFileName(req), mimeType, size: buffer.length };
}
function removeUpload(meta) {
  if (meta?.storedName && /^[0-9a-f-]{36}\.[a-z0-9]+$/.test(meta.storedName)) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, meta.storedName)); } catch {}
    if (storage.getConfig().enabled) {
      storage.deleteObject(`uploads/${meta.storedName}`).catch(() => {});
    }
  }
}
async function ensureLocalFile(storedName) {
  if (!storedName || !/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(storedName)) return null;
  const file = path.join(UPLOAD_DIR, storedName);
  if (fs.existsSync(file)) return file;
  if (!storage.getConfig().enabled) return file;
  const buf = await storage.getObject(`uploads/${storedName}`);
  if (!buf) return file;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, buf, { mode: 0o600 });
  return file;
}
async function streamUpload(req, res, meta, video = false) {
  if (!meta?.storedName || !/^[0-9a-f-]{36}\.[a-z0-9]+$/.test(meta.storedName)) fail(404, 'File not found');
  const file = await ensureLocalFile(meta.storedName);
  let stat;
  try { stat = fs.statSync(file); } catch { fail(404, 'File not found'); }
  const headers = {
    'Content-Type': video ? meta.mimeType : 'application/octet-stream',
    'Content-Disposition': (video ? 'inline' : 'attachment') + "; filename*=UTF-8''" + encodeURIComponent(meta.name || 'file'),
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Accept-Ranges': 'bytes'
  };
  const range = req.headers.range;
  if (video && range) {
    const match = String(range).match(/^bytes=(\d*)-(\d*)$/);
    if (!match) fail(416, 'Invalid video range');
    const start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2] || 0));
    const end = match[2] && match[1] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end >= stat.size) fail(416, 'Invalid video range');
    res.writeHead(206, { ...headers, 'Content-Range': 'bytes ' + start + '-' + end + '/' + stat.size, 'Content-Length': end - start + 1 });
    fs.createReadStream(file, { start, end }).pipe(res); return;
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
}
function validateQuiz(questions) {
  if (!Array.isArray(questions) || questions.length > 50) fail(400, 'Quiz questions must be an array of no more than 50 items');
  return questions.map(q => {
    const text = safeText(q?.text, 'Question', 1000);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) fail(400, 'Each question must have 2–6 options');
    const options = q.options.map(o => safeText(o, 'Option', 500));
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= options.length) fail(400, 'Invalid correct-answer index');
    return { id: typeof q.id === 'string' && q.id.length < 100 ? q.id : id('question'), text, options, correctIndex: q.correctIndex };
  });
}
function serializeQuiz(quiz, user) {
  if (!quiz) return null;
  return { ...quiz, questions: quiz.questions.map(q => ['teacher', 'admin'].includes(user?.role) ? { ...q } : { id: q.id, text: q.text, options: q.options }) };
}
function studentEnrollmentDetails(student, course) {
  const enrolled = enrollment(student.id, course.id);
  if (!enrolled) return null;
  const attempts = db.attempts.filter(a => a.userId === student.id && a.courseId === course.id);
  return { courseId: course.id, courseTitle: course.title, progress: progressFor(student.id, course).progress,
    completedLessons: enrolled.completedLessonIds.length, totalLessons: course.lessons.length, lastActiveAt: enrolled.lastActiveAt,
    bestQuizScore: attempts.length ? Math.max(...attempts.map(a => a.percent)) : null };
}

function assignmentById(assignmentId) {
  const assignment = db.assignments.find(a => a.id === assignmentId);
  if (!assignment) fail(404, 'Assignment not found');
  return assignment;
}
function assignmentFields(body, existing = null) {
  const fields = {};
  if (!existing || body.title !== undefined) fields.title = safeText(body.title, 'Assignment title', 150);
  if (!existing || body.instructions !== undefined) fields.instructions = safeText(body.instructions, 'Assignment instructions', 10000, false);
  if (!existing || body.dueAt !== undefined) {
    const dueAt = safeText(body.dueAt ?? '', 'Due date', 40, false);
    if (dueAt && Number.isNaN(Date.parse(dueAt))) fail(400, 'Invalid due date');
    fields.dueAt = dueAt ? new Date(dueAt).toISOString() : null;
  }
  if (!existing || body.maxScore !== undefined) {
    const score = Number(body.maxScore ?? 100);
    if (!Number.isFinite(score) || score <= 0 || score > 1000) fail(400, 'Maximum assignment score must be greater than 0 and no more than 1000');
    fields.maxScore = score;
  }
  return fields;
}
function serializeSubmission(submission) {
  if (!submission) return null;
  const student = db.users.find(u => u.id === submission.userId);
  return { id: submission.id, assignmentId: submission.assignmentId, userId: submission.userId,
    studentName: student?.name || 'Student', studentId: student?.studentId || '', content: submission.content,
    fileName: submission.file?.name || '', fileUrl: submission.file ? '/api/submissions/' + submission.id + '/file' : '',
    score: submission.score ?? null, feedback: submission.feedback || '', submittedAt: submission.submittedAt, gradedAt: submission.gradedAt || null };
}
function serializeAssignment(assignment, user) {
  const submissions = db.submissions.filter(s => s.assignmentId === assignment.id);
  const stats = { submitted: submissions.length, graded: submissions.filter(s => s.score != null).length,
    totalStudents: db.enrollments.filter(e => e.courseId === assignment.courseId).length };
  return { ...assignment, ...(['teacher', 'admin'].includes(user.role) ? { stats } : { submission: serializeSubmission(submissions.find(s => s.userId === user.id)) }) };
}
function validateWeights(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'Please set grade weights');
  const weights = {};
  for (const key of GRADE_KEYS) {
    const value = Number(input[key]);
    if (!Number.isFinite(value) || value < 0 || value > 100) fail(400, 'Each grade weight must be between 0 and 100');
    weights[key] = value;
  }
  if (Math.abs(Object.values(weights).reduce((sum, value) => sum + value, 0) - 100) > 0.000001) fail(400, 'Grade weights must total 100%');
  return weights;
}
function gradeFor(course, userId) {
  const weights = course.gradeWeights || DEFAULT_WEIGHTS;
  const manual = db.grades.find(g => g.courseId === course.id && g.userId === userId)?.scores || {};
  const graded = db.assignments.filter(a => a.courseId === course.id).flatMap(a => db.submissions.filter(s => s.assignmentId === a.id && s.userId === userId && s.score != null).map(s => s.score / a.maxScore * 100));
  const assignmentAverage = graded.length ? Math.round(graded.reduce((sum, score) => sum + score, 0) / graded.length * 100) / 100 : null;
  const attempts = db.attempts.filter(a => a.courseId === course.id && a.userId === userId);
  const quizBest = attempts.length ? Math.max(...attempts.map(a => a.percent)) : null;
  const scores = {}, sources = {};
  for (const key of GRADE_KEYS) {
    const automatic = key === 'usual' ? assignmentAverage : key === 'quiz' ? quizBest : null;
    scores[key] = manual[key] ?? automatic;
    sources[key] = manual[key] != null ? 'teacher' : automatic != null ? (key === 'usual' ? 'assignments' : 'quiz') : 'pending';
  }
  const complete = GRADE_KEYS.every(key => !weights[key] || scores[key] != null);
  const total = complete ? Math.round(GRADE_KEYS.reduce((sum, key) => sum + (scores[key] ?? 0) * weights[key] / 100, 0) * 100) / 100 : null;
  return { weights, scores, sources, total, assignmentAverage, quizBest };
}
function studentGradeDetails(course, userId) {
  const classmates = db.enrollments.filter(e => e.courseId === course.id && db.users.some(u => u.id === e.userId && u.role === 'student' && u.active !== false));
  const ownTotal = gradeFor(course, userId).total;
  const rank = ownTotal == null ? null : 1 + classmates.filter(e => { const total = gradeFor(course, e.userId).total; return total != null && total > ownTotal; }).length;
  const assignments = db.assignments.filter(a => a.courseId === course.id).flatMap(assignment => {
    const submission = db.submissions.find(s => s.assignmentId === assignment.id && s.userId === userId);
    if (!submission) return [];
    return [...(submission.history || []), submission].map(s => ({ id: assignment.id, title: assignment.title, maxScore: assignment.maxScore, score: s.score ?? null, feedback: s.feedback || '', submittedAt: s.submittedAt, gradedAt: s.gradedAt || null }));
  }).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  const quizTitle = quizByCourse(course.id)?.title || 'Course Quiz';
  const quizAttempts = db.attempts.filter(a => a.courseId === course.id && a.userId === userId).map(a => ({ id: a.id, title: quizTitle, score: a.score, total: a.total, percent: a.percent, submittedAt: a.submittedAt })).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
  return { classSize: classmates.length, rank, assignments, quizAttempts };
}

async function api(req, res, url) {
  await readyPromise;
  const method = req.method;
  const pathname = url.pathname;
  const user = getUser(req);
  const isBinary = pathname === '/api/profile/avatar' || /^\/api\/lessons\/[^/]+\/video$/.test(pathname) || /^\/api\/assignments\/[^/]+\/submission\/file$/.test(pathname) || /^\/api\/lessons\/[^/]+\/folders\/[^/]+\/files$/.test(pathname);
  const body = ['POST','PATCH','PUT'].includes(method) && !isBinary ? await readBody(req) : {};
  if (pathname === '/api/health' && method === 'GET') return json(res, 200, { ok: true });
  if (pathname === '/api/auth/me' && method === 'GET') return json(res, 200, { user: publicUser(user) });
  if (pathname === '/api/profile' && method === 'GET') return json(res, 200, { profile: publicUser(requireUser(user)) });
  if (pathname === '/api/profile' && method === 'PATCH') {
    requireUser(user);
    if (Object.keys(body).some(key => !['name', 'gender', 'grade'].includes(key))) fail(400, 'Account ID, student ID, email, and account role cannot be changed');
    const next = {};
    if (body.name !== undefined) next.name = safeText(body.name, 'Name', 60);
    if (body.gender !== undefined) {
      const gender = safeText(body.gender, 'Gender', 30, false);
      // Retain the legacy values already stored for existing profiles.
      if (!['', 'Male', 'Female', 'Other', 'Prefer not to say', '\u7537', '\u5973', '\u5176\u4ed6', '\u4e0d\u4fbf\u900f\u9732'].includes(gender)) fail(400, 'Invalid gender option');
      next.gender = gender;
    }
    if (body.grade !== undefined) next.grade = safeText(body.grade, 'Grade', 30, false);
    Object.assign(user, next);
    save();
    return json(res, 200, { profile: publicUser(user) });
  }
  if (pathname === '/api/profile/organization' && method === 'POST') {
    requireUser(user);
    if (!['student', 'teacher'].includes(user.role)) fail(403, 'Only student and teacher accounts can join a school');
    if (user.schoolId) fail(409, 'This account is already linked to a school');
    const school = resolveSchoolFields(body);
    if (!school) fail(400, 'Enter a school code or exact school name');
    if (user.role === 'teacher') {
      user.pendingSchoolId = school.id;
      user.pendingSchoolRequestedAt = now();
    } else {
      user.schoolId = school.id;
    }
    save();
    return json(res, 200, { profile: publicUser(user) });
  }
  if (pathname === '/api/profile/avatar' && method === 'POST') {
    requireUser(user);
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const allowed = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
    const extension = allowed[mime];
    if (!extension) fail(415, 'Only PNG, JPEG, or WebP avatars are supported');
    const buffer = await readBinary(req, MAX_AVATAR);
    const valid = mime === 'image/png' ? buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : mime === 'image/jpeg' ? buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
      : buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    if (!valid) fail(415, 'The avatar file does not match its image format');
    const previous = user.avatarFile;
    const uploaded = await saveUpload(buffer, req, extension);
    user.avatarFile = uploaded;
    try { save(); } catch (error) { user.avatarFile = previous; removeUpload(uploaded); throw error; }
    removeUpload(previous);
    return json(res, 200, { profile: publicUser(user) });
  }
  const avatarMatch = pathname.match(/^\/api\/profile\/avatar\/([^/]+)$/);
  if (avatarMatch && method === 'GET') {
    requireUser(user);
    if (avatarMatch[1] !== user.id) fail(403, 'You cannot view another user’s avatar');
    const meta = user.avatarFile;
    if (!meta?.storedName || !/^[0-9a-f-]{36}\.(png|jpg|webp)$/.test(meta.storedName)) fail(404, 'Avatar not found');
    const file = await ensureLocalFile(meta.storedName);
    let stat;
    try { stat = fs.statSync(file); } catch { fail(404, 'Avatar not found'); }
    res.writeHead(200, { 'Content-Type': meta.mimeType, 'Content-Length': stat.size, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' });
    fs.createReadStream(file).pipe(res);
    return;
  }
  function accountIdTaken(value) {
    const key = String(value || '').toLowerCase();
    return Boolean(key && db.users.some(u => u.accountId?.toLowerCase() === key || u.studentId?.toLowerCase() === key));
  }
  function validateRoleAccountId(role, raw) {
    const label = role === 'student' ? 'Student Account ID' : role === 'teacher' ? 'Instructor Account ID' : 'Administrator Account ID';
    const value = safeText(raw, label, 32);
    if (role === 'student') {
      if (!/^\d{4,32}$/.test(value)) fail(400, 'Student account ID must contain only digits (4–32 digits)');
      return value;
    }
    const normalized = value.toLowerCase();
    if (role === 'teacher') {
      if (!/^tch\d{2,24}$/.test(normalized)) fail(400, 'Instructor account ID must start with tch followed by digits (e.g. tch202601)');
      return normalized;
    }
    if (role === 'admin') {
      const upper = value.toUpperCase();
      if (!/^[A-Z][A-Z0-9]{2,31}$/.test(upper)) fail(400, 'Administrator account ID must start with an English letter and use uppercase letters and digits (e.g. SIU199901)');
      return upper;
    }
    fail(400, 'Invalid account role');
  }
  if (pathname === '/api/auth/register' && method === 'POST') {
    const name = safeText(body.name, 'Name', 60);
    const email = safeText(body.email, 'Email', 254).toLowerCase();
    const role = body.role === undefined ? 'student' : body.role;
    if (!['student', 'teacher'].includes(role)) fail(400, 'Invalid account role');
    if (role === 'teacher' && body.studentId != null && body.studentId !== '') fail(400, 'Teacher accounts do not need a student ID');
    const accountId = validateRoleAccountId(role, role === 'student' ? (body.accountId ?? body.studentId) : body.accountId);
    const studentId = role === 'student' ? accountId : null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400, 'Password must contain 8–128 characters');
    if (db.users.some(u => u.email.toLowerCase() === email)) fail(409, 'This email is already registered');
    if (accountIdTaken(accountId)) fail(409, role === 'student' ? 'This student ID is already registered; each student can have only one account' : 'This account ID is already registered');
    const school = resolveSchoolFields(body);
    const newUser = {
      id: id('user'), role, name, email, studentId, accountId,
      schoolId: role === 'teacher' ? null : (school?.id || null),
      ...(role === 'teacher' && school ? { pendingSchoolId: school.id, pendingSchoolRequestedAt: now() } : {}),
      passwordHash: hashPassword(body.password), createdAt: now()
    };
    db.users.push(newUser); save();
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(crypto.createHash('sha256').update(token).digest('hex'), { userId: newUser.id, expiresAt: Date.now() + SESSION_MS });
    return json(res, 201, { user: publicUser(newUser) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_MS / 1000) });
  }
  if (pathname === '/api/auth/register-admin' && method === 'POST') {
    const name = safeText(body.name, 'Name', 60);
    const email = safeText(body.email, 'Email', 254).toLowerCase();
    const accountId = validateRoleAccountId('admin', body.accountId);
    const schoolName = safeText(body.schoolName, 'School name', 100);
    const requestedCode = safeText(body.schoolCode ?? '', 'School code', 16, false).toUpperCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400, 'Password must contain 8–128 characters');
    if (db.users.some(u => u.email.toLowerCase() === email)) fail(409, 'This email is already registered');
    if (accountIdTaken(accountId)) fail(409, 'This account ID is already registered');
    if (db.schools.some(school => normalizeSchoolName(school.name) === normalizeSchoolName(schoolName))) fail(409, 'This school already has an organization. Sign in with its administrator account or contact the site administrator.');
    if (requestedCode && !/^[A-Z0-9_-]{4,16}$/.test(requestedCode)) fail(400, 'School code must contain 4–16 letters, numbers, underscores, or hyphens');
    const code = requestedCode || schoolCode();
    if (schoolCodeExists(code)) fail(409, 'This school code is already in use');
    const school = { id: id('school'), name: schoolName, code, createdAt: now() };
    const newUser = { id: id('user'), role: 'admin', adminScope: 'school', schoolId: school.id, name, email, studentId: null, accountId, passwordHash: hashPassword(body.password), active: true, createdAt: now() };
    db.schools.push(school);
    db.users.push(newUser);
    try { save(); } catch (error) { db.schools.pop(); db.users.pop(); throw error; }
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(crypto.createHash('sha256').update(token).digest('hex'), { userId: newUser.id, expiresAt: Date.now() + SESSION_MS });
    return json(res, 201, { user: publicUser(newUser) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_MS / 1000) });
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    const identifier = safeText(body.identifier ?? body.account ?? body.email, 'Account ID or Email', 254).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const bucket = `${req.socket.remoteAddress || ''}:${identifier}`;
    const failure = loginFailures.get(bucket);
    if (failure && failure.until > Date.now() && failure.count >= 8) fail(429, 'Too many login attempts. Please try again later');
    const found = db.users.find(u => u.active !== false && (
      u.email.toLowerCase() === identifier ||
      (u.accountId && u.accountId.toLowerCase() === identifier) ||
      (u.studentId && u.studentId.toLowerCase() === identifier)
    ));
    if (!found || !checkPassword(password, found.passwordHash)) {
      loginFailures.set(bucket, { count: (failure?.until > Date.now() ? failure.count : 0) + 1, until: Date.now() + 15 * 60_000 });
      fail(401, 'Incorrect account ID/email or password');
    }
    loginFailures.delete(bucket);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(crypto.createHash('sha256').update(token).digest('hex'), { userId: found.id, expiresAt: Date.now() + SESSION_MS });
    return json(res, 200, { user: publicUser(found) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_MS / 1000) });
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('lms_session='));
    if (cookie) sessions.delete(crypto.createHash('sha256').update(cookie.slice('lms_session='.length)).digest('hex'));
    return json(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }
  if (pathname === '/api/auth/forgot-password' && method === 'POST') {
    const email = safeText(body.email, 'Email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address');
    if (!resetMail.configured()) fail(503, 'Password reset by email is unavailable. Contact the site administrator.');
    const bucket = `${req.socket.remoteAddress || ''}:${email}`;
    const last = resetAttempts.get(bucket) || 0;
    if (Date.now() - last < 60_000) fail(429, 'Please wait before requesting another reset email');
    resetAttempts.set(bucket, Date.now());
    const target = db.users.find(u => u.email.toLowerCase() === email && u.active !== false);
    if (target) {
      const token = crypto.randomBytes(32).toString('hex');
      const key = crypto.createHash('sha256').update(token).digest('hex');
      // Mail must be accepted before storing an active token. Never return it in HTTP.
      try {
        await resetMail.sendResetEmail(email, token);
        for (const [oldKey, entry] of resetTokens) if (entry.userId === target.id) resetTokens.delete(oldKey);
        resetTokens.set(key, { userId: target.id, expiresAt: Date.now() + RESET_MS });
      } catch (error) {
        // The response remains identical for registered and unknown addresses.
        console.error('Reset email failed:', error.message);
      }
    }
    return json(res, 200, { ok: true, message: 'If the email is registered, a reset link has been sent.' });
  }
  if (pathname === '/api/auth/reset-password' && method === 'POST') {
    const token = safeText(body.token, 'Reset token', 200);
    if (!/^[0-9a-f]{64}$/.test(token)) fail(400, 'Invalid or expired reset link');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400, 'Password must contain 8–128 characters');
    const key = crypto.createHash('sha256').update(token).digest('hex');
    const reset = resetTokens.get(key);
    const target = reset && db.users.find(u => u.id === reset.userId && u.active !== false);
    if (!reset || !target || reset.expiresAt < Date.now()) { resetTokens.delete(key); fail(400, 'Invalid or expired reset link'); }
    target.passwordHash = hashPassword(body.password);
    resetTokens.delete(key); invalidateSessions(target.id); save();
    return json(res, 200, { ok: true });
  }
  function parseCsvRows(text) {
    const clean = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], cell = '', inQuotes = false;
    for (let i = 0; i < clean.length; i++) {
      const ch = clean[i], next = clean[i + 1];
      if (inQuotes) {
        if (ch === '"' && next === '"') { cell += '"'; i++; }
        else if (ch === '"') inQuotes = false;
        else cell += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(cell.trim()); cell = '';
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && next === '\n') i++;
        row.push(cell.trim());
        if (row.some(Boolean)) rows.push(row);
        row = []; cell = '';
      } else {
        cell += ch;
      }
    }
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    return rows;
  }
  const IMPORT_HEADER_MAP = {
    '身份信息': 'role', '身份': 'role', '角色': 'role', 'role': 'role',
    '名字': 'name', '姓名': 'name', 'name': 'name',
    '性别': 'gender', 'gender': 'gender',
    '学号': 'studentId', 'studentid': 'studentId', 'student_id': 'studentId',
    '学校代码': 'schoolCode', 'schoolcode': 'schoolCode', 'school_code': 'schoolCode',
    '院系': 'department', '学院': 'department', 'department': 'department',
    '专业': 'major', 'major': 'major',
    '账号': 'accountId', 'accountid': 'accountId', 'account_id': 'accountId', 'account': 'accountId',
    '临时密码': 'password', '密码': 'password', 'password': 'password',
    '邮箱': 'email', 'email': 'email',
  };
  if (pathname === '/api/admin/import/template' && method === 'GET') {
    requireAdmin(user);
    const targetRole = url.searchParams.get('role') === 'teacher' ? 'teacher' : 'student';
    const adminSchool = user.schoolId ? db.schools.find(s => s.id === user.schoolId) : null;
    const sampleCode = adminSchool?.code || '1008611';
    const csv = targetRole === 'student'
      ? '\uFEFF身份信息,名字,性别,学号,学校代码,院系,专业,账号,临时密码\r\n' +
        `student,张三,男,20260101,${sampleCode},计算机学院,软件工程,20260101,Pass202601!\r\n`
      : '\uFEFF身份信息,名字,性别,学校代码,院系,专业,账号,临时密码\r\n' +
        `teacher,李老师,女,${sampleCode},计算机学院,人工智能,tch202601,Pass202601!\r\n`;
    const filename = targetRole === 'student' ? 'student-import-template.csv' : 'teacher-import-template.csv';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    });
    res.end(csv);
    return;
  }
  if (pathname === '/api/admin/import' && method === 'POST') {
    requireAdmin(user);
    const targetRole = body.role === 'teacher' ? 'teacher' : body.role === 'student' ? 'student' : fail(400, 'Invalid import role');
    const rows = parseCsvRows(body.csv);
    if (rows.length < 2) fail(400, 'CSV file must include a header row and at least one data row');
    const keys = rows[0].map(h => IMPORT_HEADER_MAP[h.toLowerCase()] || IMPORT_HEADER_MAP[h] || '');
    const requiredKeys = targetRole === 'student' ? ['role', 'name', 'studentId', 'password'] : ['role', 'name', 'accountId', 'password'];
    for (const reqKey of requiredKeys) {
      if (!keys.includes(reqKey)) fail(400, `Missing required column: ${reqKey}`);
    }
    const adminSchool = user.schoolId ? db.schools.find(s => s.id === user.schoolId) : null;
    const errors = [];
    const staged = [];
    const seenAccountIds = new Set();
    const seenEmails = new Set();
    for (let idx = 1; idx < rows.length; idx++) {
      const rawRow = rows[idx];
      const rec = {};
      keys.forEach((k, colIdx) => { if (k) rec[k] = rawRow[colIdx] ?? ''; });
      const rowNum = idx + 1;
      try {
        const rowRole = String(rec.role || '').trim().toLowerCase();
        const normalizedRole = rowRole === '学生' ? 'student' : (rowRole === '老师' || rowRole === '教师') ? 'teacher' : rowRole;
        if (normalizedRole !== targetRole) throw new Error(`Role must be "${targetRole}"`);
        const name = safeText(rec.name, 'Name', 60);
        const gender = safeText(rec.gender ?? '', 'Gender', 30, false);
        const department = safeText(rec.department ?? '', 'Department', 80, false);
        const major = safeText(rec.major ?? '', 'Major', 80, false);
        let school = adminSchool;
        const codeInput = String(rec.schoolCode || '').trim();
        if (codeInput) {
          const resolved = resolveSchool(codeInput);
          if (!isGlobalAdmin(user) && resolved.id !== user.schoolId) {
            throw new Error(`School code "${codeInput}" does not match your school`);
          }
          school = resolved;
        }
        let studentId = null;
        let accountId = null;
        if (targetRole === 'student') {
          studentId = validateRoleAccountId('student', rec.studentId);
          const rawAcct = String(rec.accountId || '').trim();
          if (rawAcct && rawAcct !== studentId) {
            throw new Error('Student accountId must match studentId');
          }
          accountId = studentId;
        } else {
          accountId = validateRoleAccountId('teacher', rec.accountId);
        }
        if (accountIdTaken(accountId) || seenAccountIds.has(accountId.toLowerCase())) {
          throw new Error(`Account ID "${accountId}" is already registered or duplicated`);
        }
        const password = String(rec.password || '');
        if (password.length < 8 || password.length > 128) {
          throw new Error('Temporary password must contain 8–128 characters');
        }
        let email = String(rec.email || '').trim().toLowerCase();
        if (email) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Invalid email "${email}"`);
          if (db.users.some(u => u.email.toLowerCase() === email) || seenEmails.has(email)) {
            throw new Error(`Email "${email}" is already registered or duplicated`);
          }
        } else {
          const domain = (school?.code || 'zhixing').toLowerCase().replace(/[^a-z0-9-]/g, '') + '.local';
          email = `${accountId.toLowerCase()}@${domain}`;
          let suffix = 1;
          while (db.users.some(u => u.email.toLowerCase() === email) || seenEmails.has(email)) {
            email = `${accountId.toLowerCase()}_${suffix++}@${domain}`;
          }
        }
        seenAccountIds.add(accountId.toLowerCase());
        seenEmails.add(email);
        staged.push({
          id: id('user'), role: targetRole, name, email, studentId, accountId,
          gender, department, major,
          schoolId: school?.id || null,
          passwordHash: hashPassword(password),
          active: true, createdAt: now(),
        });
      } catch (err) {
        errors.push({ row: rowNum, message: err.message });
      }
    }
    if (errors.length) {
      return json(res, 400, { error: `Import failed on ${errors.length} row(s): Row ${errors[0].row}: ${errors[0].message}`, errors });
    }
    db.users.push(...staged);
    save();
    return json(res, 201, { importedCount: staged.length, users: staged.map(publicUser) });
  }
  if (pathname === '/api/admin/backup/export' && method === 'GET') {
    requireAdmin(user);
    const global = isGlobalAdmin(user);
    const schools = global ? db.schools : db.schools.filter(s => s.id === user.schoolId);
    const users = global ? db.users : db.users.filter(u => u.schoolId === user.schoolId);
    const userIds = new Set(users.map(u => u.id));
    const teacherIds = new Set(users.filter(u => u.role === 'teacher').map(u => u.id));
    const courses = global ? db.courses : db.courses.filter(c => teacherIds.has(c.teacherId));
    const courseIds = new Set(courses.map(c => c.id));
    const payload = {
      exportedAt: now(),
      version: 2,
      schools,
      users,
      departments: global ? db.departments : db.departments.filter(d => d.schoolId === user.schoolId),
      announcements: global ? db.announcements : db.announcements.filter(a => !a.schoolId || a.schoolId === user.schoolId),
      courses,
      enrollments: global ? db.enrollments : db.enrollments.filter(e => courseIds.has(e.courseId) || userIds.has(e.userId)),
      quizzes: global ? db.quizzes : db.quizzes.filter(q => courseIds.has(q.courseId)),
      attempts: global ? db.attempts : db.attempts.filter(a => courseIds.has(a.courseId)),
      posts: global ? db.posts : db.posts.filter(pt => courseIds.has(pt.courseId)),
      activity: global ? db.activity : db.activity.filter(act => courseIds.has(act.courseId) || userIds.has(act.userId)),
      assignments: global ? db.assignments : db.assignments.filter(asg => courseIds.has(asg.courseId)),
      submissions: global ? db.submissions : db.submissions.filter(sub => courseIds.has(sub.courseId)),
      grades: global ? db.grades : db.grades.filter(g => courseIds.has(g.courseId)),
      scheduling: global ? (db.scheduling || {}) : { [user.schoolId || 'global']: sched.ensureScope(db, user.schoolId || 'global') },
    };
    const stamp = new Date().toISOString().slice(0, 10);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="zhixing-backup-${stamp}.json"`,
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(payload, null, 2));
    return;
  }
  if (pathname === '/api/admin/backup/merge' && method === 'POST') {
    requireAdmin(user);
    const data = body.backup && typeof body.backup === 'object' ? body.backup : body;
    if (!data || typeof data !== 'object') fail(400, 'Invalid backup JSON payload');
    const global = isGlobalAdmin(user);
    const merged = { schools: 0, users: 0, departments: 0, announcements: 0, courses: 0, enrollments: 0, quizzes: 0, attempts: 0, posts: 0, assignments: 0, submissions: 0, grades: 0 };

    const schoolIds = new Set(db.schools.map(s => s.id));
    const schoolCodes = new Set(db.schools.map(s => String(s.code || '').toUpperCase()));
    const schoolNames = new Set(db.schools.map(s => normalizeSchoolName(s.name)));
    for (const s of (Array.isArray(data.schools) ? data.schools : [])) {
      if (!s?.id || !s?.name) continue;
      if (!global && s.id !== user.schoolId) continue;
      const code = String(s.code || '').toUpperCase();
      const norm = normalizeSchoolName(s.name);
      if (schoolIds.has(s.id) || (code && schoolCodes.has(code)) || schoolNames.has(norm)) continue;
      db.schools.push({ ...s });
      schoolIds.add(s.id);
      if (code) schoolCodes.add(code);
      schoolNames.add(norm);
      merged.schools++;
    }

    const userIds = new Set(db.users.map(u => u.id));
    const userEmails = new Set(db.users.map(u => String(u.email || '').toLowerCase()));
    const userAccts = new Set(db.users.flatMap(u => [u.accountId, u.studentId].filter(Boolean).map(x => String(x).toLowerCase())));
    for (const u of (Array.isArray(data.users) ? data.users : [])) {
      if (!u?.id || !u?.email || !u?.passwordHash) continue;
      if (!global && u.schoolId !== user.schoolId) continue;
      const em = String(u.email).toLowerCase();
      const ids = [u.accountId, u.studentId].filter(Boolean).map(x => String(x).toLowerCase());
      if (userIds.has(u.id) || userEmails.has(em) || ids.some(x => userAccts.has(x))) continue;
      db.users.push({
        ...u,
        gender: typeof u.gender === 'string' ? u.gender : '',
        grade: typeof u.grade === 'string' ? u.grade : '',
        department: typeof u.department === 'string' ? u.department : '',
        major: typeof u.major === 'string' ? u.major : '',
        accountId: u.accountId || u.studentId || null,
        active: u.active !== false,
      });
      userIds.add(u.id);
      userEmails.add(em);
      ids.forEach(x => userAccts.add(x));
      merged.users++;
    }

    const deptIds = new Set(db.departments.map(d => d.id));
    for (const d of (Array.isArray(data.departments) ? data.departments : [])) {
      if (!d?.id || !d?.name || deptIds.has(d.id)) continue;
      if (!global && d.schoolId !== user.schoolId) continue;
      db.departments.push({ ...d });
      deptIds.add(d.id);
      merged.departments++;
    }

    const annIds = new Set(db.announcements.map(a => a.id));
    for (const a of (Array.isArray(data.announcements) ? data.announcements : [])) {
      if (!a?.id || !a?.title || annIds.has(a.id)) continue;
      if (!global && a.schoolId && a.schoolId !== user.schoolId) continue;
      db.announcements.push({ ...a });
      annIds.add(a.id);
      merged.announcements++;
    }

    const validTeacherIds = new Set(db.users.filter(u => u.role === 'teacher' && (global || u.schoolId === user.schoolId)).map(u => u.id));
    const courseIds = new Set(db.courses.map(c => c.id));
    const courseCodes = new Set(db.courses.map(c => String(c.enrollmentCode || '').toUpperCase()).filter(Boolean));
    for (const c of (Array.isArray(data.courses) ? data.courses : [])) {
      if (!c?.id || !c?.title || courseIds.has(c.id)) continue;
      if (!global && !validTeacherIds.has(c.teacherId)) continue;
      const code = String(c.enrollmentCode || '').toUpperCase();
      if (code && courseCodes.has(code)) continue;
      db.courses.push({ ...c, announcements: Array.isArray(c.announcements) ? c.announcements : [], gradeWeights: c.gradeWeights || { ...DEFAULT_WEIGHTS } });
      courseIds.add(c.id);
      if (code) courseCodes.add(code);
      merged.courses++;
    }

    const allowedCourseIds = new Set(db.courses.filter(c => global || validTeacherIds.has(c.teacherId)).map(c => c.id));
    const enrollKeys = new Set(db.enrollments.map(e => `${e.userId}:${e.courseId}`));
    for (const e of (Array.isArray(data.enrollments) ? data.enrollments : [])) {
      if (!e?.userId || !e?.courseId || enrollKeys.has(`${e.userId}:${e.courseId}`)) continue;
      if (!global && !allowedCourseIds.has(e.courseId)) continue;
      db.enrollments.push({ ...e });
      enrollKeys.add(`${e.userId}:${e.courseId}`);
      merged.enrollments++;
    }

    for (const [key, list] of [['quizzes', db.quizzes], ['attempts', db.attempts], ['posts', db.posts], ['assignments', db.assignments], ['submissions', db.submissions], ['grades', db.grades]]) {
      const seen = new Set(list.map(x => x.id));
      for (const item of (Array.isArray(data[key]) ? data[key] : [])) {
        if (!item?.id || seen.has(item.id)) continue;
        if (!global && item.courseId && !allowedCourseIds.has(item.courseId)) continue;
        list.push({ ...item });
        seen.add(item.id);
        merged[key]++;
      }
    }

    const actIds = new Set(db.activity.map(x => x.id));
    for (const act of (Array.isArray(data.activity) ? data.activity : [])) {
      if (!act?.id || actIds.has(act.id)) continue;
      if (!global && act.courseId && !allowedCourseIds.has(act.courseId)) continue;
      db.activity.push({ ...act });
      actIds.add(act.id);
    }

    if (data.scheduling && typeof data.scheduling === 'object') {
      if (!db.scheduling || typeof db.scheduling !== 'object') db.scheduling = {};
      for (const [sk, sv] of Object.entries(data.scheduling)) {
        if (!global && sk !== (user.schoolId || 'global')) continue;
        if (!db.scheduling[sk]) db.scheduling[sk] = sv;
      }
    }
    save();
    return json(res, 200, { ok: true, merged });
  }
  function schedScopeKey(u) { return u?.schoolId || 'global'; }
  function addAuditLog(scope, actor, action, detail, reason = '') {
    scope.auditLogs.unshift({ id: sched.id('log'), actorId: actor.id, actorName: actor.name, action, detail, reason, createdAt: sched.now() });
    if (scope.auditLogs.length > 500) scope.auditLogs.length = 500;
  }
  if (pathname === '/api/admin/schedule' && method === 'GET') {
    requireAdmin(user);
    const key = isGlobalAdmin(user) && url.searchParams.get('schoolId') ? url.searchParams.get('schoolId') : schedScopeKey(user);
    const scope = sched.ensureScope(db, key);
    const teachers = db.users.filter(u => u.role === 'teacher' && canAdminManage(user, u)).map(publicUser);
    const students = db.users.filter(u => u.role === 'student' && canAdminManage(user, u)).map(publicUser);
    const conflicts = sched.detectAllConflicts(scope);
    return json(res, 200, { scopeKey: key, scope, conflicts, teachers, students });
  }
  if (pathname === '/api/admin/schedule/settings' && method === 'PUT') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (body.schoolLevel !== undefined) scope.settings.schoolLevel = safeText(body.schoolLevel, 'School level', 30);
    if (body.campusName !== undefined) scope.settings.campusName = safeText(body.campusName, 'Campus name', 60);
    if (body.daysPerWeek !== undefined) {
      const d = Number(body.daysPerWeek);
      if (![5, 6].includes(d)) fail(400, 'Days per week must be 5 or 6');
      scope.settings.daysPerWeek = d;
    }
    if (Array.isArray(body.periods) && body.periods.length) {
      scope.settings.periods = body.periods.map((item, idx) => ({
        id: String(item.id || sched.id('p')),
        index: Number(item.index ?? idx + 1),
        name: safeText(item.name, 'Period name', 30),
        startTime: safeText(item.startTime, 'Start time', 10),
        endTime: safeText(item.endTime, 'End time', 10),
        isBreak: Boolean(item.isBreak),
        breakLabel: safeText(item.breakLabel ?? '', 'Break label', 30, false),
      }));
    }
    if (Array.isArray(body.blockedSlots)) {
      scope.settings.blockedSlots = body.blockedSlots.filter(b => b?.key).map(b => ({ key: String(b.key), reason: safeText(b.reason ?? '特殊时段', 'Reason', 60, false) }));
    }
    addAuditLog(scope, user, '更新作息设置', `每周 ${scope.settings.daysPerWeek} 天，${scope.settings.periods.length} 个时段`);
    save();
    return json(res, 200, { settings: scope.settings });
  }
  if (pathname === '/api/admin/schedule/grades' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const grade = {
      id: sched.id('grd'),
      name: safeText(body.name, 'Grade name', 40),
      code: safeText(body.code ?? '', 'Grade code', 20, false),
      maxWeeklyPeriods: Math.max(1, Math.min(60, Number(body.maxWeeklyPeriods || 40))),
      stratified: Boolean(body.stratified),
    };
    scope.grades.push(grade); save();
    return json(res, 201, { grade });
  }
  let sMatch = pathname.match(/^\/api\/admin\/schedule\/grades\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (scope.classes.some(c => c.gradeId === sMatch[1])) fail(409, '请先删除或移出该年级下的班级');
    scope.grades = scope.grades.filter(g => g.id !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/schedule/classes' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const cls = {
      id: sched.id('cls'),
      name: safeText(body.name, 'Class name', 50),
      code: safeText(body.code ?? '', 'Class code', 20, false),
      gradeId: String(body.gradeId || ''),
      type: ['admin', 'elective', 'interest'].includes(body.type) ? body.type : 'admin',
      headTeacherId: String(body.headTeacherId || ''),
      studentCount: Math.max(0, Number(body.studentCount || 0)),
      blockedSlots: Array.isArray(body.blockedSlots) ? body.blockedSlots.map(String) : [],
      studentIds: Array.isArray(body.studentIds) ? body.studentIds.map(String) : [],
    };
    scope.classes.push(cls); save();
    return json(res, 201, { cls });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/classes\/([^/]+)$/);
  if (sMatch && method === 'PATCH') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const cls = scope.classes.find(c => c.id === sMatch[1]);
    if (!cls) fail(404, 'Class not found');
    if (body.name !== undefined) cls.name = safeText(body.name, 'Class name', 50);
    if (body.blockedSlots !== undefined && Array.isArray(body.blockedSlots)) cls.blockedSlots = body.blockedSlots.map(String);
    if (body.studentIds !== undefined && Array.isArray(body.studentIds)) cls.studentIds = body.studentIds.map(String);
    if (body.headTeacherId !== undefined) cls.headTeacherId = String(body.headTeacherId || '');
    save();
    return json(res, 200, { cls });
  }
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (scope.entries.some(e => e.classId === sMatch[1])) fail(409, '该班级已有排课记录，请先清空或解除课表关联');
    scope.classes = scope.classes.filter(c => c.id !== sMatch[1]);
    scope.plans = scope.plans.filter(p => p.classId !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/schedule/subjects' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const subject = {
      id: sched.id('sub'),
      name: safeText(body.name, 'Subject name', 50),
      code: safeText(body.code ?? '', 'Subject code', 20, false),
      group: safeText(body.group ?? '', 'Subject group', 40, false),
      tier: ['major', 'minor', 'public'].includes(body.tier) ? body.tier : 'major',
      weeklyHours: Math.max(1, Math.min(30, Number(body.weeklyHours || 4))),
      preference: ['morning', 'afternoon', 'any'].includes(body.preference) ? body.preference : 'any',
      avoidLastPeriod: Boolean(body.avoidLastPeriod),
      consecutiveMode: ['none', 'allow', 'require'].includes(body.consecutiveMode) ? body.consecutiveMode : 'none',
      consecutiveCount: Number(body.consecutiveCount) === 3 ? 3 : 2,
      maxConsecutivePerWeek: Math.max(1, Math.min(10, Number(body.maxConsecutivePerWeek || 2))),
      roomType: safeText(body.roomType ?? 'normal', 'Room type', 30, false),
    };
    scope.subjects.push(subject); save();
    return json(res, 201, { subject });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/subjects\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (scope.entries.some(e => e.subjectId === sMatch[1])) fail(409, '该科目已有排课记录，请先解除关联');
    scope.subjects = scope.subjects.filter(s => s.id !== sMatch[1]);
    scope.plans = scope.plans.filter(p => p.subjectId !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/schedule/rooms' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const room = {
      id: sched.id('rm'),
      name: safeText(body.name, 'Room name', 50),
      type: safeText(body.type ?? 'normal', 'Room type', 30, false),
      capacity: Math.max(1, Number(body.capacity || 50)),
      blockedSlots: Array.isArray(body.blockedSlots) ? body.blockedSlots.map(String) : [],
    };
    scope.rooms.push(room); save();
    return json(res, 201, { room });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/rooms\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.rooms = scope.rooms.filter(r => r.id !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/teacher-rules\/([^/]+)$/);
  if (sMatch && method === 'PUT') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.teacherRules[sMatch[1]] = {
      availableSlots: Array.isArray(body.availableSlots) ? body.availableSlots.map(String) : [],
      blockedSlots: Array.isArray(body.blockedSlots) ? body.blockedSlots.map(String) : [],
      preference: ['morning', 'afternoon', 'any'].includes(body.preference) ? body.preference : 'any',
      maxDailyPeriods: Math.max(0, Math.min(15, Number(body.maxDailyPeriods || 0))),
      allowConsecutive: body.allowConsecutive !== false,
      avoidSameClassConsecutive: Boolean(body.avoidSameClassConsecutive),
    };
    save();
    return json(res, 200, { rule: scope.teacherRules[sMatch[1]] });
  }
  if (pathname === '/api/admin/schedule/plans' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const plan = {
      id: sched.id('pln'),
      classId: safeText(body.classId, 'Class', 60),
      subjectId: safeText(body.subjectId, 'Subject', 60),
      teacherId: safeText(body.teacherId, 'Teacher', 60),
      roomId: String(body.roomId || ''),
      weeklyHours: Math.max(1, Math.min(30, Number(body.weeklyHours || 2))),
      fixed: Boolean(body.fixed),
    };
    scope.plans.push(plan); save();
    return json(res, 201, { plan });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/plans\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.plans = scope.plans.filter(p => p.id !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/schedule/auto' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const result = sched.autoSchedule(scope, { gradeId: body.gradeId || '' });
    addAuditLog(scope, user, '一键智能排课', `成功排入 ${result.placedCount} 节，未排 ${result.unplaced.length} 项`);
    save();
    return json(res, 200, { ...result, entries: scope.entries });
  }
  if (pathname === '/api/admin/schedule/entries' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const ignore = body.id ? new Set([body.id]) : new Set();
    const candidate = {
      id: body.id || sched.id('ent'),
      planId: body.planId || 'custom',
      classId: safeText(body.classId, 'Class', 60),
      subjectId: safeText(body.subjectId, 'Subject', 60),
      teacherId: safeText(body.teacherId, 'Teacher', 60),
      roomId: body.roomId || null,
      day: Number(body.day),
      periodId: safeText(body.periodId, 'Period', 30),
      locked: Boolean(body.locked),
      temporary: Boolean(body.temporary),
      overrideReason: '',
      updatedAt: sched.now(),
    };
    const check = sched.checkPlacement(scope, candidate, ignore);
    if (!check.valid && !body.forceOverride) {
      const teachers = db.users.filter(u => u.role === 'teacher' && canAdminManage(user, u));
      return json(res, 409, {
        error: check.hard[0].message,
        hard: check.hard,
        warnings: check.warnings,
        alternatives: sched.suggestAlternatives(scope, candidate, 3),
        substitutes: sched.suggestSubstitutes(scope, teachers, candidate.day, candidate.periodId, candidate.subjectId),
      });
    }
    if (!check.valid && body.forceOverride) {
      const reason = safeText(body.overrideReason, '强制放行原因', 200);
      candidate.overrideReason = reason;
      addAuditLog(scope, user, '强制放行冲突排课', `${check.hard.map(h => h.message).join('；')}`, reason);
    } else {
      addAuditLog(scope, user, body.id ? '手动调课' : '手动排课', `周${candidate.day} ${candidate.periodId}`);
    }
    if (body.id) {
      const idx = scope.entries.findIndex(e => e.id === body.id);
      if (idx >= 0) scope.entries[idx] = candidate;
      else scope.entries.push(candidate);
    } else {
      scope.entries.push(candidate);
    }
    save();
    return json(res, 200, { entry: candidate, warnings: check.warnings, conflicts: sched.detectAllConflicts(scope) });
  }
  if (pathname === '/api/admin/schedule/swap' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const a = scope.entries.find(e => e.id === body.entryAId);
    const b = scope.entries.find(e => e.id === body.entryBId);
    if (!a || !b) fail(404, '未找到要互换的课程');
    if (a.locked || b.locked) fail(400, '已锁定的固定课程不可拖拽互换');
    const ignore = new Set([a.id, b.id]);
    const groupA = a.groupId ? scope.entries.filter(e => e.groupId === a.groupId && e.day === a.day && e.periodId === a.periodId) : [a];
    const groupB = b.groupId ? scope.entries.filter(e => e.groupId === b.groupId && e.day === b.day && e.periodId === b.periodId) : [b];
    const fullIgnore = new Set([...groupA.map(x => x.id), ...groupB.map(x => x.id)]);
    const hardAll = [], warnAll = [];
    for (const item of groupA) {
      const chk = sched.checkPlacement(scope, { ...item, day: b.day, periodId: b.periodId }, fullIgnore);
      hardAll.push(...chk.hard); warnAll.push(...chk.warnings);
    }
    for (const item of groupB) {
      const chk = sched.checkPlacement(scope, { ...item, day: a.day, periodId: a.periodId }, fullIgnore);
      hardAll.push(...chk.hard); warnAll.push(...chk.warnings);
    }
    if (hardAll.length && !body.forceOverride) {
      return json(res, 409, { error: hardAll[0].message, hard: hardAll, warnings: warnAll });
    }
    const dayA = a.day, perA = a.periodId, dayB = b.day, perB = b.periodId;
    for (const item of groupA) { item.day = dayB; item.periodId = perB; item.temporary = true; item.updatedAt = sched.now(); }
    for (const item of groupB) { item.day = dayA; item.periodId = perA; item.temporary = true; item.updatedAt = sched.now(); }
    addAuditLog(scope, user, '拖拽互换调课', `周${b.day}${b.periodId} ↔ 周${a.day}${a.periodId}`, body.overrideReason || '');
    save();
    return json(res, 200, { ok: true, entries: scope.entries, conflicts: sched.detectAllConflicts(scope) });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/entries\/([^/]+)\/lock$/);
  if (sMatch && method === 'PATCH') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const entry = scope.entries.find(e => e.id === sMatch[1]);
    if (!entry) fail(404, 'Entry not found');
    entry.locked = body.locked === undefined ? !entry.locked : Boolean(body.locked);
    save();
    return json(res, 200, { entry });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/entries\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const targetEntry = scope.entries.find(e => e.id === sMatch[1]);
    if (targetEntry?.groupId) {
      scope.entries = scope.entries.filter(e => !(e.groupId === targetEntry.groupId && e.day === targetEntry.day && e.periodId === targetEntry.periodId));
    } else {
      scope.entries = scope.entries.filter(e => e.id !== sMatch[1]);
    }
    addAuditLog(scope, user, '删除排课记录', sMatch[1]);
    save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/schedule/publish' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.published = {
      publishedAt: sched.now(),
      publishedBy: user.name,
      settings: structuredClone(scope.settings),
      grades: structuredClone(scope.grades),
      classes: structuredClone(scope.classes),
      subjects: structuredClone(scope.subjects),
      rooms: structuredClone(scope.rooms),
      entries: structuredClone(scope.entries),
    };
    addAuditLog(scope, user, '发布正式课表', `同步 ${scope.entries.length} 条排课记录给全校师生`);
    save();
    return json(res, 200, { published: scope.published });
  }
  if (pathname === '/api/admin/schedule/archive' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const archive = { id: sched.id('arc'), name: safeText(body.name || '课表存档', 'Archive name', 60), createdAt: sched.now(), entryCount: scope.entries.length, entries: structuredClone(scope.entries) };
    scope.archives.unshift(archive); save();
    return json(res, 201, { archive });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/requests\/([^/]+)\/review$/);
  if (sMatch && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const reqItem = scope.swapRequests.find(r => r.id === sMatch[1]);
    if (!reqItem || reqItem.status !== 'pending') fail(404, 'Pending swap request not found');
    const approve = body.decision === 'approve';
    reqItem.status = approve ? 'approved' : 'rejected';
    reqItem.reviewerName = user.name;
    reqItem.reviewNote = safeText(body.note ?? '', 'Review note', 200, false);
    reqItem.reviewedAt = sched.now();
    if (approve) {
      const entry = scope.entries.find(e => e.id === reqItem.entryId);
      if (entry) {
        if (reqItem.substituteTeacherId) entry.teacherId = reqItem.substituteTeacherId;
        if (reqItem.targetDay && reqItem.targetPeriodId) { entry.day = Number(reqItem.targetDay); entry.periodId = reqItem.targetPeriodId; }
        entry.temporary = true;
        entry.updatedAt = sched.now();
        if (scope.published) scope.published.entries = structuredClone(scope.entries);
      }
      addAuditLog(scope, user, '审批通过调课申请', `${reqItem.requesterName}: ${reqItem.reason}`);
    } else {
      addAuditLog(scope, user, '驳回调课申请', `${reqItem.requesterName}: ${reqItem.reason}`);
    }
    save();
    return json(res, 200, { request: reqItem });
  }
  if (pathname === '/api/admin/schedule/export' && method === 'GET') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const daysMap = { 1: '周一', 2: '周二', 3: '周三', 4: '周四', 5: '周五', 6: '周六' };
    const rows = ['\uFEFF星期,节次,时间,班级,科目,教师,教室,状态'];
    for (const e of scope.entries) {
      const p = scope.settings.periods.find(x => x.id === e.periodId);
      const cls = scope.classes.find(c => c.id === e.classId)?.name || '';
      const sub = scope.subjects.find(s => s.id === e.subjectId)?.name || '';
      const tch = db.users.find(u => u.id === e.teacherId)?.name || '';
      const rm = scope.rooms.find(r => r.id === e.roomId)?.name || '';
      const st = e.locked ? '已锁定' : e.temporary ? '临时调课' : '正常';
      rows.push([daysMap[e.day] || e.day, p?.name || e.periodId, p ? `${p.startTime}-${p.endTime}` : '', cls, sub, tch, rm, st].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="zhixing-timetable.csv"', 'Cache-Control': 'no-store' });
    res.end(rows.join('\r\n'));
    return;
  }
  // --- Combined Classes (合班排课) ---
  if (pathname === '/api/admin/schedule/combined' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const planIds = Array.isArray(body.planIds) ? [...new Set(body.planIds.map(String))] : [];
    if (planIds.length < 2) fail(400, '请至少勾选 2 条同师同科的教学计划进行合班');
    const plans = planIds.map(pid => scope.plans.find(pl => pl.id === pid)).filter(Boolean);
    if (plans.length !== planIds.length) fail(404, '部分教学计划不存在');
    const teacherId = plans[0].teacherId;
    const subjectId = plans[0].subjectId;
    if (plans.some(pl => pl.teacherId !== teacherId || pl.subjectId !== subjectId)) {
      fail(400, '仅允许同一教师且同一科目的教学计划合并');
    }
    const classIds = [...new Set(plans.map(pl => pl.classId))];
    if (classIds.length < 2) fail(400, '合班需要选择不同的班级');
    const classNames = classIds.map(cid => scope.classes.find(c => c.id === cid)?.name || cid).join('+');
    const subjName = scope.subjects.find(s => s.id === subjectId)?.name || '';
    const grp = {
      id: sched.id('grp'),
      shortName: safeText(body.shortName || `${classNames} / ${subjName}`, 'Combined name', 80),
      teacherId, subjectId, classIds, planIds,
      roomId: String(body.roomId || plans[0].roomId || ''),
      weeklyHours: Number(body.weeklyHours || plans[0].weeklyHours || 2),
      createdAt: sched.now(),
    };
    scope.combinedGroups.push(grp);
    addAuditLog(scope, user, '创建合班课', grp.shortName);
    save();
    return json(res, 201, { group: grp });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/combined\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.combinedGroups = scope.combinedGroups.filter(g => g.id !== sMatch[1]);
    for (const e of scope.entries) if (e.groupId === sMatch[1]) delete e.groupId;
    addAuditLog(scope, user, '解除合班', sMatch[1]);
    save();
    return json(res, 200, { ok: true });
  }

  // --- Smart Student Placement (智能新生分班) ---
  if (pathname === '/api/admin/schedule/placement/template' && method === 'GET') {
    requireAdmin(user);
    const csv = '\uFEFF姓名,性别,学号,总分,语文,数学,英语,名次,特长标签,绑定组,互斥组,备注\r\n' +
      '张一,男,20260001,620,120,135,125,12,信息,twin1,,双胞胎\r\n' +
      '张二,女,20260002,615,118,130,128,15,,twin1,,双胞胎\r\n' +
      '李明,男,20260003,590,115,120,118,45,体育,,name_lm,\r\n' +
      '李明(重名),男,20260004,585,112,118,120,52,美术,,name_lm,\r\n';
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="student-placement-template.csv"', 'Cache-Control': 'no-store' });
    res.end(csv);
    return;
  }
  if (pathname === '/api/admin/schedule/placement/import' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    let imported = [];
    if (Array.isArray(body.students)) {
      imported = body.students.map((s, idx) => ({
        id: sched.id('pstu'),
        name: safeText(s.name, 'Student name', 60),
        gender: safeText(s.gender ?? '', 'Gender', 20, false),
        studentId: safeText(s.studentId ?? '', 'Student ID', 32, false),
        scores: { total: Number(s.scores?.total ?? s.total ?? 0), chinese: Number(s.scores?.chinese ?? s.chinese ?? 0), math: Number(s.scores?.math ?? s.math ?? 0), english: Number(s.scores?.english ?? s.english ?? 0) },
        rank: Number(s.rank || idx + 1),
        tags: { specialty: safeText(s.tags?.specialty ?? s.specialty ?? '', 'Specialty', 40, false) },
        bindGroup: safeText(s.bindGroup ?? '', 'Bind group', 40, false),
        mutexGroup: safeText(s.mutexGroup ?? '', 'Mutex group', 40, false),
        note: safeText(s.note ?? '', 'Note', 100, false),
      }));
    } else if (typeof body.csv === 'string') {
      const rows = parseCsvRows(body.csv);
      if (rows.length < 2) fail(400, 'CSV 至少需要表头和一行新生数据');
      const hdr = rows[0];
      const idxOf = (...names) => hdr.findIndex(h => names.includes(h.trim()));
      const iName = idxOf('姓名', '名字', 'name');
      if (iName < 0) fail(400, '缺少“姓名”列');
      const iGender = idxOf('性别', 'gender');
      const iStuId = idxOf('学号', 'studentId');
      const iTotal = idxOf('总分', 'total');
      const iChi = idxOf('语文', 'chinese');
      const iMath = idxOf('数学', 'math');
      const iEng = idxOf('英语', 'english');
      const iRank = idxOf('名次', 'rank');
      const iTag = idxOf('特长标签', '特长', 'specialty');
      const iBind = idxOf('绑定组', 'bindGroup');
      const iMutex = idxOf('互斥组', 'mutexGroup');
      const iNote = idxOf('备注', 'note');
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row[iName]) continue;
        imported.push({
          id: sched.id('pstu'),
          name: safeText(row[iName], 'Name', 60),
          gender: iGender >= 0 ? (row[iGender] || '') : '',
          studentId: iStuId >= 0 ? (row[iStuId] || '') : '',
          scores: { total: Number(row[iTotal] || 0), chinese: Number(row[iChi] || 0), math: Number(row[iMath] || 0), english: Number(row[iEng] || 0) },
          rank: Number(row[iRank] || r),
          tags: { specialty: iTag >= 0 ? (row[iTag] || '') : '' },
          bindGroup: iBind >= 0 ? (row[iBind] || '') : '',
          mutexGroup: iMutex >= 0 ? (row[iMutex] || '') : '',
          note: iNote >= 0 ? (row[iNote] || '') : '',
        });
      }
    } else fail(400, '请提供 CSV 或学生列表');
    scope.placement.students = imported;
    scope.placement.result = null;
    save();
    return json(res, 200, { count: imported.length, students: imported });
  }
  if (pathname === '/api/admin/schedule/placement/preview' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (!scope.placement.students.length) fail(400, '请先导入新生名单');
    const cfg = {
      classCount: Math.max(1, Math.min(50, Number(body.classCount || scope.placement.config?.classCount || 2))),
      classPrefix: safeText(body.classPrefix || scope.placement.config?.classPrefix || '新生', 'Class prefix', 30),
      mode: ['total', 'subjects', 'rankBand', 'percentTier'].includes(body.mode) ? body.mode : 'total',
      genderBalance: body.genderBalance !== false,
      gradeId: String(body.gradeId || ''),
    };
    scope.placement.config = cfg;
    scope.placement.result = sched.runSmartPlacement(scope.placement.students, cfg);
    save();
    return json(res, 200, { result: scope.placement.result });
  }
  if (pathname === '/api/admin/schedule/placement/commit' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    if (!Array.isArray(scope.placement.result) || !scope.placement.result.length) fail(400, '请先执行分班预览');
    const createdClasses = [];
    for (const clsRes of scope.placement.result) {
      const matchedUserIds = clsRes.students.map(ps => db.users.find(u => u.role === 'student' && (u.studentId === ps.studentId || u.name === ps.name) && canAdminManage(user, u))?.id).filter(Boolean);
      const cls = {
        id: sched.id('cls'),
        name: clsRes.name,
        code: '',
        gradeId: scope.placement.config?.gradeId || '',
        type: 'admin',
        headTeacherId: '',
        studentCount: clsRes.count,
        blockedSlots: [],
        studentIds: matchedUserIds,
      };
      scope.classes.push(cls);
      createdClasses.push(cls);
    }
    addAuditLog(scope, user, '正式生成分班班级', `生成 ${createdClasses.length} 个行政班`);
    save();
    return json(res, 201, { classes: createdClasses });
  }
  if (pathname === '/api/admin/schedule/placement/export' && method === 'GET') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const rows = ['\uFEFF新班级,姓名,性别,学号,总分,原名次,特长标签,备注'];
    for (const cls of (scope.placement.result || [])) {
      for (const s of (cls.students || [])) {
        rows.push([cls.name, s.name, s.gender, s.studentId || '', s.total, s.rank, s.specialty || '', s.note || ''].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      }
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="placement-roster.csv"', 'Cache-Control': 'no-store' });
    res.end(rows.join('\r\n'));
    return;
  }

  // --- Exam Proctoring (监考安排) ---
  if (pathname === '/api/admin/schedule/exams' && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const exam = {
      id: sched.id('exm'),
      name: safeText(body.name, 'Exam name', 80),
      startDate: safeText(body.startDate ?? '', 'Start date', 20, false),
      endDate: safeText(body.endDate ?? '', 'End date', 20, false),
      slots: Array.isArray(body.slots) ? body.slots.map((sl, idx) => ({
        id: sl.id || sched.id('esl'),
        dateLabel: safeText(sl.dateLabel || `第${idx + 1}场`, 'Date label', 40),
        periodName: safeText(sl.periodName || '上午', 'Period name', 30),
        startTime: safeText(sl.startTime || '08:30', 'Start', 10),
        endTime: safeText(sl.endTime || '10:30', 'End', 10),
        dayOfWeek: sl.dayOfWeek ? Number(sl.dayOfWeek) : null,
        periodId: sl.periodId ? String(sl.periodId) : '',
        subjectId: sl.subjectId ? String(sl.subjectId) : '',
        subjectName: safeText(sl.subjectName ?? '', 'Subject', 40, false),
      })) : [],
      rooms: Array.isArray(body.rooms) ? body.rooms.map(r => ({
        id: r.id || sched.id('erm'),
        name: safeText(r.name, 'Exam room', 50),
        classId: r.classId ? String(r.classId) : '',
        capacity: Number(r.capacity || 40),
      })) : [],
      teacherIds: Array.isArray(body.teacherIds) ? body.teacherIds.map(String) : [],
      rules: {
        taughtClass: ['any', 'avoid', 'prefer'].includes(body.rules?.taughtClass) ? body.rules.taughtClass : 'avoid',
        taughtSubject: ['any', 'avoid', 'prefer'].includes(body.rules?.taughtSubject) ? body.rules.taughtSubject : 'avoid',
        proctorsPerRoom: Math.max(1, Math.min(3, Number(body.rules?.proctorsPerRoom || 1))),
      },
      assignments: [],
      createdAt: sched.now(),
    };
    scope.exams.unshift(exam);
    save();
    return json(res, 201, { exam });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/exams\/([^/]+)$/);
  if (sMatch && method === 'DELETE') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    scope.exams = scope.exams.filter(ex => ex.id !== sMatch[1]); save();
    return json(res, 200, { ok: true });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/exams\/([^/]+)\/auto$/);
  if (sMatch && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const exam = scope.exams.find(ex => ex.id === sMatch[1]);
    if (!exam) fail(404, 'Exam not found');
    const teachers = db.users.filter(u => u.role === 'teacher' && canAdminManage(user, u));
    const resObj = sched.autoAssignProctors(scope, exam, teachers);
    addAuditLog(scope, user, '自动排监考', `${exam.name}：生成 ${resObj.assignments.length} 条监考安排`);
    save();
    return json(res, 200, { exam, ...resObj });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/exams\/([^/]+)\/reassign$/);
  if (sMatch && method === 'POST') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const exam = scope.exams.find(ex => ex.id === sMatch[1]);
    if (!exam) fail(404, 'Exam not found');
    const asg = exam.assignments.find(a => a.id === body.assignmentId);
    if (!asg) fail(404, 'Assignment not found');
    const newIds = Array.isArray(body.teacherIds) ? [...new Set(body.teacherIds.map(String).filter(Boolean))] : [];
    const slot = exam.slots.find(s => s.id === asg.slotId);
    for (const tid of newIds) {
      const clash = exam.assignments.some(a => a.id !== asg.id && a.slotId === asg.slotId && a.teacherIds.includes(tid));
      if (clash) fail(409, '该教师在同一考试时段已安排其他考场监考');
      if (slot?.dayOfWeek && slot?.periodId && scope.entries.some(e => Number(e.day) === Number(slot.dayOfWeek) && e.periodId === slot.periodId && e.teacherId === tid)) {
        fail(409, '该教师在该时段有正常上课安排，不可兼任监考');
      }
    }
    asg.teacherIds = newIds;
    save();
    return json(res, 200, { assignment: asg });
  }
  sMatch = pathname.match(/^\/api\/admin\/schedule\/exams\/([^/]+)\/export$/);
  if (sMatch && method === 'GET') {
    requireAdmin(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const exam = scope.exams.find(ex => ex.id === sMatch[1]);
    if (!exam) fail(404, 'Exam not found');
    const rows = ['\uFEFF考试名称,场次日期,时间,科目,考场,监考教师'];
    for (const a of (exam.assignments || [])) {
      const sl = exam.slots.find(s => s.id === a.slotId);
      const rm = exam.rooms.find(r => r.id === a.roomId);
      const names = (a.teacherIds || []).map(tid => db.users.find(u => u.id === tid)?.name || tid).join('、');
      rows.push([exam.name, sl?.dateLabel || '', sl ? `${sl.startTime}-${sl.endTime}` : '', sl?.subjectName || '', rm?.name || '', names].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    }
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="exam-proctoring.csv"', 'Cache-Control': 'no-store' });
    res.end(rows.join('\r\n'));
    return;
  }
  if (pathname === '/api/schedule/my' && method === 'GET') {
    requireUser(user);
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const pub = scope.published;
    if (!pub) return json(res, 200, { published: false, entries: [], periods: scope.settings.periods, daysPerWeek: scope.settings.daysPerWeek, swapRequests: [] });
    let entries = [];
    if (user.role === 'teacher') {
      entries = pub.entries.filter(e => e.teacherId === user.id);
    } else if (user.role === 'student') {
      const myClassIds = new Set((pub.classes || []).filter(c => Array.isArray(c.studentIds) && c.studentIds.includes(user.id)).map(c => c.id));
      entries = myClassIds.size ? pub.entries.filter(e => myClassIds.has(e.classId)) : pub.entries;
    } else {
      entries = pub.entries;
    }
    const enriched = entries.map(e => ({
      ...e,
      className: pub.classes.find(c => c.id === e.classId)?.name || '',
      subjectName: pub.subjects.find(s => s.id === e.subjectId)?.name || '',
      teacherName: db.users.find(u => u.id === e.teacherId)?.name || '',
      roomName: pub.rooms.find(r => r.id === e.roomId)?.name || '',
    }));
    const swapRequests = user.role === 'teacher' ? scope.swapRequests.filter(r => r.requesterId === user.id) : [];
    const schoolTeachers = user.role === 'teacher' ? db.users.filter(u => u.role === 'teacher' && u.schoolId === user.schoolId && u.active !== false).map(u => ({ id: u.id, name: u.name })) : [];
    return json(res, 200, { published: true, publishedAt: pub.publishedAt, daysPerWeek: pub.settings.daysPerWeek, periods: pub.settings.periods, entries: enriched, swapRequests, schoolTeachers });
  }
  if (pathname === '/api/teacher/schedule/requests' && method === 'POST') {
    requireRole(user, 'teacher');
    const scope = sched.ensureScope(db, schedScopeKey(user));
    const entry = scope.entries.find(e => e.id === body.entryId && e.teacherId === user.id);
    if (!entry) fail(404, '未找到您负责的该节课程');
    const reqItem = {
      id: sched.id('swp'),
      requesterId: user.id,
      requesterName: user.name,
      entryId: entry.id,
      targetDay: body.targetDay ? Number(body.targetDay) : null,
      targetPeriodId: body.targetPeriodId ? String(body.targetPeriodId) : null,
      substituteTeacherId: body.substituteTeacherId ? String(body.substituteTeacherId) : null,
      reason: safeText(body.reason, '调课原因', 300),
      status: 'pending',
      createdAt: sched.now(),
    };
    scope.swapRequests.unshift(reqItem); save();
    return json(res, 201, { request: reqItem });
  }
  if (pathname === '/api/admin/overview' && method === 'GET') {
    requireAdmin(user);
    const organization = db.schools.find(school => school.id === user.schoolId) || null;
    const teachers = db.users.filter(u => u.role === 'teacher' && canAdminManage(user, u));
    const teacherIds = new Set(teachers.map(teacher => teacher.id));
    const courses = db.courses.filter(course => courseTeacherIds(course).some(tid => teacherIds.has(tid))).map(c => {
      const tIds = courseTeacherIds(c);
      const assigned = tIds.map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
      const enrolledList = db.enrollments.filter(e => e.courseId === c.id).map(e => db.users.find(u => u.id === e.userId && u.active !== false)).filter(Boolean);
      return {
        id: c.id, title: c.title, description: c.description || '', category: c.category || '',
        cover: c.cover || '📘', color: c.color || '#6979dc',
        teacherId: c.teacherId, teacherIds: tIds,
        teacherName: assigned.map(t => t.name).join(', ') || 'Instructor',
        departments: [...new Set(assigned.map(t => t.department).filter(Boolean))],
        enrollmentCode: c.enrollmentCode,
        lessonCount: (c.lessons || []).length,
        quizAvailable: Boolean(quizByCourse(c.id)?.questions?.length),
        studentCount: enrolledList.length,
        enrolledStudents: enrolledList.map(s => ({ id: s.id, name: s.name, studentId: s.studentId || '', email: s.email, department: s.department || '', major: s.major || '' })),
        createdAt: c.createdAt,
      };
    });
    const courseIds = new Set(courses.map(course => course.id));
    const students = db.users.filter(u => u.role === 'student' && canAdminManage(user, u)).map(u => ({ ...publicUser(u), enrollments: db.enrollments.filter(e => e.userId === u.id && courseIds.has(e.courseId)).map(e => { const course = db.courses.find(c => c.id === e.courseId); return course ? { courseId: course.id, courseTitle: course.title, teacherName: db.users.find(t => t.id === course.teacherId)?.name || 'Instructor' } : null; }).filter(Boolean) }));
    const organizations = isGlobalAdmin(user) ? db.schools.map(school => ({ id: school.id, name: school.name, code: school.code })) : organization ? [{ id: organization.id, name: organization.name, code: organization.code }] : [];
    const pendingTeachers = db.users
      .filter(u => u.role === 'teacher' && u.active !== false && u.pendingSchoolId && (isGlobalAdmin(user) || u.pendingSchoolId === user.schoolId))
      .map(t => ({ ...publicUser(t), requestedAt: t.pendingSchoolRequestedAt || t.createdAt }));
    const deptMap = new Map();
    for (const d of db.departments) {
      if (isGlobalAdmin(user) || d.schoolId === user.schoolId) deptMap.set(d.name, d);
    }
    for (const u of [...teachers, ...students]) {
      if (u.department && !deptMap.has(u.department)) {
        deptMap.set(u.department, { id: null, schoolId: u.schoolId || null, name: u.department, derived: true });
      }
    }
    const departments = [...deptMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    const announcements = db.announcements
      .filter(a => isGlobalAdmin(user) || !a.schoolId || a.schoolId === user.schoolId)
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    return json(res, 200, { organization: organization ? { id: organization.id, name: organization.name, code: organization.code } : null, organizations, departments, announcements, teachers: teachers.map(t => ({ ...publicUser(t), courseCount: db.courses.filter(c => courseTeacherIds(c).includes(t.id)).length })), pendingTeachers, students, courses, stats: { teachers: teachers.length, students: students.length, courses: courses.length, pendingTeachers: pendingTeachers.length, announcements: announcements.length } });
  }
  if (pathname === '/api/announcements' && method === 'GET') {
    requireUser(user);
    const list = db.announcements
      .filter(a => isGlobalAdmin(user) || !a.schoolId || a.schoolId === user.schoolId)
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    return json(res, 200, { announcements: list });
  }
  if (pathname === '/api/admin/announcements' && method === 'POST') {
    requireAdmin(user);
    const category = ['school', 'college', 'academic'].includes(body.category) ? body.category : fail(400, 'Announcement category must be school, college, or academic');
    const title = safeText(body.title, 'Announcement title', 120);
    const content = safeText(body.content, 'Announcement content', 5000);
    const announcement = {
      id: id('ann'),
      schoolId: isGlobalAdmin(user) ? (body.schoolId || null) : user.schoolId,
      category, title, content,
      authorId: user.id, authorName: user.name,
      createdAt: now(), updatedAt: now(),
    };
    db.announcements.push(announcement); save();
    return json(res, 201, { announcement });
  }
  let annMatch = pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/);
  if (annMatch && method === 'PATCH') {
    requireAdmin(user);
    const ann = db.announcements.find(a => a.id === annMatch[1]);
    if (!ann || (!isGlobalAdmin(user) && ann.schoolId !== user.schoolId)) fail(404, 'Announcement not found');
    if (body.category !== undefined) {
      if (!['school', 'college', 'academic'].includes(body.category)) fail(400, 'Announcement category must be school, college, or academic');
      ann.category = body.category;
    }
    if (body.title !== undefined) ann.title = safeText(body.title, 'Announcement title', 120);
    if (body.content !== undefined) ann.content = safeText(body.content, 'Announcement content', 5000);
    ann.updatedAt = now();
    save();
    return json(res, 200, { announcement: ann });
  }
  if (annMatch && method === 'DELETE') {
    requireAdmin(user);
    const idx = db.announcements.findIndex(a => a.id === annMatch[1]);
    if (idx < 0 || (!isGlobalAdmin(user) && db.announcements[idx].schoolId !== user.schoolId)) fail(404, 'Announcement not found');
    db.announcements.splice(idx, 1); save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/departments' && method === 'POST') {
    requireAdmin(user);
    const name = safeText(body.name, 'Department name', 80);
    const schoolId = isGlobalAdmin(user) ? (body.schoolId || null) : user.schoolId;
    if (db.departments.some(d => d.schoolId === schoolId && d.name.toLowerCase() === name.toLowerCase())) {
      fail(409, 'This department already exists');
    }
    const department = { id: id('dept'), schoolId, name, createdAt: now() };
    db.departments.push(department); save();
    return json(res, 201, { department });
  }
  let deptMatch = pathname.match(/^\/api\/admin\/departments\/([^/]+)$/);
  if (deptMatch && method === 'DELETE') {
    requireAdmin(user);
    const idx = db.departments.findIndex(d => d.id === deptMatch[1]);
    if (idx < 0 || (!isGlobalAdmin(user) && db.departments[idx].schoolId !== user.schoolId)) fail(404, 'Department not found');
    db.departments.splice(idx, 1); save();
    return json(res, 200, { ok: true });
  }
  let userDeptMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/department$/);
  if (userDeptMatch && method === 'PATCH') {
    requireAdmin(user);
    const target = db.users.find(u => u.id === userDeptMatch[1] && ['teacher', 'student'].includes(u.role));
    if (!target || !canAdminManage(user, target)) fail(404, 'Account not found');
    if (body.department !== undefined) target.department = safeText(body.department ?? '', 'Department', 80, false);
    if (body.major !== undefined) target.major = safeText(body.major ?? '', 'Major', 80, false);
    save();
    return json(res, 200, { user: publicUser(target) });
  }
  let reqMatch = pathname.match(/^\/api\/admin\/teacher-requests\/([^/]+)\/(approve|reject)$/);
  if (reqMatch && method === 'POST') {
    requireAdmin(user);
    const teacher = db.users.find(u => u.id === reqMatch[1] && u.role === 'teacher' && u.active !== false);
    if (!teacher || !teacher.pendingSchoolId) fail(404, 'Pending school binding request not found');
    if (!isGlobalAdmin(user) && teacher.pendingSchoolId !== user.schoolId) fail(403, 'You do not have permission to review this request');
    if (reqMatch[2] === 'approve') {
      teacher.schoolId = teacher.pendingSchoolId;
    }
    delete teacher.pendingSchoolId;
    delete teacher.pendingSchoolRequestedAt;
    save();
    return json(res, 200, { user: publicUser(teacher), ok: true });
  }
  if (pathname === '/api/admin/courses' && method === 'POST') {
    requireAdmin(user);
    const rawIds = Array.isArray(body.teacherIds) ? body.teacherIds : body.teacherId ? [body.teacherId] : [];
    const teacherIds = [...new Set(rawIds.map(x => String(x || '').trim()).filter(Boolean))];
    if (!teacherIds.length) fail(400, 'Select at least one instructor for this course');
    for (const tid of teacherIds) {
      const t = db.users.find(u => u.id === tid && u.role === 'teacher' && u.active !== false);
      if (!t || !canAdminManage(user, t)) fail(400, 'Selected instructor is invalid or outside your school');
    }
    const course = {
      id: id('course'), ...courseFields(body),
      teacherId: teacherIds[0], teacherIds,
      gradeWeights: { ...DEFAULT_WEIGHTS },
      lessons: [], announcements: [], createdAt: now(), updatedAt: now(),
    };
    db.courses.push(course); save();
    return json(res, 201, { course: serializeCourse(course, user) });
  }
  let adminCourseMatch = pathname.match(/^\/api\/admin\/courses\/([^/]+)$/);
  if (adminCourseMatch && method === 'PATCH') {
    requireAdmin(user);
    const course = courseById(adminCourseMatch[1]);
    const existingTeachers = courseTeacherIds(course).map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
    if (!isGlobalAdmin(user) && !existingTeachers.some(t => canAdminManage(user, t))) fail(404, 'Course not found');
    Object.assign(course, courseFields(body, course));
    if (body.teacherIds !== undefined || body.teacherId !== undefined) {
      const rawIds = Array.isArray(body.teacherIds) ? body.teacherIds : body.teacherId ? [body.teacherId] : [];
      const teacherIds = [...new Set(rawIds.map(x => String(x || '').trim()).filter(Boolean))];
      if (!teacherIds.length) fail(400, 'Select at least one instructor for this course');
      for (const tid of teacherIds) {
        const t = db.users.find(u => u.id === tid && u.role === 'teacher' && u.active !== false);
        if (!t || !canAdminManage(user, t)) fail(400, 'Selected instructor is invalid or outside your school');
      }
      course.teacherId = teacherIds[0];
      course.teacherIds = teacherIds;
    }
    course.updatedAt = now();
    save();
    return json(res, 200, { course: serializeCourse(course, user) });
  }
  if (adminCourseMatch && method === 'DELETE') {
    requireAdmin(user);
    const course = courseById(adminCourseMatch[1]);
    const existingTeachers = courseTeacherIds(course).map(tid => db.users.find(u => u.id === tid)).filter(Boolean);
    if (!isGlobalAdmin(user) && !existingTeachers.some(t => canAdminManage(user, t))) fail(404, 'Course not found');
    db.courses = db.courses.filter(c => c.id !== course.id);
    db.enrollments = db.enrollments.filter(e => e.courseId !== course.id);
    db.quizzes = db.quizzes.filter(q => q.courseId !== course.id);
    db.attempts = db.attempts.filter(a => a.courseId !== course.id);
    db.posts = db.posts.filter(pt => pt.courseId !== course.id);
    db.assignments = db.assignments.filter(a => a.courseId !== course.id);
    db.submissions = db.submissions.filter(s => s.courseId !== course.id);
    db.grades = db.grades.filter(g => g.courseId !== course.id);
    save();
    return json(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/teachers' && method === 'POST') {
    requireAdmin(user);
    const name = safeText(body.name, 'Name', 60);
    const email = safeText(body.email, 'Email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email address');
    if (db.users.some(u => u.email.toLowerCase() === email)) fail(409, 'This email is already registered');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400, 'Password must contain 8–128 characters');
    const accountId = body.accountId != null && body.accountId !== '' ? validateRoleAccountId('teacher', body.accountId) : null;
    if (accountId && accountIdTaken(accountId)) fail(409, 'This account ID is already registered');
    const teacher = { id: id('user'), role: 'teacher', name, email, studentId: null, accountId, schoolId: isGlobalAdmin(user) ? null : user.schoolId, passwordHash: hashPassword(body.password), active: true, createdAt: now() };
    db.users.push(teacher); save(); return json(res, 201, { user: publicUser(teacher) });
  }
  let adminMatch = pathname.match(/^\/api\/admin\/teachers\/([^/]+)$/);
  if (adminMatch && method === 'DELETE') {
    requireAdmin(user);
    const teacher = db.users.find(u => u.id === adminMatch[1] && u.role === 'teacher');
    if (!teacher || !canAdminManage(user, teacher)) fail(404, 'Instructor account not found');
    teacher.active = false; invalidateSessions(teacher.id); save();
    return json(res, 200, { ok: true });
  }
  adminMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/password$/);
  if (adminMatch && method === 'PATCH') {
    requireAdmin(user);
    const target = db.users.find(u => u.id === adminMatch[1] && ['teacher', 'student'].includes(u.role));
    if (!target || !canAdminManage(user, target)) fail(404, 'Account not found');
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 128) fail(400, 'Password must contain 8–128 characters');
    target.passwordHash = hashPassword(body.password); invalidateSessions(target.id); save();
    return json(res, 200, { ok: true });
  }
  adminMatch = pathname.match(/^\/api\/admin\/students\/([^/]+)\/enrollments\/([^/]+)$/);
  if (adminMatch && ['POST', 'DELETE'].includes(method)) {
    requireAdmin(user);
    const student = db.users.find(u => u.id === adminMatch[1] && u.role === 'student' && u.active !== false);
    if (!student || !canAdminManage(user, student)) fail(404, 'Student account not found');
    const course = courseById(adminMatch[2]);
    const courseTeacher = db.users.find(u => u.id === course.teacherId && u.role === 'teacher');
    if (!courseTeacher || !canAdminManage(user, courseTeacher)) fail(404, 'Course not found');
    if (method === 'POST') {
      if (!enrollment(student.id, course.id)) db.enrollments.push({ id: id('enrollment'), userId: student.id, courseId: course.id, completedLessonIds: [], createdAt: now(), lastActiveAt: now() });
    } else {
      db.enrollments = db.enrollments.filter(e => !(e.userId === student.id && e.courseId === course.id));
      db.grades = db.grades.filter(g => !(g.userId === student.id && g.courseId === course.id));
    }
    save(); return json(res, 200, { ok: true });
  }
  if (pathname === '/api/courses' && method === 'GET') return json(res, 200, { courses: db.courses.map(c => serializeCourse(c, user)) });
  if (pathname === '/api/courses/enroll-by-code' && method === 'POST') {
    requireRole(user, 'student');
    const code = safeText(body.code, 'Enrollment code', 20).toUpperCase();
    const course = db.courses.find(c => c.enrollmentCode === code);
    if (!course) fail(404, 'Invalid enrollment code');
    if (!enrollment(user.id, course.id)) {
      db.enrollments.push({ id: id('enrollment'), userId: user.id, courseId: course.id, completedLessonIds: [], createdAt: now(), lastActiveAt: now() });
      recentActivity('enrolled', user.id, course.id, course.title); save();
    }
    return json(res, 200, { course: serializeCourse(course, user) });
  }
  if (pathname === '/api/courses' && method === 'POST') {
    requireRole(user, 'teacher');
    const course = { id: id('course'), ...courseFields(body), teacherId: user.id, lessons: [], createdAt: now(), updatedAt: now() };
    db.courses.push(course); recentActivity('course_created', user.id, course.id, course.title); save();
    return json(res, 201, { course: serializeCourse(course, user) });
  }
  if (pathname === '/api/student/grades' && method === 'GET') {
    requireRole(user, 'student');
    const courses = db.enrollments.filter(e => e.userId === user.id).map(e => db.courses.find(c => c.id === e.courseId)).filter(Boolean)
      .map(course => ({ courseId: course.id, courseTitle: course.title, ...gradeFor(course, user.id), ...studentGradeDetails(course, user.id) }));
    return json(res, 200, { courses });
  }
  let match = pathname.match(/^\/api\/courses\/([^/]+)\/assignments$/);
  if (match) {
    const course = courseById(match[1]); canStudy(user, course);
    if (method === 'GET') return json(res, 200, { assignments: db.assignments.filter(a => a.courseId === course.id).map(a => serializeAssignment(a, user)) });
    if (method === 'POST') {
      ownedCourse(user, course);
      const assignment = { id: id('assignment'), courseId: course.id, ...assignmentFields(body), createdAt: now(), updatedAt: now() };
      db.assignments.push(assignment); save();
      return json(res, 201, { assignment: serializeAssignment(assignment, user) });
    }
  }
  match = pathname.match(/^\/api\/assignments\/([^/]+)$/);
  if (match && ['PATCH', 'DELETE'].includes(method)) {
    const assignment = assignmentById(match[1]);
    const course = ownedCourse(user, courseById(assignment.courseId));
    if (method === 'PATCH') {
      Object.assign(assignment, assignmentFields(body, assignment), { updatedAt: now() }); save();
      return json(res, 200, { assignment: serializeAssignment(assignment, user) });
    }
    const removed = db.submissions.filter(s => s.assignmentId === assignment.id);
    for (const submission of removed) removeUpload(submission.file);
    db.submissions = db.submissions.filter(s => s.assignmentId !== assignment.id);
    db.assignments = db.assignments.filter(a => a.id !== assignment.id);
    save(); return json(res, 200, { ok: true });
  }
  match = pathname.match(/^\/api\/assignments\/([^/]+)\/submit$/);
  if (match && method === 'POST') {
    requireRole(user, 'student');
    const assignment = assignmentById(match[1]); const course = courseById(assignment.courseId); canStudy(user, course);
    const content = safeText(body.content ?? '', 'Assignment content', 10000, false);
    let submission = db.submissions.find(s => s.assignmentId === assignment.id && s.userId === user.id);
    if (!submission) {
      submission = { id: id('submission'), assignmentId: assignment.id, courseId: course.id, userId: user.id, content, file: null, score: null, feedback: '', submittedAt: now(), gradedAt: null };
      db.submissions.push(submission);
    } else {
      if (submission.submittedAt) (submission.history ||= []).push({ score: submission.score, feedback: submission.feedback, submittedAt: submission.submittedAt, gradedAt: submission.gradedAt });
      removeUpload(submission.file); submission.file = null;
      Object.assign(submission, { content, score: null, feedback: '', submittedAt: now(), gradedAt: null });
    }
    recentActivity('assignment_submitted', user.id, course.id, assignment.title);
    enrollment(user.id, course.id).lastActiveAt = now(); save();
    return json(res, 200, { submission: serializeSubmission(submission) });
  }
  match = pathname.match(/^\/api\/assignments\/([^/]+)\/submissions$/);
  if (match && method === 'GET') {
    const assignment = assignmentById(match[1]); ownedCourse(user, courseById(assignment.courseId));
    return json(res, 200, { submissions: db.submissions.filter(s => s.assignmentId === assignment.id).map(serializeSubmission) });
  }
  match = pathname.match(/^\/api\/assignments\/([^/]+)\/submission\/file$/);
  if (match && method === 'POST') {
    requireRole(user, 'student');
    const assignment = assignmentById(match[1]); const course = courseById(assignment.courseId); canStudy(user, course);
    const submission = db.submissions.find(s => s.assignmentId === assignment.id && s.userId === user.id);
    if (!submission) fail(400, 'Submit the written assignment content first');
    const mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    const allowed = { 'application/pdf': '.pdf', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx', 'text/plain': '.txt', 'image/png': '.png', 'image/jpeg': '.jpg' };
    const extension = allowed[mime]; if (!extension) fail(415, 'Only PDF, Word, text, or image assignment files are supported');
    const buffer = await readBinary(req, MAX_ASSIGNMENT_FILE);
    const upload = await saveUpload(buffer, req, extension);
    removeUpload(submission.file);
    if (submission.score != null) (submission.history ||= []).push({ score: submission.score, feedback: submission.feedback, submittedAt: submission.submittedAt, gradedAt: submission.gradedAt });
    Object.assign(submission, { file: upload, score: null, feedback: '', gradedAt: null, submittedAt: now() });
    enrollment(user.id, course.id).lastActiveAt = now(); save();
    return json(res, 200, { submission: serializeSubmission(submission) });
  }
  match = pathname.match(/^\/api\/submissions\/([^/]+)\/file$/);
  if (match && method === 'GET') {
    requireUser(user);
    const submission = db.submissions.find(s => s.id === match[1]); if (!submission) fail(404, 'Assignment file not found');
    const assignment = assignmentById(submission.assignmentId); const course = courseById(assignment.courseId);
    if (['teacher', 'admin'].includes(user.role)) ownedCourse(user, course);
    else if (submission.userId !== user.id || !enrollment(user.id, course.id)) fail(403, 'You cannot access another student’s assignment file');
    return streamUpload(req, res, submission.file);
  }
  match = pathname.match(/^\/api\/submissions\/([^/]+)\/grade$/);
  if (match && method === 'PATCH') {
    const submission = db.submissions.find(s => s.id === match[1]); if (!submission) fail(404, 'Assignment submission not found');
    const assignment = assignmentById(submission.assignmentId); ownedCourse(user, courseById(assignment.courseId));
    const score = Number(body.score);
    if (!Number.isFinite(score) || score < 0 || score > assignment.maxScore) fail(400, 'Assignment score is outside the valid range');
    Object.assign(submission, { score, feedback: safeText(body.feedback ?? '', 'Instructor feedback', 3000, false), gradedAt: now() }); save();
    return json(res, 200, { submission: serializeSubmission(submission) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/gradebook$/);
  if (match && method === 'GET') {
    const course = ownedCourse(user, courseById(match[1]));
    const students = db.enrollments.filter(e => e.courseId === course.id).map(e => {
      const student = db.users.find(u => u.id === e.userId);
      return student ? { userId: student.id, name: student.name, studentId: student.studentId, ...gradeFor(course, student.id) } : null;
    }).filter(Boolean);
    return json(res, 200, { weights: course.gradeWeights || DEFAULT_WEIGHTS, students });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/gradebook\/weights$/);
  if (match && method === 'PUT') {
    const course = ownedCourse(user, courseById(match[1]));
    course.gradeWeights = validateWeights(body.weights); save();
    return json(res, 200, { weights: course.gradeWeights });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/gradebook\/([^/]+)$/);
  if (match && method === 'PATCH') {
    const course = ownedCourse(user, courseById(match[1]));
    const student = db.users.find(u => u.id === match[2] && u.role === 'student');
    if (!student || !enrollment(student.id, course.id)) fail(404, 'This student is not enrolled in the course');
    if (!body.scores || typeof body.scores !== 'object' || Array.isArray(body.scores)) fail(400, 'Invalid grade format');
    let grade = db.grades.find(g => g.courseId === course.id && g.userId === student.id);
    const nextScores = { ...(grade?.scores || {}) };
    for (const key of GRADE_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(body.scores, key)) continue;
      const value = body.scores[key];
      if (value === '' || value == null) { delete nextScores[key]; continue; }
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 100) fail(400, 'Grades must be between 0 and 100');
      nextScores[key] = number;
    }
    if (!grade) { grade = { id: id('grade'), courseId: course.id, userId: student.id, scores: nextScores }; db.grades.push(grade); }
    else grade.scores = nextScores;
    save(); return json(res, 200, { userId: student.id, ...gradeFor(course, student.id) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)$/);
  if (match) {
    const course = courseById(match[1]);
    if (method === 'GET') return json(res, 200, { course: serializeCourse(course, user) });
    ownedCourse(user, course);
    if (method === 'PATCH') { Object.assign(course, courseFields(body, course), { updatedAt: now() }); save(); return json(res, 200, { course: serializeCourse(course, user) }); }
    if (method === 'DELETE') {
      for (const lesson of course.lessons) { removeUpload(lesson.videoFile); for (const folder of lesson.resourceFolders || []) for (const file of folder.files || []) removeUpload(file); }
      const assignmentIds = new Set(db.assignments.filter(a => a.courseId === course.id).map(a => a.id));
      for (const submission of db.submissions.filter(s => assignmentIds.has(s.assignmentId))) removeUpload(submission.file);
      db.assignments = db.assignments.filter(a => a.courseId !== course.id);
      db.submissions = db.submissions.filter(s => !assignmentIds.has(s.assignmentId));
      db.grades = db.grades.filter(g => g.courseId !== course.id);
      db.courses = db.courses.filter(c => c.id !== course.id);
      db.quizzes = db.quizzes.filter(q => q.courseId !== course.id);
      db.enrollments = db.enrollments.filter(e => e.courseId !== course.id);
      db.attempts = db.attempts.filter(a => a.courseId !== course.id);
      db.posts = db.posts.filter(p => p.courseId !== course.id);
      db.activity = db.activity.filter(a => a.courseId !== course.id); save();
      return json(res, 200, { ok: true });
    }
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/lessons$/);
  if (match && method === 'POST') {
    const course = ownedCourse(user, courseById(match[1]));
    const lesson = { id: id('lesson'), ...lessonFields(body), order: course.lessons.length, createdAt: now() };
    course.lessons.push(lesson); course.updatedAt = now(); save();
    return json(res, 201, { lesson, course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)$/);
  if (match && ['PATCH','DELETE'].includes(method)) {
    const course = db.courses.find(c => c.lessons.some(l => l.id === match[1]));
    if (!course) fail(404, 'Lesson not found');
    ownedCourse(user, course);
    const lesson = course.lessons.find(l => l.id === match[1]);
    if (method === 'PATCH') { Object.assign(lesson, lessonFields(body, lesson)); course.updatedAt = now(); save(); return json(res, 200, { lesson, course: serializeCourse(course, user) }); }
    removeUpload(lesson.videoFile);
    for (const folder of lesson.resourceFolders || []) for (const file of folder.files || []) removeUpload(file);
    course.lessons = course.lessons.filter(l => l.id !== lesson.id).map((l, order) => ({ ...l, order }));
    for (const e of db.enrollments.filter(e => e.courseId === course.id)) e.completedLessonIds = e.completedLessonIds.filter(x => x !== lesson.id);
    course.updatedAt = now(); save(); return json(res, 200, { ok: true });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/folders$/);
  if (match && ['GET', 'POST'].includes(method)) {
    const { course, lesson } = courseByLesson(match[1]);
    if (method === 'GET') { canStudy(user, course); return json(res, 200, { folders: publicFolders(lesson) }); }
    ownedCourse(user, course);
    if ((lesson.resourceFolders || []).length >= 30) fail(400, 'A lesson supports at most 30 resource folders');
    const name = safeText(body.name, 'Folder name', 100);
    if (/[\/\\\x00-\x1f]/.test(name) || name === '.' || name === '..') fail(400, 'Invalid folder name');
    if ((lesson.resourceFolders || []).some(f => f.name.toLowerCase() === name.toLowerCase())) fail(409, 'This folder name is already used');
    const folder = { id: id('folder'), name, files: [], createdAt: now() };
    (lesson.resourceFolders ||= []).push(folder); course.updatedAt = now(); save();
    return json(res, 201, { folder: publicFolder(folder) });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/folders\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const { course, lesson } = courseByLesson(match[1]); ownedCourse(user, course);
    const folder = folderById(lesson, match[2]);
    for (const file of folder.files || []) removeUpload(file);
    lesson.resourceFolders = lesson.resourceFolders.filter(f => f.id !== folder.id); course.updatedAt = now(); save();
    return json(res, 200, { ok: true });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/folders\/([^/]+)\/files$/);
  if (match && method === 'POST') {
    const { course, lesson } = courseByLesson(match[1]); ownedCourse(user, course);
    const folder = folderById(lesson, match[2]);
    if (folder.files.length >= MAX_FOLDER_FILES) fail(400, 'A folder supports at most 50 files');
    const mime = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const allowed = {
      'application/pdf': '.pdf', 'application/msword': '.doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
      'application/vnd.ms-powerpoint': '.ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
      'application/vnd.ms-excel': '.xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
      'text/plain': '.txt', 'text/csv': '.csv', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
      'application/zip': '.zip', 'application/x-zip-compressed': '.zip'
    };
    const extension = allowed[mime];
    if (!extension) fail(415, 'Unsupported teaching resource file type');
    const originalName = cleanFileName(req);
    if (!originalName.toLowerCase().endsWith(extension)) fail(415, 'File name does not match the declared format');
    if (folder.files.some(file => file.name.toLowerCase() === originalName.toLowerCase())) fail(409, 'A file with this name already exists in the folder');
    const buffer = await readBinary(req, MAX_RESOURCE_FILE);
    const uploaded = await saveUpload(buffer, req, extension);
    const file = { id: id('resource'), ...uploaded, createdAt: now() };
    folder.files.push(file); course.updatedAt = now();
    try { save(); } catch (error) { folder.files.pop(); removeUpload(file); throw error; }
    return json(res, 201, { file: { id: file.id, name: file.name, size: file.size, mimeType: file.mimeType } });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/folders\/([^/]+)\/files\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const { course, lesson } = courseByLesson(match[1]); ownedCourse(user, course);
    const folder = folderById(lesson, match[2]);
    const file = folder.files.find(f => f.id === match[3]);
    if (!file) fail(404, 'File not found');
    folder.files = folder.files.filter(f => f.id !== file.id); removeUpload(file); course.updatedAt = now(); save();
    return json(res, 200, { ok: true });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/folders\/([^/]+)\/download$/);
  if (match && method === 'GET') {
    const { course, lesson } = courseByLesson(match[1]); canStudy(user, course);
    const folder = folderById(lesson, match[2]);
    await Promise.all((folder.files || []).map(f => ensureLocalFile(f.storedName)));
    return streamZip(res, folder.files || [], UPLOAD_DIR, folder.name);
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/video$/);
  if (match && ['GET', 'POST'].includes(method)) {
    const course = db.courses.find(c => c.lessons.some(l => l.id === match[1]));
    if (!course) fail(404, 'Lesson not found');
    const lesson = course.lessons.find(l => l.id === match[1]);
    if (method === 'GET') { canStudy(user, course); return streamUpload(req, res, lesson.videoFile, true); }
    ownedCourse(user, course);
    const mime = String(req.headers['content-type'] || '').split(';')[0].toLowerCase();
    const allowed = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'video/ogg': '.ogv' };
    const extension = allowed[mime]; if (!extension) fail(415, 'Only MP4, WebM, or Ogg videos are supported');
    const buffer = await readBinary(req, MAX_VIDEO);
    const upload = await saveUpload(buffer, req, extension);
    removeUpload(lesson.videoFile);
    lesson.videoFile = upload; lesson.type = 'video'; course.updatedAt = now(); save();
    return json(res, 200, { lesson: serializeCourse(course, user).lessons.find(l => l.id === lesson.id), course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/enroll$/);
  if (match && method === 'POST') {
    requireRole(user, 'student'); const course = courseById(match[1]);
    if (safeText(body.code, 'Enrollment code', 20).toUpperCase() !== course.enrollmentCode) fail(403, 'Incorrect enrollment code');
    if (!enrollment(user.id, course.id)) {
      db.enrollments.push({ id: id('enrollment'), userId: user.id, courseId: course.id, completedLessonIds: [], createdAt: now(), lastActiveAt: now() });
      recentActivity('enrolled', user.id, course.id, course.title); save();
    }
    return json(res, 200, { course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/unenroll$/);
  if (match && method === 'POST') {
    requireRole(user, 'student');
    const course = courseById(match[1]);
    db.enrollments = db.enrollments.filter(e => !(e.userId === user.id && e.courseId === course.id));
    save();
    return json(res, 200, { course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/lessons\/([^/]+)\/complete$/);
  if (match && method === 'POST') {
    requireRole(user, 'student');
    const course = db.courses.find(c => c.lessons.some(l => l.id === match[1]));
    if (!course) fail(404, 'Lesson not found');
    const e = enrollment(user.id, course.id); if (!e) fail(403, 'Enroll in the course first');
    if (!e.completedLessonIds.includes(match[1])) e.completedLessonIds.push(match[1]);
    e.lastActiveAt = now(); recentActivity('lesson_completed', user.id, course.id, course.lessons.find(l => l.id === match[1]).title); save();
    return json(res, 200, { course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/quiz$/);
  if (match) {
    const course = courseById(match[1]); canStudy(user, course);
    let quiz = quizByCourse(course.id);
    if (method === 'GET') {
      const attempts = user.role === 'student' ? db.attempts.filter(a => a.userId === user.id && a.courseId === course.id).map(({ id, score, total, percent, submittedAt }) => ({ id, score, total, percent, submittedAt })) : [];
      return json(res, 200, { quiz: serializeQuiz(quiz, user), attempts });
    }
    if (method === 'PUT') {
      ownedCourse(user, course);
      const questions = validateQuiz(body.questions);
      if (!quiz) { quiz = { id: id('quiz'), courseId: course.id, title: `${course.title} · Knowledge Check`, questions, updatedAt: now() }; db.quizzes.push(quiz); }
      else { quiz.questions = questions; quiz.updatedAt = now(); }
      save(); return json(res, 200, { quiz: serializeQuiz(quiz, user) });
    }
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/quiz\/submit$/);
  if (match && method === 'POST') {
    requireRole(user, 'student'); const course = courseById(match[1]); canStudy(user, course);
    const quiz = quizByCourse(course.id); if (!quiz || !quiz.questions.length) fail(404, 'No quiz has been set up for this course');
    if (!Array.isArray(body.answers)) fail(400, 'Submit an array of answers');
    const answerMap = new Map(body.answers.map(a => [a.questionId, a.optionIndex]));
    const score = quiz.questions.filter(q => answerMap.get(q.id) === q.correctIndex).length;
    const attempt = { id: id('attempt'), quizId: quiz.id, courseId: course.id, userId: user.id, score, total: quiz.questions.length, percent: Math.round(score / quiz.questions.length * 100), submittedAt: now() };
    db.attempts.push(attempt); enrollment(user.id, course.id).lastActiveAt = now(); recentActivity('quiz_submitted', user.id, course.id, `${attempt.percent}%`); save();
    return json(res, 201, { attempt: { id: attempt.id, score, total: attempt.total, percent: attempt.percent, submittedAt: attempt.submittedAt } });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/announcements$/);
  if (match && method === 'POST') {
    const course = ownedCourse(user, courseById(match[1]));
    const title = safeText(body.title, 'Announcement title', 120);
    const content = safeText(body.content, 'Announcement content', 5000);
    if (!Array.isArray(course.announcements)) course.announcements = [];
    const announcement = { id: id('cann'), title, content, authorId: user.id, authorName: user.name, createdAt: now() };
    course.announcements.unshift(announcement);
    course.updatedAt = now();
    save();
    return json(res, 201, { announcement, course: serializeCourse(course, user) });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/announcements\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const course = ownedCourse(user, courseById(match[1]));
    if (!Array.isArray(course.announcements)) course.announcements = [];
    const idx = course.announcements.findIndex(a => a.id === match[2]);
    if (idx < 0) fail(404, 'Course announcement not found');
    course.announcements.splice(idx, 1);
    course.updatedAt = now();
    save();
    return json(res, 200, { ok: true });
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/discussions$/);
  if (match) {
    const course = courseById(match[1]); canStudy(user, course);
    if (method === 'GET') return json(res, 200, { posts: db.posts.filter(p => p.courseId === course.id).slice().sort((a,b) => a.createdAt.localeCompare(b.createdAt)) });
    if (method === 'POST') {
      const content = safeText(body.content, 'Discussion content', 2000);
      const post = { id: id('post'), courseId: course.id, authorId: user.id, authorName: user.name, authorRole: user.role, content, createdAt: now() };
      db.posts.push(post); recentActivity('discussion', user.id, course.id, content.slice(0, 80)); save();
      return json(res, 201, { post });
    }
  }
  match = pathname.match(/^\/api\/courses\/([^/]+)\/discussions\/([^/]+)$/);
  if (match && method === 'DELETE') {
    const course = courseById(match[1]); canStudy(user, course);
    const post = db.posts.find(p => p.courseId === course.id && p.id === match[2]);
    if (!post) fail(404, 'Discussion post not found');
    if (post.authorId !== user.id && !canManageCourse(user, course)) fail(403, 'You can only delete your own discussion posts');
    db.posts = db.posts.filter(p => p.id !== post.id); save(); return json(res, 200, { ok: true });
  }
  if (pathname === '/api/teacher/overview' && method === 'GET') {
    requireRole(user, 'teacher');
    const courses = db.courses.filter(c => isCourseTeacher(user, c));
    const courseIds = new Set(courses.map(c => c.id));
    const enrollments = db.enrollments.filter(e => courseIds.has(e.courseId));
    const enrolledStudentIds = new Set(enrollments.map(e => e.userId));
    const students = db.users.filter(u => u.role === 'student' && enrolledStudentIds.has(u.id));
    const attempts = db.attempts.filter(a => courseIds.has(a.courseId));
    const courseStats = courses.map(c => {
      const e = enrollments.filter(x => x.courseId === c.id);
      const a = attempts.filter(x => x.courseId === c.id);
      return { id: c.id, title: c.title, enrollments: e.length, avgProgress: e.length ? Math.round(e.reduce((s,x) => s + progressFor(x.userId,c).progress,0)/e.length) : 0, avgQuizScore: a.length ? Math.round(a.reduce((s,x) => s+x.percent,0)/a.length) : null };
    });
    const avgCompletion = enrollments.length ? Math.round(enrollments.reduce((s,e) => s + progressFor(e.userId, courses.find(c => c.id === e.courseId)).progress,0)/enrollments.length) : 0;
    const avgQuizScore = attempts.length ? Math.round(attempts.reduce((s,a) => s+a.percent,0)/attempts.length) : null;
    const recent = db.activity.filter(a => courseIds.has(a.courseId)).slice(0,10).map(a => ({ ...a, userName: db.users.find(u => u.id === a.userId)?.name || 'User', courseTitle: courses.find(c => c.id === a.courseId)?.title || '' }));
    return json(res, 200, { stats: { totalStudents: students.length, totalCourses: courses.length, totalEnrollments: enrollments.length, avgCompletion, avgQuizScore }, courses: courseStats, recentActivity: recent });
  }
  if (pathname === '/api/teacher/students' && method === 'GET') {
    requireRole(user, 'teacher');
    const courses = db.courses.filter(c => isCourseTeacher(user, c));
    const courseIds = new Set(courses.map(c => c.id));
    const enrolledStudentIds = new Set(db.enrollments.filter(e => courseIds.has(e.courseId)).map(e => e.userId));
    const students = db.users.filter(u => u.role === 'student' && enrolledStudentIds.has(u.id)).map(u => {
      const details = courses.map(c => studentEnrollmentDetails(u,c)).filter(Boolean);
      return { id: u.id, name: u.name, email: u.email, studentId: u.studentId, enrollments: details,
        avgProgress: details.length ? Math.round(details.reduce((s,e) => s+e.progress,0)/details.length) : 0,
        lastActiveAt: details.map(e => e.lastActiveAt).filter(Boolean).sort().at(-1) || null };
    });
    return json(res, 200, { students });
  }
  fail(404, 'API endpoint not found');
}

const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.ico':'image/x-icon', '.webp':'image/webp', '.woff2':'font/woff2', '.json':'application/json; charset=utf-8' };
function staticFile(req, res, url) {
  if (!['GET','HEAD'].includes(req.method)) return json(res, 405, { error: 'Unsupported request method' });
  let requested;
  try { requested = decodeURIComponent(url.pathname); } catch { return json(res, 400, { error: 'Invalid path' }); }
  const file = path.resolve(PUBLIC, `.${requested === '/' ? '/index.html' : requested}`);
  if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Invalid path' });
  let target = file;
  try { if (!fs.statSync(target).isFile()) target = path.join(PUBLIC, 'index.html'); } catch { target = path.join(PUBLIC, 'index.html'); }
  fs.readFile(target, (err, content) => {
    if (err) return json(res, 404, { error: 'Page not found' });
    res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin' });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else staticFile(req, res, url);
  } catch (error) {
    if (res.writableEnded || res.destroyed) return;
    if (!(error instanceof HttpError)) console.error(error);
    json(res, error.status || 500, { error: error instanceof HttpError ? error.message : 'The server cannot process this request right now' });
  }
});
if (require.main === module) server.listen(PORT, HOST, () => console.log(`Campus learning platform: http://localhost:${PORT}`));
module.exports = { server, db };
