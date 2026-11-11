// Copy a pre-V2 database, load the server with that copy, and check upgrade integrity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const source = path.join(__dirname, 'backups', 'platform-pre-v2.json');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-v2-migration-'));
process.env.DATA_FILE = path.join(temp, 'copy.json');
process.env.UPLOAD_DIR = path.join(temp, 'uploads');
try {
  fs.copyFileSync(source, process.env.DATA_FILE);
  const before = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
  const { db } = require('../server');
  const after = JSON.parse(fs.readFileSync(process.env.DATA_FILE, 'utf8'));
  for (const key of ['users', 'courses', 'enrollments', 'quizzes', 'attempts', 'posts', 'activity']) {
    assert.equal(after[key].length, before[key].length, key + ' count preserved');
  }
  for (const key of ['assignments', 'submissions', 'grades']) assert.ok(Array.isArray(after[key]), key + ' initialized');
  const codes = after.courses.map(course => course.enrollmentCode);
  assert.ok(codes.every(code => typeof code === 'string' && code.length > 0), 'all existing courses receive codes');
  assert.equal(new Set(codes).size, codes.length, 'all existing course codes are unique');
  assert.ok(after.courses.every(course => {
    const w = course.gradeWeights;
    return w && ['usual', 'quiz', 'midterm', 'final'].every(k => Number.isFinite(w[k])) && Object.values(w).reduce((a,b)=>a+b,0) === 100;
  }), 'all existing courses receive valid default grade weights');
  assert.deepEqual(after.enrollments, before.enrollments, 'existing enrollment progress preserved');
  assert.deepEqual(after.attempts, before.attempts, 'existing quiz attempts preserved');
  assert.equal(db.courses.length, before.courses.length);
  console.log('PASS: pre-V2 database migrated, enrollment and quiz histories preserved, codes and weights initialized');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
