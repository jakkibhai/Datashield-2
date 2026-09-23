// app.js — talks to the SafeWipe backend over fetch().
// Backend is served from the same origin by server.js, so a relative
// "/api/..." path is all that's needed (no CORS juggling required when
// you run `npm start` inside backend/).
const API_BASE = "/api";

let state = {
  scanMode: "sandbox", // "sandbox" | "folder"
  deviceId: null,
  deviceLabel: null,
  folderPath: null,
  riskScore: null,
  sessionId: null,
  method: "single-pass",
  certificateId: null,
};

// The order of steps, used to figure out which ones are safe to jump back
// to from the stepper nav at the top. You can only navigate to a step
// you've already reached — not skip ahead.
const STEP_ORDER = ["scan", "checklist", "wipe", "certificate", "verify"];
let furthestStepIndex = 0;

const REAL_CHECKLIST = [
  { title: "Sign out of your cloud/account link", body: "Remove Google, Apple ID, or Samsung account from the device settings — this is what actually re-locks it against the next owner." },
  { title: "Turn off Find My / anti-theft lock", body: "If this stays on, the next owner can end up with a device that's permanently locked to your account." },
  { title: "Remove SIM and SD cards", body: "These aren't touched by a factory reset and can carry contacts, texts, or files on their own." },
  { title: "Deauthorize banking and payment apps", body: "Log out of banking apps and remove stored cards from wallet apps before resetting." },
  { title: "Encrypt, then factory reset", body: "On most modern phones and laptops, encrypting first and then doing a factory reset is what actually makes old data unrecoverable." },
  { title: "Confirm the reset actually completed", body: "Power the device back on once and confirm it boots to a setup screen, not your old data." },
];

function setStep(name) {
  document.querySelectorAll(".step").forEach((el) => {
    el.classList.toggle("active", el.dataset.step === name);
  });
}
function markDone(name) {
  document.querySelector(`.step[data-step="${name}"]`).classList.add("done");
}
function showPanel(name) {
  document.querySelectorAll(".panel").forEach((el) => el.classList.add("hidden"));
  document.getElementById(`panel-${name}`).classList.remove("hidden");
  setStep(name);

  const idx = STEP_ORDER.indexOf(name);
  if (idx > furthestStepIndex) furthestStepIndex = idx;
  updateStepperClickability();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Steps you've already reached become clickable in the top nav, so you
// can go back and re-check something without redoing the whole flow.
// You still can't jump AHEAD of where you've actually gotten to.
function updateStepperClickability() {
  document.querySelectorAll(".step").forEach((el) => {
    const idx = STEP_ORDER.indexOf(el.dataset.step);
    el.classList.toggle("clickable", idx <= furthestStepIndex);
  });
}

document.querySelectorAll(".step").forEach((el) => {
  el.addEventListener("click", () => {
    const idx = STEP_ORDER.indexOf(el.dataset.step);
    if (idx <= furthestStepIndex) showPanel(el.dataset.step);
  });
});

/* ================= STEP 1: SCAN ================= */

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".mode-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    const mode = tab.dataset.mode;
    state.scanMode = mode;
    document.getElementById("mode-sandbox").classList.toggle("hidden", mode !== "sandbox");
    document.getElementById("mode-folder").classList.toggle("hidden", mode !== "folder");
    document.getElementById("risk-report").classList.add("hidden");
  });
});

async function loadDevices() {
  const res = await fetch(`${API_BASE}/sandbox/devices`);
  const devices = await res.json();
  const grid = document.getElementById("device-grid");
  grid.innerHTML = "";
  devices.forEach((d) => {
    const card = document.createElement("div");
    card.className = "device-card";
    card.innerHTML = `<div class="device-type">${d.type}</div><div class="device-label">${d.label}</div>`;
    card.addEventListener("click", () => selectDevice(d.id, card));
    grid.appendChild(card);
  });
}

async function selectDevice(id, cardEl) {
  document.querySelectorAll(".device-card").forEach((c) => c.classList.remove("selected"));
  cardEl.classList.add("selected");
  state.deviceId = id;
  state.folderPath = null;

  const res = await fetch(`${API_BASE}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId: id }),
  });
  const report = await res.json();
  if (!res.ok) { alert(report.error || "Scan failed"); return; }

  state.deviceLabel = report.deviceLabel;
  state.riskScore = report.riskScore;
  document.getElementById("risk-sub").textContent = "Simulated exposure score, based on mock device contents";
  renderRiskReport(report);
}

document.getElementById("scan-folder-btn").addEventListener("click", scanFolder);

async function scanFolder() {
  const folderPath = document.getElementById("folder-path-input").value.trim();
  const errBox = document.getElementById("folder-error");
  errBox.classList.add("hidden");
  if (!folderPath) return;

  const res = await fetch(`${API_BASE}/local/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderPath }),
  });
  const report = await res.json();

  if (!res.ok) {
    errBox.textContent = report.error || "Could not scan that folder.";
    errBox.classList.remove("hidden");
    document.getElementById("risk-report").classList.add("hidden");
    return;
  }

  state.deviceId = null;
  state.deviceLabel = `Test folder: ${folderPath}`;
  state.folderPath = report.folderPath;
  state.riskScore = report.riskScore;

  document.getElementById("risk-sub").textContent = `Real scan of ${report.totalFiles} file name(s) — content never read`;
  renderRiskReport(report);
}

function renderRiskReport(report) {
  document.getElementById("risk-report").classList.remove("hidden");
  document.getElementById("risk-score-value").textContent = report.riskScore;
  document.getElementById("risk-level-label").textContent = `${report.riskLevel.toUpperCase()} exposure`;

  const ring = document.getElementById("risk-ring");
  const colorMap = { low: "#52D273", medium: "#F5A623", high: "#FF8C5A", critical: "#FF5C5C" };
  ring.style.borderColor = colorMap[report.riskLevel] || "#3ED6C4";

  const list = document.getElementById("category-list");
  list.innerHTML = "";
  report.categories.forEach((c) => {
    const row = document.createElement("div");
    row.className = "category-row";
    row.innerHTML = `<span>${c.name} <span class="item-count">(${c.items.toLocaleString()} items)</span></span><span class="sensitivity-pill sensitivity-${c.sensitivity}">${c.sensitivity}</span>`;
    list.appendChild(row);
  });
}

document.getElementById("to-checklist").addEventListener("click", () => {
  markDone("scan");
  renderChecklist();
  showPanel("checklist");
});

/* ================= STEP 2: CHECKLIST ================= */
function renderChecklist() {
  const ul = document.getElementById("checklist-items");
  ul.innerHTML = "";
  REAL_CHECKLIST.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<div><span class="item-title">${item.title}</span><span class="item-body">${item.body}</span></div>`;
    ul.appendChild(li);
  });
}

document.getElementById("to-wipe").addEventListener("click", () => {
  markDone("checklist");
  setupWipeStep();
  showPanel("wipe");
});

/* ================= STEP 3: WIPE ================= */

function setupWipeStep() {
  const hasFolder = !!state.folderPath;
  document.getElementById("wipe-tab-real").classList.toggle("hidden", !hasFolder);
  document.getElementById("real-wipe-folder").textContent = state.folderPath || "—";

  // Always reset to the simulated tab when entering this step fresh.
  setWipeMode("simulated");
  document.getElementById("wipe-terminal").classList.add("hidden");
  document.getElementById("to-certificate").classList.add("hidden");
  document.getElementById("start-wipe").disabled = false;
  document.getElementById("real-wipe-confirm").checked = false;
  document.getElementById("start-real-wipe").disabled = true;
}

function setWipeMode(mode) {
  document.querySelectorAll(".wipe-tab").forEach((t) => t.classList.toggle("active", t.dataset.wipeMode === mode));
  document.getElementById("wipe-panel-simulated").classList.toggle("hidden", mode !== "simulated");
  document.getElementById("wipe-panel-real").classList.toggle("hidden", mode !== "real");
}

document.querySelectorAll(".wipe-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    if (tab.classList.contains("hidden")) return;
    setWipeMode(tab.dataset.wipeMode);
  });
});

document.getElementById("real-wipe-confirm").addEventListener("change", (e) => {
  document.getElementById("start-real-wipe").disabled = !e.target.checked;
});

document.getElementById("start-wipe").addEventListener("click", startSimulatedWipe);
document.getElementById("start-real-wipe").addEventListener("click", startRealWipe);

async function startSimulatedWipe() {
  const method = document.querySelector('input[name="method"]:checked').value;
  state.method = method;
  state.wipeWasReal = false;

  document.getElementById("start-wipe").disabled = true;
  document.getElementById("terminal-title").textContent = "safewipe --sandbox";
  document.getElementById("wipe-terminal").classList.remove("hidden");
  const body = document.getElementById("terminal-body");
  body.textContent = `$ safewipe --sandbox --device "${state.deviceLabel}" --method ${method}\n`;

  const res = await fetch(`${API_BASE}/wipe/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceLabel: state.deviceLabel, method }),
  });
  const session = await res.json();
  if (!res.ok) { alert(session.error || "Could not start wipe"); return; }
  state.sessionId = session.sessionId;

  pollSimulatedWipe();
}

function pollSimulatedWipe() {
  const lines = [
    "initializing overwrite pattern…",
    "writing pass 1/N (0x00)…",
    "verifying written blocks…",
    "writing pass 2/N (0xFF)…",
    "writing pass N (random)…",
    "finalizing and re-checking free space…",
  ];
  let lineIdx = 0;

  const interval = setInterval(async () => {
    const res = await fetch(`${API_BASE}/wipe/status/${state.sessionId}`);
    const status = await res.json();

    updateProgressUI(status.progress, status.status);

    if (lineIdx < lines.length && status.progress > (lineIdx * 100) / lines.length) {
      appendTerminalLine(lines[lineIdx]);
      lineIdx++;
    }

    if (status.status === "complete") {
      clearInterval(interval);
      appendTerminalLine("wipe simulation complete.");
      document.getElementById("to-certificate").classList.remove("hidden");
    }
  }, 400);
}

async function startRealWipe() {
  const method = document.querySelector('input[name="real-method"]:checked').value;
  state.method = method;
  state.wipeWasReal = true;

  document.getElementById("start-real-wipe").disabled = true;
  document.getElementById("terminal-title").textContent = "safewipe --REAL --danger";
  document.getElementById("wipe-terminal").classList.remove("hidden");
  const body = document.getElementById("terminal-body");
  body.textContent = `$ safewipe --real --folder "${state.folderPath}" --method ${method}\n`;

  const res = await fetch(`${API_BASE}/local/wipe/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderPath: state.folderPath, method, confirm: true }),
  });
  const session = await res.json();
  if (!res.ok) {
    alert(session.error || "Could not start real wipe");
    document.getElementById("start-real-wipe").disabled = false;
    return;
  }
  state.sessionId = session.sessionId;
  appendTerminalLine(`target has ${session.totalFiles} file(s), ${session.passes} overwrite pass(es) each`);

  pollRealWipe();
}

function pollRealWipe() {
  let lastProgress = -1;
  const interval = setInterval(async () => {
    const res = await fetch(`${API_BASE}/wipe/status/${state.sessionId}`);
    const status = await res.json();

    updateProgressUI(status.progress, status.status);

    if (status.progress !== lastProgress) {
      lastProgress = status.progress;
      appendTerminalLine(`overwriting + unlinking files… ${status.progress}% (${status.totalFiles} total)`);
    }

    if (status.status === "complete") {
      clearInterval(interval);
      appendTerminalLine("real wipe complete — files permanently deleted.");
      document.getElementById("to-certificate").classList.remove("hidden");
    } else if (status.status === "error") {
      clearInterval(interval);
      appendTerminalLine("wipe worker hit an error — check the backend terminal for details.");
    }
  }, 400);
}

function updateProgressUI(progress, status) {
  document.getElementById("progress-fill").style.width = `${progress}%`;
  document.getElementById("progress-pct").textContent = `${progress}%`;
  document.getElementById("progress-status").textContent = status;
}

function appendTerminalLine(text) {
  const body = document.getElementById("terminal-body");
  body.textContent += text + "\n";
  body.scrollTop = body.scrollHeight;
}

document.getElementById("to-certificate").addEventListener("click", async () => {
  markDone("wipe");
  await generateCertificate();
  showPanel("certificate");
});

/* ================= STEP 4: CERTIFICATE ================= */
async function generateCertificate() {
  const res = await fetch(`${API_BASE}/certificate/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: state.sessionId, riskScoreBefore: state.riskScore }),
  });
  const cert = await res.json();
  if (!res.ok) { alert(cert.error || "Could not generate certificate"); return; }

  state.certificateId = cert.certificateId;
  document.getElementById("cert-id").textContent = cert.certificateId;
  document.getElementById("cert-index").textContent = `#${cert.chainIndex} in ledger`;
  document.getElementById("cert-device").textContent = cert.deviceLabel;
  document.getElementById("cert-method").textContent = cert.method;
  document.getElementById("cert-issued").textContent = new Date(cert.issuedAt).toLocaleString();
  document.getElementById("cert-prev-hash").textContent = cert.prevHash;
  document.getElementById("cert-hash").textContent = cert.hash;
  document.getElementById("cert-qr-img").src = cert.qrDataUrl;
  document.getElementById("cert-simulated-flag").textContent = cert.simulated
    ? "SIMULATED WIPE — for demo purposes"
    : "REAL WIPE — files were actually overwritten and deleted";
}

document.getElementById("to-verify").addEventListener("click", () => {
  markDone("certificate");
  document.getElementById("verify-input").value = state.certificateId || "";
  showPanel("verify");
  loadLedger();
});

/* ================= STEP 5: VERIFY ================= */
document.getElementById("verify-btn").addEventListener("click", verifyCertificate);

async function verifyCertificate() {
  const id = document.getElementById("verify-input").value.trim();
  if (!id) return;

  const res = await fetch(`${API_BASE}/certificate/verify/${encodeURIComponent(id)}`);
  const result = await res.json();
  const box = document.getElementById("verify-result");
  box.classList.remove("hidden", "ok", "bad");

  if (!res.ok || !result.valid) {
    box.classList.add("bad");
    box.innerHTML = `<div class="vr-title">✕ Not verifiable</div><div class="vr-row"><span>Reason</span><span>${result.error || "Hash does not match stored record"}</span></div>`;
    return;
  }

  box.classList.add("ok");
  box.innerHTML = `
    <div class="vr-title">✓ Certificate verified</div>
    <div class="vr-row"><span>Device</span><span>${result.deviceLabel}</span></div>
    <div class="vr-row"><span>Method</span><span>${result.method}</span></div>
    <div class="vr-row"><span>Ledger position</span><span>#${result.chainIndex}</span></div>
    <div class="vr-row"><span>Issued</span><span>${new Date(result.issuedAt).toLocaleString()}</span></div>
    <div class="vr-row"><span>Simulated</span><span>${result.simulated ? "yes (demo)" : "no — real wipe"}</span></div>
  `;
}

/* ---- Attacker console: live tamper / restore demo ---- */
document.getElementById("tamper-btn").addEventListener("click", async () => {
  const id = document.getElementById("verify-input").value.trim();
  if (!id) return alert("Paste a certificate ID first.");
  await fetch(`${API_BASE}/certificate/${encodeURIComponent(id)}/demo-tamper`, { method: "POST" });
  await verifyCertificate();
});

document.getElementById("restore-btn").addEventListener("click", async () => {
  const id = document.getElementById("verify-input").value.trim();
  if (!id) return alert("Paste a certificate ID first.");
  await fetch(`${API_BASE}/certificate/${encodeURIComponent(id)}/demo-restore`, { method: "POST" });
  await verifyCertificate();
});

/* ---- Ledger view ---- */
async function loadLedger() {
  const res = await fetch(`${API_BASE}/certificate/chain`);
  const data = await res.json();
  const list = document.getElementById("ledger-list");
  list.innerHTML = "";

  data.chain.forEach((c) => {
    const node = document.createElement("div");
    node.className = "ledger-node";
    node.innerHTML = `
      <div class="ledger-node-index">#${c.chainIndex}</div>
      <div class="ledger-node-body">
        <div class="ledger-node-title">${c.deviceLabel} <span class="ledger-node-flag">${c.simulated ? "simulated" : "real"}</span></div>
        <div class="ledger-node-hash">hash: <span class="mono">${c.hash.slice(0, 16)}…</span></div>
        <div class="ledger-node-hash">prev: <span class="mono">${c.prevHash === "GENESIS" ? "GENESIS" : c.prevHash.slice(0, 16) + "…"}</span></div>
      </div>
    `;
    list.appendChild(node);
  });

  document.getElementById("chain-result").classList.add("hidden");
}

document.getElementById("verify-chain-btn").addEventListener("click", async () => {
  const res = await fetch(`${API_BASE}/certificate/chain/verify`);
  const result = await res.json();
  const box = document.getElementById("chain-result");
  box.classList.remove("hidden", "ok", "bad");

  if (result.valid) {
    box.classList.add("ok");
    box.innerHTML = `<div class="vr-title">✓ Ledger intact — all ${result.length} certificate(s) correctly chained</div>`;
  } else {
    box.classList.add("bad");
    box.innerHTML = `<div class="vr-title">✕ Ledger broken at position #${result.brokenAtIndex}</div><div class="vr-row"><span>Certificate</span><span>${result.brokenCertificateId}</span></div><div class="vr-row"><span>Reason</span><span>${result.reason}</span></div>`;
  }
  loadLedger();
});

/* ================= init ================= */
loadDevices();
updateStepperClickability();
