import { createServer, type Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { exec } from "node:child_process";
import { platform } from "node:os";

export interface ServeOptions {
  html: string;
  port?: number;
  onFix: (indices: number[]) => Promise<number>;
}

export async function serveReport(opts: ServeOptions): Promise<{ url: string; close: () => void }> {
  const port = opts.port ?? await findPort();
  const html = opts.html;

  const server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws: WebSocket) => {
    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === "fix" && Array.isArray(msg.indices)) {
          const count = await opts.onFix(msg.indices);
          ws.send(JSON.stringify({ type: "fixed", count, indices: msg.indices }));
        }
      } catch {
        // ignore malformed messages
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      const url = `http://localhost:${port}`;
      openBrowser(url);
      resolve({
        url,
        close() {
          wss.close();
          server.close();
        },
      });
    });
  });
}

async function findPort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

function openBrowser(url: string): void {
  const cmd = platform() === "darwin" ? "open"
    : platform() === "win32" ? "start"
    : "xdg-open";
  exec(`${cmd} "${url}"`);
}
