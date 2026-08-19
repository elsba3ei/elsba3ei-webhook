# 🎯 elsba3ei Webhook & SSRF Inspector (Web Dashboard & Node.js Server)

<p align="center">
  <b>A lightweight, ultra-fast Webhook.site & Burp Collaborator Alternative with real-time SSE streaming, Cloudflare Quick Tunnel support, body decoders, dynamic mock responses, and built-in request repeater.</b>
</p>

---

## ⚡ Highlights & Features

- 🌐 **Built-in Cloudflare Quick Tunnel**: 1-Click temporary public HTTPS link (`https://xxxx.trycloudflare.com/capture`) for external SSRF testing and public webhook callbacks with **zero configuration and no account needed**!
- 🚀 **Zero External NPM Packages**: Built entirely on native Node.js standard libraries (`http`, `crypto`, `fs`, `path`, `os`, `child_process`). Runs immediately!
- 🔴 **Real-Time Live Updates**: Instant push stream via Server-Sent Events (SSE) with live connection status indicators.
- 🔍 **Deep Request Inspection**:
  - Full HTTP Headers & Raw Headers with instant fuzzy search filtering
  - Formatted JSON / Raw Text / URL-Encoded Form / Hex Dump / Base64 for Request Bodies
  - Query parameters breakdown table
  - Accurate Client IP resolution (`CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`, `True-Client-IP`)
  - SSRF origin indicators (Localhost, Private LAN, External IP)
- ⚙️ **Customizable Mock Response Engine**:
  - Change Status Codes (200, 201, 301, 302, 404, 500, etc.)
  - Change Content-Type (`application/json`, `text/html`, `text/xml`, `text/plain`)
  - Custom Response Body & Custom Headers (e.g. redirect `Location`)
  - Artificial Response Delay (ms) to simulate slow backends and test client timeout handling
  - Automatic CORS handling (`Access-Control-Allow-Origin: *`)
- 🔁 **Built-in Request Repeater**: Resend and modify any captured request on the fly to external targets or local servers.
- 📋 **1-Click Export Tools**: Copy any request as **cURL**, **JavaScript `fetch()`**, **Raw HTTP/1.1**, or Export all captured logs to a **JSON** file.
- ⌨️ **Keyboard Shortcuts**:
  - `Space` or `P`: Pause / Resume live feed
  - `/`: Focus search box
  - `Esc`: Clear search / close modal

---

## 🚀 How to Run

### Option A: 1-Click Launch with Cloudflare (Recommended on Windows)

Double-click [`start server.bat`](file:///g:/Playing/elsba3ei%20webhook/start%20server.bat) in this folder.

- Launches the Node.js server.
- Starts a temporary Cloudflare Quick Tunnel.
- Opens your default web browser automatically at `http://localhost:4000`.

### Option B: Terminal / PowerShell

```powershell
# Default local server on port 4000
node server.js

# Auto-start Cloudflare Public Tunnel
node server.js --tunnel

# Run on custom port (e.g. 8080)
node server.js 8080

# Run on custom port with tunnel
node server.js 8080 --tunnel
```

---

## 💡 How It Works

1. **Boot**: The server boots on `http://localhost:4000` (or your configured port).
2. **Tunnel Generation**: If `--tunnel` is enabled, `cloudflared` automatically provisions a secure public HTTPS link (e.g. `https://random-name.trycloudflare.com/capture`).
3. **Capture**: Any external web service, webhook provider (Stripe, GitHub, PayPal), or SSRF target making an HTTP/HTTPS request to your Cloudflare or Local URL will be captured.
4. **Live Push**: The server parses headers, query parameters, and body payloads, and streams the event live over SSE to your browser dashboard.
5. **Dynamic Mocking**: The server immediately responds to the caller with the configured status code, custom headers, and body defined in the Mock Response panel.

---

## 📡 REST Endpoints Reference

| Route                       | Method   | Description                                                                                                    |
| :-------------------------- | :------- | :------------------------------------------------------------------------------------------------------------- |
| `/`                         | `GET`    | Serves the web dashboard (for local browser sessions).                                                         |
| `/dashboard`                | `GET`    | Dedicated web dashboard interface.                                                                             |
| `/public/*`                 | `GET`    | Static assets (CSS, JS, icons).                                                                                |
| `/api/events`               | `GET`    | Server-Sent Events stream for live requests and tunnel updates.                                                |
| `/api/requests`             | `GET`    | Returns list of all captured requests in JSON.                                                                 |
| `/api/requests`             | `DELETE` | Clears all captured requests.                                                                                  |
| `/api/requests/:id`         | `GET`    | Returns details for a specific request ID.                                                                     |
| `/api/requests/:id`         | `DELETE` | Deletes a single request record.                                                                               |
| `/api/config`               | `GET`    | Returns current mock response configuration.                                                                   |
| `/api/config`               | `POST`   | Updates mock response configuration (`statusCode`, `contentType`, `responseBody`, `delayMs`, `customHeaders`). |
| `/api/config/reset`         | `POST`   | Resets mock response configuration back to defaults.                                                           |
| `/api/tunnel/status`        | `GET`    | Returns active Cloudflare tunnel status and public URL.                                                        |
| `/api/tunnel/start`         | `POST`   | Starts the Cloudflare Quick Tunnel.                                                                            |
| `/api/tunnel/stop`          | `POST`   | Stops the active Cloudflare tunnel.                                                                            |
| `/api/replay`               | `POST`   | Sends a custom HTTP request to an external target.                                                             |
| `/capture` (or any subpath) | `ANY`    | Captures incoming webhook / SSRF request.                                                                      |

---

## 🔒 Security Best Practice

> [!WARNING]
> Captured data may include sensitive headers or authentication tokens sent by third-party services. Use this tool only in authorized testing environments.

---

## 📄 License

Distributed under the **MIT License**.

<div align="center">
  Developed by <b>Ahmed E. El-Sbaei</b> — © 2026 Ahmed E. El-Sbaei<br>
  <a href="http://linkedin.com/in/elsba3ei">http://linkedin.com/in/elsba3ei</a>
</div>
