const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");
const crypto = require("crypto");
const os = require("os");
const querystring = require("querystring");
const readline = require("readline");
const { spawn, execSync } = require("child_process");

// Configuration
const args = process.argv.slice(2);
const autoStartTunnel =
  args.includes("--tunnel") || process.env.AUTO_TUNNEL === "true";
const portArg = args.find((a) => /^\d+$/.test(a));
const DEFAULT_PORT = portArg
  ? parseInt(portArg, 10)
  : process.env.PORT
    ? parseInt(process.env.PORT, 10)
    : 4000;
const MAX_STORED_REQUESTS = 1000;
const PUBLIC_DIR = path.join(__dirname, "public");

// State Storage
let requests = [];
let sseClients = [];
let cloudflaredProcess = null;
let cloudflareTunnelUrl = null;
let tunnelStatus = "stopped"; // 'stopped' | 'starting' | 'running' | 'error'

let mockConfig = {
  statusCode: 200,
  contentType: "application/json",
  responseBody: JSON.stringify(
    { status: "ok", message: "Captured by elsba3ei Webhook" },
    null,
    2,
  ),
  customHeaders: {
    Server: "elsba3ei-Webhook/1.0",
    "X-Powered-By": "elsba3ei-Inspector",
  },
  delayMs: 0,
  autoCors: true,
};

// Helper: Get local network IP addresses
function getLocalNetworkIPs() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push({ interface: name, address: iface.address });
      }
    }
  }
  return ips;
}

// Helper: Broadcast to all active SSE browser connections
function broadcastSSE(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients = sseClients.filter((client) => {
    try {
      client.res.write(payload);
      return true;
    } catch (e) {
      return false;
    }
  });
}

// Helper: Real Client IP resolution
function getClientIP(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim());
    if (parts[0]) return parts[0];
  }
  return (
    req.headers["cf-connecting-ip"] ||
    req.headers["x-real-ip"] ||
    req.headers["true-client-ip"] ||
    req.socket.remoteAddress ||
    "127.0.0.1"
  ).replace(/^::ffff:/, "");
}

// Helper: Start Cloudflare Temporary Quick Tunnel
function startCloudflareTunnel() {
  if (cloudflaredProcess) {
    return Promise.resolve(cloudflareTunnelUrl);
  }

  tunnelStatus = "starting";
  broadcastSSE("tunnel_status", { status: "starting", url: null });
  console.log(
    "\x1b[36m[i] Starting Cloudflare Temporary Quick Tunnel on port " +
      DEFAULT_PORT +
      "...\x1b[0m",
  );

  return new Promise((resolve, reject) => {
    try {
      cloudflaredProcess = spawn(
        "cloudflared",
        ["tunnel", "--url", `http://localhost:${DEFAULT_PORT}`],
        {
          shell: true,
        },
      );

      let urlFound = false;

      const handleOutput = (data) => {
        const text = data.toString();
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !urlFound) {
          urlFound = true;
          cloudflareTunnelUrl = match[0];
          tunnelStatus = "running";
          console.log(`\n\x1b[32m✔ Cloudflare Public Tunnel is ACTIVE!\x1b[0m`);
          console.log(
            `  🌐 Public Direct Webhook URL: \x1b[1m\x1b[33m${cloudflareTunnelUrl}\x1b[0m\n`,
          );
          broadcastSSE("tunnel_status", {
            status: "running",
            url: cloudflareTunnelUrl,
          });
          resolve(cloudflareTunnelUrl);
        }
      };

      cloudflaredProcess.stdout.on("data", handleOutput);
      cloudflaredProcess.stderr.on("data", handleOutput);

      cloudflaredProcess.on("error", (err) => {
        console.error(
          "\x1b[31m[!] Failed to spawn cloudflared:\x1b[0m",
          err.message,
        );
        tunnelStatus = "error";
        cloudflareTunnelUrl = null;
        cloudflaredProcess = null;
        broadcastSSE("tunnel_status", { status: "error", error: err.message });
        reject(err);
      });

      cloudflaredProcess.on("exit", (code) => {
        console.log(
          `\x1b[33m[!] Cloudflare Tunnel closed (code: ${code})\x1b[0m`,
        );
        tunnelStatus = "stopped";
        cloudflareTunnelUrl = null;
        cloudflaredProcess = null;
        broadcastSSE("tunnel_status", { status: "stopped", url: null });
      });

      setTimeout(() => {
        if (!urlFound) {
          if (tunnelStatus === "starting") {
            tunnelStatus = "error";
            broadcastSSE("tunnel_status", {
              status: "error",
              error: "Tunnel URL timeout",
            });
          }
          resolve(cloudflareTunnelUrl);
        }
      }, 20000);
    } catch (e) {
      tunnelStatus = "error";
      cloudflaredProcess = null;
      cloudflareTunnelUrl = null;
      broadcastSSE("tunnel_status", { status: "error", error: e.message });
      reject(e);
    }
  });
}

function stopCloudflareTunnel() {
  if (cloudflaredProcess) {
    try {
      if (process.platform === "win32") {
        if (cloudflaredProcess.pid) {
          try {
            execSync(`taskkill /pid ${cloudflaredProcess.pid} /f /t`, {
              stdio: "ignore",
            });
          } catch (e) {}
        }
        try {
          execSync("taskkill /im cloudflared.exe /f", { stdio: "ignore" });
        } catch (e) {}
      } else {
        cloudflaredProcess.kill("SIGKILL");
      }
    } catch (e) {
      console.error("Error stopping cloudflared:", e.message);
    }
    cloudflaredProcess = null;
    cloudflareTunnelUrl = null;
    tunnelStatus = "stopped";
    broadcastSSE("tunnel_status", { status: "stopped", url: null });
    console.log("\x1b[33m[i] Cloudflare tunnel stopped.\x1b[0m");
  }
}

// Cleanup & Graceful Shutdown
let isShuttingDown = false;
function shutdownGracefully(reason = "User Requested") {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(
    `\n\x1b[33m[i] Shutting down elsba3ei Webhook Server (${reason})...\x1b[0m`,
  );

  stopCloudflareTunnel();

  // Notify active SSE clients
  sseClients.forEach((client) => {
    try {
      client.res.write(
        `event: server_stopped\ndata: {"message":"Server stopping"}\n\n`,
      );
      client.res.end();
    } catch (e) {}
  });
  sseClients = [];

  // Close HTTP Server
  try {
    server.close(() => {
      console.log(
        `\x1b[32m✔ HTTP Server on port ${DEFAULT_PORT} stopped.\x1b[0m`,
      );
    });
  } catch (e) {}

  // Final process check on Windows
  if (process.platform === "win32") {
    try {
      execSync("taskkill /f /im cloudflared.exe", { stdio: "ignore" });
    } catch (e) {}
  }

  console.log("\x1b[32m✔ All background services terminated.\x1b[0m");
  console.log("\x1b[36m✔ Clean shutdown complete. Goodbye!\x1b[0m\n");

  setTimeout(() => {
    process.exit(0);
  }, 250).unref();
}

process.on("SIGINT", () => shutdownGracefully("Ctrl+C"));
process.on("SIGTERM", () => shutdownGracefully("SIGTERM"));
process.on("SIGHUP", () => shutdownGracefully("SIGHUP"));
process.on("uncaughtException", (err) => {
  console.error("\x1b[31m[!] Uncaught Exception:\x1b[0m", err);
  shutdownGracefully("Exception");
});

// Helper: Serve Static Files
function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".html": "text/html; charset=UTF-8",
    ".css": "text/css; charset=UTF-8",
    ".js": "application/javascript; charset=UTF-8",
    ".json": "application/json; charset=UTF-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
  };

  const contentType = mimeTypes[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 Not Found");
      } else {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("500 Internal Server Error: " + err.message);
      }
      return;
    }
    res.writeHead(200, {
      "Content-Type": contentType,
      "Cache-Control": "no-cache, no-store, must-revalidate",
    });
    res.end(content);
  });
}

// Helper: Read raw request body buffer
function readRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const buffer = Buffer.concat(chunks);
      resolve(buffer);
    });
    req.on("error", () => {
      resolve(Buffer.concat(chunks));
    });
  });
}

// Helper: Analyze body content
function parseBody(buffer, contentType = "") {
  if (!buffer || buffer.length === 0) {
    return { raw: "", parsed: null, type: "empty", size: 0 };
  }

  const rawString = buffer.toString("utf8");
  const size = buffer.length;

  if (contentType.includes("application/json")) {
    try {
      const json = JSON.parse(rawString);
      return { raw: rawString, parsed: json, type: "json", size };
    } catch {
      return { raw: rawString, parsed: null, type: "text", size };
    }
  }

  if (contentType.includes("application/x-www-form-urlencoded")) {
    try {
      const parsedForm = querystring.parse(rawString);
      return { raw: rawString, parsed: parsedForm, type: "form", size };
    } catch {
      return { raw: rawString, parsed: null, type: "text", size };
    }
  }

  // Attempt JSON parse
  try {
    const json = JSON.parse(rawString);
    return { raw: rawString, parsed: json, type: "json", size };
  } catch {
    const isPrintable = /^[\x20-\x7E\s\r\n\t]*$/.test(rawString.slice(0, 1000));
    if (isPrintable) {
      return { raw: rawString, parsed: null, type: "text", size };
    }
    return {
      raw: buffer.toString("base64"),
      hex: buffer.toString("hex").match(/../g)?.join(" ") || "",
      parsed: null,
      type: "binary",
      size,
    };
  }
}

// Main HTTP Server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname || "/";

  // Handle CORS for all requests
  if (mockConfig.autoCors) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD, TRACE",
    );
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Expose-Headers", "*");
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  // Handle preflight OPTIONS
  if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. DASHBOARD & STATIC ASSETS
  const hostHeader = (req.headers["host"] || "").toLowerCase();
  const isLocalhost =
    hostHeader.startsWith("localhost") ||
    hostHeader.startsWith("127.0.0.1") ||
    hostHeader.startsWith("[::1]") ||
    hostHeader.startsWith("0.0.0.0");
  const isTunnelHost =
    hostHeader.includes(".trycloudflare.com") ||
    req.headers["cf-ray"] ||
    req.headers["cf-connecting-ip"];

  // Dedicated /dashboard route always opens Dashboard UI
  if (pathname === "/dashboard") {
    return serveStatic(req, res, path.join(PUBLIC_DIR, "index.html"));
  }

  // Local browser accessing root '/' opens Dashboard UI (only if local and not via Cloudflare Tunnel)
  if (
    pathname === "/" &&
    req.method === "GET" &&
    isLocalhost &&
    !isTunnelHost
  ) {
    return serveStatic(req, res, path.join(PUBLIC_DIR, "index.html"));
  }

  if (pathname.startsWith("/public/")) {
    const safePath = path
      .normalize(pathname.replace("/public/", ""))
      .replace(/^(\.\.[\/\\])+/, "");
    return serveStatic(req, res, path.join(PUBLIC_DIR, safePath));
  }

  // 2. IGNORE BROWSER / CRAWLER NOISE (favicon.ico, robots.txt, apple-touch-icon)
  const ignoredBotNoise = [
    "/favicon.ico",
    "/robots.txt",
    "/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png",
    "/browserconfig.xml",
  ];
  if (ignoredBotNoise.includes(pathname)) {
    if (pathname === "/robots.txt") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("User-agent: *\nDisallow: /");
      return;
    }
    // Return 204 No Content for favicon / apple icons so browsers/bots don't spam request logs
    res.writeHead(204, { "Cache-Control": "public, max-age=86400" });
    res.end();
    return;
  }

  // 3. INTERNAL API ENDPOINTS
  if (pathname === "/api/events" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(": connected to elsba3ei Webhook SSE\n\n");

    // Send initial tunnel status
    res.write(
      `event: tunnel_status\ndata: ${JSON.stringify({ status: tunnelStatus, url: cloudflareTunnelUrl })}\n\n`,
    );

    const clientId = crypto.randomUUID();
    const newClient = { id: clientId, res };
    sseClients.push(newClient);

    req.on("close", () => {
      sseClients = sseClients.filter((c) => c.id !== clientId);
    });
    return;
  }

  // Tunnel Start / Stop APIs
  if (pathname === "/api/tunnel/start" && req.method === "POST") {
    startCloudflareTunnel();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        status: tunnelStatus,
        url: cloudflareTunnelUrl,
      }),
    );
    return;
  }

  if (pathname === "/api/tunnel/stop" && req.method === "POST") {
    stopCloudflareTunnel();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, status: "stopped" }));
    return;
  }

  if (pathname === "/api/tunnel/status" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: tunnelStatus, url: cloudflareTunnelUrl }));
    return;
  }

  if (pathname === "/api/requests" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(requests));
    return;
  }

  if (pathname === "/api/requests" && req.method === "DELETE") {
    requests = [];
    broadcastSSE("clear", { message: "All requests cleared" });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, count: 0 }));
    return;
  }

  if (
    pathname.startsWith("/api/requests/") &&
    pathname.length > "/api/requests/".length
  ) {
    const id = pathname.replace("/api/requests/", "");
    if (req.method === "GET") {
      const found = requests.find((r) => r.id === id);
      if (found) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(found));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Request not found" }));
      }
      return;
    }
    if (req.method === "DELETE") {
      const idx = requests.findIndex((r) => r.id === id);
      if (idx !== -1) {
        requests.splice(idx, 1);
        broadcastSSE("delete", { id });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, id }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Request not found" }));
      }
      return;
    }
  }

  if (pathname === "/api/config") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(mockConfig));
      return;
    }
    if (req.method === "POST") {
      const bodyBuffer = await readRequestBody(req);
      try {
        const update = JSON.parse(bodyBuffer.toString("utf8"));
        mockConfig = {
          ...mockConfig,
          statusCode: parseInt(update.statusCode, 10) || 200,
          contentType: update.contentType || "application/json",
          responseBody:
            typeof update.responseBody === "string"
              ? update.responseBody
              : JSON.stringify(update.responseBody || {}),
          customHeaders:
            typeof update.customHeaders === "object" &&
            update.customHeaders !== null
              ? update.customHeaders
              : {},
          delayMs: Math.max(0, parseInt(update.delayMs, 10) || 0),
          autoCors:
            update.autoCors !== undefined ? Boolean(update.autoCors) : true,
        };
        broadcastSSE("config_updated", mockConfig);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, config: mockConfig }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON payload" }));
      }
      return;
    }
  }

  if (pathname === "/api/system" && req.method === "GET") {
    const localIPs = getLocalNetworkIPs();
    const systemInfo = {
      port: DEFAULT_PORT,
      requestCount: requests.length,
      connectedClients: sseClients.length,
      uptime: process.uptime(),
      localIPs: localIPs,
      tunnel: {
        status: tunnelStatus,
        url: cloudflareTunnelUrl,
      },
      urls: {
        localhost: `http://localhost:${DEFAULT_PORT}`,
        lan: localIPs.map((item) => `http://${item.address}:${DEFAULT_PORT}`),
        cloudflare: cloudflareTunnelUrl ? `${cloudflareTunnelUrl}` : null,
      },
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(systemInfo));
    return;
  }

  if (pathname === "/api/replay" && req.method === "POST") {
    const bodyBuffer = await readRequestBody(req);
    try {
      const payload = JSON.parse(bodyBuffer.toString("utf8"));
      const targetUrl = payload.targetUrl;
      if (!targetUrl) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "targetUrl is required" }));
        return;
      }

      const method = payload.method || "GET";
      const headers = payload.headers || {};
      const body = payload.body || "";

      const targetParsed = url.parse(targetUrl);
      const isHttps = targetParsed.protocol === "https:";
      const clientModule = isHttps ? require("https") : require("http");

      const replayReq = clientModule.request(
        targetUrl,
        { method, headers },
        (replayRes) => {
          const resChunks = [];
          replayRes.on("data", (c) => resChunks.push(c));
          replayRes.on("end", () => {
            const resBuffer = Buffer.concat(resChunks);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                status: replayRes.statusCode,
                statusText: replayRes.statusMessage,
                headers: replayRes.headers,
                body: resBuffer.toString("utf8"),
              }),
            );
          });
        },
      );

      replayReq.on("error", (err) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      });

      if (body) {
        replayReq.write(body);
      }
      replayReq.end();
      return;
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }
  }

  // 4. CAPTURE ALL INCOMING REQUESTS (WEBHOOK / SSRF)
  const rawBodyBuffer = await readRequestBody(req);
  const clientIP = getClientIP(req);
  const contentType = req.headers["content-type"] || "";
  const parsedBody = parseBody(rawBodyBuffer, contentType);

  const requestId = crypto.randomUUID();
  const capturedRecord = {
    id: requestId,
    timestamp: new Date().toISOString(),
    timestampLocal: new Date().toLocaleTimeString(),
    method: req.method,
    url: req.url,
    path: pathname,
    protocol:
      req.headers["x-forwarded-proto"] ||
      (req.socket.encrypted ? "https" : "http"),
    httpVersion: req.httpVersion,
    clientIP: clientIP,
    headers: req.headers,
    rawHeaders: req.rawHeaders,
    query: parsedUrl.query || {},
    rawQuery: parsedUrl.search || "",
    body: parsedBody,
    size: rawBodyBuffer.length,
    responseSent: {
      statusCode: mockConfig.statusCode,
      contentType: mockConfig.contentType,
      customHeaders: mockConfig.customHeaders,
      body: mockConfig.responseBody,
    },
  };

  requests.unshift(capturedRecord);
  if (requests.length > MAX_STORED_REQUESTS) {
    requests.pop();
  }

  broadcastSSE("new_request", capturedRecord);

  console.log(
    `\x1b[32m[+] INCOMING ${req.method}\x1b[0m ${req.url} \x1b[90mfrom\x1b[0m ${clientIP} \x1b[90m(${rawBodyBuffer.length} bytes)\x1b[0m`,
  );

  if (mockConfig.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, mockConfig.delayMs));
  }

  const responseHeaders = {
    "Content-Type": mockConfig.contentType,
    ...mockConfig.customHeaders,
  };

  res.writeHead(mockConfig.statusCode, responseHeaders);
  res.end(mockConfig.responseBody);
});

// Helper: Print Active Webhook URLs
function printActiveUrls() {
  const localIPs = getLocalNetworkIPs();
  console.log(
    "\n=============================================================",
  );
  console.log("  🌐 ACTIVE WEBHOOK ENDPOINTS");
  console.log("=============================================================");
  console.log(
    `  🖥️  Web Dashboard:        \x1b[34mhttp://localhost:${DEFAULT_PORT}\x1b[0m`,
  );
  console.log(
    `  🎯 Localhost Capture:    \x1b[33mhttp://localhost:${DEFAULT_PORT}/capture\x1b[0m`,
  );
  localIPs.forEach((ip) => {
    console.log(
      `  🏠 Local LAN (${ip.interface}): \x1b[35mhttp://${ip.address}:${DEFAULT_PORT}/capture\x1b[0m`,
    );
  });
  if (cloudflareTunnelUrl) {
    console.log(
      `  ⚡ Public Cloudflare:    \x1b[1m\x1b[32m${cloudflareTunnelUrl}\x1b[0m (Direct Root Capture)`,
    );
  } else {
    console.log(
      `  ⚡ Public Cloudflare:    \x1b[90mNot active (Press 't' to launch)\x1b[0m`,
    );
  }
  console.log(
    "=============================================================\n",
  );
}

// Helper: Print Main Banner
function printBanner() {
  const localIPs = getLocalNetworkIPs();
  console.log(
    "\n=============================================================",
  );
  console.log("   \x1b[36m🎯 elsba3ei WEBHOOK & SSRF REQUEST INSPECTOR\x1b[0m");
  console.log("=============================================================");
  console.log(`\x1b[32m✔ Server is ACTIVE & LISTENING!\x1b[0m`);
  console.log(
    `  🖥️  Web Dashboard:        \x1b[34mhttp://localhost:${DEFAULT_PORT}\x1b[0m`,
  );
  console.log(
    `  🎯 Localhost Capture:    \x1b[33mhttp://localhost:${DEFAULT_PORT}/capture\x1b[0m`,
  );

  if (localIPs.length > 0) {
    localIPs.forEach((ip) => {
      console.log(
        `  🏠 Local LAN (${ip.interface}): \x1b[35mhttp://${ip.address}:${DEFAULT_PORT}/capture\x1b[0m`,
      );
    });
  }

  if (cloudflareTunnelUrl) {
    console.log(
      `  ⚡ Public Cloudflare:    \x1b[1m\x1b[32m${cloudflareTunnelUrl}\x1b[0m (Direct Root Capture)`,
    );
  }

  console.log("-------------------------------------------------------------");
  console.log("  \x1b[1m⌨️  INTERACTIVE TERMINAL COMMANDS:\x1b[0m");
  console.log(
    "     \x1b[33m[q]\x1b[0m -> Stop server & exit cleanly (or Ctrl+C / close window)",
  );
  console.log(
    "     \x1b[36m[t]\x1b[0m -> Toggle Cloudflare Public HTTPS Tunnel",
  );
  console.log("     \x1b[35m[u]\x1b[0m -> Display all active webhook URLs");
  console.log("     \x1b[90m[c]\x1b[0m -> Clear terminal screen");
  console.log("     \x1b[90m[?]\x1b[0m -> Show help");
  console.log(
    "=============================================================\n",
  );
}

// Helper: Print Help
function printHelp() {
  console.log("\n--- ⌨️  Available Terminal Commands ---");
  console.log("  q      : Stop server and exit cleanly");
  console.log("  t      : Toggle Cloudflare Public HTTPS Tunnel on/off");
  console.log("  u      : Show all active Webhook URLs");
  console.log("  c      : Clear terminal screen & reprint banner");
  console.log("  ? or h : Show this help message");
  console.log("  Ctrl+C : Immediate graceful exit");
  console.log("--------------------------------------\n");
}

// Interactive Terminal Console Listener
function setupInteractiveConsole() {
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      process.stdin.on("data", (key) => {
        if (key === "\u0003" || key.toLowerCase() === "q") {
          shutdownGracefully(key === "\u0003" ? "Ctrl+C" : "Key Q");
        } else if (key.toLowerCase() === "t") {
          if (tunnelStatus === "running" || tunnelStatus === "starting") {
            console.log("\n\x1b[33m[i] Stopping Cloudflare tunnel...\x1b[0m");
            stopCloudflareTunnel();
          } else {
            console.log("\n\x1b[36m[i] Starting Cloudflare tunnel...\x1b[0m");
            startCloudflareTunnel();
          }
        } else if (key.toLowerCase() === "u") {
          printActiveUrls();
        } else if (key.toLowerCase() === "c" || key.toLowerCase() === "l") {
          try {
            console.clear();
          } catch (e) {}
          printBanner();
        } else if (key === "?" || key.toLowerCase() === "h") {
          printHelp();
        }
      });
      return;
    } catch (e) {
      // Fallback to readline
    }
  }

  try {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    rl.on("line", (line) => {
      const cmd = line.trim().toLowerCase();
      if (cmd === "q" || cmd === "quit" || cmd === "exit" || cmd === "stop") {
        shutdownGracefully("Command " + cmd);
      } else if (cmd === "t" || cmd === "tunnel") {
        if (tunnelStatus === "running" || tunnelStatus === "starting") {
          stopCloudflareTunnel();
        } else {
          startCloudflareTunnel();
        }
      } else if (cmd === "u" || cmd === "urls") {
        printActiveUrls();
      } else if (cmd === "c" || cmd === "cls" || cmd === "clear") {
        try {
          console.clear();
        } catch (e) {}
        printBanner();
      } else if (cmd === "h" || cmd === "help" || cmd === "?") {
        printHelp();
      }
    });
  } catch (e) {}
}

// Start Server
server.listen(DEFAULT_PORT, "0.0.0.0", () => {
  printBanner();
  setupInteractiveConsole();

  if (autoStartTunnel) {
    console.log("\x1b[36m⚡ Auto-starting Cloudflare Tunnel...\x1b[0m");
    startCloudflareTunnel();
  }
});
