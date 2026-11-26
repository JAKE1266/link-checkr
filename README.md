# link-checkr

[![CI](https://github.com/JAKE1266/link-checkr/actions/workflows/ci.yml/badge.svg)](https://github.com/JAKE1266/link-checkr/actions/workflows/ci.yml)

> 源码：<https://github.com/JAKE1266/link-checkr> · 安装：`npm i github:JAKE1266/link-checkr`（或直接克隆运行）

零依赖**死链检查器**:从起始 URL 出发广度爬取同域内链,报告死链(4xx/5xx)、重定向链、超时,支持 CLI 文本报告与 JSON 导出。纯 Node.js(≥18)。

## 快速开始

```bash
npm test                                     # 29 项断言(fetch/时钟注入,零真实网络)
node cli.js https://example.com --depth 2    # exit 0 = 全部正常,1 = 有死链(CI 友好)
```

## CLI

```
link-checkr <url> [url2…] [选项]
  --depth N        爬取深度(默认 2,0 = 只检查起始 URL)
  --delay MS       每次请求后的限速间隔(默认 0)
  --timeout MS     单请求超时(默认 8000)
  --max-pages N    最多检查的 URL 数(默认 50)
  --json           输出 JSON(便于 CI/存档)
  --out FILE       报告写入文件
```

## 能力

- **限深限速 BFS**:只跟进同域内链(外域/锚点/mailto/tel 记录为跳过);HTML 页面才解析链接,资源(图片/CSS)只查状态
- **重定向链**:手动跟随(≤5 跳)并完整记录 `301 → 302 → 200` 链路;无 Location 头、跳数超限都算死链
- **分类报告**:死链(含 HTTP 状态或 超时/网络错误)、重定向链、跳过原因(按原因聚合)
- **URL 解析**:相对/根相对/上级路径基于起始页解析,fragment 剥离,query 保留
- **确定性**:fetch、时钟、sleep 全部可注入——单测零网络、零真实等待
- **fetch 失效友好**:解析失败的 href(如 `http://[bad`)保留分类但 url=null,不抛异常

## 库 API

```js
import { extractLinks, sameDomain, isHtmlContentType } from './lib/links.js'
import { Crawler } from './lib/crawler.js'
import { reportText, reportJson } from './lib/report.js'

const crawler = new Crawler({
  seeds: ['https://example.com'],
  fetchImpl: fetch,            // 测试可注入 mock
  maxDepth: 2, delayMs: 250,
})
const result = await crawler.crawl()
console.log(reportText(result))
fs.writeFileSync('report.json', JSON.stringify(reportJson(result), null, 2))
```

## 文件结构

```
link-checkr/
├── cli.js             # CLI(参数解析/报告输出/退出码)
├── lib/
│   ├── links.js       # <a href> 提取 + 分类 + URL 解析 + 同域判定
│   ├── crawler.js     # BFS 爬取引擎(手动重定向/超时分类/限速/上限)
│   └── report.js      # 文本报告 + JSON 导出形状
└── test/              # links(6) + crawler(12) + cli E2E(6) + 语法(5) = 29 项
```

## License

MIT
