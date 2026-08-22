// Global State
let allRequests = [];
let selectedRequestId = null;
let currentFilter = "ALL";
let currentStatusFilter = "ALL";
let searchQuery = "";
let isRegexSearch = false;
let currentBodyView = "formatted";
let soundEnabled = true;
let isStreamPaused = false;
let pendingRequestsBuffer = [];
let systemInfo = {
  port: 4000,
  localIPs: [],
  tunnel: { status: "stopped", url: null },
};
let cloudflareTunnel = { status: "stopped", url: null };
let undoStack = null;
let lastFocusedElementBeforeModal = null;

// Tab Switching (Accessible from DOM and JS)
function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    const isActive = b.getAttribute("data-tab") === tabId;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  document.querySelectorAll(".tab-pane").forEach((p) => {
    const isActive = p.id === tabId;
    p.classList.toggle("active", isActive);
    p.hidden = !isActive;
  });
}
window.switchTab = switchTab;

// Audio Notification
function playBeep() {
  if (!soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(
      1320,
      audioCtx.currentTime + 0.08,
    );
    gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.12);
  } catch (e) {}
}

// Stackable Toast Notification System
function showToast(
  message,
  type = "info",
  actionText = null,
  onAction = null,
  duration = 3200,
) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const card = document.createElement("div");
  card.className = `toast-card ${type}`;

  let iconHtml =
    '<i class="fa-solid fa-circle-info toast-card-icon" aria-hidden="true"></i>';
  if (type === "success") {
    iconHtml =
      '<i class="fa-solid fa-circle-check toast-card-icon" aria-hidden="true"></i>';
  } else if (type === "warning") {
    iconHtml =
      '<i class="fa-solid fa-triangle-exclamation toast-card-icon" aria-hidden="true"></i>';
  } else if (type === "error") {
    iconHtml =
      '<i class="fa-solid fa-circle-exclamation toast-card-icon" aria-hidden="true"></i>';
  }

  let actionHtml = "";
  if (actionText && onAction) {
    actionHtml = `<button class="toast-card-action">${escapeHtml(actionText)}</button>`;
  }

  card.innerHTML = `
    ${iconHtml}
    <div class="toast-card-body">${escapeHtml(message)}</div>
    ${actionHtml}
    <button class="toast-card-close" aria-label="Dismiss notification"><i class="fa-solid fa-xmark"></i></button>
  `;

  if (actionText && onAction) {
    card.querySelector(".toast-card-action")?.addEventListener("click", () => {
      onAction();
      dismissToast(card);
    });
  }

  card.querySelector(".toast-card-close")?.addEventListener("click", () => {
    dismissToast(card);
  });

  container.appendChild(card);

  const timeoutId = setTimeout(
    () => {
      dismissToast(card);
    },
    actionText ? 6000 : duration,
  );

  card._timeoutId = timeoutId;
}

function dismissToast(card) {
  if (!card) return;
  if (card._timeoutId) clearTimeout(card._timeoutId);
  card.style.opacity = "0";
  card.style.transform = "translateY(10px) scale(0.95)";
  setTimeout(() => {
    if (card.parentNode) card.parentNode.removeChild(card);
  }, 200);
}

// Clipboard Copy
function copyToClipboard(
  text,
  successMsg = "Copied to clipboard!",
  triggerBtn = null,
) {
  const performCopy = () => {
    showToast(successMsg, "success");
    if (triggerBtn) {
      triggerBtn.classList.add("copied");
      const icon = triggerBtn.querySelector("i");
      const textSpan =
        triggerBtn.querySelector(".copy-text") ||
        triggerBtn.querySelector("span");
      const originalIconClass = icon ? icon.className : "";
      const originalText = textSpan ? textSpan.textContent : "";

      if (icon) icon.className = "fa-solid fa-check";
      if (textSpan) textSpan.textContent = "Copied!";

      setTimeout(() => {
        triggerBtn.classList.remove("copied");
        if (icon && originalIconClass) icon.className = originalIconClass;
        if (textSpan && originalText) textSpan.textContent = originalText;
      }, 1800);
    }
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(performCopy);
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    performCopy();
  }
}

// Stream Pause / Resume Control
function toggleStreamPause() {
  isStreamPaused = !isStreamPaused;
  const btnToggleStream = document.getElementById("btn-toggle-stream");
  const streamCtrlIcon = document.getElementById("stream-ctrl-icon");
  const streamCtrlText = document.getElementById("stream-ctrl-text");
  const sseStatus = document.getElementById("sse-status");
  const streamPausedBanner = document.getElementById("stream-paused-banner");
  const pausedPendingCount = document.getElementById("paused-pending-count");

  if (btnToggleStream) {
    btnToggleStream.classList.toggle("paused", isStreamPaused);
    btnToggleStream.setAttribute(
      "aria-pressed",
      isStreamPaused ? "true" : "false",
    );
  }

  if (isStreamPaused) {
    if (streamCtrlIcon) streamCtrlIcon.className = "fa-solid fa-play";
    if (streamCtrlText) streamCtrlText.textContent = "Resume";
    if (sseStatus) {
      sseStatus.className = "status-badge paused";
      sseStatus.querySelector(".status-text").textContent = "PAUSED";
    }
    showToast(
      "Live stream feed paused. Incoming requests will buffer without moving view.",
      "warning",
    );
  } else {
    if (streamCtrlIcon) streamCtrlIcon.className = "fa-solid fa-pause";
    if (streamCtrlText) streamCtrlText.textContent = "Pause";
    if (sseStatus) {
      sseStatus.className = "status-badge connected";
      sseStatus.querySelector(".status-text").textContent = "LIVE";
    }
    if (streamPausedBanner) streamPausedBanner.classList.add("hidden");

    if (pendingRequestsBuffer.length > 0) {
      showToast(
        `Resumed! Rendered ${pendingRequestsBuffer.length} buffered requests.`,
        "success",
      );
      pendingRequestsBuffer = [];
      renderRequestsList();
      const autoScrollToggle = document.getElementById("auto-scroll-toggle");
      if (
        autoScrollToggle &&
        autoScrollToggle.checked &&
        allRequests.length > 0
      ) {
        selectRequest(allRequests[0].id);
      }
    } else {
      showToast("Live stream feed resumed.", "info");
    }
  }
}

// Initialization
async function init() {
  setupEventListeners();
  setupSendTestModalEvents();
  setupCompareModalEvents();
  setupKeyboardShortcuts();
  try {
    await fetchSystemInfo();
  } catch (e) {
    console.error("fetchSystemInfo error:", e);
  }
  try {
    await fetchRequests();
  } catch (e) {
    console.error("fetchRequests error:", e);
  }
  try {
    await loadMockConfig();
  } catch (e) {
    console.error("loadMockConfig error:", e);
  }
  initSSE();
  updateUrlBar();
}

async function fetchSystemInfo() {
  try {
    const res = await fetch("/api/system");
    if (res.ok) {
      systemInfo = await res.json();
      if (systemInfo.tunnel) {
        updateTunnelUI(systemInfo.tunnel.status, systemInfo.tunnel.url);
      }
      populateUrlOptions();
      updateTestModalDestinations();
    }
  } catch (err) {
    console.error("Failed to load system info", err);
  }
}

async function toggleTunnel() {
  const tunnelBtnIcon = document.getElementById("tunnel-btn-icon");
  const tunnelBtnText = document.getElementById("tunnel-btn-text");

  if (cloudflareTunnel.status === "running") {
    if (tunnelBtnText) tunnelBtnText.textContent = "Stopping...";
    if (tunnelBtnIcon) tunnelBtnIcon.className = "fa-solid fa-spinner fa-spin";
    try {
      await fetch("/api/tunnel/stop", { method: "POST" });
      updateTunnelUI("stopped", null);
      showToast("Cloudflare Tunnel stopped.", "info");
    } catch (err) {
      showToast("Failed to stop tunnel: " + err.message, "error");
      updateTunnelUI("running", cloudflareTunnel.url);
    }
  } else {
    updateTunnelUI("starting", null);
    showToast("Starting Cloudflare Temporary Quick Tunnel...", "info");
    try {
      const res = await fetch("/api/tunnel/start", { method: "POST" });
      const data = await res.json();
      if (data.url) {
        updateTunnelUI("running", data.url);
        showToast(`Cloudflare Tunnel Active: ${data.url}`, "success");
      } else if (data.status === "starting" || data.success) {
        // SSE will stream URL once detected
      } else {
        updateTunnelUI("error", null);
        showToast("Tunnel failed to start", "error");
      }
    } catch (err) {
      updateTunnelUI("error", null);
      showToast("Tunnel start error: " + err.message, "error");
    }
  }
}

function updateTunnelUI(status, url) {
  cloudflareTunnel = { status, url };
  const btnToggleTunnel = document.getElementById("btn-toggle-tunnel");
  const tunnelBtnIcon = document.getElementById("tunnel-btn-icon");
  const tunnelBtnText = document.getElementById("tunnel-btn-text");
  if (!btnToggleTunnel) return;

  if (status === "running" && url) {
    btnToggleTunnel.className = "btn btn-tunnel active";
    tunnelBtnIcon.className = "fa-solid fa-link-slash";
    tunnelBtnText.textContent = "Stop Tunnel";
    btnToggleTunnel.title = `Active Public HTTPS URL: ${url}`;
  } else if (status === "starting") {
    btnToggleTunnel.className = "btn btn-tunnel loading";
    tunnelBtnIcon.className = "fa-solid fa-spinner fa-spin";
    tunnelBtnText.textContent = "Starting...";
  } else {
    btnToggleTunnel.className = "btn btn-tunnel";
    tunnelBtnIcon.className = "fa-brands fa-cloudflare";
    tunnelBtnText.textContent = "Cloudflare Tunnel";
    btnToggleTunnel.title =
      "Start free Cloudflare Temporary Quick Tunnel for public HTTPS callbacks";
  }

  populateUrlOptions();
  updateTestModalDestinations();
}

function getActiveWebhookUrl() {
  const urlSelect = document.getElementById("url-select");
  if (urlSelect && urlSelect.value) {
    return urlSelect.value;
  }
  if (cloudflareTunnel.status === "running" && cloudflareTunnel.url) {
    return cloudflareTunnel.url;
  }
  return `http://localhost:${systemInfo.port || 4000}/capture`;
}

function populateUrlOptions() {
  const urlSelect = document.getElementById("url-select");
  if (!urlSelect) return;
  const previousValue = urlSelect.value;
  urlSelect.innerHTML = "";

  if (cloudflareTunnel.status === "running" && cloudflareTunnel.url) {
    const cfOpt = document.createElement("option");
    cfOpt.value = cloudflareTunnel.url;
    cfOpt.textContent = `⚡ Public Cloudflare: ${cloudflareTunnel.url}`;
    urlSelect.appendChild(cfOpt);
  }

  const localhostOpt = document.createElement("option");
  localhostOpt.value = `http://localhost:${systemInfo.port}/capture`;
  localhostOpt.textContent = `Localhost: http://localhost:${systemInfo.port}/capture`;
  urlSelect.appendChild(localhostOpt);

  if (systemInfo.localIPs && systemInfo.localIPs.length > 0) {
    systemInfo.localIPs.forEach((ip) => {
      const lanOpt = document.createElement("option");
      lanOpt.value = `http://${ip.address}:${systemInfo.port}/capture`;
      lanOpt.textContent = `LAN (${ip.interface}): http://${ip.address}:${systemInfo.port}/capture`;
      urlSelect.appendChild(lanOpt);
    });
  }

  if (cloudflareTunnel.status === "running" && cloudflareTunnel.url) {
    urlSelect.value = cloudflareTunnel.url;
  } else if (
    previousValue &&
    Array.from(urlSelect.options).some((o) => o.value === previousValue)
  ) {
    urlSelect.value = previousValue;
  } else {
    urlSelect.selectedIndex = 0;
  }
}

// Server-Sent Events
function initSSE() {
  const sseStatus = document.getElementById("sse-status");
  const evtSource = new EventSource("/api/events");

  evtSource.onopen = () => {
    if (sseStatus && !isStreamPaused) {
      sseStatus.className = "status-badge connected";
      sseStatus.querySelector(".status-text").textContent = "LIVE";
    }
  };

  evtSource.addEventListener("tunnel_status", (e) => {
    try {
      const { status, url, error } = JSON.parse(e.data);
      updateTunnelUI(status, url);
      if (status === "running" && url) {
        showToast(`Cloudflare Tunnel Active: ${url}`, "success");
      } else if (status === "error") {
        showToast(`Tunnel error: ${error || "Failed"}`, "error");
      }
    } catch (err) {}
  });

  evtSource.addEventListener("new_request", (e) => {
    try {
      const record = JSON.parse(e.data);
      record._isNew = true;
      allRequests.unshift(record);
      playBeep();

      if (isStreamPaused) {
        pendingRequestsBuffer.unshift(record);
        const streamPausedBanner = document.getElementById(
          "stream-paused-banner",
        );
        const pausedPendingCount = document.getElementById(
          "paused-pending-count",
        );
        if (streamPausedBanner) streamPausedBanner.classList.remove("hidden");
        if (pausedPendingCount)
          pausedPendingCount.textContent = `Feed paused (${pendingRequestsBuffer.length} new items buffered)`;
      } else {
        renderRequestsList();
        const autoScrollToggle = document.getElementById("auto-scroll-toggle");
        if (
          (autoScrollToggle && autoScrollToggle.checked) ||
          !selectedRequestId
        ) {
          selectRequest(record.id);
        }
        showToast(
          `Incoming ${record.method} request from ${record.clientIP}`,
          "info",
        );
      }
    } catch (err) {
      console.error(err);
    }
  });

  evtSource.addEventListener("delete", (e) => {
    try {
      const { id } = JSON.parse(e.data);
      allRequests = allRequests.filter((r) => r.id !== id);
      pendingRequestsBuffer = pendingRequestsBuffer.filter((r) => r.id !== id);
      renderRequestsList();
      if (selectedRequestId === id) {
        if (allRequests.length > 0) {
          selectRequest(allRequests[0].id);
        } else {
          selectedRequestId = null;
          renderDetail(null);
        }
      }
    } catch (err) {
      console.error(err);
    }
  });

  evtSource.addEventListener("clear", () => {
    allRequests = [];
    pendingRequestsBuffer = [];
    selectedRequestId = null;
    renderRequestsList();
    renderDetail(null);
  });

  evtSource.addEventListener("config_updated", () => {
    showToast("Mock Response configuration updated on server!", "success");
  });

  evtSource.onerror = () => {
    if (sseStatus) {
      sseStatus.className = "status-badge disconnected";
      sseStatus.querySelector(".status-text").textContent = "RECONNECTING";
    }
  };
}

// Request Storage & Filter Logic
async function fetchRequests() {
  try {
    const res = await fetch("/api/requests");
    if (res.ok) {
      allRequests = await res.json();
      renderRequestsList();
      if (allRequests.length > 0 && !selectedRequestId) {
        selectRequest(allRequests[0].id);
      }
    }
  } catch (e) {
    console.error("Error fetching requests", e);
  }
}

function getFilteredRequests() {
  return allRequests.filter((req) => {
    if (
      req.path === "/favicon.ico" ||
      req.path === "/robots.txt" ||
      req.path === "/apple-touch-icon.png"
    ) {
      return false;
    }

    // Method Filter
    if (currentFilter !== "ALL") {
      if (currentFilter === "OTHER") {
        if (["GET", "POST", "PUT", "DELETE"].includes(req.method)) return false;
      } else if (req.method !== currentFilter) {
        return false;
      }
    }

    // Status Code Filter
    if (currentStatusFilter !== "ALL") {
      const code = req.responseSent?.statusCode || 200;
      if (currentStatusFilter === "2xx" && (code < 200 || code >= 300))
        return false;
      if (currentStatusFilter === "3xx" && (code < 300 || code >= 400))
        return false;
      if (currentStatusFilter === "4xx" && (code < 400 || code >= 500))
        return false;
      if (currentStatusFilter === "5xx" && (code < 500 || code >= 600))
        return false;
    }

    // Search Query (Text or Regex)
    if (searchQuery) {
      if (isRegexSearch) {
        try {
          const re = new RegExp(searchQuery, "i");
          const inPath = re.test(req.path || "");
          const inUrl = re.test(req.url || "");
          const inIp = re.test(req.clientIP || "");
          const inMethod = re.test(req.method || "");
          const inHeaders = re.test(JSON.stringify(req.headers || {}));
          const inBody = re.test(req.body?.raw || "");
          const inQuery = re.test(JSON.stringify(req.query || {}));
          return (
            inPath ||
            inUrl ||
            inIp ||
            inMethod ||
            inHeaders ||
            inBody ||
            inQuery
          );
        } catch {
          // Invalid regex fallback to false
          return false;
        }
      } else {
        const q = searchQuery.toLowerCase();
        const inPath = (req.path || "").toLowerCase().includes(q);
        const inUrl = (req.url || "").toLowerCase().includes(q);
        const inIp = (req.clientIP || "").toLowerCase().includes(q);
        const inMethod = (req.method || "").toLowerCase().includes(q);
        const inHeaders = JSON.stringify(req.headers || {})
          .toLowerCase()
          .includes(q);
        const inBody = (req.body?.raw || "").toLowerCase().includes(q);
        const inQuery = JSON.stringify(req.query || {})
          .toLowerCase()
          .includes(q);
        return (
          inPath || inUrl || inIp || inMethod || inHeaders || inBody || inQuery
        );
      }
    }

    return true;
  });
}

function highlightSearchMatch(text) {
  if (!searchQuery || !text) return escapeHtml(text);
  const rawText = String(text);
  if (isRegexSearch) {
    try {
      const re = new RegExp(`(${searchQuery})`, "gi");
      return escapeHtml(rawText).replace(
        re,
        '<mark class="search-match">$1</mark>',
      );
    } catch {
      return escapeHtml(rawText);
    }
  }
  const escaped = escapeHtml(rawText);
  const q = escapeHtml(searchQuery);
  const re = new RegExp(
    `(${q.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")})`,
    "gi",
  );
  return escaped.replace(re, '<mark class="search-match">$1</mark>');
}

function renderRequestsList() {
  const requestsListEl = document.getElementById("requests-list");
  const countAllBadge = document.getElementById("count-all");
  const totalRequestsCount = document.getElementById("total-requests-count");
  const filteredCountText = document.getElementById("filtered-count-text");
  const btnResetFilters = document.getElementById("btn-reset-filters");
  if (!requestsListEl) return;

  const filtered = getFilteredRequests();
  if (countAllBadge) countAllBadge.textContent = allRequests.length;
  if (totalRequestsCount)
    totalRequestsCount.textContent = `${allRequests.length} requests`;

  const isFiltering =
    currentFilter !== "ALL" ||
    currentStatusFilter !== "ALL" ||
    searchQuery.length > 0;
  if (filteredCountText) {
    if (isFiltering) {
      filteredCountText.textContent = `Showing ${filtered.length} of ${allRequests.length} requests`;
      if (btnResetFilters) btnResetFilters.classList.remove("hidden");
    } else {
      filteredCountText.textContent = `Showing all ${allRequests.length} requests`;
      if (btnResetFilters) btnResetFilters.classList.add("hidden");
    }
  }

  if (filtered.length === 0) {
    if (allRequests.length === 0) {
      requestsListEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon-wrap" aria-hidden="true">
            <i class="fa-solid fa-tower-broadcast"></i>
          </div>
          <div class="empty-title">Listening for incoming requests...</div>
          <p class="empty-desc">Send HTTP or SSRF callbacks to your active Webhook URL to inspect them in real time.</p>
          <button id="btn-send-first-test" class="btn btn-primary btn-sm">
            <i class="fa-solid fa-paper-plane" aria-hidden="true"></i>
            <span>Send Test Request Probe</span>
          </button>
        </div>
      `;
      document
        .getElementById("btn-send-first-test")
        ?.addEventListener("click", openSendTestModal);
    } else {
      requestsListEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon-wrap" aria-hidden="true">
            <i class="fa-solid fa-magnifying-glass"></i>
          </div>
          <div class="empty-title">No matching requests found</div>
          <p class="empty-desc">Try clearing your search query or changing active method/status filters.</p>
          <button id="btn-clear-filters-empty" class="btn btn-secondary btn-sm">Reset All Filters</button>
        </div>
      `;
      document
        .getElementById("btn-clear-filters-empty")
        ?.addEventListener("click", resetAllFilters);
    }
    return;
  }

  requestsListEl.innerHTML = "";
  filtered.forEach((req) => {
    const item = document.createElement("div");
    item.className = `request-item ${req.id === selectedRequestId ? "active" : ""} ${req._isNew ? "new-arrival" : ""}`;
    item.dataset.id = req.id;
    item.setAttribute("role", "option");
    item.setAttribute(
      "aria-selected",
      req.id === selectedRequestId ? "true" : "false",
    );
    delete req._isNew;

    const timeStr =
      req.timestampLocal || new Date(req.timestamp).toLocaleTimeString();
    const sizeStr = formatBytes(req.size || 0);
    const highlightedPath = highlightSearchMatch(req.url);
    const highlightedIp = highlightSearchMatch(req.clientIP);
    const respStatus = req.responseSent?.statusCode || 200;

    item.innerHTML = `
      <div class="req-item-top">
        <span class="method-badge ${req.method}">${req.method}</span>
        <span class="req-item-path" title="${escapeHtml(req.url)}">${highlightedPath}</span>
        <span class="req-item-time">${timeStr}</span>
      </div>
      <div class="req-item-bottom">
        <div class="req-item-meta">
          <span class="req-item-ip">${highlightedIp}</span>
          <span>•</span>
          <span>${sizeStr}</span>
          <span>•</span>
          <span class="status-pill status-${respStatus.toString()[0]}xx">${respStatus}</span>
        </div>
        <button class="req-item-delete" title="Delete request (with undo)" data-delete-id="${req.id}" aria-label="Delete request">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `;

    item.addEventListener("click", (e) => {
      if (e.target.closest(".req-item-delete")) return;
      selectRequest(req.id);
    });

    item.querySelector(".req-item-delete").addEventListener("click", (e) => {
      e.stopPropagation();
      deleteRequest(req.id);
    });

    requestsListEl.appendChild(item);
  });
}

function resetAllFilters() {
  searchQuery = "";
  currentFilter = "ALL";
  currentStatusFilter = "ALL";
  const requestSearch = document.getElementById("request-search");
  if (requestSearch) requestSearch.value = "";
  document.querySelectorAll(".filter-btn").forEach((b) => {
    const isAll = b.dataset.filter === "ALL";
    b.classList.toggle("active", isAll);
    b.setAttribute("aria-pressed", isAll ? "true" : "false");
  });
  document.querySelectorAll(".status-filter-btn").forEach((b) => {
    const isAll = b.dataset.statusFilter === "ALL";
    b.classList.toggle("active", isAll);
    b.setAttribute("aria-pressed", isAll ? "true" : "false");
  });
  renderRequestsList();
}

function selectRequest(id) {
  selectedRequestId = id;
  const found = allRequests.find((r) => r.id === id);

  document.querySelectorAll(".request-item").forEach((el) => {
    const isTarget = el.dataset.id === id;
    el.classList.toggle("active", isTarget);
    el.setAttribute("aria-selected", isTarget ? "true" : "false");
  });

  renderDetail(found);
}

async function deleteRequest(id) {
  const target = allRequests.find((r) => r.id === id);
  if (!target) return;

  undoStack = { type: "single", record: target };

  try {
    await fetch(`/api/requests/${id}`, { method: "DELETE" });
    showToast("Request deleted", "warning", "Undo", async () => {
      if (undoStack && undoStack.record) {
        allRequests.unshift(undoStack.record);
        renderRequestsList();
        selectRequest(undoStack.record.id);
        showToast("Restored deleted request", "success");
      }
    });
  } catch (err) {
    console.error(err);
  }
}

async function clearAllRequests() {
  if (allRequests.length === 0) return;
  const backup = [...allRequests];
  undoStack = { type: "all", records: backup };

  try {
    await fetch("/api/requests", { method: "DELETE" });
    showToast("All recorded requests cleared", "warning", "Undo", () => {
      if (undoStack && undoStack.records) {
        allRequests = [...undoStack.records];
        renderRequestsList();
        if (allRequests.length > 0) selectRequest(allRequests[0].id);
        showToast("Restored all requests", "success");
      }
    });
  } catch (err) {
    console.error(err);
  }
}

// Inspector Detail Rendering
function renderDetail(req) {
  const noSelectionEl = document.getElementById("no-selection");
  const requestDetailEl = document.getElementById("request-detail");
  const detailMethod = document.getElementById("detail-method");
  const detailPath = document.getElementById("detail-path");
  const detailIp = document.getElementById("detail-ip");
  const detailTimestamp = document.getElementById("detail-timestamp");
  const detailSize = document.getElementById("detail-size");
  const detailContentType = document.getElementById("detail-content-type");
  const detailResponseStatus = document.getElementById(
    "detail-response-status",
  );
  const tabHeadersCount = document.getElementById("tab-headers-count");
  const tabBodyBadge = document.getElementById("tab-body-badge");
  const tabQueryCount = document.getElementById("tab-query-count");
  const headersRawContainer = document.getElementById("headers-raw-container");

  if (!req) {
    if (noSelectionEl) noSelectionEl.classList.remove("hidden");
    if (requestDetailEl) requestDetailEl.classList.add("hidden");
    return;
  }

  if (noSelectionEl) noSelectionEl.classList.add("hidden");
  if (requestDetailEl) requestDetailEl.classList.remove("hidden");

  if (detailMethod) {
    detailMethod.className = `method-badge ${req.method}`;
    detailMethod.textContent = req.method;
  }
  if (detailPath) {
    detailPath.textContent = req.url;
    detailPath.title = req.url;
  }
  if (detailIp) detailIp.textContent = req.clientIP;
  if (detailTimestamp)
    detailTimestamp.textContent = new Date(req.timestamp).toLocaleString();
  if (detailSize) detailSize.textContent = formatBytes(req.size || 0);

  const contentTypeHeader = req.headers["content-type"] || "None";
  if (detailContentType) {
    detailContentType.textContent =
      contentTypeHeader.length > 30
        ? contentTypeHeader.slice(0, 30) + "..."
        : contentTypeHeader;
    detailContentType.title = contentTypeHeader;
  }

  const respCode = req.responseSent?.statusCode || 200;
  if (detailResponseStatus) {
    detailResponseStatus.className = `meta-value status-pill status-${respCode.toString()[0]}xx`;
    detailResponseStatus.textContent = `${respCode} OK`;
  }

  const headerKeys = Object.keys(req.headers || {});
  if (tabHeadersCount) tabHeadersCount.textContent = headerKeys.length;
  if (tabBodyBadge) tabBodyBadge.textContent = formatBytes(req.size || 0);
  const queryKeys = Object.keys(req.query || {});
  if (tabQueryCount) tabQueryCount.textContent = queryKeys.length;

  renderHeadersTable(req.headers);
  if (headersRawContainer) {
    headersRawContainer.textContent = formatRawHeaders(
      req.rawHeaders || req.headers,
    );
  }
  renderBodyContent(req.body);
  renderQueryParams(req.query);
  renderClientInfo(req);
  renderResponseSent(req.responseSent);
}

function renderHeadersTable(headers) {
  const headersTableBody = document.getElementById("headers-table-body");
  const headersFilterInput = document.getElementById("headers-filter");
  if (!headersTableBody) return;
  headersTableBody.innerHTML = "";
  const filter = (headersFilterInput?.value || "").toLowerCase();

  for (const [key, value] of Object.entries(headers || {})) {
    if (
      filter &&
      !key.toLowerCase().includes(filter) &&
      !String(value).toLowerCase().includes(filter)
    ) {
      continue;
    }
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="header-name">${escapeHtml(key)}</td>
      <td class="header-value">${escapeHtml(String(value))}</td>
      <td>
        <button class="btn-icon-subtle" title="Copy header value" aria-label="Copy ${escapeHtml(key)} value">
          <i class="fa-regular fa-clone"></i>
        </button>
      </td>
    `;
    tr.querySelector(".btn-icon-subtle").addEventListener("click", (e) => {
      copyToClipboard(value, `Copied header "${key}"`, e.currentTarget);
    });
    headersTableBody.appendChild(tr);
  }
}

function formatRawHeaders(headers) {
  if (Array.isArray(headers)) {
    let out = "";
    for (let i = 0; i < headers.length; i += 2) {
      out += `${headers[i]}: ${headers[i + 1]}\n`;
    }
    return out;
  }
  return Object.entries(headers || {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

// Colorized JSON Tokenizer
function syntaxHighlightJson(json) {
  if (typeof json !== "string") {
    json = JSON.stringify(json, null, 2);
  }
  json = escapeHtml(json);
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    function (match) {
      let cls = "json-number";
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = "json-key";
        } else {
          cls = "json-string";
        }
      } else if (/true|false/.test(match)) {
        cls = "json-boolean";
      } else if (/null/.test(match)) {
        cls = "json-null";
      }
      return '<span class="' + cls + '">' + match + "</span>";
    },
  );
}

function renderBodyContent(bodyObj) {
  const bodyPre = document.getElementById("body-pre");
  if (!bodyPre) return;

  if (!bodyObj || bodyObj.size === 0 || bodyObj.type === "empty") {
    bodyPre.innerHTML =
      '<span style="color: var(--theme-dim)">(Empty Payload Body)</span>';
    return;
  }

  if (currentBodyView === "formatted") {
    if (bodyObj.type === "json" && bodyObj.parsed) {
      bodyPre.innerHTML = syntaxHighlightJson(bodyObj.parsed);
    } else if (bodyObj.type === "form" && bodyObj.parsed) {
      bodyPre.innerHTML = syntaxHighlightJson(bodyObj.parsed);
    } else {
      bodyPre.textContent = bodyObj.raw || "";
    }
  } else if (currentBodyView === "raw") {
    bodyPre.textContent = bodyObj.raw || "";
  } else if (currentBodyView === "hex") {
    bodyPre.textContent =
      bodyObj.hex || "(Hex dump unavailable for text payload)";
  }
}

function renderQueryParams(query) {
  const queryTableBody = document.getElementById("query-table-body");
  const queryEmptyState = document.getElementById("query-empty");
  const queryTableContainer = document.getElementById("query-table-container");
  if (!queryTableBody) return;
  queryTableBody.innerHTML = "";
  const keys = Object.keys(query || {});
  if (keys.length === 0) {
    queryEmptyState?.classList.remove("hidden");
    queryTableContainer?.classList.add("hidden");
    return;
  }
  queryEmptyState?.classList.add("hidden");
  queryTableContainer?.classList.remove("hidden");

  keys.forEach((key) => {
    const val = query[key];
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="header-name">${escapeHtml(key)}</td>
      <td class="header-value">${escapeHtml(String(val))}</td>
      <td>
        <button class="btn-icon-subtle" title="Copy query param value" aria-label="Copy ${escapeHtml(key)}">
          <i class="fa-regular fa-clone"></i>
        </button>
      </td>
    `;
    tr.querySelector(".btn-icon-subtle").addEventListener("click", (e) => {
      copyToClipboard(val, `Copied parameter "${key}"`, e.currentTarget);
    });
    queryTableBody.appendChild(tr);
  });
}

function renderClientInfo(req) {
  const clientIpDisplay = document.getElementById("client-ip-display");
  const clientIpDesc = document.getElementById("client-ip-desc");
  const clientProtoDisplay = document.getElementById("client-proto-display");
  const clientUaDisplay = document.getElementById("client-ua-display");
  const ssrfIndicators = document.getElementById("ssrf-indicators");
  const cfEdgeCard = document.getElementById("cf-edge-card");
  const cfEdgeDetails = document.getElementById("cf-edge-details");

  if (clientIpDisplay)
    clientIpDisplay.textContent = req.clientIP || "127.0.0.1";
  if (clientProtoDisplay)
    clientProtoDisplay.textContent = `${(req.protocol || "http").toUpperCase()} / ${req.httpVersion || "1.1"}`;
  if (clientUaDisplay)
    clientUaDisplay.textContent = req.headers["user-agent"] || "None specified";

  if (ssrfIndicators) {
    ssrfIndicators.innerHTML = "";
    const ip = req.clientIP || "";
    const isLoopback =
      ip === "127.0.0.1" ||
      ip === "::1" ||
      ip === "localhost" ||
      ip === "0.0.0.0";
    const isPrivate =
      /^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.|100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.)/.test(
        ip,
      );

    if (isLoopback) {
      ssrfIndicators.innerHTML +=
        '<span class="tag"><i class="fa-solid fa-house-laptop"></i> Localhost Loopback (127.0.0.1)</span>';
      if (clientIpDesc)
        clientIpDesc.textContent = "Direct loopback connection on host system";
    } else if (isPrivate) {
      ssrfIndicators.innerHTML += `<span class="tag"><i class="fa-solid fa-network-wired"></i> RFC 1918 Private LAN (${ip})</span>`;
      if (clientIpDesc)
        clientIpDesc.textContent = "Internal private subnet address";
    } else {
      ssrfIndicators.innerHTML += `<span class="tag tag-success"><i class="fa-solid fa-earth-americas"></i> Public External WAN IP (${ip})</span>`;
      if (clientIpDesc)
        clientIpDesc.textContent = "Public routable internet client";
    }

    if (req.headers["x-forwarded-for"]) {
      ssrfIndicators.innerHTML += `<span class="tag"><i class="fa-solid fa-arrows-split-up-and-left"></i> Proxied (X-Forwarded-For: ${escapeHtml(req.headers["x-forwarded-for"])})</span>`;
    }

    if (
      req.headers["x-aws-ec2-metadata-token"] ||
      req.url.includes("169.254.169.254") ||
      req.url.includes("meta-data")
    ) {
      ssrfIndicators.innerHTML += `<span class="tag tag-danger"><i class="fa-solid fa-triangle-exclamation"></i> AWS IMDS Metadata SSRF Target</span>`;
    }

    if (
      req.headers["metadata-flavor"] === "Google" ||
      req.url.includes("computeMetadata")
    ) {
      ssrfIndicators.innerHTML += `<span class="tag tag-warning"><i class="fa-brands fa-google"></i> GCP Metadata SSRF Probe</span>`;
    }

    if (req.headers["cf-connecting-ip"] || req.headers["cf-ray"]) {
      const country = req.headers["cf-ipcountry"] || "Global";
      const ray = req.headers["cf-ray"] || "";
      ssrfIndicators.innerHTML += `<span class="tag" style="background: rgba(243, 128, 32, 0.15); color: #ff9838"><i class="fa-brands fa-cloudflare"></i> Cloudflare Edge (${country})</span>`;

      if (cfEdgeCard) cfEdgeCard.classList.remove("hidden");
      if (cfEdgeDetails)
        cfEdgeDetails.textContent = `Ray ID: ${ray}\nClient Country: ${country}\nVisitor Scheme: ${req.headers["cf-visitor"] || "https"}\nConnecting IP: ${req.headers["cf-connecting-ip"] || ip}`;
    } else {
      if (cfEdgeCard) cfEdgeCard.classList.add("hidden");
    }

    if (
      req.headers["authorization"] ||
      req.headers["x-api-key"] ||
      req.headers["stripe-signature"]
    ) {
      ssrfIndicators.innerHTML += `<span class="tag" style="color: var(--theme-violet)"><i class="fa-solid fa-key"></i> Auth Credential / Signature Present</span>`;
    }
  }
}

function renderResponseSent(resp) {
  const respSentStatus = document.getElementById("resp-sent-status");
  const respSentType = document.getElementById("resp-sent-type");
  const respSentBody = document.getElementById("resp-sent-body");
  if (!resp) return;
  if (respSentStatus) {
    respSentStatus.className = `meta-value status-pill status-${resp.statusCode.toString()[0]}xx`;
    respSentStatus.textContent = `${resp.statusCode} OK`;
  }
  if (respSentType)
    respSentType.textContent = resp.contentType || "application/json";
  if (respSentBody) respSentBody.textContent = resp.body || "";
}

// Code Exporters
function generateCurl(req) {
  const activeBaseUrl = getActiveWebhookUrl().replace(/\/capture.*$/, "");
  let cmd = `curl -X ${req.method} "${activeBaseUrl}${req.url}"`;

  for (const [k, v] of Object.entries(req.headers || {})) {
    if (["host", "content-length"].includes(k.toLowerCase())) continue;
    cmd += ` \\\n  -H "${k}: ${v.replace(/"/g, '\\"')}"`;
  }

  if (
    req.body &&
    req.body.raw &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
  ) {
    cmd += ` \\\n  --data '${req.body.raw.replace(/'/g, "'\\''")}'`;
  }

  return cmd;
}

function generateFetch(req) {
  const activeBaseUrl = getActiveWebhookUrl().replace(/\/capture.*$/, "");
  const fullUrl = `${activeBaseUrl}${req.url}`;
  const headersObj = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (["host", "content-length"].includes(k.toLowerCase())) continue;
    headersObj[k] = v;
  }

  const options = {
    method: req.method,
    headers: headersObj,
  };

  if (
    req.body &&
    req.body.raw &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
  ) {
    options.body = req.body.raw;
  }

  return `fetch("${fullUrl}", ${JSON.stringify(options, null, 2)});`;
}

function generatePython(req) {
  const activeBaseUrl = getActiveWebhookUrl().replace(/\/capture.*$/, "");
  const fullUrl = `${activeBaseUrl}${req.url}`;
  const headersObj = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (["host", "content-length"].includes(k.toLowerCase())) continue;
    headersObj[k] = v;
  }

  let code = `import requests\n\n`;
  code += `url = "${fullUrl}"\n`;
  code += `headers = ${JSON.stringify(headersObj, null, 4)}\n`;
  if (
    req.body &&
    req.body.raw &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
  ) {
    code += `data = ${JSON.stringify(req.body.raw)}\n\n`;
    code += `response = requests.${req.method.toLowerCase()}(url, headers=headers, data=data)\n`;
  } else {
    code += `\nresponse = requests.${req.method.toLowerCase()}(url, headers=headers)\n`;
  }
  code += `print(f"Status: {response.status_code}")\nprint(response.text)\n`;
  return code;
}

function generatePowerShell(req) {
  const activeBaseUrl = getActiveWebhookUrl().replace(/\/capture.*$/, "");
  const fullUrl = `${activeBaseUrl}${req.url}`;

  let ps = `$headers = @{\n`;
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (["host", "content-length"].includes(k.toLowerCase())) continue;
    ps += `    "${k}" = "${v.replace(/"/g, '`"')}"\n`;
  }
  ps += `}\n\n`;

  if (
    req.body &&
    req.body.raw &&
    ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)
  ) {
    ps += `$body = @"\n${req.body.raw}\n"@\n\n`;
    ps += `Invoke-RestMethod -Uri "${fullUrl}" -Method ${req.method} -Headers $headers -Body $body\n`;
  } else {
    ps += `Invoke-RestMethod -Uri "${fullUrl}" -Method ${req.method} -Headers $headers\n`;
  }

  return ps;
}

function generateRawHttp(req) {
  let raw = `${req.method} ${req.url} HTTP/${req.httpVersion || "1.1"}\n`;
  for (const [k, v] of Object.entries(req.headers || {})) {
    raw += `${k}: ${v}\n`;
  }
  raw += "\n";
  if (req.body && req.body.raw) {
    raw += req.body.raw;
  }
  return raw;
}

// Side-by-Side Request Diff Logic
function openCompareModal(reqAId = null, reqBId = null) {
  const modalCompare = document.getElementById("modal-compare");
  const selectA = document.getElementById("diff-select-a");
  const selectB = document.getElementById("diff-select-b");
  if (!modalCompare || !selectA || !selectB) return;

  selectA.innerHTML = "";
  selectB.innerHTML = "";

  if (allRequests.length < 2) {
    showToast(
      "At least 2 captured requests are required to compare diffs.",
      "warning",
    );
  }

  allRequests.forEach((req, idx) => {
    const label = `#${allRequests.length - idx} [${req.method}] ${req.url.slice(0, 30)} (${req.clientIP})`;
    const optA = new Option(label, req.id);
    const optB = new Option(label, req.id);
    selectA.add(optA);
    selectB.add(optB);
  });

  if (reqAId && allRequests.some((r) => r.id === reqAId)) {
    selectA.value = reqAId;
  } else if (selectedRequestId) {
    selectA.value = selectedRequestId;
  }

  if (reqBId && allRequests.some((r) => r.id === reqBId)) {
    selectB.value = reqBId;
  } else if (allRequests.length > 1) {
    // Pick the next request
    const secondReq = allRequests.find((r) => r.id !== selectA.value);
    if (secondReq) selectB.value = secondReq.id;
  }

  updateDiffView();
  openModal(modalCompare);
}

function setupCompareModalEvents() {
  const selectA = document.getElementById("diff-select-a");
  const selectB = document.getElementById("diff-select-b");
  const btnDiffSwap = document.getElementById("btn-diff-swap");
  const btnCopyDiffA = document.getElementById("btn-copy-diff-a");
  const btnCopyDiffB = document.getElementById("btn-copy-diff-b");

  selectA?.addEventListener("change", updateDiffView);
  selectB?.addEventListener("change", updateDiffView);

  btnDiffSwap?.addEventListener("click", () => {
    const valA = selectA.value;
    selectA.value = selectB.value;
    selectB.value = valA;
    updateDiffView();
  });

  btnCopyDiffA?.addEventListener("click", () => {
    const reqA = allRequests.find((r) => r.id === selectA.value);
    if (reqA)
      copyToClipboard(JSON.stringify(reqA, null, 2), "Request A JSON copied!");
  });

  btnCopyDiffB?.addEventListener("click", () => {
    const reqB = allRequests.find((r) => r.id === selectB.value);
    if (reqB)
      copyToClipboard(JSON.stringify(reqB, null, 2), "Request B JSON copied!");
  });
}

function updateDiffView() {
  const selectA = document.getElementById("diff-select-a");
  const selectB = document.getElementById("diff-select-b");
  const diffHeaderA = document.getElementById("diff-header-a");
  const diffHeaderB = document.getElementById("diff-header-b");
  const diffContentA = document.getElementById("diff-content-a");
  const diffContentB = document.getElementById("diff-content-b");
  const diffSummaryText = document.getElementById("diff-summary-text");

  if (!selectA || !selectB || !diffContentA || !diffContentB) return;

  const reqA = allRequests.find((r) => r.id === selectA.value);
  const reqB = allRequests.find((r) => r.id === selectB.value);

  if (!reqA || !reqB) {
    diffContentA.innerHTML =
      '<div class="tab-empty-state">Select a valid request</div>';
    diffContentB.innerHTML =
      '<div class="tab-empty-state">Select a valid request</div>';
    return;
  }

  if (diffHeaderA)
    diffHeaderA.textContent = `[${reqA.method}] ${reqA.url} (${reqA.clientIP})`;
  if (diffHeaderB)
    diffHeaderB.textContent = `[${reqB.method}] ${reqB.url} (${reqB.clientIP})`;

  // Compare stats
  const headerKeysA = Object.keys(reqA.headers || {});
  const headerKeysB = Object.keys(reqB.headers || {});
  const headerDiffCount =
    headerKeysA.filter((k) => reqA.headers[k] !== reqB.headers[k]).length +
    headerKeysB.filter((k) => !headerKeysA.includes(k)).length;
  const bodyMatch = (reqA.body?.raw || "") === (reqB.body?.raw || "");

  if (diffSummaryText) {
    diffSummaryText.innerHTML = `Comparison: <strong>${headerDiffCount} header difference(s)</strong> • <strong>Body: ${bodyMatch ? "Identical" : "Different"}</strong> • <strong>Method: ${reqA.method === reqB.method ? "Same (" + reqA.method + ")" : reqA.method + " vs " + reqB.method}</strong>`;
  }

  // Render Diff Pane A
  diffContentA.innerHTML = renderDiffPaneContent(reqA, reqB, "A");
  diffContentB.innerHTML = renderDiffPaneContent(reqB, reqA, "B");
}

function renderDiffPaneContent(targetReq, otherReq, side) {
  let html = "";

  // 1. Method & URL Section
  const methodMatch = targetReq.method === otherReq.method;
  const urlMatch = targetReq.url === otherReq.url;

  html += `<div class="diff-section-title">Request Line</div>`;
  html += `<div class="${methodMatch ? "" : "diff-line-changed"}">Method: <strong>${targetReq.method}</strong></div>`;
  html += `<div class="${urlMatch ? "" : "diff-line-changed"}">Path: <strong>${escapeHtml(targetReq.url)}</strong></div>`;
  html += `<div>Client IP: <strong>${targetReq.clientIP}</strong> (${targetReq.timestampLocal || ""})</div>`;

  // 2. Headers Diff
  html += `<div class="diff-section-title mt-2">Headers (${Object.keys(targetReq.headers || {}).length})</div>`;
  for (const [k, v] of Object.entries(targetReq.headers || {})) {
    const otherVal = otherReq.headers ? otherReq.headers[k] : undefined;
    if (otherVal === undefined) {
      html += `<div class="diff-line-added">+ ${escapeHtml(k)}: ${escapeHtml(String(v))}</div>`;
    } else if (otherVal !== v) {
      html += `<div class="diff-line-changed">~ ${escapeHtml(k)}: ${escapeHtml(String(v))}</div>`;
    } else {
      html += `<div>&nbsp; ${escapeHtml(k)}: ${escapeHtml(String(v))}</div>`;
    }
  }

  // Check headers in otherReq that are missing in targetReq
  for (const k of Object.keys(otherReq.headers || {})) {
    if (!targetReq.headers || targetReq.headers[k] === undefined) {
      html += `<div class="diff-line-removed">- ${escapeHtml(k)}: (missing in this request)</div>`;
    }
  }

  // 3. Body Diff
  html += `<div class="diff-section-title mt-2">Body Payload (${formatBytes(targetReq.size || 0)})</div>`;
  const rawBody = targetReq.body?.raw || "";
  if (!rawBody) {
    html += `<div style="color: var(--theme-dim)">(Empty Body)</div>`;
  } else {
    const isBodySame = rawBody === (otherReq.body?.raw || "");
    html += `<pre class="code-block ${isBodySame ? "" : "diff-line-changed"}" style="max-height: 180px; overflow-y: auto;">${escapeHtml(rawBody)}</pre>`;
  }

  return html;
}

// Send Test Modal
const TEST_PRESETS = {
  ssrf_internal: {
    method: "POST",
    path: "/internal/admin-api?probe=ssrf-verification",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": "10.0.4.12",
      "X-Internal-Token": "sec_internal_adm_991823",
    },
    body: JSON.stringify(
      {
        service: "payment-worker-internal",
        action: "query_metadata",
        probe: "SSRF verification check",
        authorized: true,
      },
      null,
      2,
    ),
  },
  ssrf_metadata: {
    method: "GET",
    path: "/latest/meta-data/iam/security-credentials/internal-admin-role",
    headers: {
      "User-Agent": "aws-sdk-nodejs/v3.400.0",
      "X-Aws-Ec2-Metadata-Token": "aws_meta_token_sample_123",
    },
    body: "",
  },
  ssrf_gcp: {
    method: "GET",
    path: "/computeMetadata/v1/instance/service-accounts/default/token",
    headers: {
      "Metadata-Flavor": "Google",
      "User-Agent": "Google-Cloud-SDK/412.0.0",
    },
    body: "",
  },
  webhook_stripe: {
    method: "POST",
    path: "/webhook/stripe/payment_intent_succeeded",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": "t=1723980000,v1=99a38f712b89c62384a10d94f",
      "User-Agent": "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
    },
    body: JSON.stringify(
      {
        id: "evt_3NpQ942eZvKYlo2C1g",
        object: "event",
        type: "payment_intent.succeeded",
        data: {
          object: {
            amount: 4900,
            currency: "usd",
            status: "succeeded",
            customer: "cus_P92830192",
          },
        },
      },
      null,
      2,
    ),
  },
  auth_callback: {
    method: "GET",
    path: "/oauth/callback?code=spl_auth_code_982736192837&state=csrf_protect_token_xyz&provider=google",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
      Referer: "https://accounts.google.com/",
    },
    body: "",
  },
  custom_json: {
    method: "POST",
    path: "/capture?source=elsba3ei-test",
    headers: {
      "Content-Type": "application/json",
      "X-Origin-Host": "elsba3ei.local",
    },
    body: JSON.stringify(
      {
        event: "manual.test.dispatch",
        user: "ahmed-el-sbaei",
        timestamp: new Date().toISOString(),
        status: "active",
      },
      null,
      2,
    ),
  },
};

function getSelectedDestinationBase() {
  const selectedRadio = document.querySelector(
    'input[name="test-destination"]:checked',
  );
  const type = selectedRadio ? selectedRadio.value : "local";

  if (type === "public") {
    if (cloudflareTunnel.status === "running" && cloudflareTunnel.url) {
      return cloudflareTunnel.url;
    }
    return null;
  }

  if (type === "lan" && systemInfo.localIPs && systemInfo.localIPs.length > 0) {
    return `http://${systemInfo.localIPs[0].address}:${systemInfo.port}`;
  }

  return `http://localhost:${systemInfo.port}`;
}

function updateTestModalDestinations() {
  const destPublicDesc = document.getElementById("dest-public-desc");
  const destLanDesc = document.getElementById("dest-lan-desc");
  if (destPublicDesc) {
    if (cloudflareTunnel.status === "running" && cloudflareTunnel.url) {
      destPublicDesc.textContent = `Routes via active Cloudflare tunnel (${cloudflareTunnel.url.replace("https://", "")}).`;
    } else {
      destPublicDesc.textContent =
        "Cloudflare tunnel is offline. Starting tunnel will activate public link.";
    }
  }

  if (destLanDesc) {
    if (systemInfo.localIPs && systemInfo.localIPs.length > 0) {
      destLanDesc.textContent = `Routes via LAN interface (http://${systemInfo.localIPs[0].address}:${systemInfo.port}).`;
    } else {
      destLanDesc.textContent =
        "No active secondary LAN network interface detected.";
    }
  }

  updateTestTargetPreview();
}

function updateTestTargetPreview() {
  const testTargetPreview = document.getElementById("test-target-preview");
  const testProbePreset = document.getElementById("test-probe-preset");
  if (!testTargetPreview || !testProbePreset) return;

  const base = getSelectedDestinationBase();
  const presetKey = testProbePreset.value;
  const preset = TEST_PRESETS[presetKey] || TEST_PRESETS.ssrf_internal;

  if (base) {
    testTargetPreview.value = `${preset.method} ${base}${preset.path}`;
    testTargetPreview.style.borderColor = "";
  } else {
    testTargetPreview.value = `[!] Cloudflare tunnel offline. Click "Start Cloudflare Tunnel" first.`;
    testTargetPreview.style.borderColor = "var(--theme-red)";
  }
}

function openSendTestModal() {
  const modalSendTest = document.getElementById("modal-send-test");
  updateTestModalDestinations();
  if (modalSendTest) openModal(modalSendTest);
}

function setupSendTestModalEvents() {
  const modalSendTest = document.getElementById("modal-send-test");
  const testProbePreset = document.getElementById("test-probe-preset");
  const btnExecuteSendTest = document.getElementById("btn-execute-send-test");

  document.querySelectorAll(".destination-option-card").forEach((card) => {
    card.addEventListener("click", () => {
      document
        .querySelectorAll(".destination-option-card")
        .forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      updateTestTargetPreview();
    });
  });

  testProbePreset?.addEventListener("change", updateTestTargetPreview);

  btnExecuteSendTest?.addEventListener("click", async () => {
    const selectedRadio = document.querySelector(
      'input[name="test-destination"]:checked',
    );
    const destType = selectedRadio ? selectedRadio.value : "local";
    let base = getSelectedDestinationBase();

    if (destType === "public" && !base) {
      showToast(
        "Cloudflare Tunnel is offline. Start the tunnel first to route public tests.",
        "warning",
      );
      return;
    }

    const presetKey = testProbePreset.value;
    const preset = TEST_PRESETS[presetKey] || TEST_PRESETS.ssrf_internal;
    const targetUrl = `${base}${preset.path}`;

    btnExecuteSendTest.disabled = true;
    btnExecuteSendTest.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i><span>Dispatching...</span>';

    try {
      const res = await fetch("/api/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUrl: targetUrl,
          method: preset.method,
          headers: preset.headers,
          body: preset.body,
        }),
      });

      if (res.ok) {
        if (modalSendTest) closeModal(modalSendTest);
        showToast(
          `Test probe dispatched to ${destType === "public" ? "Cloudflare HTTPS" : destType === "lan" ? "LAN" : "Localhost"}!`,
          "success",
        );
      } else {
        showToast("Server reported an issue during probe dispatch.", "warning");
      }
    } catch (e) {
      showToast("Error sending probe: " + e.message, "error");
    } finally {
      btnExecuteSendTest.disabled = false;
      btnExecuteSendTest.innerHTML =
        '<i class="fa-solid fa-paper-plane"></i><span>Dispatch Test Request</span>';
    }
  });
}

// Modal Management with Focus Trap & Restoration
function openModal(modal) {
  if (!modal) return;
  lastFocusedElementBeforeModal = document.activeElement;
  modal.classList.remove("hidden");

  // Focus first input or button
  setTimeout(() => {
    const focusable = modal.querySelector(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable) focusable.focus();
  }, 50);
}

function closeModal(modal) {
  if (!modal) return;
  modal.classList.add("hidden");
  if (
    lastFocusedElementBeforeModal &&
    typeof lastFocusedElementBeforeModal.focus === "function"
  ) {
    lastFocusedElementBeforeModal.focus();
  }
}

// Keyboard Shortcuts & Focus Navigation
function setupKeyboardShortcuts() {
  const requestSearchInput = document.getElementById("request-search");
  const modalResponseConfig = document.getElementById("modal-response-config");
  const modalShortcuts = document.getElementById("modal-shortcuts");
  const soundToggleBtn = document.getElementById("btn-sound-toggle");
  const copyUrlBtn = document.getElementById("copy-url-btn");

  window.addEventListener("keydown", (e) => {
    const isTyping = ["INPUT", "TEXTAREA", "SELECT"].includes(
      document.activeElement.tagName,
    );

    if (e.key === "Escape") {
      const openModalEl = document.querySelector(
        ".modal-backdrop:not(.hidden)",
      );
      if (openModalEl) {
        closeModal(openModalEl);
        return;
      }
      if (document.activeElement === requestSearchInput) {
        resetAllFilters();
        requestSearchInput.blur();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      if (requestSearchInput) {
        requestSearchInput.focus();
        requestSearchInput.select();
      }
      return;
    }

    if (e.altKey && e.key.toLowerCase() === "c") {
      e.preventDefault();
      clearAllRequests();
      return;
    }

    if (isTyping) return;

    if (e.key === "/") {
      e.preventDefault();
      if (requestSearchInput) {
        requestSearchInput.focus();
        requestSearchInput.select();
      }
    } else if (e.key === " " || e.key === "p" || e.key === "P") {
      e.preventDefault();
      toggleStreamPause();
    } else if (e.key === "j" || e.key === "ArrowDown") {
      e.preventDefault();
      navigateRequest(1);
    } else if (e.key === "k" || e.key === "ArrowUp") {
      e.preventDefault();
      navigateRequest(-1);
    } else if (e.key === "t" || e.key === "T") {
      e.preventDefault();
      openSendTestModal();
    } else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      openRepeaterModal();
    } else if (e.key === "d" || e.key === "D") {
      e.preventDefault();
      openCompareModal();
    } else if (e.key === "e" || e.key === "E") {
      e.preventDefault();
      exportRequestsJson();
    } else if (e.key === "c" || e.key === "C") {
      e.preventDefault();
      const activeUrl = getActiveWebhookUrl();
      if (activeUrl)
        copyToClipboard(activeUrl, "Webhook URL copied!", copyUrlBtn);
    } else if (e.key === "m" || e.key === "M") {
      e.preventDefault();
      if (modalResponseConfig) openModal(modalResponseConfig);
    } else if (e.key === "s" || e.key === "S") {
      e.preventDefault();
      soundToggleBtn?.click();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (selectedRequestId) deleteRequest(selectedRequestId);
    } else if (e.key >= "1" && e.key <= "5") {
      e.preventDefault();
      const tabMap = {
        1: "tab-headers",
        2: "tab-body",
        3: "tab-query",
        4: "tab-client",
        5: "tab-response",
      };
      if (tabMap[e.key]) switchTab(tabMap[e.key]);
    } else if (e.key === "?") {
      e.preventDefault();
      if (modalShortcuts) openModal(modalShortcuts);
    }
  });
}

function navigateRequest(direction) {
  const filtered = getFilteredRequests();
  if (filtered.length === 0) return;

  const currentIndex = filtered.findIndex((r) => r.id === selectedRequestId);
  let nextIndex = currentIndex + direction;

  if (currentIndex === -1) {
    nextIndex = 0;
  } else if (nextIndex < 0) {
    nextIndex = 0;
  } else if (nextIndex >= filtered.length) {
    nextIndex = filtered.length - 1;
  }

  selectRequest(filtered[nextIndex].id);
  const activeEl = document.querySelector(
    `.request-item[data-id="${filtered[nextIndex].id}"]`,
  );
  if (activeEl) {
    activeEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function exportRequestsJson() {
  const dataStr =
    "data:text/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(allRequests, null, 2));
  const dlAnchorElem = document.createElement("a");
  dlAnchorElem.setAttribute("href", dataStr);
  dlAnchorElem.setAttribute("download", `elsba3ei-requests-${Date.now()}.json`);
  dlAnchorElem.click();
  showToast(`Exported ${allRequests.length} requests to JSON file`, "success");
}

// Global Event Listeners Setup
function setupEventListeners() {
  const requestSearchInput = document.getElementById("request-search");
  const clearSearchBtn = document.getElementById("clear-search-btn");
  const btnToggleRegex = document.getElementById("btn-toggle-regex");
  const filterBtns = document.querySelectorAll(".filter-btn");
  const statusFilterBtns = document.querySelectorAll(".status-filter-btn");
  const btnResetFilters = document.getElementById("btn-reset-filters");
  const btnToggleStream = document.getElementById("btn-toggle-stream");
  const btnResumeAndJump = document.getElementById("btn-resume-and-jump");
  const soundToggleBtn = document.getElementById("btn-sound-toggle");
  const soundIcon = document.getElementById("sound-icon");
  const btnShortcutsHelp = document.getElementById("btn-shortcuts-help");
  const modalShortcuts = document.getElementById("modal-shortcuts");
  const btnCopyCurl = document.getElementById("btn-copy-curl");
  const btnCopyFetch = document.getElementById("btn-copy-fetch");
  const btnCopyPython = document.getElementById("btn-copy-python");
  const btnCopyPowershell = document.getElementById("btn-copy-powershell");
  const btnCopyRawHttp = document.getElementById("btn-copy-raw-http");
  const btnCopyBody = document.getElementById("copy-body-btn");
  const btnCopyFullUrl = document.getElementById("copy-full-url");
  const btnDeleteCurrent = document.getElementById("btn-delete-current");
  const btnClearAll = document.getElementById("btn-clear-all");
  const btnExportJson = document.getElementById("btn-export-json");
  const btnTestRequest = document.getElementById("btn-test-request");
  const btnCompareModal = document.getElementById("btn-compare-modal");
  const btnDiffCurrent = document.getElementById("btn-diff-current");
  const toggleRawHeadersBtn = document.getElementById("toggle-raw-headers");
  const headersRawContainer = document.getElementById("headers-raw-container");
  const headersTableContainer = document.getElementById(
    "headers-table-container",
  );
  const bodyViewBtns = document.querySelectorAll(".view-btn");
  const btnResponseSettings = document.getElementById("btn-response-settings");
  const modalResponseConfig = document.getElementById("modal-response-config");
  const btnOpenRepeater = document.getElementById("btn-open-repeater");
  const btnSaveConfig = document.getElementById("btn-save-config");
  const btnSendReplay = document.getElementById("btn-send-replay");
  const btnToggleTunnel = document.getElementById("btn-toggle-tunnel");
  const copyUrlBtn = document.getElementById("copy-url-btn");
  const urlSelect = document.getElementById("url-select");
  const headersFilterInput = document.getElementById("headers-filter");
  const btnCopyAllHeaders = document.getElementById("btn-copy-all-headers");

  copyUrlBtn?.addEventListener("click", () => {
    const activeUrl = getActiveWebhookUrl();
    if (activeUrl)
      copyToClipboard(activeUrl, "Webhook URL copied!", copyUrlBtn);
  });
  btnToggleTunnel?.addEventListener("click", toggleTunnel);

  btnToggleStream?.addEventListener("click", toggleStreamPause);
  btnResumeAndJump?.addEventListener("click", () => {
    if (isStreamPaused) toggleStreamPause();
  });

  requestSearchInput?.addEventListener("input", (e) => {
    searchQuery = e.target.value.trim();
    renderRequestsList();
  });
  clearSearchBtn?.addEventListener("click", () => {
    if (requestSearchInput) requestSearchInput.value = "";
    searchQuery = "";
    renderRequestsList();
  });

  btnToggleRegex?.addEventListener("click", () => {
    isRegexSearch = !isRegexSearch;
    btnToggleRegex.classList.toggle("active", isRegexSearch);
    showToast(
      isRegexSearch ? "Regex search enabled" : "Standard search enabled",
      "info",
    );
    renderRequestsList();
  });

  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      currentFilter = btn.dataset.filter;
      renderRequestsList();
    });
  });

  statusFilterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      statusFilterBtns.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      currentStatusFilter = btn.dataset.statusFilter;
      renderRequestsList();
    });
  });

  btnResetFilters?.addEventListener("click", resetAllFilters);

  // Clickable IP to filter
  document.addEventListener("click", (e) => {
    const ipTarget = e.target.closest(".clickable-filter-val");
    if (ipTarget && ipTarget.textContent) {
      const ip = ipTarget.textContent.trim();
      if (requestSearchInput) {
        requestSearchInput.value = ip;
        searchQuery = ip;
        renderRequestsList();
        showToast(`Filtered by IP: ${ip}`, "info");
      }
    }
  });

  soundToggleBtn?.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    if (soundIcon)
      soundIcon.className = soundEnabled
        ? "fa-solid fa-bell"
        : "fa-solid fa-bell-slash";
    showToast(
      soundEnabled ? "Audio alerts enabled" : "Audio alerts muted",
      "info",
    );
  });

  btnShortcutsHelp?.addEventListener("click", () => {
    if (modalShortcuts) openModal(modalShortcuts);
  });

  btnCopyCurl?.addEventListener("click", () => {
    const req = allRequests.find((r) => r.id === selectedRequestId);
    if (req)
      copyToClipboard(generateCurl(req), "cURL command copied!", btnCopyCurl);
  });

  btnCopyFetch?.addEventListener("click", () => {
    const req = allRequests.find((r) => r.id === selectedRequestId);
    if (req)
      copyToClipboard(
        generateFetch(req),
        "JavaScript fetch() code copied!",
        btnCopyFetch,
      );
  });

  btnCopyPython?.addEventListener("click", () => {
    const req = allRequests.find((r) => r.id === selectedRequestId);
    if (req)
      copyToClipboard(
        generatePython(req),
        "Python requests script copied!",
        btnCopyPython,
      );
  });

  btnCopyPowershell?.addEventListener("click", () => {
    const req = allRequests.find((r) => r.id === selectedRequestId);
    if (req)
      copyToClipboard(
        generatePowerShell(req),
        "PowerShell Invoke-RestMethod script copied!",
        btnCopyPowershell,
      );
  });

  btnCopyRawHttp?.addEventListener("click", () => {
    const req = allRequests.find((r) => r.id === selectedRequestId);
    if (req)
      copyToClipboard(
        generateRawHttp(req),
        "Raw HTTP request wire format copied!",
        btnCopyRawHttp,
      );
  });

  btnCopyBody?.addEventListener("click", () => {
    const req = allRequests.find((r) => r.id === selectedRequestId);
    if (req && req.body && req.body.raw) {
      copyToClipboard(req.body.raw, "Payload body copied!", btnCopyBody);
    } else {
      showToast("Payload body is empty", "warning");
    }
  });

  btnCopyFullUrl?.addEventListener("click", () => {
    const req = allRequests.find((r) => r.id === selectedRequestId);
    if (req) copyToClipboard(req.url, "Path copied!", btnCopyFullUrl);
  });

  btnDeleteCurrent?.addEventListener("click", () => {
    if (selectedRequestId) deleteRequest(selectedRequestId);
  });

  btnClearAll?.addEventListener("click", clearAllRequests);
  btnExportJson?.addEventListener("click", exportRequestsJson);
  btnTestRequest?.addEventListener("click", openSendTestModal);

  btnCompareModal?.addEventListener("click", () => openCompareModal());
  btnDiffCurrent?.addEventListener("click", () => {
    if (selectedRequestId) openCompareModal(selectedRequestId);
  });

  toggleRawHeadersBtn?.addEventListener("click", () => {
    const isHidden = headersRawContainer.classList.contains("hidden");
    if (isHidden) {
      headersRawContainer.classList.remove("hidden");
      headersTableContainer.classList.add("hidden");
      toggleRawHeadersBtn.innerHTML =
        '<i class="fa-solid fa-table"></i><span>Show Table View</span>';
    } else {
      headersRawContainer.classList.add("hidden");
      headersTableContainer.classList.remove("hidden");
      toggleRawHeadersBtn.innerHTML =
        '<i class="fa-solid fa-code"></i><span>Show Raw Text</span>';
    }
  });

  bodyViewBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      bodyViewBtns.forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-pressed", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-pressed", "true");
      currentBodyView = btn.dataset.bodyView;
      const req = allRequests.find((r) => r.id === selectedRequestId);
      if (req) renderBodyContent(req.body);
    });
  });

  headersFilterInput?.addEventListener("input", () => {
    const req = allRequests.find((r) => r.id === selectedRequestId);
    if (req) renderHeadersTable(req.headers);
  });

  btnCopyAllHeaders?.addEventListener("click", () => {
    const req = allRequests.find((r) => r.id === selectedRequestId);
    if (req && req.headers) {
      copyToClipboard(
        JSON.stringify(req.headers, null, 2),
        "All headers copied as JSON!",
        btnCopyAllHeaders,
      );
    }
  });

  btnResponseSettings?.addEventListener("click", () => {
    if (modalResponseConfig) openModal(modalResponseConfig);
  });
  btnOpenRepeater?.addEventListener("click", openRepeaterModal);

  document.querySelectorAll("[data-close-modal]").forEach((el) => {
    el.addEventListener("click", () => {
      const parentModal = el.closest(".modal-backdrop");
      if (parentModal) closeModal(parentModal);
    });
  });

  document.querySelectorAll(".modal-backdrop").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal(modal);
    });
  });

  btnSaveConfig?.addEventListener("click", saveMockConfig);
  btnSendReplay?.addEventListener("click", executeReplay);

  // URL query parameter deep-linking for screenshots and direct navigation
  const urlParams = new URLSearchParams(window.location.search);
  const targetTab = urlParams.get("tab");
  if (targetTab) {
    setTimeout(() => {
      switchTab(`tab-${targetTab}`);
    }, 250);
  }
  const targetModal = urlParams.get("modal");
  if (targetModal === "mock") {
    setTimeout(() => {
      if (modalResponseConfig) openModal(modalResponseConfig);
    }, 350);
  } else if (targetModal === "repeater") {
    setTimeout(() => {
      openRepeaterModal();
    }, 350);
  }
}

// Mock HTTP Config
async function loadMockConfig() {
  const cfgStatusCode = document.getElementById("cfg-status-code");
  const cfgContentType = document.getElementById("cfg-content-type");
  const cfgDelay = document.getElementById("cfg-delay");
  const cfgBody = document.getElementById("cfg-body");
  const cfgHeaders = document.getElementById("cfg-headers");
  const cfgCors = document.getElementById("cfg-cors");

  try {
    const res = await fetch("/api/config");
    if (res.ok) {
      const cfg = await res.json();
      if (cfgStatusCode) cfgStatusCode.value = cfg.statusCode || 200;
      if (cfgContentType)
        cfgContentType.value = cfg.contentType || "application/json";
      if (cfgDelay) cfgDelay.value = cfg.delayMs || 0;
      if (cfgBody)
        cfgBody.value =
          typeof cfg.responseBody === "string"
            ? cfg.responseBody
            : JSON.stringify(cfg.responseBody, null, 2);
      if (cfgHeaders)
        cfgHeaders.value = JSON.stringify(cfg.customHeaders || {}, null, 2);
      if (cfgCors)
        cfgCors.checked = cfg.autoCors !== undefined ? cfg.autoCors : true;
    }
  } catch (err) {
    console.error("Failed to load mock config", err);
  }
}

async function saveMockConfig() {
  const cfgStatusCode = document.getElementById("cfg-status-code");
  const cfgContentType = document.getElementById("cfg-content-type");
  const cfgDelay = document.getElementById("cfg-delay");
  const cfgBody = document.getElementById("cfg-body");
  const cfgHeaders = document.getElementById("cfg-headers");
  const cfgCors = document.getElementById("cfg-cors");
  const modalResponseConfig = document.getElementById("modal-response-config");

  let customHeaders = {};
  try {
    customHeaders = JSON.parse(cfgHeaders?.value || "{}");
  } catch {
    showToast("Custom Headers must be valid JSON", "error");
    return;
  }

  const payload = {
    statusCode: parseInt(cfgStatusCode?.value || "200", 10),
    contentType: cfgContentType?.value || "application/json",
    delayMs: parseInt(cfgDelay?.value || "0", 10) || 0,
    responseBody: cfgBody?.value || "",
    customHeaders: customHeaders,
    autoCors: cfgCors ? cfgCors.checked : true,
  };

  try {
    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      if (modalResponseConfig) closeModal(modalResponseConfig);
      showToast("Mock response configuration saved successfully!", "success");
    }
  } catch (err) {
    showToast("Failed to save config: " + err.message, "error");
  }
}

// Repeater Logic
function openRepeaterModal() {
  const modalRepeater = document.getElementById("modal-repeater");
  const repMethod = document.getElementById("rep-method");
  const repUrl = document.getElementById("rep-url");
  const repHeaders = document.getElementById("rep-headers");
  const repBody = document.getElementById("rep-body");
  const repResponseSection = document.getElementById("rep-response-section");

  const req = allRequests.find((r) => r.id === selectedRequestId);
  if (!req) {
    showToast("Select a request first to send to repeater", "warning");
    return;
  }

  const activeBaseUrl = getActiveWebhookUrl().replace(/\/capture.*$/, "");
  if (repMethod) repMethod.value = req.method || "GET";
  if (repUrl) repUrl.value = `${activeBaseUrl}${req.url}`;
  if (repHeaders) repHeaders.value = JSON.stringify(req.headers || {}, null, 2);
  if (repBody) repBody.value = req.body?.raw || "";
  if (repResponseSection) repResponseSection.classList.add("hidden");

  if (modalRepeater) openModal(modalRepeater);
}

async function executeReplay() {
  const btnSendReplay = document.getElementById("btn-send-replay");
  const repMethod = document.getElementById("rep-method");
  const repUrl = document.getElementById("rep-url");
  const repHeaders = document.getElementById("rep-headers");
  const repBody = document.getElementById("rep-body");
  const repResponseSection = document.getElementById("rep-response-section");
  const repRespStatus = document.getElementById("rep-resp-status");
  const repRespBody = document.getElementById("rep-resp-body");

  if (btnSendReplay) {
    btnSendReplay.disabled = true;
    btnSendReplay.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin"></i><span>Sending...</span>';
  }

  let headers = {};
  try {
    headers = JSON.parse(repHeaders?.value || "{}");
  } catch {
    showToast("Headers must be valid JSON", "error");
    if (btnSendReplay) {
      btnSendReplay.disabled = false;
      btnSendReplay.innerHTML =
        '<i class="fa-solid fa-paper-plane"></i><span>Send Request</span>';
    }
    return;
  }

  const payload = {
    targetUrl: repUrl?.value.trim() || "",
    method: repMethod?.value || "GET",
    headers: headers,
    body: repBody?.value || "",
  };

  try {
    const res = await fetch("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (repResponseSection) repResponseSection.classList.remove("hidden");
    if (repRespStatus)
      repRespStatus.textContent = `Status: ${result.status || "OK"}`;
    if (repRespBody)
      repRespBody.textContent = result.body || JSON.stringify(result, null, 2);
    showToast("Request repeated successfully!", "success");
  } catch (err) {
    if (repResponseSection) repResponseSection.classList.remove("hidden");
    if (repRespStatus) repRespStatus.textContent = "Error";
    if (repRespBody) repRespBody.textContent = err.message;
    showToast("Replay error: " + err.message, "error");
  } finally {
    if (btnSendReplay) {
      btnSendReplay.disabled = false;
      btnSendReplay.innerHTML =
        '<i class="fa-solid fa-paper-plane"></i><span>Send Request</span>';
    }
  }
}

// Format Utilities
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function escapeHtml(text) {
  if (typeof text !== "string") return String(text || "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", init);
