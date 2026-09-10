const API = "/api";

// ---------------------------------------------------------------- Clerk authentication
let clerk = null; // the Clerk instance, once loaded
const CACHED_USER_KEY = "ledger.cachedUser"; // "login info save" — last-known profile, for instant display on reload

function getCachedUser() {
  try { return JSON.parse(localStorage.getItem(CACHED_USER_KEY) || "null"); }
  catch { return null; }
}
function setCachedUser(user) {
  if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(CACHED_USER_KEY);
}

/** Wraps fetch() so every request to our API carries the signed-in user's
 * Clerk session token, once auth is configured. Falls back to a plain fetch
 * if Clerk isn't loaded/configured (dev mode with no keys set yet). */
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (clerk && clerk.session) {
    try {
      const token = await clerk.session.getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } catch { /* no active session yet */ }
  }
  return fetch(url, { ...options, headers });
}

function showCachedUserBadge() {
  document.getElementById("user-badge").style.display = "flex";
  const cached = getCachedUser();
  let name = "Account";
  let image = "https://ui-avatars.com/api/?name=User&background=cba135&color=fff";
  if (cached) {
    name = cached.name || cached.email || "Signed in";
    if (cached.image_url) image = cached.image_url;
  } else if (clerk && clerk.user) {
    name = clerk.user.fullName || clerk.user.primaryEmailAddress?.emailAddress || "Signed in";
    if (clerk.user.imageUrl) image = clerk.user.imageUrl;
  }
  document.getElementById("user-name").textContent = name;
  document.getElementById("user-avatar").src = image;
  const sidebarName = document.getElementById("sidebar-name");
  const sidebarAvatar = document.getElementById("sidebar-avatar");
  const topbarName = document.getElementById("topbar-name");
  const topbarAvatar = document.getElementById("topbar-avatar");
  if (sidebarName) sidebarName.textContent = name;
  if (sidebarAvatar) sidebarAvatar.src = image;
  if (topbarName) topbarName.textContent = name;
  if (topbarAvatar) topbarAvatar.src = image;
}

function showApp() {
  document.getElementById("auth-gate").style.display = "none";
  document.getElementById("app-shell").style.display = "";
  showCachedUserBadge();
}

function showAuthGate() {
  document.getElementById("auth-gate").style.display = "flex";
  document.getElementById("app-shell").style.display = "none";
}

async function initAuth() {
  showCachedUserBadge(); // instant paint from last session, avoids a flash of "signed out"

  let config;
  try {
    config = await fetch(`${API}/auth/config`).then(r => r.json());
  } catch {
    // Server unreachable — nothing we can do yet; let the user see the sign-in gate.
    showAuthGate();
    return;
  }

  if (!config.authRequired || !config.publishableKey) {
    // Clerk not configured on the server yet — skip the gate so the app stays usable.
    document.getElementById("auth-setup-hint").style.display = "block";
    showApp();
    initApp();
    return;
  }

  const loadClerkScript = () => {
    return new Promise((resolve, reject) => {
      if (window.Clerk) return resolve(window.Clerk);
      let script = document.getElementById("clerk-script");
      if (!script) {
        script = document.createElement("script");
        script.id = "clerk-script";
        script.crossOrigin = "anonymous";
        document.head.appendChild(script);
      }
      script.setAttribute("data-clerk-publishable-key", config.publishableKey);

      const checkClerk = (attempts = 150) => {
        if (window.Clerk) return resolve(window.Clerk);
        if (attempts <= 0) return reject(new Error("Clerk script load timeout"));
        setTimeout(() => checkClerk(attempts - 1), 100);
      };

      if (!script.src) {
        script.onload = () => checkClerk();
        script.onerror = (e) => reject(e);
        script.src = "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
      } else {
        checkClerk();
      }
    });
  };

  document.getElementById("clerk-sign-in").innerHTML =
    `<div class="auth-loading">Loading sign-in…</div>`;

  try {
    clerk = await loadClerkScript();
    if (!clerk.loaded) {
      await clerk.load({ publishableKey: config.publishableKey });
    }
  } catch (e) {
    console.error("Clerk load error:", e);
    document.getElementById("clerk-sign-in").innerHTML =
      `<div class="auth-loading" style="color:var(--accent);">Failed to load Clerk authentication widget. Retrying...</div>`;
    setTimeout(() => window.location.reload(), 3000);
    return;
  }

  const onAuthChange = async () => {
    if (clerk.user) {
      // Save/refresh the local login record on the server ("login info save").
      try {
        const res = await apiFetch(`${API}/auth/sync`, { method: "POST" });
        if (res.ok) {
          const saved = await res.json();
          setCachedUser(saved);
          showCachedUserBadge();
        }
      } catch { /* non-fatal — user can still use the app */ }
      showApp();
      initApp();
    } else {
      setCachedUser(null);
      showAuthGate();
      mountSignIn();
    }
  };

  clerk.addListener(onAuthChange);
  await onAuthChange();
}

function mountSignIn() {
  if (!clerk) return;
  const el = document.getElementById("clerk-sign-in");
  el.innerHTML = "";
  clerk.mountSignIn(el);
}

document.getElementById("sign-out-btn").addEventListener("click", async () => {
  if (clerk) await clerk.signOut();
  setCachedUser(null);
});

// ---------------------------------------------------------------- Tabs & Sidebar Navigation
function activateTab(tabName) {
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  document.getElementById(`tab-${tabName}`)?.classList.add("active");
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.remove("active"));
  document.querySelectorAll(".sidebar-item").forEach(s => s.classList.remove("active"));
  const sidebarLink = document.querySelector(`.sidebar-item[data-tab="${tabName}"]`);
  if (sidebarLink) sidebarLink.classList.add("active");
  const pageTitleMap = {
    "premium-dashboard":"Dashboard",
    "upload":"Ingest Documents",
    "dashboard":"Archive",
    "timeline":"Timeline",
    "graph":"Connections",
    "search":"Retrieve",
    "career":"Career Intelligence",
    "news":"Tech Today",
    "identity":"My Identity"
  };
  const titleEl = document.getElementById("page-title");
  if (titleEl) titleEl.textContent = pageTitleMap[tabName] || "Ledger";
  if (tabName === "dashboard") loadDashboard();
  if (tabName === "timeline") loadTimeline();
  if (tabName === "graph") loadGraph();
  if (tabName === "career") loadCareerProfile();
  if (tabName === "news") loadNews();
  if (tabName === "identity") loadIdentity();
  if (tabName === "premium-dashboard") loadPremiumDashboard();
}

document.querySelectorAll("nav.tabs button").forEach(btn => {
  btn.addEventListener("click", () => activateTab(btn.dataset.tab));
});
document.querySelectorAll(".sidebar-item").forEach(link => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    activateTab(link.dataset.tab);
  });
});

async function refreshTotal() {
  const docs = await apiFetch(`${API}/documents`).then(r => r.json());
  document.getElementById("doc-total").textContent = docs.length;
}

// ---------------------------------------------------------------- Module 1: Ingestion
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
dropzone.addEventListener("click", () => fileInput.click());
["dragover", "dragleave", "drop"].forEach(evt => {
  dropzone.addEventListener(evt, e => {
    e.preventDefault();
    dropzone.classList.toggle("drag", evt === "dragover");
  });
});
dropzone.addEventListener("drop", e => handleFiles(e.dataTransfer.files));
fileInput.addEventListener("change", e => handleFiles(e.target.files));

async function handleFiles(fileList) {
  const log = document.getElementById("upload-log");
  const dateVal = document.getElementById("upload-date").value;
  for (const file of fileList) {
    const line = document.createElement("div");
    line.textContent = `Ingesting ${file.name}…`;
    log.prepend(line);
    const form = new FormData();
    form.append("file", file);
    form.append("doc_date", dateVal);
    try {
      const res = await apiFetch(`${API}/upload`, { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        line.innerHTML = `<span style="color:var(--accent);">&#10007;</span> Failed: ${escapeHtml(file.name)} (${escapeHtml(data.detail || res.statusText)})`;
        continue;
      }
      line.innerHTML = `<span class="ok">&#10003;</span> ${escapeHtml(file.name)} &rarr; classified as <b>${escapeHtml(data.category)}</b>${data.skills.length ? " · " + escapeHtml(data.skills.join(", ")) : ""}`;
    } catch (err) {
      line.innerHTML = `<span style="color:var(--accent);">&#10007;</span> Failed: ${escapeHtml(file.name)} (${escapeHtml(err.message)})`;
    }
  }
  refreshTotal();
  if (typeof loadDashboard === "function") loadDashboard();
}

document.getElementById("link-submit").addEventListener("click", async () => {
  const url = document.getElementById("link-url").value.trim();
  if (!url) return;
  const form = new FormData();
  form.append("url", url);
  form.append("label", document.getElementById("link-label").value);
  form.append("doc_date", document.getElementById("link-date").value);
  const res = await apiFetch(`${API}/upload-link`, { method: "POST", body: form });
  const data = await res.json();
  const log = document.getElementById("upload-log");
  const line = document.createElement("div");
  line.innerHTML = `<span class="ok">&#10003;</span> Linked ${data.title} &rarr; classified as <b>${data.category}</b>`;
  log.prepend(line);
  document.getElementById("link-url").value = "";
  document.getElementById("link-label").value = "";
  refreshTotal();
});

// ---------------------------------------------------------------- Module 2: Dashboard
let activeCategory = null;
async function loadDashboard() {
  const counts = await apiFetch(`${API}/categories`).then(r => r.json());
  const strip = document.getElementById("category-strip");
  strip.innerHTML = "";
  const allChip = makeChip("All", null, Object.values(counts).reduce((a, b) => a + b, 0));
  strip.appendChild(allChip);
  for (const [cat, n] of Object.entries(counts)) {
    strip.appendChild(makeChip(cat, cat, n));
  }
  renderDocs(activeCategory);
}

function makeChip(label, value, count) {
  const chip = document.createElement("button");
  chip.className = "category-chip" + (activeCategory === value ? " active" : "");
  chip.textContent = `${label} (${count})`;
  chip.addEventListener("click", () => { activeCategory = value; loadDashboard(); });
  return chip;
}

async function renderDocs(category) {
  const url = category ? `${API}/documents?category=${encodeURIComponent(category)}` : `${API}/documents`;
  const docs = await apiFetch(url).then(r => r.json());
  const grid = document.getElementById("doc-grid");
  grid.innerHTML = "";
  if (!docs.length) {
    grid.innerHTML = `<div class="empty-state">Nothing here yet — upload something in Ingest.</div>`;
    return;
  }
  for (const d of docs) {
    const card = document.createElement("div");
    card.className = "doc-card";
    card.innerHTML = `
      <div class="doc-card-top">
        <div class="doc-cat">${d.category}${d.doc_date ? " · " + d.doc_date : ""}</div>
        <button class="remove-btn" title="Remove this document" data-id="${d.id}">Remove</button>
      </div>
      <h4>${escapeHtml(d.title || d.original_filename)}</h4>
      <p>${escapeHtml((d.summary || "").replace(/^\[[^\]]*\]\s*/, ""))}</p>
      <div class="skills">${d.skills.map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join("")}</div>
      ${d.has_file ? `<a class="file-link" href="${API}/documents/${d.id}/file" target="_blank">View original file &rarr;</a>` : (d.source_url ? `<a class="file-link" href="${d.source_url}" target="_blank">Open link &rarr;</a>` : "")}
    `;
    card.querySelector(".remove-btn").addEventListener("click", () => removeDocument(d.id, card));
    grid.appendChild(card);
  }
}

async function removeDocument(id, cardEl) {
  if (!confirm("Remove this document? This deletes the stored file too and can't be undone.")) return;
  try {
    const res = await apiFetch(`${API}/documents/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.detail || "Couldn't remove the document.");
      return;
    }
    cardEl.remove();
    refreshTotal();
    loadDashboard();
  } catch (e) {
    alert("Couldn't reach the server to remove the document.");
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------------------------------------------------------------- Module 4: Timeline
async function loadTimeline() {
  const data = await apiFetch(`${API}/timeline`).then(r => r.json());
  const el = document.getElementById("timeline");
  el.innerHTML = "";
  if (!data.length) {
    el.innerHTML = `<div class="empty-state">No dated documents yet. Add a date on upload to place items on the timeline.</div>`;
    return;
  }
  for (const yearBlock of data) {
    const block = document.createElement("div");
    block.className = "timeline-year";
    block.innerHTML = `<div class="year-label">${yearBlock.year}</div>
      <div class="timeline-events">${yearBlock.events.map(e =>
        `<div class="timeline-event"><span class="tcat">${e.category}</span>${escapeHtml(e.label)}</div>`
      ).join("")}</div>`;
    el.appendChild(block);
  }
}

// ---------------------------------------------------------------- Module 3: Graph (simple force layout on canvas)
async function loadGraph() {
  const data = await apiFetch(`${API}/graph`).then(r => r.json());
  const canvas = document.getElementById("graph-canvas");
  const parent = canvas.parentElement;
  canvas.width = parent.clientWidth;
  canvas.height = 560;
  const ctx = canvas.getContext("2d");

  if (!data.nodes.length) {
    ctx.fillStyle = "#7d8792";
    ctx.font = "13px monospace";
    ctx.fillText("Upload a few documents to see how they connect.", 20, 30);
    return;
  }

  const nodes = data.nodes.map(n => ({
    ...n,
    x: canvas.width / 2 + (Math.random() - 0.5) * 300,
    y: canvas.height / 2 + (Math.random() - 0.5) * 300,
    vx: 0, vy: 0,
  }));
  const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const edges = data.edges.filter(e => idx[e.from] !== undefined && idx[e.to] !== undefined);

  function simulate() {
    // repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let dist2 = dx * dx + dy * dy || 0.01;
        const force = 2200 / dist2;
        const d = Math.sqrt(dist2);
        dx /= d; dy /= d;
        a.vx += dx * force; a.vy += dy * force;
        b.vx -= dx * force; b.vy -= dy * force;
      }
    }
    // attraction along edges
    for (const e of edges) {
      const a = nodes[idx[e.from]], b = nodes[idx[e.to]];
      const dx = b.x - a.x, dy = b.y - a.y;
      a.vx += dx * 0.02; a.vy += dy * 0.02;
      b.vx -= dx * 0.02; b.vy -= dy * 0.02;
    }
    // center pull + integrate
    for (const n of nodes) {
      n.vx += (canvas.width / 2 - n.x) * 0.002;
      n.vy += (canvas.height / 2 - n.y) * 0.002;
      n.vx *= 0.8; n.vy *= 0.8;
      n.x += n.vx; n.y += n.vy;
      n.x = Math.max(24, Math.min(canvas.width - 24, n.x));
      n.y = Math.max(24, Math.min(canvas.height - 24, n.y));
    }
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "rgba(216,208,189,0.25)";
    ctx.lineWidth = 1;
    for (const e of edges) {
      const a = nodes[idx[e.from]], b = nodes[idx[e.to]];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const n of nodes) {
      ctx.beginPath();
      ctx.fillStyle = n.type === "skill" ? "#5b8cff" : "#d9a441";
      const r = n.type === "skill" ? 6 : 8;
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "11px 'IBM Plex Mono', monospace";
      ctx.fillStyle = "#e9e5d8";
      ctx.fillText(n.label.length > 22 ? n.label.slice(0, 20) + "…" : n.label, n.x + r + 4, n.y + 3);
    }
  }

  let ticks = 0;
  const iv = setInterval(() => {
    simulate();
    draw();
    ticks++;
    if (ticks > 220) clearInterval(iv);
  }, 20);
}

// ---------------------------------------------------------------- Module 5: Search
async function runSearch() {
  const q = document.getElementById("search-input").value.trim();
  const box = document.getElementById("search-results");
  if (!q) { box.innerHTML = ""; return; }
  const results = await apiFetch(`${API}/search?q=${encodeURIComponent(q)}`).then(r => r.json());
  if (!results.length) {
    box.innerHTML = `<div class="empty-state">No matches. Try a broader term ("certificate", "python", "internship")…</div>`;
    return;
  }
  box.innerHTML = results.map(r => `
    <div class="result-item">
      <span class="rel">match ${(r.relevance * 100).toFixed(0)}%</span>
      <div class="doc-cat" style="font-family:'IBM Plex Mono',monospace;font-size:10.5px;color:#b8863f;text-transform:uppercase;">${r.category}${r.doc_date ? " · " + r.doc_date : ""}</div>
      <h4 style="font-family:'Source Serif 4',serif;margin:6px 0 6px;">${escapeHtml(r.title)}</h4>
      <p style="font-size:12.5px;color:#b7bec6;margin:0 0 8px;">${escapeHtml((r.summary || "").replace(/^\[[^\]]*\]\s*/, ""))}</p>
      ${r.has_file ? `<a class="file-link" href="${API}/documents/${r.id}/file" target="_blank">View original file &rarr;</a>` : (r.source_url ? `<a class="file-link" href="${r.source_url}" target="_blank">Open link &rarr;</a>` : "")}
    </div>
  `).join("");
}
document.getElementById("search-btn").addEventListener("click", runSearch);
document.getElementById("search-input").addEventListener("keydown", e => { if (e.key === "Enter") runSearch(); });

// ---------------------------------------------------------------- Career Intelligence Engine
async function loadCareerProfile() {
  try {
    const res = await apiFetch(`${API}/career/profile`);
    if (res.status === 404) { showCareerEmpty(); return; }
    const report = await res.json();
    renderCareerReport(report);
  } catch (e) {
    showCareerEmpty();
  }
}

function showCareerEmpty() {
  document.getElementById("career-empty").style.display = "block";
  document.getElementById("career-content").style.display = "none";
}

document.getElementById("career-run-btn").addEventListener("click", async () => {
  const btn = document.getElementById("career-run-btn");
  const empty = document.getElementById("career-empty");
  btn.textContent = "Analyzing…";
  btn.disabled = true;
  empty.style.display = "block";
  empty.textContent = "Reading your archive and generating a fresh career report…";
  try {
    const res = await apiFetch(`${API}/career/analyze`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      empty.textContent = `Couldn't run the analysis: ${data.detail || "unknown error"}`;
    } else {
      renderCareerReport(data);
    }
  } catch (e) {
    empty.textContent = "Couldn't reach the server to run the analysis.";
  }
  btn.textContent = "Run career analysis";
  btn.disabled = false;
});

function renderCareerReport(report) {
  document.getElementById("career-empty").style.display = "none";
  document.getElementById("career-content").style.display = "block";

  if (report._meta) {
    const meta = report._meta;
    const stale = meta.current_document_count !== meta.document_count_at_analysis;
    document.getElementById("career-meta").textContent =
      `Generated ${new Date(meta.generated_at).toLocaleString()} · based on ${meta.document_count_at_analysis} documents` +
      (stale ? " · new documents added since — re-run for a fresh read" : "");
  }

  document.getElementById("score-readiness").textContent = report.career_readiness_score ?? "--";
  document.getElementById("score-resume").textContent = report.resume_analysis?.ats_score ?? "--";
  document.getElementById("score-portfolio").textContent = report.portfolio_analysis?.score ?? "--";

  // Career matches
  const matchesEl = document.getElementById("career-matches");
  matchesEl.innerHTML = (report.career_matches || []).map(m => `
    <div class="match-card">
      <div class="match-head">
        <h4>${escapeHtml(m.role)}<span class="match-confidence">${escapeHtml(m.confidence || "")} confidence</span></h4>
        <div class="match-score">${m.match_score}%</div>
      </div>
      <div class="match-why">${escapeHtml(m.why_it_fits || "")}</div>
      <div class="match-row"><b>Strengths</b>${(m.strengths || []).map(escapeHtml).join(", ")}</div>
      <div class="match-row"><b>Missing</b>${(m.missing_skills || []).map(escapeHtml).join(", ") || "—"}</div>
      ${(m.roadmap || []).length ? `<div class="match-row"><b>Roadmap</b></div><ul class="roadmap-list">${
        m.roadmap.map(r => `<li>${escapeHtml(r.step)} <i>(${escapeHtml(r.estimated_time || "")}, ${escapeHtml(r.difficulty || "")})</i></li>`).join("")
      }</ul>` : ""}
      <div class="match-meta-strip">
        <span>Salary: ${escapeHtml(m.salary_range_estimate || "n/a")}</span>
        <span>Demand: ${escapeHtml(m.market_demand || "n/a")}</span>
        <span>Outlook: ${escapeHtml(m.growth_outlook || "n/a")}</span>
      </div>
    </div>
  `).join("") || `<div class="empty-state">No matches generated.</div>`;

  // Skill gap
  const gap = report.skill_gap || {};
  document.getElementById("skill-gap").innerHTML = `
    <div class="gap-cols">
      <div class="gap-col">
        <h5>Current skills</h5>
        ${(gap.current_skills || []).map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join(" ") || "—"}
      </div>
      <div class="gap-col missing">
        <h5>Missing skills</h5>
        ${(gap.missing_skills || []).map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join(" ") || "—"}
      </div>
    </div>
    ${(gap.prioritized_learning_path || []).length ? `<h5 style="margin-top:16px;font-family:'IBM Plex Mono',monospace;font-size:11px;text-transform:uppercase;color:#9aa3ad;">Prioritized path</h5><ol class="roadmap-list">${
      gap.prioritized_learning_path.map(s => `<li>${escapeHtml(s)}</li>`).join("")
    }</ol>` : ""}
  `;

  // Resume review
  const ra = report.resume_analysis || {};
  document.getElementById("resume-review").innerHTML = `
    <div class="match-meta-strip" style="margin-bottom:10px;">
      <span>Completeness: ${ra.completeness ?? "n/a"}%</span>
      <span>Skill coverage: ${ra.skill_coverage ?? "n/a"}%</span>
      <span>Keyword optimization: ${ra.keyword_optimization ?? "n/a"}%</span>
    </div>
    ${(ra.missing_sections || []).length ? `<div class="match-row"><b>Missing sections</b>${ra.missing_sections.map(escapeHtml).join(", ")}</div>` : ""}
    ${(ra.suggestions || []).length ? `<ul class="roadmap-list">${ra.suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : ""}
  `;

  // Future timeline
  const tlEl = document.getElementById("career-timeline");
  tlEl.innerHTML = (report.future_timeline || []).map(e => `
    <div class="timeline-year">
      <div class="year-label">${escapeHtml(e.year)}</div>
      <div class="timeline-events"><div class="timeline-event">${escapeHtml(e.milestone)}</div></div>
    </div>
  `).join("") || `<div class="empty-state">No future milestones generated.</div>`;

  // Insights
  document.getElementById("career-insights").innerHTML = `
    <ul class="roadmap-list">${(report.insights || []).map(i => `<li>${escapeHtml(i)}</li>`).join("")}</ul>
  ` || `<div class="empty-state">No insights generated.</div>`;
}

// Job match
document.getElementById("job-match-btn").addEventListener("click", async () => {
  const jd = document.getElementById("job-desc-input").value.trim();
  const resultEl = document.getElementById("job-match-result");
  if (!jd) return;
  resultEl.innerHTML = `<div class="empty-state">Comparing against the job description…</div>`;
  const form = new FormData();
  form.append("job_description", jd);
  const res = await apiFetch(`${API}/career/job-match`, { method: "POST", body: form });
  const data = await res.json();
  if (!res.ok) {
    resultEl.innerHTML = `<div class="empty-state">${escapeHtml(data.detail || "Couldn't complete the match.")}</div>`;
    return;
  }
  resultEl.innerHTML = `
    <div class="match-row"><b>Match</b>${data.match_percentage}%</div>
    <div class="match-row"><b>Matching skills</b>${(data.matching_skills || []).map(escapeHtml).join(", ") || "—"}</div>
    <div class="match-row"><b>Missing skills</b>${(data.missing_skills || []).map(escapeHtml).join(", ") || "—"}</div>
    ${(data.strengths_for_this_role || []).length ? `<div class="match-row"><b>Strengths</b>${data.strengths_for_this_role.map(escapeHtml).join(", ")}</div>` : ""}
    ${(data.resume_suggestions || []).length ? `<ul class="roadmap-list">${data.resume_suggestions.map(s => `<li>${escapeHtml(s)}</li>`).join("")}</ul>` : ""}
  `;
});

// Copilot
async function sendCopilotMessage() {
  const input = document.getElementById("copilot-input");
  const q = input.value.trim();
  if (!q) return;
  const log = document.getElementById("copilot-log");
  log.innerHTML += `<div class="copilot-msg user">${escapeHtml(q)}</div>`;
  input.value = "";
  const thinkingId = "thinking-" + Date.now();
  log.innerHTML += `<div class="copilot-msg bot" id="${thinkingId}">…</div>`;
  log.scrollTop = log.scrollHeight;
  const form = new FormData();
  form.append("question", q);
  try {
    const res = await apiFetch(`${API}/career/copilot`, { method: "POST", body: form });
    const data = await res.json();
    document.getElementById(thinkingId).textContent = res.ok ? data.answer : (data.detail || "Something went wrong.");
  } catch (e) {
    document.getElementById(thinkingId).textContent = "Couldn't reach the server.";
  }
  log.scrollTop = log.scrollHeight;
}
document.getElementById("copilot-send").addEventListener("click", sendCopilotMessage);
document.getElementById("copilot-input").addEventListener("keydown", e => { if (e.key === "Enter") sendCopilotMessage(); });

// Global AI Widget
const aiWidgetToggle = document.getElementById("ai-widget-toggle");
const aiWidgetPanel = document.getElementById("ai-widget-panel");
const aiWidgetClose = document.getElementById("ai-widget-close");
const aiWidgetLog = document.getElementById("ai-widget-log");
const aiWidgetInput = document.getElementById("ai-widget-input");
const aiWidgetSend = document.getElementById("ai-widget-send");
if (aiWidgetToggle && aiWidgetPanel) {
  aiWidgetToggle.addEventListener("click", () => aiWidgetPanel.classList.toggle("open"));
  if (aiWidgetClose) aiWidgetClose.addEventListener("click", () => aiWidgetPanel.classList.remove("open"));
  async function sendAiWidgetMessage() {
    const q = aiWidgetInput.value.trim();
    if (!q) return;
    aiWidgetLog.innerHTML += `<div class="copilot-msg user">${escapeHtml(q)}</div>`;
    aiWidgetInput.value = "";
    const thinkingId = "ai-thinking-" + Date.now();
    aiWidgetLog.innerHTML += `<div class="copilot-msg bot" id="${thinkingId}">…</div>`;
    aiWidgetLog.scrollTop = aiWidgetLog.scrollHeight;
    const form = new FormData();
    form.append("question", q);
    try {
      const res = await apiFetch(`${API}/career/copilot`, { method: "POST", body: form });
      const data = await res.json();
      document.getElementById(thinkingId).textContent = res.ok ? data.answer : (data.detail || "Something went wrong.");
    } catch (e) {
      document.getElementById(thinkingId).textContent = "Couldn't reach the server.";
    }
    aiWidgetLog.scrollTop = aiWidgetLog.scrollHeight;
  }
  aiWidgetSend.addEventListener("click", sendAiWidgetMessage);
  aiWidgetInput.addEventListener("keydown", e => { if (e.key === "Enter") sendAiWidgetMessage(); });
}

// ---------------------------------------------------------------- World Tech News
let activeNewsCategory = "All";
let activeNewsSearch = "";
let newsLoading = false;

function timeAgo(date) {
  const now = new Date();
  const diff = Math.floor((now - new Date(date)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

async function loadNews() {
  if (newsLoading) return;
  newsLoading = true;
  const statusEl = document.getElementById("news-status");
  const grid = document.getElementById("news-grid");
  const personalized = document.getElementById("news-personalized");
  const personalizedContent = document.getElementById("news-personalized-content");
  const newTechSec = document.getElementById("news-new-tech");
  const newTechContent = document.getElementById("news-new-tech-content");
  const evolutionSec = document.getElementById("news-evolution");
  const evolutionContent = document.getElementById("news-evolution-content");
  const lastUpdatedEl = document.getElementById("news-last-updated");
  const newsTotalEl = document.getElementById("news-total");
  const newsLastSyncedEl = document.getElementById("news-last-synced");
  const featuredSec = document.getElementById("news-featured");
  const featuredContent = document.getElementById("news-featured-content");
  const refreshSpinner = document.getElementById("news-refresh-spinner");
  if (refreshSpinner) refreshSpinner.style.display = "inline";
  statusEl.style.display = "none";
  grid.innerHTML = `<div class="empty-state">Loading news…</div>`;
  personalized.style.display = "none";
  newTechSec.style.display = "none";
  evolutionSec.style.display = "none";
  if (featuredSec) featuredSec.style.display = "none";

  try {
    const params = new URLSearchParams();
    params.set("category", activeNewsCategory);
    if (activeNewsSearch) params.set("search", activeNewsSearch);
    const res = await apiFetch(`${API}/news?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.message || "Failed to load news";
      statusEl.style.display = "block";
      grid.innerHTML = "";
      return;
    }
    if (data.source_status === "error") {
      statusEl.textContent = data.message || "News source unavailable. Configure NEWS_RSS_URLS or check internet connection.";
      statusEl.style.display = "block";
      grid.innerHTML = "";
      return;
    }
    let articles = data.articles || [];
    const userSkills = data.user_skills || [];

    // Sort by publication date newest first
    articles.sort((a,b) => {
      const da = new Date(a.pub_date || 0).getTime();
      const db = new Date(b.pub_date || 0).getTime();
      return db - da;
    });

    // Update header metadata
    if (newsTotalEl) {
      const total = data.total_articles || articles.length;
      newsTotalEl.textContent = `${total} articles`;
    }
    const resultsCountEl = document.getElementById("news-results-count");
    if (resultsCountEl) {
      resultsCountEl.textContent = `${articles.length} results`;
    }
    if (lastUpdatedEl) {
      const lu = data.last_updated ? new Date(data.last_updated) : new Date();
      const rel = timeAgo(lu);
      lastUpdatedEl.textContent = `Updated ${rel}`;
    }
    if (newsLastSyncedEl) {
      if (data.last_updated) {
        newsLastSyncedEl.textContent = new Date(data.last_updated).toLocaleString();
      }
    }
    // Featured article
    if (featuredSec && articles.length) {
      const featured = articles[0];
      featuredSec.style.display = "block";
      featuredContent.innerHTML = renderFeaturedCard(featured);
    } else if (featuredSec) {
      featuredSec.style.display = "none";
    }

    // Fetch user's project documents for linking
    let projects = [];
    try {
      const projRes = await apiFetch(`${API}/documents?category=Project`);
      if (projRes.ok) projects = await projRes.json();
    } catch {}

    // Enrich articles with related project
    articles.forEach(a => {
      if (a.related_skills && a.related_skills.length && projects.length) {
        const match = projects.find(p => 
          p.skills && p.skills.some(s => a.related_skills.includes(s))
        );
        a.related_project = match ? match.title || match.original_filename : null;
      }
    });

    // New Technologies & Innovations section
    const newTechArticles = articles.filter(a => {
      const title = (a.title || "").toLowerCase();
      const cat = (a.category || "").toLowerCase();
      const isEmerging = cat === "emerging technologies";
      const isNew = /\b(new|launch|announce|release|unveil|introduce)\b/.test(title);
      return isEmerging || isNew;
    });
    if (newTechArticles.length) {
      newTechSec.style.display = "block";
      newTechContent.innerHTML = newTechArticles.slice(0, 6).map(a => renderNewsCard(a, false)).join("");
    }

    // Personalized section
    const personalizedArticles = articles.filter(a => a.is_personalized);
    if (personalizedArticles.length && userSkills.length) {
      personalized.style.display = "block";
      personalizedContent.innerHTML = personalizedArticles.slice(0, 3).map(a => renderNewsCard(a, true)).join("");
    }

    // Technology Evolution / Latest Developments grouped by category
    if (articles.length) {
      evolutionSec.style.display = "block";
      const byCat = {};
      articles.forEach(a => {
        const cat = a.category || "General";
        if (!byCat[cat]) byCat[cat] = [];
        byCat[cat].push(a);
      });
      let evolutionHtml = "";
      Object.entries(byCat).slice(0, 6).forEach(([cat, arts]) => {
        const top = arts.slice(0, 3);
        evolutionHtml += `<div class="evolution-group"><div class="evolution-cat">${escapeHtml(cat)}</div><div class="evolution-list">${top.map(a => `<div class="evolution-item"><a href="${escapeHtml(a.link)}" target="_blank">${escapeHtml(a.title)}</a><span class="evolution-date">${a.pub_date ? new Date(a.pub_date).toLocaleDateString() : ""}</span></div>`).join("")}</div></div>`;
      });
      evolutionContent.innerHTML = evolutionHtml;
    }

    // All articles grid
    if (!articles.length) {
      grid.innerHTML = `<div class="empty-state">No news articles found for this filter.</div>`;
    } else {
      grid.innerHTML = articles.map(a => renderNewsCard(a, false)).join("");
    }
  } catch (e) {
    statusEl.textContent = "Couldn't reach the server to load news.";
    statusEl.style.display = "block";
    grid.innerHTML = "";
  } finally {
    newsLoading = false;
    if (refreshSpinner) refreshSpinner.style.display = "none";
  }
}

function renderNewsCard(article, isPersonalized) {
  const skillsHtml = article.related_skills && article.related_skills.length
    ? `<div class="news-skills">Related to your skill: ${article.related_skills.map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join("")}</div>`
    : "";
  const whyHtml = isPersonalized && article.related_skills && article.related_skills.length
    ? `<div class="news-why">Why relevant: This topic matches your ${escapeHtml(article.related_skills[0])} skill.</div>`
    : "";
  const projectHtml = article.related_project
    ? `<div class="news-project">Related Project: ${escapeHtml(article.related_project)}</div>`
    : "";
  const dateStr = article.pub_date ? new Date(article.pub_date).toLocaleDateString() : "";
  const relTime = article.pub_date ? timeAgo(article.pub_date) : "";
  return `
    <div class="doc-card news-card ${isPersonalized ? 'personalized' : ''}">
      <div class="doc-card-top">
        <div class="doc-cat">${escapeHtml(article.category || "General")}${dateStr ? " · " + dateStr : ""}</div>
        <div class="news-source">${escapeHtml(article.source || "")}</div>
      </div>
      <h4>${escapeHtml(article.title)}</h4>
      <p>${escapeHtml(article.summary || "")}</p>
      ${skillsHtml}
      ${projectHtml}
      ${whyHtml}
      ${relTime ? `<div class="news-time">${relTime}</div>` : ""}
      <a class="file-link" href="${escapeHtml(article.link)}" target="_blank">Read full article &rarr;</a>
    </div>
  `;
}

function renderFeaturedCard(article) {
  const dateStr = article.pub_date ? new Date(article.pub_date).toLocaleString() : "";
  const relTime = article.pub_date ? timeAgo(article.pub_date) : "";
  const img = article.image ? `<img src="${escapeHtml(article.image)}" alt="" class="news-featured-img" onerror="this.style.display='none'">` : `<div class="news-featured-placeholder">${escapeHtml(article.category||'Tech')}</div>`;
  const skills = article.related_skills && article.related_skills.length ? article.related_skills.map(s => `<span class="skill-tag">${escapeHtml(s)}</span>`).join("") : "";
  return `
    <div class="news-featured-card">
      <div class="news-featured-media">${img}</div>
      <div class="news-featured-body">
        <div class="news-featured-meta">
          <span class="doc-cat">${escapeHtml(article.category || "General")}</span>
          <span class="news-source">${escapeHtml(article.source || "")}</span>
          <span>${relTime}</span>
        </div>
        <h3>${escapeHtml(article.title)}</h3>
        <p>${escapeHtml(article.summary || "")}</p>
        ${skills ? `<div class="news-skills">Related skills: ${skills}</div>` : ""}
        ${article.related_skills && article.related_skills.length ? `<div class="news-why">Why this matters: This topic matches your ${escapeHtml(article.related_skills[0])} skill.</div>` : ""}
        <a class="primary" href="${escapeHtml(article.link)}" target="_blank">Read full article</a>
      </div>
    </div>
  `;
}

// Category chips
document.querySelectorAll("#news-categories .category-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#news-categories .category-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    activeNewsCategory = chip.dataset.cat;
    loadNews();
  });
});

// Search
const newsSearchInput = document.getElementById("news-search");
const newsSearchClear = document.getElementById("news-search-clear");
document.getElementById("news-search-btn").addEventListener("click", () => {
  activeNewsSearch = newsSearchInput.value.trim();
  loadNews();
});
if (newsSearchClear) {
  newsSearchClear.addEventListener("click", () => {
    newsSearchInput.value = "";
    activeNewsSearch = "";
    if (newsSearchClear) newsSearchClear.style.display = "none";
    loadNews();
  });
}
newsSearchInput?.addEventListener("input", () => {
  if (newsSearchClear) newsSearchClear.style.display = newsSearchInput.value ? "inline-block" : "none";
});
newsSearchInput?.addEventListener("keydown", e => {
  if (e.key === "Enter") {
    activeNewsSearch = newsSearchInput.value.trim();
    loadNews();
  }
});

// Refresh button and auto-refresh
const newsRefreshBtn = document.getElementById("news-refresh-btn");
if (newsRefreshBtn) {
  newsRefreshBtn.addEventListener("click", () => {
    loadNews();
  });
}
// Auto-refresh every 10 minutes to align with backend 10-minute cache
// Avoid duplicate intervals
let newsAutoInterval;
function startNewsAutoRefresh() {
  if (newsAutoInterval) return;
  newsAutoInterval = setInterval(() => {
    // Only refresh if news tab is visible to avoid unnecessary requests
    const newsPanel = document.getElementById("tab-news");
    if (newsPanel && getComputedStyle(newsPanel).display !== "none") {
      loadNews();
    }
  }, 10 * 60 * 1000);
}
document.addEventListener("DOMContentLoaded", startNewsAutoRefresh);

// ---------------------------------------------------------------- Identity Dashboard
async function loadIdentity() {
  const container = document.getElementById("identity-summary");
  container.innerHTML = `<div class="empty-state">Loading identity…</div>`;
  try {
    const data = await apiFetch(`${API}/identity`).then(r => r.json());
    // Summary
    document.getElementById("identity-summary").innerHTML = `
      <h3 style="margin-top:0;font-family:var(--font-display);">Identity Summary</h3>
      <p style="font-size:14px;line-height:1.6;color:#d8d0bd;">${escapeHtml(data.summary)}</p>
    `;
    // Statistics
    const stats = data.statistics || {};
    document.getElementById("identity-stats").innerHTML = `
      <div class="card" style="margin:18px 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;">
        <div><b>${stats.total_documents||0}</b><div class="field-label" style="font-size:11px;">Documents</div></div>
        <div><b>${stats.total_skills||0}</b><div class="field-label" style="font-size:11px;">Skills</div></div>
        <div><b>${stats.total_projects||0}</b><div class="field-label" style="font-size:11px;">Projects</div></div>
        <div><b>${stats.total_certifications||0}</b><div class="field-label" style="font-size:11px;">Certifications</div></div>
        <div><b>${stats.total_internships||0}</b><div class="field-label" style="font-size:11px;">Internships</div></div>
        <div><b>${stats.total_achievements||0}</b><div class="field-label" style="font-size:11px;">Achievements</div></div>
      </div>
    `;
    // Helper to render doc grids
    function renderDocGrid(targetId, docs) {
      const el = document.getElementById(targetId);
      if (!docs || !docs.length) {
        el.innerHTML = `<div class="empty-state">No items yet.</div>`;
        return;
      }
      el.innerHTML = docs.map(d => `
        <div class="doc-card">
          <div class="doc-cat">${escapeHtml(d.category)}${d.doc_date? ' · '+escapeHtml(d.doc_date):''}</div>
          <h4>${escapeHtml(d.title||d.original_filename)}</h4>
          <p>${escapeHtml((d.summary||'').replace(/^\[[^\]]*\]\s*/,''))}</p>
          <div class="skills">${(d.skills||[]).map(s=>`<span class="skill-tag">${escapeHtml(s)}</span>`).join('')}</div>
        </div>
      `).join('');
    }
    renderDocGrid('identity-education', data.education);
    renderDocGrid('identity-projects', data.projects);
    renderDocGrid('identity-certifications', data.certifications);
    renderDocGrid('identity-internships', data.internships);
    renderDocGrid('identity-achievements', data.achievements);

    // Skills list
    const skillsEl = document.getElementById('identity-skills');
    if (data.skills && data.skills.length) {
      skillsEl.innerHTML = data.skills.map(s=>`<span class="skill-tag">${escapeHtml(s.name)} <small>(${s.count})</small></span>`).join(' ');
    } else {
      skillsEl.innerHTML = `<div class="empty-state">No skills extracted yet.</div>`;
    }

    // Skill evidence
    const evidenceEl = document.getElementById('identity-skill-evidence');
    if (data.skill_evidence && data.skill_evidence.length) {
      evidenceEl.innerHTML = data.skill_evidence.map(ev => `
        <div class="card" style="margin-bottom:12px;">
          <h4 style="margin:0 0 8px;font-family:var(--font-mono);text-transform:uppercase;font-size:12px;color:var(--gold-bright);">${escapeHtml(ev.skill)}</h4>
          <ul style="margin:0 0 0 18px;padding:0;">
            ${ev.evidence.map(e=>`<li><b>${escapeHtml(e.category)}</b> – ${escapeHtml(e.title)}</li>`).join('')}
          </ul>
        </div>
      `).join('');
    } else {
      evidenceEl.innerHTML = `<div class="empty-state">No skill evidence yet.</div>`;
    }

    // Connections summary (reuse graph nodes count)
    const conn = data.connections || {nodes:[], edges:[]};
    document.getElementById('identity-connections').innerHTML = `
      <p style="margin-top:0;">${conn.nodes.length} entities, ${conn.edges.length} connections.</p>
      <p style="font-size:12px;color:#9aa3ad;">Identity connections are derived from your existing knowledge graph linking documents and skills.</p>
    `;
  } catch (e) {
    document.getElementById("identity-summary").innerHTML = `<div class="empty-state">Could not load identity data.</div>`;
  }
}

// ---------------------------------------------------------------- Premium Dashboard
async function loadPremiumDashboard() {
  const greetingEl = document.getElementById('dash-greeting');
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const cached = getCachedUser() || {};
  let userName = cached.name || cached.email || 'there';
  if (clerk && clerk.user) {
    userName = clerk.user.fullName || clerk.user.primaryEmailAddress?.emailAddress || userName;
  }
  greetingEl.textContent = `${greet}, ${escapeHtml(userName)}`;
  document.getElementById('dash-updated').textContent = 'Last updated — ' + new Date().toLocaleTimeString();

  try {
    const data = await apiFetch(`${API}/dashboard`).then(r => r.json());
    const stats = data.stats || {};
    const statsHtml = `
      <div class="card" style="grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;">
        ${[
          {label:'Total Documents', value: stats.total_documents||0, action:'dashboard'},
          {label:'Verified Skills', value: stats.total_skills||0, action:'dashboard'},
          {label:'Projects', value: stats.projects_completed||0, action:'dashboard'},
          {label:'Internships & Certs', value: stats.internships_certifications||0, action:'dashboard'},
          {label:'Achievements', value: stats.achievements||0, action:'dashboard'},
          {label:'Relationships', value: stats.relationships||0, action:'graph'}
        ].map(s=>`
          <div class="card" style="padding:16px;cursor:pointer;" onclick="document.querySelector('[data-tab=\\'${s.action}\\']').click()">
            <div style="font-size:28px;font-family:var(--font-display);">${s.value}</div>
            <div style="font-family:var(--font-mono);font-size:11px;text-transform:uppercase;color:#9aa3ad;">${s.label}</div>
          </div>
        `).join('')}
      </div>
    `;
    document.getElementById('dash-stats').innerHTML = statsHtml;

    // Identity overview
    const id = data.identity || {};
    const completeness = id.completeness || 0;
    document.getElementById('dash-identity-overview').innerHTML = `
      <p><b>Name:</b> ${escapeHtml(user.name || '—')}</p>
      <p><b>Documents:</b> ${id.document_count||0} &nbsp; <b>Skills:</b> ${id.skill_count||0}</p>
      <p><b>Education records:</b> ${id.education_count||0}</p>
      <p><b>Profile completeness:</b> ${completeness}%</p>
      <div style="width:100%;height:8px;background:#2a2f38;border-radius:4px;overflow:hidden;margin-top:8px;">
        <div style="width:${completeness}%;height:100%;background:var(--gold-bright);"></div>
      </div>
      <p><b>Top skills:</b> ${(id.top_skills||[]).map(escapeHtml).join(', ') || '—'}</p>
    `;

    // Skills intelligence
    const skillsByCat = data.skills_by_category || {};
    document.getElementById('dash-skills').innerHTML = Object.entries(skillsByCat).map(([cat, skills])=>`
      <h4 style="font-family:var(--font-mono);font-size:12px;text-transform:uppercase;color:var(--gold-bright);">${escapeHtml(cat)}</h4>
      <div>${skills.map(s=>`<span class="skill-tag">${escapeHtml(s.name)} <small>(${s.count})</small></span>`).join(' ')}</div>
    `).join('<hr style="border:none;border-top:1px solid rgba(216,208,189,0.12);margin:12px 0;" />') || '<div class="empty-state">No skills yet.</div>';

    // Recent documents
    const recent = data.recent_documents || [];
    document.getElementById('dash-recent-docs').innerHTML = recent.length ? recent.map(d=>`
      <div class="doc-card">
        <div class="doc-cat">${escapeHtml(d.category)}</div>
        <h4>${escapeHtml(d.title||d.original_filename)}</h4>
        <div class="skills">${(d.skills||[]).map(s=>`<span class="skill-tag">${escapeHtml(s)}</span>`).join('')}</div>
      </div>
    `).join('') : '<div class="empty-state">No documents yet.</div>';

    // Timeline
    const tl = data.timeline || [];
    document.getElementById('dash-timeline').innerHTML = tl.length ? tl.map(y=>`
      <div class="timeline-year">
        <div class="year-label">${escapeHtml(y.year)}</div>
        <div class="timeline-events">${y.events.map(e=>`<div class="timeline-event"><span class="tcat">${escapeHtml(e.category)}</span>${escapeHtml(e.label)}</div>`).join('')}</div>
      </div>
    `).join('') : '<div class="empty-state">Timeline empty.</div>';

    // Knowledge network preview
    const gs = data.graph_summary || {};
    document.getElementById('dash-graph').innerHTML = `
      <p>${gs.nodes||0} entities, ${gs.edges||0} relationships.</p>
      <p style="font-size:12px;color:#9aa3ad;">Preview of your knowledge network.</p>
    `;
    document.getElementById('dash-view-graph').onclick = () => document.querySelector('[data-tab="graph"]').click();

    // Career insights
    const insights = data.insights || [];
    document.getElementById('dash-insights').innerHTML = insights.length ? `<ul>${insights.map(i=>`<li>${escapeHtml(i)}</li>`).join('')}</ul>` : '<div class="empty-state">No insights yet.</div>';

    // Quick actions
    document.getElementById('dash-quick-actions').innerHTML = [
      {label:'Upload Document', tab:'upload'},
      {label:'Search My Identity', tab:'search'},
      {label:'View Archive', tab:'dashboard'},
      {label:'View Timeline', tab:'timeline'},
      {label:'Explore Connections', tab:'graph'},
      {label:'Check Career Intelligence', tab:'career'}
    ].map(a=>`<button class="primary" onclick="document.querySelector('[data-tab=\\'${a.tab}\\']').click()">${a.label}</button>`).join(' ');

    // Tech news – reuse existing news loader with dashboard specific elements
    loadDashboardNews();

  } catch (e) {
    console.error('Dashboard load error', e);
  }
}

async function loadDashboardNews() {
  const cats = ['AI','ML','Cybersecurity','Programming','Cloud','Robotics','Space'];
  document.getElementById('dash-news-cats').innerHTML = cats.map(c=>`<button class="category-chip" data-cat="${c}">${c}</button>`).join('');
  // Simplified news fetch using existing /api/news
  try {
    const res = await apiFetch(`${API}/news?category=All`).then(r=>r.json());
    const articles = res.articles || [];
    document.getElementById('dash-news-updated').textContent = 'Last updated ' + new Date().toLocaleTimeString();
    const grid = document.getElementById('dash-news-grid');
    if (!articles.length) {
      grid.innerHTML = '<div class="empty-state">No news available.</div>';
      return;
    }
    grid.innerHTML = articles.slice(0,6).map(a=>`
      <div class="doc-card news-card">
        <div class="doc-cat">${escapeHtml(a.category||'General')}</div>
        <h4>${escapeHtml(a.title)}</h4>
        <p>${escapeHtml(a.summary||'')}</p>
        <a class="file-link" href="${escapeHtml(a.link)}" target="_blank">Read &rarr;</a>
      </div>
    `).join('');
  } catch {}
}

// Dashboard refresh button
document.getElementById('dash-refresh')?.addEventListener('click', loadPremiumDashboard);

// ---------------------------------------------------------------- init
let appInitialized = false;
function initApp() {
  if (appInitialized) return; // avoid double-loading if auth state flips more than once
  appInitialized = true;
  refreshTotal();
  initTheme();
}

function initTheme() {
  const saved = localStorage.getItem('ledger-theme');
  if (saved === 'light') document.body.classList.add('light');
  const btn = document.getElementById('theme-toggle');
  if (btn) {
    btn.addEventListener('click', () => {
      document.body.classList.toggle('light');
      const isLight = document.body.classList.contains('light');
      localStorage.setItem('ledger-theme', isLight ? 'light' : 'dark');
    });
  }
}

initAuth();
