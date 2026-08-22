/**
 * elsba3ei Webhook & SSRF Inspector — Automated Test Suite
 * Zero dependencies — Uses Node.js native http, assert, and crypto modules.
 */

const http = require("http");
const assert = require("assert");
const { spawn } = require("child_process");
const path = require("path");

const TEST_PORT = 4199;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

let serverProcess = null;
let testsPassed = 0;
let testsFailed = 0;

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body,
          json() {
            return JSON.parse(body);
          },
        });
      });
    });

    req.on("error", reject);

    if (postData) {
      if (typeof postData === "object" && !(postData instanceof Buffer)) {
        req.write(JSON.stringify(postData));
      } else {
        req.write(postData);
      }
    }
    req.end();
  });
}

async function runTest(name, fn) {
  process.stdout.write(`  [TEST] ${name} ... `);
  try {
    await fn();
    testsPassed++;
    console.log(`\x1b[32mPASSED\x1b[0m`);
  } catch (err) {
    testsFailed++;
    console.log(`\x1b[31mFAILED\x1b[0m`);
    console.error(`         Error: ${err.message}`);
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn("node", [path.join(__dirname, "server.js"), String(TEST_PORT)], {
      stdio: "pipe",
    });

    serverProcess.stdout.on("data", (data) => {
      const str = data.toString();
      if (str.includes("Server running on") || str.includes(String(TEST_PORT))) {
        resolve();
      }
    });

    serverProcess.stderr.on("data", () => {});
    serverProcess.on("error", reject);

    // Timeout fallback
    setTimeout(resolve, 1500);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill("SIGINT");
    serverProcess = null;
  }
}

async function main() {
  console.log("\n========================================================");
  console.log("  elsba3ei Webhook & SSRF Inspector — Test Suite");
  console.log(`  Target: ${BASE_URL}`);
  console.log("========================================================\n");

  try {
    console.log("[i] Starting test server instance on port " + TEST_PORT + "...");
    await startServer();
    console.log("[i] Server ready. Running tests:\n");

    // Test 1: Static / Dashboard endpoints
    await runTest("GET / (Root Dashboard)", async () => {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: "/",
        method: "GET",
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.body.includes("elsba3ei Webhook"));
    });

    await runTest("GET /dashboard (Dashboard Route)", async () => {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: "/dashboard",
        method: "GET",
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers["content-type"].includes("text/html"));
    });

    await runTest("GET /public/style.css (Static Asset)", async () => {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: "/public/style.css",
        method: "GET",
      });
      assert.strictEqual(res.statusCode, 200);
      assert.ok(res.headers["content-type"].includes("text/css"));
    });

    // Test 2: Webhook Captures (JSON, Form, GET params, Custom Paths)
    let capturedId1 = null;
    await runTest("POST /capture (JSON Webhook Payload)", async () => {
      const payload = {
        event: "payment.succeeded",
        amount: 4999,
        currency: "usd",
        customer: { id: "cus_demo123", email: "user@example.com" },
      };
      const res = await httpRequest(
        {
          hostname: "127.0.0.1",
          port: TEST_PORT,
          path: "/capture",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Webhook-Source": "Stripe-Mock",
          },
        },
        payload
      );
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.status, "ok");
    });

    await runTest("POST /webhook/github (URL-Encoded Form Data)", async () => {
      const formBody = "action=opened&issue_id=42&title=Bug+Report&author=dev";
      const res = await httpRequest(
        {
          hostname: "127.0.0.1",
          port: TEST_PORT,
          path: "/webhook/github",
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "GitHub-Hookshot/mock",
          },
        },
        formBody
      );
      assert.strictEqual(res.statusCode, 200);
    });

    await runTest("GET /capture/probe (SSRF Probe with Query Params)", async () => {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: "/capture/probe?token=xyz987&origin=cloud-lambda&metric=latency",
        method: "GET",
        headers: {
          "X-Forwarded-For": "198.51.100.25",
          "CF-Connecting-IP": "198.51.100.25",
        },
      });
      assert.strictEqual(res.statusCode, 200);
    });

    // Test 3: API Requests Retrieval
    await runTest("GET /api/requests (Fetch captured logs array)", async () => {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: "/api/requests",
        method: "GET",
      });
      assert.strictEqual(res.statusCode, 200);
      const list = res.json();
      assert.ok(Array.isArray(list));
      assert.ok(list.length >= 3);
      capturedId1 = list[0].id;
    });

    await runTest("GET /api/requests/:id (Fetch single request by ID)", async () => {
      assert.ok(capturedId1, "capturedId1 must exist");
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: `/api/requests/${capturedId1}`,
        method: "GET",
      });
      assert.strictEqual(res.statusCode, 200);
      const item = res.json();
      assert.strictEqual(item.id, capturedId1);
    });

    // Test 4: Mock Configuration Engine
    await runTest("GET /api/config (Fetch mock response settings)", async () => {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: "/api/config",
        method: "GET",
      });
      assert.strictEqual(res.statusCode, 200);
      const config = res.json();
      assert.strictEqual(config.statusCode, 200);
    });

    await runTest("POST /api/config (Update custom mock response)", async () => {
      const updatedConfig = {
        statusCode: 201,
        contentType: "application/json",
        responseBody: JSON.stringify({ message: "Custom Created Response", success: true }),
        customHeaders: { "X-Custom-Header": "elsba3ei-test" },
        delayMs: 20,
      };
      const res = await httpRequest(
        {
          hostname: "127.0.0.1",
          port: TEST_PORT,
          path: "/api/config",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        updatedConfig
      );
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.config.statusCode, 201);
    });

    await runTest("POST /capture (Verify customized mock response status 201)", async () => {
      const res = await httpRequest(
        {
          hostname: "127.0.0.1",
          port: TEST_PORT,
          path: "/capture",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        { ping: "check_mock" }
      );
      assert.strictEqual(res.statusCode, 201);
      assert.strictEqual(res.headers["x-custom-header"], "elsba3ei-test");
      const body = res.json();
      assert.strictEqual(body.success, true);
    });

    await runTest("POST /api/config/reset (Reset mock response to default)", async () => {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: "/api/config/reset",
        method: "POST",
      });
      assert.strictEqual(res.statusCode, 200);
      const json = res.json();
      assert.strictEqual(json.config.statusCode, 200);
    });

    // Test 5: Tunnel & System Status Endpoints
    await runTest("GET /api/tunnel/status (Check tunnel status)", async () => {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: "/api/tunnel/status",
        method: "GET",
      });
      assert.strictEqual(res.statusCode, 200);
      const status = res.json();
      assert.ok("status" in status);
    });

    await runTest("GET /api/system (Check system telemetry)", async () => {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: "/api/system",
        method: "GET",
      });
      assert.strictEqual(res.statusCode, 200);
      const sys = res.json();
      assert.strictEqual(sys.port, TEST_PORT);
      assert.ok(Array.isArray(sys.localIPs));
    });

    // Test 6: Delete single request and Clear all
    await runTest("DELETE /api/requests/:id (Delete single request)", async () => {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: `/api/requests/${capturedId1}`,
        method: "DELETE",
      });
      assert.strictEqual(res.statusCode, 200);
    });

    await runTest("DELETE /api/requests (Clear all captured requests)", async () => {
      const res = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: "/api/requests",
        method: "DELETE",
      });
      assert.strictEqual(res.statusCode, 200);

      // Verify list is empty
      const check = await httpRequest({
        hostname: "127.0.0.1",
        port: TEST_PORT,
        path: "/api/requests",
        method: "GET",
      });
      const list = check.json();
      assert.strictEqual(list.length, 0);
    });

  } finally {
    stopServer();
  }

  console.log("\n--------------------------------------------------------");
  console.log(`  Test Results: ${testsPassed} Passed, ${testsFailed} Failed`);
  console.log("========================================================\n");

  if (testsFailed > 0) {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Test runner failed:", err);
    stopServer();
    process.exit(1);
  });
}

module.exports = { httpRequest, runTest };
