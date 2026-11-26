/** Crawler tests — injected fetch + clock, zero real network/wait. */
import assert from 'node:assert/strict'
import { Crawler } from '../lib/crawler.js'

let n = 0
const pending = []
function test(name, fn) {
  pending.push(async () => {
    try { await fn(); console.log(`ok   ${name}`); n++ }
    catch (e) { console.error(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1 }
  })
}

let t = 0
const sleeps = []
const mk = ({ seeds, routes, opts = {} } = {}) => {
  t = 0
  sleeps.length = 0
  const fetchLog = []
  const fetchImpl = async (url, requestOpts = {}) => {
    fetchLog.push(url)
    const route = routes(url)
    if (route === undefined) throw new Error(`unexpected fetch: ${url}`)
    return route
  }
  const crawler = new Crawler({
    seeds,
    fetchImpl,
    now: () => t,
    sleep: async (ms) => { sleeps.push(ms); t += ms },
    ...opts,
  })
  return { crawler, sleeps, fetchLog }
}

const page = (body, contentType = 'text/html; charset=utf-8') => mkRes(200, body, contentType)
function mkRes(status, body = '', contentType = 'text/html; charset=utf-8', headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] ?? (k.toLowerCase() === 'content-type' ? contentType : null) },
    text: async () => body,
  }
}

test('BFS follows same-domain links within depth; broken links recorded', async () => {
  const routes = (url) => {
    if (url === 'https://s.test/') return page('<a href="/a">A</a><a href="/gone">死链</a>')
    if (url === 'https://s.test/a') return page('<a href="/b">B</a>')
    if (url === 'https://s.test/b') return page('<a href="/a">回环</a>')
    if (url === 'https://s.test/gone') return mkRes(404, 'not found')
    return undefined
  }
  const { crawler } = mk({ seeds: ['https://s.test/'], routes, opts: { maxDepth: 2 } })
  const result = await crawler.crawl()
  assert.equal(result.checked, 4, '/ /a /gone /b 各查一次')
  assert.ok(result.visitedUrls.includes('https://s.test/a'))
  assert.equal(result.brokenCount, 1)
  assert.equal(result.broken[0].url, 'https://s.test/gone')
  assert.match(result.broken[0].error, /404/)
  assert.equal(result.okCount, 3)
  // 回环: /a 被再次发现但只查一次
  assert.ok(!result.capReached)
})

test('external-domain links are skipped, not fetched', async () => {
  const external = []
  const routes = (url) => {
    if (url === 'https://s.test/') {
      external.push(url)
      return page('<a href="https://elsewhere.test/x">外</a><a href="https://s.test/inner">内</a>')
    }
    return page('ok')
  }
  const { crawler } = mk({ seeds: ['https://s.test/'], routes, opts: { maxDepth: 1 } })
  const result = await crawler.crawl()
  assert.ok(!result.visitedUrls.includes('https://elsewhere.test/x'), '外域不入队')
  const skip = result.skipped.find((s) => s.url === 'https://elsewhere.test/x')
  assert.match(skip.reason, /外域/)
})

test('maxDepth 0 checks only the seeds', async () => {
  const routes = (url) => page('<a href="/a">A</a>')
  const { crawler } = mk({ seeds: ['https://s.test/'], routes, opts: { maxDepth: 0 } })
  const result = await crawler.crawl()
  assert.equal(result.checked, 1)
})

test('redirect chain is followed manually and reported', async () => {
  const routes = (url) => {
    if (url === 'https://s.test/old') return mkRes(301, '', 'text/html', { location: '/mid' })
    if (url === 'https://s.test/mid') return mkRes(302, '', 'text/html', { location: 'https://s.test/new' })
    if (url === 'https://s.test/new') return page('<a href="/old">回链</a>')
    return undefined
  }
  const { crawler } = mk({ seeds: ['https://s.test/old'], routes, opts: { maxDepth: 1 } })
  const result = await crawler.crawl()
  assert.equal(result.redirectCount, 1)
  const r = result.redirects[0]
  assert.equal(r.status, 200, '最终状态')
  assert.equal(r.redirectChain.length, 2)
  assert.equal(r.redirectChain[0].status, 301)
  assert.equal(r.redirectChain[1].status, 302)
  assert.equal(r.ok, true, '最终 200 → ok')
})

test('redirect without Location is a broken record', async () => {
  const routes = (url) => (url === 'https://s.test/x' ? mkRes(302, '', 'text/html') : undefined)
  const { crawler } = mk({ seeds: ['https://s.test/x'], routes, opts: { maxDepth: 0 } })
  const result = await crawler.crawl()
  assert.equal(result.brokenCount, 1)
  assert.match(result.broken[0].error, /Location/)
})

test('5-hop redirect loop is capped as broken', async () => {
  const routes = (url) => mkRes(301, '', 'text/html', { location: url === 'https://s.test/a' ? 'https://s.test/b' : 'https://s.test/a' })
  const { crawler } = mk({ seeds: ['https://s.test/a'], routes, opts: { maxDepth: 0 } })
  const result = await crawler.crawl()
  assert.equal(result.brokenCount, 1)
  assert.match(result.broken[0].error, /重定向超过/)
})

test('timeout (AbortError) is classified as 超时', async () => {
  const err = new Error('The operation was aborted')
  err.name = 'TimeoutError'
  const { crawler } = mk({
    seeds: ['https://s.test/'],
    routes: () => { throw err },
    opts: { maxDepth: 0 },
  })
  const result = await crawler.crawl()
  assert.equal(result.brokenCount, 1)
  assert.equal(result.broken[0].error, '超时')
})

test('non-HTML assets are checked but not scanned for links', async () => {
  const routes = (url) => (url === 'https://s.test/logo.png' ? mkRes(200, 'PNGDATA', 'image/png') : page('<a href="/logo.png">图</a>'))
  const { crawler } = mk({ seeds: ['https://s.test/'], routes, opts: { maxDepth: 1 } })
  const result = await crawler.crawl()
  assert.equal(result.checked, 2, 'logo.png 被检查')
  // logo.png 是 200 但非 HTML:它不被扫描,/deep 不会被发现
  assert.ok(!result.visitedUrls.includes('https://s.test/deep'))
})

test('delayMs sleeps after every request (rate limiting)', async () => {
  const routes = (url) => page('<a href="/a">A</a>')
  const { crawler, sleeps } = mk({
    seeds: ['https://s.test/'],
    routes,
    opts: { maxDepth: 1, delayMs: 250 },
  })
  await crawler.crawl()
  assert.deepEqual(sleeps, [250, 250], '两次请求各睡一次')
})

test('maxPages cap marks the overflow as skipped', async () => {
  const routes = (url) => {
    const m = url.match(/p(\d+)/)
    const n = m ? +m[1] : 0
    return page(`<a href="/p${n + 1}">next</a><a href="/p${n + 2}">skip</a>`)
  }
  const { crawler } = mk({
    seeds: ['https://s.test/p0'],
    routes,
    opts: { maxDepth: 5, maxPages: 3 },
  })
  const result = await crawler.crawl()
  assert.equal(result.checked, 3)
  assert.equal(result.capReached, true)
  assert.ok(result.skipped.some((s) => s.reason.includes('页数上限')))
})

test('missing seed URL throws immediately', () => {
  assert.throws(() => new Crawler({ seeds: [] }), /至少需要/)
})

test('crawl timing uses the injected clock', async () => {
  let t2 = 0
  const crawler = new Crawler({
    seeds: ['https://s.test/'],
    fetchImpl: async () => { t2 += 30; return page('ok') },
    now: () => t2,
    maxDepth: 0,
  })
  const result = await crawler.crawl()
  assert.equal(result.records[0].latencyMs, 30)
  assert.ok(result.finishedAt >= result.startedAt)
})

for (const run of pending) await run()
console.log(`\n${n} passed${process.exitCode ? ', some FAILED' : ', 0 failed'}`)
