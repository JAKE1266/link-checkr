#!/usr/bin/env node
/**
 * link-checkr CLI — zero-dependency dead-link checker.
 *
 *   link-checkr <url> [url2…] [--depth 2] [--delay 0] [--timeout 8000]
 *               [--max-pages 50] [--json] [--out report.json]
 *
 * Exit code: 0 when no broken links, 1 when broken links or errors (CI friendly).
 */
import fs from 'node:fs'
import { Crawler } from './lib/crawler.js'
import { reportText, reportJson } from './lib/report.js'

function usage() {
  return [
    'link-checkr — 零依赖死链检查器',
    '',
    '用法:',
    '  link-checkr <url> [url2…] [选项]',
    '',
    '选项:',
    '  --depth N        爬取深度(默认 2,0 = 只检查起始 URL)',
    '  --delay MS       每次请求后的间隔(限速,默认 0)',
    '  --timeout MS     单请求超时(默认 8000)',
    '  --max-pages N    最多检查的 URL 数(默认 50)',
    '  --json           输出 JSON 而不是文本报告',
    '  --out FILE       报告写入文件(JSON 时同样生效)',
    '',
    '退出码:发现死链/错误时为 1,全部正常为 0。',
  ].join('\n')
}

function parseArgv(argv) {
  const pos = []
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) { opts[key] = next; i++ }
      else opts[key] = true
    } else pos.push(a)
  }
  return { pos, opts }
}

/** Numeric option: 0 is VALID (falsy!) — only undefined/''/NaN fall back. */
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v))) ? d : Number(v)

export async function main(argv = process.argv.slice(2)) {
  const { pos, opts } = parseArgv(argv)
  if (!pos.length || opts.help) { console.log(usage()); return 0 }

  const seeds = pos.filter((u) => /^https?:\/\//i.test(u))
  if (!seeds.length) throw new Error('起始 URL 必须以 http:// 或 https:// 开头')

  const crawler = new Crawler({
    seeds,
    maxDepth: num(opts.depth, 2),
    delayMs: num(opts.delay, 0),
    timeoutMs: num(opts.timeout, 8000),
    maxPages: num(opts['max-pages'], 50),
    onCheck: (rec) => {
      if (!rec.ok) console.error(`  ✗ ${rec.url} — ${rec.error ?? `HTTP ${rec.status}`}`)
    },
  })
  const result = await crawler.crawl()

  let text
  if (opts.json) text = JSON.stringify(reportJson(result), null, 2)
  else text = reportText(result)

  if (opts.out) {
    fs.writeFileSync(opts.out, text.endsWith('\n') ? text : text + '\n', 'utf8')
    console.log(`报告已写入 ${opts.out}`)
  } else {
    console.log(text)
  }
  return result.brokenCount > 0 ? 1 : 0
}

if (process.argv[1] && process.argv[1].endsWith('cli.js')) {
  main().then(
    (code) => { process.exitCode = code },
    (e) => { console.error(`错误: ${e.message}`); process.exitCode = 1 },
  )
}
