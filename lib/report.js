/** Report rendering — human-readable text + JSON export shape. */

const fmtMs = (ms) => (ms == null ? '—' : `${ms}ms`)

/**
 * Render a crawl result as a text report.
 * @param {object} result — Crawler.crawl() output
 */
export function reportText(result) {
  const lines = []
  lines.push(`link-checkr 报告 — ${result.domain}`)
  lines.push(`检查 ${result.checked} 个 URL:✓ ${result.okCount} · ✗ 死链 ${result.brokenCount} · ↪ 重定向 ${result.redirectCount}${result.capReached ? ' · (达到页数上限,部分 URL 未检查)' : ''}`)
  lines.push('')

  if (result.broken.length) {
    lines.push(`✗ 死链(${result.broken.length})`)
    for (const b of result.broken) {
      lines.push(`  [${b.status ?? 'ERR'}] ${b.url}`)
      if (b.error) lines.push(`        ${b.error}`)
    }
    lines.push('')
  }
  if (result.redirects.length) {
    lines.push(`↪ 重定向链(${result.redirects.length})`)
    for (const r of result.redirects) {
      const chain = r.redirectChain.map((h) => `${h.status} ${h.url}`).join(' → ')
      lines.push(`  ${r.url} (${fmtMs(r.latencyMs)})`)
      lines.push(`        ${chain} → 最终 ${r.status}`)
    }
    lines.push('')
  }
  if (result.skipped.length) {
    const byReason = new Map()
    for (const s of result.skipped) {
      if (!byReason.has(s.reason)) byReason.set(s.reason, [])
      byReason.get(s.reason).push(s.url)
    }
    lines.push(`跳过(${result.skipped.length})`)
    for (const [reason, urls] of byReason) {
      lines.push(`  ${reason} ×${urls.length}`)
      for (const u of urls.slice(0, 5)) lines.push(`        ${u}`)
      if (urls.length > 5) lines.push(`        …等共 ${urls.length} 个`)
    }
    lines.push('')
  }
  if (!result.broken.length) lines.push('✓ 未发现死链')
  return lines.join('\n')
}

/** JSON export shape (stable field order for diffs). */
export function reportJson(result) {
  return {
    domain: result.domain,
    checked: result.checked,
    okCount: result.okCount,
    brokenCount: result.brokenCount,
    redirectCount: result.redirectCount,
    capReached: result.capReached,
    broken: result.broken.map((b) => ({ url: b.url, status: b.status, error: b.error, depth: b.depth })),
    redirects: result.redirects.map((r) => ({ url: r.url, status: r.status, latencyMs: r.latencyMs, chain: r.redirectChain })),
    skipped: result.skipped,
    checkedUrls: result.visitedUrls,
  }
}
