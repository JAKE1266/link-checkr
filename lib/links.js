/**
 * HTML link extraction — zero dependencies. Pulls every <a href> out of an
 * HTML document and classifies it against a base URL:
 *
 *   kind: 'absolute' | 'relative'  → a real URL to check (fragment stripped)
 *   kind: 'anchor'                 → same-page #fragment (no request)
 *   kind: 'mailto' | 'tel'         → non-HTTP schemes worth reporting, not fetching
 *   kind: 'other'                  → javascript:/data:/unknown schemes (ignored)
 *
 * The extractor is regex-based ON PURPOSE: a full DOM parser is out of scope
 * for a zero-dependency tool, and anchors are well-defined enough for this.
 */

const A_HREF_RE = /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi

const SKIP_SCHEMES = /^(mailto:|tel:)/i
const IGNORE_SCHEMES = /^(javascript:|data:|blob:|about:)/i

export function sameDomain(urlA, urlB) {
  try {
    return new URL(urlA).hostname === new URL(urlB).hostname
  } catch {
    return false
  }
}

/**
 * Extract links from HTML.
 * @param {string} html
 * @param {string} baseUrl — resolution base for relative hrefs
 * @returns {{ links: Array<{ href: string, url: string|null, kind: string }> }}
 */
export function extractLinks(html, baseUrl) {
  const base = new URL(baseUrl)
  const links = []
  for (const m of String(html ?? '').matchAll(A_HREF_RE)) {
    const href = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (!href) continue
    let kind = 'relative'
    let url = null

    if (href.startsWith('#')) {
      kind = 'anchor'
    } else if (SKIP_SCHEMES.test(href)) {
      kind = href.toLowerCase().startsWith('mailto:') ? 'mailto' : 'tel'
    } else if (IGNORE_SCHEMES.test(href)) {
      kind = 'other'
    } else if (/^https?:\/\//i.test(href)) {
      kind = 'absolute'
      try {
        const u = new URL(href)
        u.hash = ''   // fragment is not part of the checked resource
        url = u.toString()
      } catch { url = null }
    } else {
      try {
        const resolved = new URL(href, base)
        resolved.hash = ''   // fragment is not part of the checked resource
        url = resolved.toString()
      } catch { url = null }
    }
    links.push({ href, url, kind })
  }
  return { links }
}

/** Content-Type check: should this response's body be scanned for links? */
export function isHtmlContentType(contentType) {
  return /text\/html|application\/xhtml/i.test(String(contentType ?? ''))
}
