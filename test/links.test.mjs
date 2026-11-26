/** Link extractor tests: classification, resolution, same-domain. */
import assert from 'node:assert/strict'
import { extractLinks, sameDomain, isHtmlContentType } from '../lib/links.js'

let n = 0
function test(name, fn) {
  try { fn(); console.log(`ok   ${name}`); n++ }
  catch (e) { console.error(`FAIL ${name}\n     ${e.stack}`); process.exitCode = 1 }
}

const BASE = 'https://site.test/blog/index.html'
const kinds = (html) => Object.fromEntries(extractLinks(html, BASE).links.map((l) => [l.href, l]))

test('absolute/relative/anchor/mailto/tel/other classification', () => {
  const k = kinds(`
    <a href="https://other.test/x">外域</a>
    <a href="/about">根相对</a>
    <a href="post.html">相对</a>
    <a href="../up">上级</a>
    <a href="#section">锚点</a>
    <a href="mailto:a@b.c">邮件</a>
    <a href="tel:+86123">电话</a>
    <a href="javascript:void(0)">脚本</a>
    <a href="data:text/plain,x">data</a>
  `)
  assert.equal(k['https://other.test/x'].kind, 'absolute')
  assert.equal(k['/about'].kind, 'relative')
  assert.equal(k['/about'].url, 'https://site.test/about')
  assert.equal(k['post.html'].kind, 'relative')
  assert.equal(k['post.html'].url, 'https://site.test/blog/post.html')
  assert.equal(k['../up'].url, 'https://site.test/up')
  assert.equal(k['#section'].kind, 'anchor')
  assert.equal(k['#section'].url, null)
  assert.equal(k['mailto:a@b.c'].kind, 'mailto')
  assert.equal(k['tel:+86123'].kind, 'tel')
  assert.equal(k['javascript:void(0)'].kind, 'other')
  assert.equal(k['data:text/plain,x'].kind, 'other')
})

test('fragment is stripped from resolved URLs; query is kept', () => {
  const k = kinds('<a href="post.html?utm=1#top">x</a><a href="https://o.test/p#f">y</a>')
  assert.equal(k['post.html?utm=1#top'].url, 'https://site.test/blog/post.html?utm=1')
  assert.equal(k['https://o.test/p#f'].url, 'https://o.test/p')
})

test('single and double quotes, unquoted values, multiple anchors', () => {
  const { links } = extractLinks(
    `<a href='/a'>1</a><a href=/b>2</a><a class="x" href="/c">3</a><a>无href</a>`,
    BASE,
  )
  const urls = links.map((l) => l.url)
  assert.deepEqual(urls, ['https://site.test/a', 'https://site.test/b', 'https://site.test/c'])
})

test('sameDomain compares hostnames only', () => {
  assert.equal(sameDomain('https://a.test/x', 'https://a.test/y'), true)
  assert.equal(sameDomain('https://a.test/x', 'http://a.test/y'), true, '同主机名即同域(协议不敏感)')
  assert.equal(sameDomain('https://a.test/x', 'https://b.test/y'), false)
  assert.equal(sameDomain('not a url', 'https://b.test'), false)
})

test('isHtmlContentType accepts html/xhtml, rejects assets', () => {
  assert.equal(isHtmlContentType('text/html; charset=utf-8'), true)
  assert.equal(isHtmlContentType('application/xhtml+xml'), true)
  assert.equal(isHtmlContentType('image/png'), false)
  assert.equal(isHtmlContentType('application/json'), false)
  assert.equal(isHtmlContentType(''), false)
})

test('empty href is skipped; malformed absolute URL keeps kind but null url', () => {
  assert.deepEqual(extractLinks('', BASE).links, [])
  const { links } = extractLinks('<a href="">空</a><a href="http://[bad">坏</a>', BASE)
  assert.equal(links.length, 1, '空 href 直接跳过')
  assert.equal(links[0].kind, 'absolute', 'http 前缀仍分类为 absolute')
  assert.equal(links[0].url, null, '解析失败 → null')
})

console.log(`\n${n} passed${process.exitCode ? ', some FAILED' : ', 0 failed'}`)
