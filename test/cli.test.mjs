/**
 * CLI E2E — spawns the real cli.js against a LOCAL mock HTTP server (real
 * requests, zero external network) and verifies the text/JSON reports,
 * --out export, and the CI exit code.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Async spawn: spawnSync would BLOCK this process's event loop — and the mock
// upstream lives HERE, so the child's requests would hang until timeout.
const run = (args) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(ROOT, 'cli.js'), ...args], { encoding: 'utf8' })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (d) => { stdout += d })
  child.stderr.on('data', (d) => { stderr += d })
  child.on('close', (status) => resolve({ status, stdout, stderr }))
})

let n = 0
// Queue tests: run() awaits the child process, and the mock upstream lives in
// THIS process — parallel tests would race the shared upstream + temp dir.
const pending = []
const test = (name, fn) => {
  pending.push(async () => {
    try { await fn(); console.log(`ok   ${name}`); n++ }
    catch (e) { console.error(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1 }
  })
}

// ---- mock upstream ----
const HTML = {
  '/': '<h1>index</h1><a href="/ok">ok page</a><a href="/missing">missing</a><a href="https://external.test/x">外域</a><a href="mailto:a@b.c">邮件</a>',
  '/ok': '<h1>ok page</h1><a href="/">back</a>',
}
const upstream = http.createServer((req, res) => {
  const doc = HTML[req.url.split('?')[0]]
  if (doc) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(doc) }
  else { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found') }
})
await new Promise((r) => upstream.listen(0, '127.0.0.1', r))
const port = upstream.address().port
const base = `http://127.0.0.1:${port}`

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'link-checkr-cli-'))

try {
  test('文本报告:死链分组、外域跳过、exit 1', async () => {
    const r = await run([`${base}/`, '--depth', '1'])
    assert.equal(r.status, 1, '有死链 → exit 1')
    assert.match(r.stdout, /link-checkr 报告/)
    assert.match(r.stdout, /死链\(1\)/)
    assert.match(r.stdout, /\/missing/)
    assert.match(r.stdout, /外域链接/)
    assert.match(r.stdout, /mailto 链接/)
    assert.ok(!r.stdout.includes('✓ 未发现死链'), '有死链时不应出现未发现死链')
  })

  test('--json 输出结构化结果', async () => {
    const r = await run([`${base}/`, '--depth', '1', '--json'])
    assert.equal(r.status, 1)
    const data = JSON.parse(r.stdout)
    assert.equal(data.brokenCount, 1)
    assert.equal(data.broken[0].url, `${base}/missing`)
    assert.equal(data.broken[0].status, 404)
    assert.ok(data.checkedUrls.includes(`${base}/ok`))
    assert.ok(data.skipped.some((s) => s.url === 'https://external.test/x'))
    assert.ok(data.skipped.some((s) => s.url === 'mailto:a@b.c'))
  })

  test('全部正常时 exit 0 且报告含 ✓', async () => {
    const r = await run([`${base}/ok`, '--depth', '0'])
    assert.equal(r.status, 0, r.stdout)
    assert.match(r.stdout, /✓ 未发现死链/)
  })

  test('--out 写入 JSON 文件', async () => {
    const out = path.join(dir, 'report.json')
    const r = await run([`${base}/`, '--depth', '1', '--json', '--out', out])
    assert.equal(r.status, 1)
    assert.match(r.stdout, /报告已写入/)
    const data = JSON.parse(fs.readFileSync(out, 'utf8'))
    assert.equal(data.brokenCount, 1)
  })

  test('非 http 起始 URL 报错', async () => {
    const r = await run(['ftp://nope'])
    assert.equal(r.status, 1)
    assert.match(r.stderr, /http/)
  })

  test('--help 显示用法', async () => {
    const r = await run(['--help'])
    assert.equal(r.status, 0)
    assert.match(r.stdout, /用法/)
  })
} finally {
  for (const p of pending) await p()
  upstream.close()
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log(`\n${n} passed${process.exitCode ? ', some FAILED' : ', 0 failed'}`)
