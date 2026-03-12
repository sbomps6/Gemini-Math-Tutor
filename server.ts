import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import fs from "fs";
import http from "http";
import https from "https";
import { WebSocketServer, WebSocket } from "ws";

import { Server as SocketServer } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Log capturing for remote debugging
const serverLogs: string[] = [];
const maxLogs = 100;

const log = (...args: any[]) => {
  const msg = `[${new Date().toISOString().split('T')[1].split('.')[0]}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
  serverLogs.push(msg);
  if (serverLogs.length > maxLogs) serverLogs.shift();
  console.log(...args);
};

const error = (...args: any[]) => {
  const msg = `[${new Date().toISOString().split('T')[1].split('.')[0]}] ERROR: ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}`;
  serverLogs.push(msg);
  if (serverLogs.length > maxLogs) serverLogs.shift();
  console.error(...args);
};

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const PORT = 3000;

  log("[Server] Initializing with Socket.io Relay...");

  // Setup Socket.io for robust tunneling
  const io = new SocketServer(server, {
    cors: { origin: "*" },
    path: "/socket.io"
  });

  io.on("connection", (socket) => {
    log(`[Socket.io] New Client Connected: ${socket.id}`);

    let googleWs: WebSocket | null = null;

    socket.on("gemini-connect", (data) => {
      const { url } = data;
      log(`[Relay] Client requesting Gemini connection: ${url.substring(0, 50)}...`);

      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      
      // Reconstruct the Google URL with the server-side key
      let [baseUrl, query] = url.split('?');
      
      // Fix double slash issue (SDK sometimes adds an extra slash)
      baseUrl = baseUrl.replace("googleapis.com//ws/", "googleapis.com/ws/");
      
      const params = new URLSearchParams(query || "");
      if (apiKey) {
        params.set('key', apiKey);
        log("[Relay] Using server-side API key.");
      } else {
        error("[Relay] No API key found in environment!");
      }
      
      const rawOrigin = socket.handshake.headers.origin || socket.handshake.headers['origin'];
      const rawReferer = socket.handshake.headers.referer || socket.handshake.headers['referer'];
      
      let clientOrigin = rawOrigin;
      if (!clientOrigin && rawReferer) {
        try {
          const refUrl = new URL(rawReferer as string);
          clientOrigin = `${refUrl.protocol}//${refUrl.host}`;
        } catch (e) {}
      }
      
      if (!clientOrigin) {
        clientOrigin = "https://ais-pre-2o2ozpfms2zmlm5wmvxe54-187211787605.us-east1.run.app";
      }
      
      const clientReferer = rawReferer || clientOrigin + "/";
      const targetUrl = `${baseUrl}?${params.toString()}`;
      
      log(`[Relay] Final Headers - Origin: ${clientOrigin}, Referer: ${clientReferer}`);
      log(`[Relay] Target URL: ${targetUrl.substring(0, 100)}...`);

      const wsHeaders: any = {
        "origin": clientOrigin,
        "referer": clientReferer,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      };

      googleWs = new WebSocket(targetUrl, {
        headers: wsHeaders
      });

      googleWs.on('open', () => {
        log("[Relay] Connected to Google.");
        socket.emit("gemini-status", { status: "open" });
      });

      googleWs.on('message', (msg) => {
        // Send binary or text data back to client
        socket.emit("gemini-data", msg);
      });

      googleWs.on('error', (err) => {
        error("[Relay] Google WS Error:", err.message);
        socket.emit("gemini-status", { status: "error", message: err.message });
      });

      googleWs.on('close', (code, reason) => {
        log(`[Relay] Google WS Closed. Code: ${code}, Reason: ${reason}`);
        socket.emit("gemini-status", { status: "closed", code, reason: reason.toString() });
      });
    });

    socket.on("gemini-send", (data) => {
      if (googleWs && googleWs.readyState === WebSocket.OPEN) {
        try {
          if (typeof data === 'string') {
            log(`[Relay] Sending Text: ${data.substring(0, 100)}...`);
            googleWs.send(data);
          } else if (Buffer.isBuffer(data) || data instanceof ArrayBuffer || data instanceof Uint8Array) {
            const len = (data as any).byteLength || (data as any).length;
            log(`[Relay] Sending Binary: ${len} bytes`);
            googleWs.send(data);
          } else {
            // If it's an object, stringify it
            const str = JSON.stringify(data);
            log(`[Relay] Sending Object as JSON: ${str.substring(0, 100)}...`);
            googleWs.send(str);
          }
        } catch (err: any) {
          error("[Relay] Error sending to Google:", err.message);
        }
      } else {
        log(`[Relay] gemini-send ignored: Google WS not open (State: ${googleWs?.readyState})`);
      }
    });

    socket.on("disconnect", () => {
      log(`[Socket.io] Client Disconnected: ${socket.id}`);
      if (googleWs) {
        googleWs.close();
        googleWs = null;
      }
    });
  });

  app.get("/api/health", (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY;
    res.json({ 
      status: "ok", 
      apiKeySet: !!apiKey,
      env: process.env.NODE_ENV
    });
  });

  app.get("/api/logs", (req, res) => {
    res.json({ logs: serverLogs });
  });

  app.get("/api/test-google", (req, res) => {
    try {
      const apiKey = process.env.API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (!apiKey) return res.status(400).json({ error: "No API Key found in environment" });
      
      const options = {
        hostname: 'generativelanguage.googleapis.com',
        port: 443,
        path: `/v1beta/models?key=${apiKey}`,
        method: 'GET',
        headers: {
          'referer': 'https://ais-pre-2o2ozpfms2zmlm5wmvxe54-187211787605.us-east1.run.app/',
          'origin': 'https://ais-pre-2o2ozpfms2zmlm5wmvxe54-187211787605.us-east1.run.app',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      };

      const googleReq = https.request(options, (googleRes) => {
        let data = '';
        googleRes.on('data', (chunk) => data += chunk);
        googleRes.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            res.json({ 
              status: googleRes.statusCode === 200 ? "success" : "failed", 
              statusCode: googleRes.statusCode, 
              error: googleRes.statusCode === 200 ? null : parsed
            });
          } catch (e) {
            res.json({ status: "failed", statusCode: googleRes.statusCode, raw: data });
          }
        });
      });

      googleReq.on('error', (e) => {
        res.status(500).json({ error: e.message });
      });

      googleReq.end();
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });

    app.use(async (req, res, next) => {
      const isHtmlRequest = req.headers.accept?.includes("text/html") || req.url === "/" || req.url.endsWith(".html");
      if (isHtmlRequest && !req.url.includes("/node_modules/")) {
        try {
          const indexPath = path.resolve(__dirname, "index.html");
          const template = fs.readFileSync(indexPath, "utf-8");
          const html = await vite.transformIndexHtml(req.url, template);
          
          const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY;
          const envScript = `
            <script id="runtime-env">
              window.RUNTIME_ENV = {
                HAS_SERVER_KEY: ${!!apiKey},
                FIREBASE_API_KEY: "${process.env.VITE_FIREBASE_API_KEY || ''}",
                FIREBASE_AUTH_DOMAIN: "${process.env.VITE_FIREBASE_AUTH_DOMAIN || ''}",
                FIREBASE_PROJECT_ID: "${process.env.VITE_FIREBASE_PROJECT_ID || ''}",
                FIREBASE_STORAGE_BUCKET: "${process.env.VITE_FIREBASE_STORAGE_BUCKET || ''}",
                FIREBASE_MESSAGING_SENDER_ID: "${process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''}",
                FIREBASE_APP_ID: "${process.env.VITE_FIREBASE_APP_ID || ''}",
                GA_MEASUREMENT_ID: "${process.env.VITE_GA_MEASUREMENT_ID || ''}"
              };
            </script>
          `;
          res.status(200).set({ 'Content-Type': 'text/html' }).end(html.replace("<head>", "<head>" + envScript));
          return;
        } catch (e) {
          vite.ssrFixStacktrace(e as Error);
          next(e);
          return;
        }
      }
      next();
    });
    app.use(vite.middlewares);
  } else {
    const injectIndexHtml = (req: express.Request, res: express.Response) => {
      try {
        const indexPath = path.join(__dirname, "dist", "index.html");
        let html = fs.readFileSync(indexPath, "utf-8");
        const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY;
        const envScript = `
          <script id="runtime-env">
            window.RUNTIME_ENV = {
              HAS_SERVER_KEY: ${!!apiKey},
              FIREBASE_API_KEY: "${process.env.VITE_FIREBASE_API_KEY || ''}",
              FIREBASE_AUTH_DOMAIN: "${process.env.VITE_FIREBASE_AUTH_DOMAIN || ''}",
              FIREBASE_PROJECT_ID: "${process.env.VITE_FIREBASE_PROJECT_ID || ''}",
              FIREBASE_STORAGE_BUCKET: "${process.env.VITE_FIREBASE_STORAGE_BUCKET || ''}",
              FIREBASE_MESSAGING_SENDER_ID: "${process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || ''}",
              FIREBASE_APP_ID: "${process.env.VITE_FIREBASE_APP_ID || ''}",
              GA_MEASUREMENT_ID: "${process.env.VITE_GA_MEASUREMENT_ID || ''}"
            };
          </script>
        `;
        res.send(html.replace("<head>", "<head>" + envScript));
      } catch (e) {
        res.status(500).send("Internal Server Error");
      }
    };
    app.get("/", injectIndexHtml);
    app.get("/index.html", injectIndexHtml);
    app.use(express.static(path.join(__dirname, "dist"), { index: false }));
    app.get("*", injectIndexHtml);
  }

  server.listen(PORT, "0.0.0.0", () => {
    log(`[Server] Running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
