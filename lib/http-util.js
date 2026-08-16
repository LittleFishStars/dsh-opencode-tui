export function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
}
export function sseHeaders(res) {
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
    });
}
/** 宽松 JSON 解析：失败返回空对象（请求体可选/容错）。 */
export function safeParse(text) {
    try {
        const value = JSON.parse(text);
        return value && typeof value === "object" ? value : {};
    }
    catch {
        return {};
    }
}
export function readBody(req) {
    return new Promise((resolve) => {
        let data = "";
        req.on("data", (chunk) => {
            data += chunk.toString("utf8");
            if (data.length > 1_000_000)
                req.destroy();
        });
        req.on("end", () => resolve(data));
        req.on("error", () => resolve(data));
    });
}
//# sourceMappingURL=http-util.js.map