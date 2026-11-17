// Shared static server for the browser tests.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".mp3": "audio/mpeg",
  ".jpg": "image/jpeg", ".png": "image/png",
};

// Serve `root` on a random port. Returns the server and its base URL.
export const startServer = async (root) => {
  const server = createServer(async (req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    const f = join(root, u.endsWith("/") ? `${u}index.html` : u);
    if (!existsSync(f)) {
      res.statusCode = 404;
      return res.end("not found");
    }
    res.setHeader("Content-Type", MIME[extname(f)] || "application/octet-stream");
    res.end(await readFile(f));
  });
  await new Promise((r) => server.listen(0, r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
};
