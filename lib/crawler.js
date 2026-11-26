/**
 * Crawler — breadth-first same-domain link checker. Zero dependencies.
 *
 * - fetch is injectable (tests run without network); time is injectable
 *   (now/sleep) so rate limiting is deterministic.
 * - Depth-limited BFS: only pages (HTML responses, same domain) are scanned
 *   and enqueued; assets are checked but never followed.
 * - Redirects are followed MANUALLY (up to 5 hops) so the full chain can be
 *   reported — fetch's automatic redirect would hide it.
 * - Every checked URL produces exactly one record; the result groups them
 *   into ok / broken / redirects / skipped.
 */

import { extractLinks, isHtmlContentType, sameDomain } from './links.js'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECT_HOPS = 5

export class Crawler {
  constructor({
    seeds = [],
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    maxDepth = 2,
    delayMs = 0,
    timeoutMs = 8000,
    maxPages = 50,
    onCheck = () => {},
    onEvent = () => {},
  } = {}) {
    if (!seeds.length) throw new Error('至少需要一个起始 URL')
    this.fetch = fetchImpl
    this.now = now
    this.sleep = sleep
    this.maxDepth = Math.max(0, Math.floor(maxDepth))
    this.delayMs = Math.max(0, delayMs)
    this.timeoutMs = timeoutMs
    this.maxPages = Math.max(1, maxPages)
    this.onCheck = onCheck
    this.onEvent = onEvent
    this.seeds = seeds.map((s) => {
      const u = new URL(s).toString()
      return { url: u, depth: 0 }
    })
    this.domain = new URL(this.seeds[0].url).hostname
  }

  async crawl() {
    const visited = new Set()
    const records = []
    const queue = [...this.seeds]
    const skipped = []
    let capReached = false

    const classify = (rec) => {
      if (rec.ok) return 'ok'
      if (rec.status) return 'broken'
      return 'broken'
    }

    while (queue.length) {
      const { url, depth } = queue.shift()
      if (visited.has(url)) continue
      visited.add(url)

      if (records.length >= this.maxPages) {
        capReached = true
        skipped.push({ url, reason: `超出页数上限(${this.maxPages})` })
        continue
      }

      const rec = await this.checkUrl(url, depth)
      records.push(rec)
      this.onCheck(rec)
      classify(rec)

      // Follow links only from HTML PAGES within depth budget.
      if (rec.ok && rec.isPage && depth < this.maxDepth) {
        for (const link of rec.links ?? []) {
          if (link.kind === 'absolute' || link.kind === 'relative') {
            if (!link.url) continue
            if (!sameDomain(link.url, this.seeds[0].url)) {
              skipped.push({ url: link.url, reason: '外域链接(仅爬取同域)' })
              continue
            }
            queue.push({ url: link.url, depth: depth + 1 })
          } else {
            skipped.push({ url: link.href, reason: reasonForKind(link.kind) })
          }
        }
      }

      if (this.delayMs > 0) await this.sleep(this.delayMs)
    }

    const ok = records.filter((r) => r.ok)
    const broken = records.filter((r) => !r.ok)
    const redirects = records.filter((r) => r.redirectChain?.length)
    const visitedUrls = [...visited]

    return {
      domain: this.domain,
      startedAt: this.now(),
      finishedAt: this.now(),
      pagesChecked: records.filter((r) => r.isPage && r.ok).length,
      checked: records.length,
      okCount: ok.length,
      brokenCount: broken.length,
      redirectCount: redirects.length,
      records,
      ok,
      broken,
      redirects,
      skipped,
      capReached,
      visitedUrls,
    }
  }

  /**
   * Check one URL: manual redirect follow (chain recorded), latency measured,
   * HTML pages get scanned for links.
   */
  async checkUrl(url, depth = 0) {
    const chain = []
    let target = url
    let res = null
    let error = null

    for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
      const started = this.now()
      try {
        res = await this.fetch(target, {
          method: 'GET',
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs),
        })
      } catch (e) {
        error = /abort|timeout/i.test(`${e.name} ${e.message}`) ? '超时' : `网络错误: ${e.message}`
        break
      }
      const latencyMs = this.now() - started

      if (REDIRECT_STATUSES.has(res.status)) {
        const loc = res.headers?.get?.('location')
        chain.push({ status: res.status, url: target })
        if (!loc) {
          return {
            url, depth, ok: false, status: res.status, latencyMs,
            error: `重定向缺少 Location 头`, redirectChain: chain, isPage: false, links: null,
          }
        }
        target = safeResolve(loc, target) ?? target
        if (hop === MAX_REDIRECT_HOPS) {
          return {
            url, depth, ok: false, status: res.status, latencyMs,
            error: `重定向超过 ${MAX_REDIRECT_HOPS} 跳`, redirectChain: chain, isPage: false, links: null,
          }
        }
        continue
      }

      const contentType = res.headers?.get?.('content-type') ?? ''
      const isPage = res.ok && isHtmlContentType(contentType)
      let links = null
      if (isPage) {
        let text = ''
        try { text = await res.text() } catch { text = '' }
        links = extractLinks(text, target).links
      }
      return {
        url, depth,
        ok: res.status >= 200 && res.status < 400,
        status: res.status,
        latencyMs,
        contentType,
        isPage,
        links,
        redirectChain: chain,
        error: res.status >= 400 ? `HTTP ${res.status}` : null,
      }
    }

    return {
      url, depth, ok: false, status: null, latencyMs: 0,
      error: error ?? '未知错误', redirectChain: chain, isPage: false, links: null,
    }
  }
}

function safeResolve(href, base) {
  try { return new URL(href, base).toString() } catch { return null }
}

function reasonForKind(kind) {
  if (kind === 'anchor') return '页内锚点(不发请求)'
  if (kind === 'mailto') return 'mailto 链接'
  if (kind === 'tel') return 'tel 链接'
  return '非 HTTP scheme'
}
