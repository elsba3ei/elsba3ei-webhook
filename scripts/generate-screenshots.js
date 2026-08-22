const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const PORT = 4288;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function post(endpoint, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const isJson = typeof data === "object";
    const body = isJson ? JSON.stringify(data) : data;
    const reqHeaders = {
      ...(isJson ? { "Content-Type": "application/json" } : {}),
      ...headers,
    };
    const req = http.request(
      `${BASE_URL}${endpoint}`,
      { method: "POST", headers: reqHeaders },
      (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => resolve({ status: res.statusCode, body: b }));
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function get(endpoint, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`${BASE_URL}${endpoint}`, { method: "GET", headers }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => resolve({ status: res.statusCode, body: b }));
    });
    req.on("error", reject);
    req.end();
  });
}

function takeScreenshot(url, outputPath) {
  const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  return new Promise((resolve, reject) => {
    const browser = spawn(
      edgePath,
      [
        "--headless=new",
        "--disable-gpu",
        "--hide-scrollbars",
        "--window-size=1440,900",
        `--screenshot=${outputPath}`,
        url,
      ],
      { stdio: "ignore" }
    );

    browser.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error("Browser exited with code " + code));
    });
    browser.on("error", reject);
  });
}

async function capture() {
  console.log("[1/5] Spawning server on port " + PORT + "...");
  const server = spawn("node", ["server.js", String(PORT)], {
    cwd: path.join(__dirname, ".."),
    stdio: "pipe",
  });

  await new Promise((r) => setTimeout(r, 2000));

  console.log("[2/5] Populating realistic sanitized mock requests...");

  // 1. Form-encoded Payment Callback
  await post(
    "/capture/payment-gateway-callback",
    "order_id=ORD-2026-9921&status=SUCCESS&transaction_ref=TXN_881928471&amount=450.00&auth_code=AUTH_9182",
    {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "PaymentGateway-IPN/2.1",
      "X-Forwarded-For": "203.0.113.88",
    }
  );

  // 2. SSRF Internal Metadata Probe
  await get(
    "/capture/metadata-probe?token=canary_vault_token_4491&action=read_credentials&env=production",
    {
      "User-Agent": "curl/7.88.1-SSRF-Test",
      "X-Forwarded-For": "10.0.4.15",
      "CF-Connecting-IP": "10.0.4.15",
      "X-Originating-IP": "10.0.4.15",
    }
  );

  // 3. GitHub Push Event
  await post(
    "/capture/github-webhook",
    {
      ref: "refs/heads/main",
      before: "6113728f27ae82c7b1a12fcedd945f2f1402a212",
      after: "87a4628f27ae82c7b1a12fcedd945f2f1402a999",
      repository: {
        name: "cloud-infrastructure",
        full_name: "example-corp/cloud-infrastructure",
        private: true,
      },
      pusher: { name: "lead-dev", email: "dev@example.org" },
      commits: [
        {
          id: "87a4628f",
          message: "feat: deploy automated microservices cluster v3.2.0",
          author: { name: "lead-dev" },
        },
      ],
    },
    {
      "User-Agent": "GitHub-Hookshot/918273",
      "X-GitHub-Event": "push",
      "X-GitHub-Delivery": "72eeeed0-68e8-11ef-93da-6b3a2418e9a2",
      "X-Forwarded-For": "140.82.112.4",
      "CF-Connecting-IP": "140.82.112.4",
    }
  );

  // 4. Stripe Checkout Completed Webhook
  await post(
    "/capture/stripe-webhook",
    {
      id: "evt_3MvY82LkdIwHu7ix0rW6Z8a1",
      object: "event",
      api_version: "2024-06-20",
      created: 1719230000,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_live_demo_987654321",
          customer_email: "alex.taylor@example.org",
          amount_total: 12900,
          currency: "usd",
          payment_status: "paid",
          status: "complete",
        },
      },
    },
    {
      "User-Agent": "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
      "Stripe-Signature": "t=1719230000,v1=5257a869e7ecebeda32affa62cd43fa51cad7e77a0e56ff536d0ce8e108d8bd6",
      "X-Forwarded-For": "198.51.100.42",
      "CF-Connecting-IP": "198.51.100.42",
    }
  );

  await new Promise((r) => setTimeout(r, 1200));

  const assetsDir = path.join(__dirname, "..", "assets");

  console.log("[3/5] Capturing 1: dashboard-preview.png ...");
  await takeScreenshot(`http://127.0.0.1:${PORT}/dashboard`, path.join(assetsDir, "dashboard-preview.png"));

  console.log("[4/5] Capturing 2: body-payload-view.png ...");
  await takeScreenshot(`http://127.0.0.1:${PORT}/dashboard?tab=body`, path.join(assetsDir, "body-payload-view.png"));

  console.log("[5/5] Capturing 3: mock-response-engine.png ...");
  await takeScreenshot(`http://127.0.0.1:${PORT}/dashboard?modal=mock`, path.join(assetsDir, "mock-response-engine.png"));

  console.log("All screenshots captured successfully in assets/ !");

  server.kill("SIGINT");
}

capture().catch((e) => {
  console.error("Failed:", e);
  process.exit(1);
});
