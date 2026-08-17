#!/usr/bin/env node
/* 记录型 HTTP 服务器：记录 opencode TUI 客户端发出的所有请求（method/path/body）与响应状态。
   支持三种模式：mock 命中返回 mock；PROXY 未命中转发上游并把响应样例存 research/samples/；否则 404。 */
const http = require("http")
const zlib = require("zlib")
const fs = require("fs")

const PORT = parseInt(process.env.RECORD_PORT || "4199", 10)
const LOG = process.env.RECORD_LOG || "research/requests.log"
const MOCK = process.env.RECORD_MOCK || "research/mock.json"
const PROXY = process.env.RECORD_PROXY || ""
const PROXY_AUTH = process.env.RECORD_PROXY_AUTH || ""
// mock.json: { "METHOD /path": { status, body, contentType, sse, sseEvents }, ... } 支持 :param 前缀匹配

fs.writeFileSync(LOG, "")
const log = (line) => fs.appendFileSync(LOG, line + "\n")

const mock = JSON.parse(fs.readFileSync(MOCK, "utf8"))
const SAMPLES = "research/samples"
fs.mkdirSync(SAMPLES, { recursive: true })
const sampleKey = (method, path) =>
  `${method}_${path.replace(/[^A-Za-z0-9/]/g, "_").replace(/^\//, "").replace(/\//g, "_") || "root"}`

function proxyRequest(req, res, body) {
  const upstream = new URL(PROXY)
  const headers = { ...req.headers, host: upstream.host }
  if (PROXY_AUTH) headers.authorization = `Basic ${Buffer.from(PROXY_AUTH).toString("base64")}`
  const preq = http.request(
    {
      hostname: upstream.hostname,
      port: upstream.port,
      path: req.url,
      method: req.method,
      headers,
    },
    (pres) => {
      if (pres.headers["content-type"]?.includes("text/event-stream")) {
        log(`  -> ${pres.statusCode} sse-stream`)
        res.writeHead(pres.statusCode, pres.headers)
        pres.pipe(res)
        return
      }
      let buf = ""
      pres.on("data", (c) => (buf += c))
      pres.on("end", () => {
        let body = buf
        let headers = { ...pres.headers }
        if (pres.headers["content-encoding"] === "gzip") {
          try {
            body = zlib.gunzipSync(buf)
            delete headers["content-encoding"]
            headers["content-length"] = String(body.length)
          } catch {}
        }
        try {
          fs.writeFileSync(`${SAMPLES}/${sampleKey(req.method, req.url.split("?")[0])}.json`, body)
        } catch {}
        log(`  -> ${pres.statusCode} ${body.slice(0, 300)}`)
        res.writeHead(pres.statusCode, { "Content-Type": pres.headers["content-type"] || "application/json" })
        res.end(body)
      })
    },
  )
  preq.on("error", (e) => {
    res.writeHead(502, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: "proxy failed", detail: String(e) }))
  })
  preq.end(body)
}

function matchMock(method, path) {
  const exact = mock[`${method} ${path}`]
  if (exact) return exact
  const parts = path.split("/")
  for (const [key, val] of Object.entries(mock)) {
    const [m, p] = key.split(" ")
    if (m !== method) continue
    const kp = p.split("/")
    if (kp.length !== parts.length) continue
    let ok = true
    for (let i = 0; i < kp.length; i++) {
      if (kp[i].startsWith(":")) continue
      if (kp[i] !== parts[i]) { ok = false; break }
    }
    if (ok) return val
  }
  return null
}

const server = http.createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    log(`${new Date().toISOString()} ${req.method} ${req.url} body=${body.slice(0, 500)}`)
    const hit = matchMock(req.method, req.url.split("?")[0])
    if (hit) {
      if (hit.sse) {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" })
        log("  -> 200 sse-mock")
        for (const ev of hit.sseEvents || []) {
          res.write(`event: ${ev.name}\ndata: ${JSON.stringify(ev.data)}\n\n`)
        }
        res.write(": connected\n\n")
        const iv = setInterval(() => res.write(": keepalive\n\n"), 5000)
        req.on("close", () => clearInterval(iv))
        return
      }
      res.writeHead(hit.status || 200, { "Content-Type": hit.contentType || "application/json" })
      log(`  -> ${hit.status || 200} mock`)
      const payload = hit.body
      if (typeof payload === "string" && payload.startsWith("__file:")) {
        res.end(fs.readFileSync(payload.slice(7), "utf8"))
      } else {
        res.end(typeof payload === "string" ? payload : JSON.stringify(payload))
      }
      return
    }
    if (PROXY) {
      proxyRequest(req, res, body)
      return
    }
    res.writeHead(404, { "Content-Type": "application/json" })
    log("  -> 404 no-mock")
    res.end(JSON.stringify({ error: "not implemented by record server", path: req.url }))
  })
})

server.listen(PORT, () => console.log(`record server on http://127.0.0.1:${PORT}, log=${LOG}`))
