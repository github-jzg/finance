const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = 4174;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".toon": "text/plain; charset=utf-8",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "POST" && url.pathname === "/save-data") {
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        fs.writeFile(path.join(root, "data.toon"), body, "utf8", (error) => {
          if (error) {
            send(res, 500, error.message);
            return;
          }
          send(res, 200, "saved");
        });
      });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, "Method not allowed");
      return;
    }

    const requested = url.pathname === "/" ? "/index.html" : url.pathname;
    const filePath = path.normalize(path.join(root, requested));
    if (!filePath.startsWith(root)) {
      send(res, 403, "Forbidden");
      return;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        send(res, 404, "Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream" });
      if (req.method === "HEAD") res.end();
      else res.end(content);
    });
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`Asset allocation app running at http://127.0.0.1:${port}/`);
  });
