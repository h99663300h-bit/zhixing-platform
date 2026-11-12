// Verifies zero-dependency S3/R2 remote persistence: DB & binary files survive local container wipes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const s3Objects = new Map();
const s3Server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const key = decodeURIComponent(req.url.replace(/^\/test-bucket\//, ''));
    if (req.method === 'PUT') {
      assert.ok((req.headers.authorization || '').startsWith('AWS4-HMAC-SHA256 '), 'signed request');
      s3Objects.set(key, Buffer.concat(chunks));
      res.writeHead(200); res.end(); return;
    }
    if (req.method === 'GET') {
      if (!s3Objects.has(key)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200); res.end(s3Objects.get(key)); return;
    }
    if (req.method === 'DELETE') {
      s3Objects.delete(key);
      res.writeHead(204); res.end(); return;
    }
    res.writeHead(405); res.end();
  });
});

async function runInstance(tempDir, s3Url, fn) {
  const env = {
    ...process.env,
    PORT: '0',
    HOST: '127.0.0.1',
    DATA_FILE: path.join(tempDir, 'platform.json'),
    UPLOAD_DIR: path.join(tempDir, 'uploads'),
    S3_ENDPOINT: s3Url,
    S3_BUCKET: 'test-bucket',
    S3_ACCESS_KEY_ID: 'test-key',
    S3_SECRET_ACCESS_KEY: 'test-secret',
    S3_REGION: 'auto',
  };
  const child = spawn(process.execPath, ['-e', `
    const { server } = require('./server');
    server.listen(0, '127.0.0.1', () => console.log('PORT:' + server.address().port));
  `], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  const port = await new Promise((resolve, reject) => {
    let out = '';
    child.stdout.on('data', d => {
      out += d.toString();
      const m = out.match(/PORT:(\d+)/);
      if (m) resolve(Number(m[1]));
    });
    child.stderr.on('data', d => process.stderr.write(d));
    child.on('exit', code => reject(new Error('Exited early: ' + code)));
  });
  try {
    await fn('http://127.0.0.1:' + port);
  } finally {
    child.kill('SIGTERM');
    await new Promise(r => child.on('exit', r));
  }
}

async function main() {
  await new Promise(r => s3Server.listen(0, '127.0.0.1', r));
  const s3Url = 'http://127.0.0.1:' + s3Server.address().port;
  const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-s3-1-'));
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'zhixing-s3-2-'));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');

  try {
    let avatarUrl = '';
    await runInstance(dir1, s3Url, async base => {
      const reg = await fetch(base + '/api/auth/register', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role: 'student', name: 'R2 Student', studentId: '20260888', email: 'r2@siu.edu', password: 'Password123!' }),
      });
      assert.equal(reg.status, 201);
      const cookie = reg.headers.get('set-cookie').split(';')[0];
      const up = await fetch(base + '/api/profile/avatar', {
        method: 'POST', headers: { cookie, 'content-type': 'image/png', 'x-file-name': 'avatar.png' }, body: png,
      });
      assert.equal(up.status, 200);
      avatarUrl = (await up.json()).profile.avatarUrl;
      await new Promise(r => setTimeout(r, 150));
    });

    assert.ok(s3Objects.has('_db/platform.json'), 'DB persisted to S3');

    // Start a brand-new container with an empty local dir2 (simulating Render redeploy)
    await runInstance(dir2, s3Url, async base => {
      const login = await fetch(base + '/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: '20260888', password: 'Password123!' }),
      });
      assert.equal(login.status, 200, 'user restored from S3');
      const cookie = login.headers.get('set-cookie').split(';')[0];
      const av = await fetch(base + avatarUrl, { headers: { cookie } });
      assert.equal(av.status, 200, 'binary avatar restored from S3');
      assert.ok(Buffer.from(await av.arrayBuffer()).equals(png), 'restored bytes match');
    });

    console.log('PASS: S3/R2 remote DB & binary file persistence across container wipes');
  } finally {
    s3Server.close();
    fs.rmSync(dir1, { recursive: true, force: true });
    fs.rmSync(dir2, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
