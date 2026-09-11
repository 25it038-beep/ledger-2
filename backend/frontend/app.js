const API = "/api";

// ---------------------------------------------------------------- Clerk authentication
let clerk = null; // the Clerk instance, once loaded
const CACHED_USER_KEY = "ledger.cachedUser"; // "login info save" — last-known profile, for instant display on reload
const DEMO_TOKEN_KEY = "ledger.demoToken";

function getCachedUser() {
  try { return JSON.parse(localStorage.getItem(CACHED_USER_KEY) || "null"); }
  catch { return null; }
}
function setCachedUser(user) {
  if (user) localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(CACHED_USER_KEY);
}

function showToast(msg) {
  let toast = document.getElementById("global-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "global-toast";
    toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#131A23;color:#d2a24a;border:1px solid rgba(210,162,74,0.5);padding:10px 20px;border-radius:8px;font-size:13px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,0.6);z-index:99999;transition:opacity 0.3s ease;pointer-events:none;";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = "1";
  setTimeout(() => { toast.style.opacity = "0"; }, 3500);
}

/** Wraps fetch() so every request to our API carries the signed-in user's
 * Clerk session token or Demo token. */
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (clerk && clerk.session) {
    try {
      const token = await clerk.session.getToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    } catch { /* no active session yet */ }
  } else {
    const demoToken = localStorage.getItem(DEMO_TOKEN_KEY);
    if (demoToken) headers.set("Authorization", `Bearer ${demoToken}`);
  }
  return fetch(url, { ...options, headers });
}
window.apiFetch = apiFetch;

function showCachedUserBadge() {
  document.getElementById("user-badge").style.display = "flex";
  const cached = getCachedUser();
  let name = "Account";
  let image = "https://ui-avatars.com/api/?name=User&background=cba135&color=fff";
  let email = "";
  let isDemo = false;
  if (cached) {
    name = cached.name || cached.email || "Signed in";
    if (cached.image_url) image = cached.image_url;
    email = cached.email || "";
    isDemo = !!cached.is_demo;
  } else if (clerk && (clerk.user || clerk.session?.user)) {
    const u = clerk.user || clerk.session.user;
    name = u.fullName || [u.firstName, u.lastName].filter(Boolean).join(" ") || u.primaryEmailAddress?.emailAddress || "Signed in";
    if (u.imageUrl) image = u.imageUrl;
    email = u.primaryEmailAddress?.emailAddress || "";
  }
  const userNameEl = document.getElementById("user-name");
  const userAvatarEl = document.getElementById("user-avatar");
  if (userNameEl) userNameEl.textContent = name;
  if (userAvatarEl) userAvatarEl.src = image;
  const sidebarName = document.getElementById("sidebar-name");
  const sidebarAvatar = document.getElementById("sidebar-avatar");
  const sidebarEmail = document.querySelector(".sidebar-email");
  const topbarName = document.getElementById("topbar-name");
  const topbarAvatar = document.getElementById("topbar-avatar");
  if (sidebarName) sidebarName.textContent = name;
  if (sidebarAvatar) sidebarAvatar.src = image;
  if (sidebarEmail && email) sidebarEmail.textContent = email;
  if (topbarName) topbarName.textContent = name;
  if (topbarAvatar) topbarAvatar.src = image;

  const sidebarDemo = document.getElementById("sidebar-demo-badge");
  const topbarDemo = document.getElementById("topbar-demo-badge");
  const headerDemo = document.getElementById("header-demo-badge");
  const demoResetBtn = document.getElementById("demo-reset-btn");
  if (sidebarDemo) sidebarDemo.style.display = isDemo ? "inline-flex" : "none";
  if (topbarDemo) topbarDemo.style.display = isDemo ? "inline-flex" : "none";
  if (headerDemo) headerDemo.style.display = isDemo ? "inline-flex" : "none";
  if (demoResetBtn) demoResetBtn.style.display = isDemo ? "inline-flex" : "none";

  const switchToClerkBtn = document.getElementById("switch-to-clerk-btn");
  const topbarSignoutBtn = document.getElementById("topbar-signout-btn");
  const sidebarSignoutBtn = document.getElementById("sidebar-signout-btn");
  const headerSignoutBtn = document.getElementById("sign-out-btn");
  if (switchToClerkBtn) switchToClerkBtn.style.display = isDemo ? "inline-flex" : "none";
  if (topbarSignoutBtn) topbarSignoutBtn.textContent = isDemo ? "Exit Demo" : "Sign Out";
  if (sidebarSignoutBtn) sidebarSignoutBtn.textContent = isDemo ? "Exit Demo" : "Sign Out";
  if (headerSignoutBtn) headerSignoutBtn.textContent = isDemo ? "Exit Demo" : "Sign out";
}

async function loginAsDemoAccount() {
  const btn = document.getElementById("demo-login-btn");
  const topBtn = document.getElementById("demo-login-btn-top");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⏳ Initializing Demo Account & Sample Data...";
  }
  if (topBtn) {
    topBtn.disabled = true;
    topBtn.textContent = "⏳ Initializing Demo Account...";
  }
  try {
    const res = await fetch(`${API}/auth/demo-login`, { method: "POST" });
    const data = await res.json();
    if (data && data.token) {
      sessionStorage.setItem(DEMO_TOKEN_KEY, data.token);
      localStorage.setItem(DEMO_TOKEN_KEY, data.token);
      setCachedUser(data);
      showApp();
      initApp();
      showToast("🚀 Logged in as Demo Account with preloaded sample data!");
    }
  } catch (err) {
    console.error("Demo login error:", err);
    alert("Could not connect to demo account. Please make sure the backend server is running.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🚀 Continue with Demo Account (Preloaded Data)";
    }
    if (topBtn) {
      topBtn.disabled = false;
      topBtn.textContent = "🚀 Instant Access: Continue with Demo Account";
    }
  }
}

async function resetDemoSampleData() {
  const btn = document.getElementById("demo-reset-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "⟳ Resetting...";
  }
  try {
    const res = await apiFetch(`${API}/demo/reset-sample-data`, { method: "POST" });
    const data = await res.json();
    if (data.status === "ok") {
      showToast("✓ Clean sample data reloaded! Refreshing dashboard...");
      await loadPremiumDashboard();
      if (typeof loadHackathons === "function") loadHackathons();
    }
  } catch (err) {
    console.error("Reset sample data error:", err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "⟳ Reload Sample Data";
    }
  }
}

function showApp() {
  const gate = document.getElementById("auth-gate");
  const shell = document.getElementById("app-shell");
  if (gate) gate.style.display = "none";
  if (shell) shell.style.display = "flex";
  showCachedUserBadge();
}

function showAuthGate() {
  const gate = document.getElementById("auth-gate");
  const shell = document.getElementById("app-shell");
  if (gate) gate.style.display = "flex";
  if (shell) shell.style.display = "none";
}


async function initAuth() {
  document.getElementById("demo-login-btn")?.addEventListener("click", loginAsDemoAccount);
  document.getElementById("demo-reset-btn")?.addEventListener("click", resetDemoSampleData);
  document.getElementById("sign-out-btn")?.addEventListener("click", handleSignOut);
  document.getElementById("topbar-signout-btn")?.addEventListener("click", handleSignOut);
  document.getElementById("sidebar-signout-btn")?.addEventListener("click", handleSignOut);
  document.getElementById("switch-to-clerk-btn")?.addEventListener("click", handleSignOut);

  const urlParams = new URLSearchParams(window.location.search);
  const forceAuth = urlParams.has("auth") || urlParams.has("login") || urlParams.has("signout") || urlParams.has("logout");
  if (forceAuth) {
    localStorage.removeItem(DEMO_TOKEN_KEY);
    sessionStorage.removeItem(DEMO_TOKEN_KEY);
    localStorage.removeItem(USER_CACHE_KEY);
    sessionStorage.clear();
    setCachedUser(null);
    if (window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }

  // Active demo session only if explicitly chosen in this session
  const demoToken = sessionStorage.getItem(DEMO_TOKEN_KEY);
  if (demoToken && !forceAuth) {
    showApp();
    initApp();
    return;
  }

  // Always clear persistent demo token so the initial login page shows Clerk authentication!
  localStorage.removeItem(DEMO_TOKEN_KEY);

  // Show Auth Gate with Clerk Authentication as primary interface
  showAuthGate();
  showCachedUserBadge();

  let config;
  try {
    config = await fetch(`${API}/auth/config`).then(r => r.json());
  } catch {
    // Server unreachable — nothing we can do yet; keep the auth gate visible.
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

      let attempts = 40;
      const checkClerk = () => {
        if (window.Clerk) return resolve(window.Clerk);
        if (attempts-- <= 0) return reject(new Error("Clerk script load timeout"));
        setTimeout(checkClerk, 100);
      };

      if (!script.src) {
        script.onload = () => checkClerk();
        script.onerror = () => {
          const fallback = document.createElement("script");
          fallback.crossOrigin = "anonymous";
          fallback.setAttribute("data-clerk-publishable-key", config.publishableKey);
          fallback.src = "https://sharing-racer-5715.clerk.accounts.dev/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
          fallback.onload = () => checkClerk();
          fallback.onerror = (e) => reject(e);
          document.head.appendChild(fallback);
        };
        script.src = "https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js";
      } else {
        checkClerk();
      }
    });
  };

  const clerkSignIn = document.getElementById("clerk-sign-in");
  if (clerkSignIn && !clerkSignIn.children.length) {
    clerkSignIn.innerHTML = `
      <div id="clerk-loading-indicator" style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; padding:30px 10px; color:var(--text-secondary); text-align:center;">
        <div style="width:26px; height:26px; border:2.5px solid var(--accent); border-top-color:transparent; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
        <div style="font-size:12.5px; color:var(--text-secondary);">Connecting to Clerk authentication…</div>
      </div>
    `;
  }

  try {
    clerk = await loadClerkScript();
    if (!clerk.loaded) {
      await clerk.load({ publishableKey: config.publishableKey });
    }
  } catch (e) {
    console.warn("Clerk load notice:", e);
    if (clerkSignIn) {
      clerkSignIn.innerHTML = `
        <div style="background:rgba(210,162,74,0.08);border:1px solid rgba(210,162,74,0.25);border-radius:10px;padding:16px;margin-bottom:16px;text-align:left;">
          <div style="color:var(--accent);font-weight:600;font-size:13px;margin-bottom:6px;">
            ℹ️ Authentication Notice
          </div>
          <div style="color:var(--text-secondary);font-size:12px;line-height:1.5;margin-bottom:14px;">
            Clerk development keys only accept requests from authorized domains. You can explore the platform live right now in Demo Mode with full preloaded data:
          </div>
          <button id="clerk-error-demo-btn" class="primary demo-btn" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;">
            🚀 Enter Demo Mode (Preloaded Data)
          </button>
        </div>
      `;
      document.getElementById("clerk-error-demo-btn")?.addEventListener("click", loginAsDemoAccount);
    }
    showAuthGate();
    return;
  }

  const onAuthChange = async (payload) => {
    const user = (payload && payload.user) || (clerk && clerk.user);
    const session = (payload && payload.session) || (clerk && clerk.session);
    if (user || session) {
      showApp();
      initApp();
      // Save/refresh the local login record on the server ("login info save").
      try {
        const uObj = user || session?.user;
        const profilePayload = {
          name: uObj?.fullName || [uObj?.firstName, uObj?.lastName].filter(Boolean).join(" ") || "",
          email: uObj?.primaryEmailAddress?.emailAddress || "",
          image_url: uObj?.imageUrl || "",
        };
        const res = await apiFetch(`${API}/auth/sync`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(profilePayload),
        });
        if (res.ok) {
          const saved = await res.json();
          setCachedUser(saved);
          showCachedUserBadge();
        }
      } catch { /* non-fatal — user can still use the app */ }
    } else {
      const demoToken = localStorage.getItem(DEMO_TOKEN_KEY);
      if (!demoToken) {
        setCachedUser(null);
        showAuthGate();
        mountSignIn();
      }
    }
  };

  clerk.addListener(onAuthChange);
  await onAuthChange();

  // Active polling watcher to catch Clerk session updates in virtual mode or after redirect
  if (!window._clerkWatcherStarted) {
    window._clerkWatcherStarted = true;
    setInterval(async () => {
      const u = clerk?.user || clerk?.session?.user;
      const s = clerk?.session;
      if (u || s) {
        const authGate = document.getElementById("auth-gate");
        if (authGate && authGate.style.display !== "none") {
          showApp();
          initApp();
          try {
            const profilePayload = {
              name: u?.fullName || [u?.firstName, u?.lastName].filter(Boolean).join(" ") || "",
              email: u?.primaryEmailAddress?.emailAddress || "",
              image_url: u?.imageUrl || "",
            };
            const res = await apiFetch(`${API}/auth/sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(profilePayload),
            });
            if (res.ok) {
              const saved = await res.json();
              setCachedUser(saved);
              showCachedUserBadge();
            }
          } catch {}
        }
      }
    }, 400);
  }
}

function mountSignIn() {
  if (!clerk) return;
  const el = document.getElementById("clerk-sign-in");
  if (!el) return;
  if (el.querySelector(".cl-card") || el.querySelector(".cl-rootBox")) return;
  const loader = document.getElementById("clerk-loading-indicator");
  if (loader) loader.remove();
  try {
    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const currentOrigin = window.location.origin;
    clerk.mountSignIn(el, {
      routing: "virtual",
      forceRedirectUrl: currentOrigin + "/",
      fallbackRedirectUrl: currentOrigin + "/",
      signUpForceRedirectUrl: currentOrigin + "/",
      signUpFallbackRedirectUrl: currentOrigin + "/",
      afterSignInUrl: currentOrigin + "/",
      afterSignUpUrl: currentOrigin + "/",
      redirectUrl: currentOrigin + "/",
      appearance: {
        variables: {
          colorPrimary: "#d2a24a",
          colorBackground: "#131a23",
          colorText: "#f0f2f5",
        },
        elements: {
          ...(!isLocalhost ? {
            socialButtonsBlockButton: { display: "none" },
            dividerRow: { display: "none" }
          } : {}),
          card: {
            boxShadow: "none",
            background: "transparent",
            border: "none",
            padding: "0"
          },
          rootBox: {
            width: "100%"
          }
        }
      }
    });
  } catch (err) {
    console.warn("clerk.mountSignIn error:", err);
    el.innerHTML = `
      <div style="background:rgba(210,162,74,0.08);border:1px solid rgba(210,162,74,0.25);border-radius:10px;padding:16px;margin-bottom:16px;text-align:left;">
        <div style="color:var(--accent);font-weight:600;font-size:13px;margin-bottom:6px;">
          Clerk Authentication Notice
        </div>
        <div style="color:var(--text-secondary);font-size:12px;line-height:1.5;margin-bottom:14px;">
          Clerk sign-in widget is restricted on this hosted domain. Explore all features with full preloaded data in Demo Mode:
        </div>
        <button id="clerk-mount-demo-btn" class="primary demo-btn" style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;">
          🚀 Enter Demo Mode (Preloaded Data)
        </button>
      </div>
    `;
    document.getElementById("clerk-mount-demo-btn")?.addEventListener("click", loginAsDemoAccount);
  }
}

async function handleSignOut() {
  localStorage.removeItem(DEMO_TOKEN_KEY);
  sessionStorage.removeItem(DEMO_TOKEN_KEY);
  localStorage.removeItem(USER_CACHE_KEY);
  sessionStorage.clear();
  setCachedUser(null);
  if (clerk && typeof clerk.signOut === "function") {
    try { await clerk.signOut(); } catch (e) { console.warn("Clerk signOut error:", e); }
  }
  showToast("Signed out. Showing authentication portal...");
  showAuthGate();
  if (clerk) mountSignIn();
}

document.getElementById("sign-out-btn")?.addEventListener("click", handleSignOut);
document.getElementById("topbar-signout-btn")?.addEventListener("click", handleSignOut);
document.getElementById("sidebar-signout-btn")?.addEventListener("click", handleSignOut);
document.getElementById("switch-to-clerk-btn")?.addEventListener("click", handleSignOut);


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
    "identity":"My Identity",
    "hackathons":"Hackathon Finder",
    "resume":"Resume Creator"
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
  if (tabName === "hackathons") loadHackathons();
  if (tabName === "resume") loadResumeCreator();
  if (typeof window.updateAiWidgetContext === "function") {
    window.updateAiWidgetContext(tabName);
  }
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
  btn.textContent = "Analyzing with NVIDIA AI…";
  btn.disabled = true;
  empty.style.display = "block";
  empty.innerHTML = `<div class="auth-loading">Reading your credentials & generating real-time AI intelligence (~8s)…</div>`;
  try {
    const res = await apiFetch(`${API}/career/analyze`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) {
      empty.textContent = `Couldn't run the analysis: ${data.detail || "unknown error"}`;
    } else {
      renderCareerReport(data);
    }
  } catch (e) {
    empty.textContent = "Couldn't reach the server to run the analysis. Check if backend is running.";
  }
  btn.textContent = "Run career analysis";
  btn.disabled = false;
});

function formatDateTime(dateStr) {
  if (!dateStr) return "";
  let str = String(dateStr);
  if (!str.endsWith("Z") && !/[+-]\d{2}:?\d{2}$/.test(str)) {
    str += "Z";
  }
  const d = new Date(str);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleString();
}

function renderCareerReport(report) {
  document.getElementById("career-empty").style.display = "none";
  document.getElementById("career-content").style.display = "block";

  if (report._meta) {
    const meta = report._meta;
    const stale = meta.current_document_count !== meta.document_count_at_analysis;
    document.getElementById("career-meta").textContent =
      `Generated ${formatDateTime(meta.generated_at)} · based on ${meta.document_count_at_analysis} documents` +
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
        m.roadmap.map(r => typeof r === "string" ? `<li>${escapeHtml(r)}</li>` : `<li>${escapeHtml(r.step || r.title || "")} <i>(${escapeHtml(r.estimated_time || "")}, ${escapeHtml(r.difficulty || "")})</i></li>`).join("")
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
  tlEl.innerHTML = (report.future_timeline || []).map(e => {
    if (typeof e === "string") return `<div class="timeline-year"><div class="timeline-events"><div class="timeline-event">${escapeHtml(e)}</div></div></div>`;
    return `
    <div class="timeline-year">
      <div class="year-label">${escapeHtml(String(e.year || ""))}</div>
      <div class="timeline-events"><div class="timeline-event">${escapeHtml(e.milestone || e.event || "")}</div></div>
    </div>
  `;}).join("") || `<div class="empty-state">No future milestones generated.</div>`;


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
      <p><b>Name:</b> ${escapeHtml(userName || '—')}</p>
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
      {label:'Open Resume Creator', tab:'resume'},
      {label:'Upload Document', tab:'upload'},
      {label:'Find Hackathons', tab:'hackathons'},
      {label:'Search My Identity', tab:'search'},
      {label:'View Archive', tab:'dashboard'},
      {label:'View Timeline', tab:'timeline'},
      {label:'Explore Connections', tab:'graph'},
      {label:'Check Career Intelligence', tab:'career'}
    ].map(a=>`<button class="primary" onclick="document.querySelector('[data-tab=\\'${a.tab}\\']').click()">${a.label}</button>`).join(' ');

    // Tech news – reuse existing news loader with dashboard specific elements
    loadDashboardNews();

    // Hackathon intelligence – load asynchronously without blocking dashboard render
    loadDashboardHackathons();
    loadTrendingSkillsIntelligence();

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

// ---------------------------------------------------------------- Hackathon Finder System
function renderHackathonCardHtml(h, isCompact = false) {
  const modeClass = (h.mode || 'online').toLowerCase();
  const matchScore = h.match_score || 50;
  const matchClass = matchScore >= 80 ? 'high' : '';
  const deadlineStr = h.deadline_display || (h.registration_deadline ? `Deadline: ${h.registration_deadline}` : 'Not specified');
  const isUrgent = h.deadline_days_left !== undefined && h.deadline_days_left <= 7 && h.deadline_days_left >= 0;
  const deadlineClass = isUrgent ? 'deadline-indicator urgent' : 'deadline-indicator';
  const prizeStr = h.prize && h.prize !== 'Not specified' ? h.prize : 'Not specified';
  const tags = [...(h.technologies || []), ...(h.categories || [])].slice(0, isCompact ? 3 : 5);
  const matchedSkillsSet = new Set((h.matched_skills || []).map(s => s.toLowerCase()));

  return `
    <div class="hackathon-card">
      <div>
        <div class="hackathon-card-header">
          <div class="hackathon-card-badges">
            <span class="mode-badge ${escapeHtml(modeClass)}">${escapeHtml(h.mode || 'Online')}</span>
            ${h.is_trending_today ? `<span class="mode-badge trending" style="background: rgba(210,162,74,0.18); color: var(--accent-strong); border: 1px solid rgba(210,162,74,0.4);">Web Trend</span>` : ''}
            ${h.source && h.source.startsWith('Web') ? `<span class="mode-badge" style="background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3);">Web Found</span>` : ''}
            ${h.country && h.country !== 'Not specified' && h.country !== 'Global' ? `<span class="mode-badge offline">${escapeHtml(h.country)}</span>` : ''}
          </div>
          <span class="match-score-badge ${matchClass}">
            ${matchScore}% Match
          </span>
        </div>


        <h4 class="hackathon-card-title">${escapeHtml(h.name)}</h4>
        <div class="hackathon-card-organizer">by ${escapeHtml(h.organizer || 'Community Organizer')}</div>

        <div class="hackathon-meta-details">
          <div class="meta-detail-row">
            <span class="icon">Start:</span>
            <span>${escapeHtml(h.start_date || 'Not specified')}</span>
          </div>
          <div class="meta-detail-row">
            <span class="icon">Deadline:</span>
            <span class="${deadlineClass}">${escapeHtml(deadlineStr)}</span>
          </div>
          <div class="meta-detail-row">
            <span class="icon">Location:</span>
            <span>${escapeHtml(h.location || 'Online / Worldwide')}</span>
          </div>
        </div>

        <div class="hackathon-tags">
          ${tags.map(t => {
            const isMatched = matchedSkillsSet.has(t.toLowerCase());
            return `<span class="hackathon-tag ${isMatched ? 'matched' : ''}">${escapeHtml(t)}</span>`;
          }).join('')}
        </div>

        ${h.why_relevant ? `
          <div class="hackathon-why-match">
            ${escapeHtml(h.why_relevant)}
          </div>
        ` : ''}
      </div>

      <div class="hackathon-card-action">
        <span class="prize-display">
          ${prizeStr !== 'Not specified' ? `Prize: ${escapeHtml(prizeStr)}` : '<span style="color:var(--text-muted);font-size:11px;">Prizes: Not specified</span>'}
        </span>
        <a class="view-official-btn" href="${escapeHtml(h.official_url)}" target="_blank" rel="noopener noreferrer">
          View Official Event &rarr;
        </a>
      </div>
    </div>
  `;
}

function renderBestMatchHero(h) {
  if (!h) return '';
  const matchScore = h.match_score || 50;
  const deadlineStr = h.deadline_display || (h.registration_deadline ? `Deadline: ${h.registration_deadline}` : 'Not specified');
  const isUrgent = h.deadline_days_left !== undefined && h.deadline_days_left <= 7 && h.deadline_days_left >= 0;
  const deadlineClass = isUrgent ? 'deadline-indicator urgent' : 'deadline-indicator';
  const prizeStr = h.prize && h.prize !== 'Not specified' ? h.prize : 'Not specified';
  const tags = [...(h.technologies || []), ...(h.categories || [])].slice(0, 6);
  const matchedSkillsSet = new Set((h.matched_skills || []).map(s => s.toLowerCase()));

  return `
    <div class="best-match-card">
      <div class="best-match-top">
        <span class="best-match-label">Best Match For Your Profile</span>
        <span class="match-score-badge high" style="font-size:13px;padding:4px 10px;">
          ${matchScore}% Profile Overlap
        </span>
      </div>

      <h3 class="best-match-title">${escapeHtml(h.name)}</h3>
      <div class="best-match-organizer">
        Organized by <b>${escapeHtml(h.organizer || 'Community')}</b> · Source: ${escapeHtml(h.source || 'Verified')}
        ${h.is_trending_today ? `<span class="mode-badge trending" style="background: rgba(210,162,74,0.18); color: var(--accent-strong); border: 1px solid rgba(210,162,74,0.4); margin-left: 8px;">Web Trending Tech</span>` : ''}
      </div>


      ${h.why_relevant ? `
        <div class="hackathon-why-match" style="font-size:12.5px;margin:8px 0 14px;">
          <b>Why it matches:</b> ${escapeHtml(h.why_relevant)}
        </div>
      ` : ''}

      <div class="best-match-grid">
        <div>
          <div class="best-match-stat-label">Mode & Region</div>
          <div class="best-match-stat-val">${escapeHtml(h.mode || 'Online')} (${escapeHtml(h.country || 'Global')})</div>
        </div>
        <div>
          <div class="best-match-stat-label">Registration Deadline</div>
          <div class="best-match-stat-val ${deadlineClass}">${escapeHtml(deadlineStr)}</div>
        </div>
        <div>
          <div class="best-match-stat-label">Prize Pool</div>
          <div class="best-match-stat-val" style="color:var(--accent-strong);font-family:var(--font-mono);">${prizeStr !== 'Not specified' ? escapeHtml(prizeStr) : 'Not specified'}</div>
        </div>
        <div>
          <div class="best-match-stat-label">Event Start Date</div>
          <div class="best-match-stat-val">${escapeHtml(h.start_date || 'Not specified')}</div>
        </div>
      </div>

      <div class="best-match-footer">
        <div class="hackathon-tags">
          ${tags.map(t => {
            const isMatched = matchedSkillsSet.has(t.toLowerCase());
            return `<span class="hackathon-tag ${isMatched ? 'matched' : ''}">${escapeHtml(t)}</span>`;
          }).join('')}
        </div>
        <a class="primary" style="text-decoration:none;display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:var(--radius-sm);font-weight:600;" href="${escapeHtml(h.official_url)}" target="_blank" rel="noopener noreferrer">
          View Official Event &rarr;
        </a>
      </div>
    </div>
  `;
}

async function loadDashboardHackathons() {
  const container = document.getElementById('dash-hackathons-recommended');
  if (!container) return;

  container.innerHTML = `
    <div class="skeleton-card"><div class="skeleton-line title"></div><div class="skeleton-line sub"></div><div class="skeleton-line tag"></div></div>
    <div class="skeleton-card"><div class="skeleton-line title"></div><div class="skeleton-line sub"></div><div class="skeleton-line tag"></div></div>
    <div class="skeleton-card"><div class="skeleton-line title"></div><div class="skeleton-line sub"></div><div class="skeleton-line tag"></div></div>
  `;

  document.getElementById('dash-hackathons-view-all')?.addEventListener('click', () => {
    activateTab('hackathons');
  });

  try {
    const res = await apiFetch(`${API}/hackathons/recommended?limit=3`);
    const data = await res.json();
    const items = data.hackathons || [];

    if (!items.length) {
      container.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No upcoming hackathons available right now. Check back soon!</div>';
      return;
    }

    container.innerHTML = items.map(h => renderHackathonCardHtml(h, true)).join('');
  } catch (err) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        Could not load recommended hackathons.
        <button class="primary small-btn" style="margin-left:10px;" onclick="loadDashboardHackathons()">Retry</button>
      </div>
    `;
  }
}

let hackathonState = {
  search: "",
  mode: "All",
  category: "All",
  country: "All",
  sort: "best_match",
};

let hackathonControlsBound = false;

async function loadHackathons() {
  const bestMatchContainer = document.getElementById('hackathon-best-match');
  const gridContainer = document.getElementById('hackathon-grid');
  const countEl = document.getElementById('hackathon-results-count');
  const updatedEl = document.getElementById('hackathon-last-updated');

  if (!gridContainer) return;

  if (!hackathonControlsBound) {
    hackathonControlsBound = true;

    // Search input & button
    const searchInput = document.getElementById('hackathon-search-input');
    const searchBtn = document.getElementById('hackathon-search-btn');
    const triggerSearch = () => {
      const searchTag = document.getElementById('hackathon-web-search-tag');
      if (searchTag) searchTag.style.display = 'none';
      hackathonState.search = searchInput ? searchInput.value.trim() : "";
      loadHackathonsList();
    };
    if (searchBtn) searchBtn.addEventListener('click', triggerSearch);
    if (searchInput) searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') triggerSearch();
    });

    // Live Web Search button
    const webSearchBtn = document.getElementById('hackathon-web-search-btn');
    if (webSearchBtn) {
      webSearchBtn.addEventListener('click', () => {
        const query = searchInput ? searchInput.value.trim() : "";
        executeLiveWebSearch(query);
      });
    }


    // Mode buttons
    const modeBtns = document.querySelectorAll('#hackathon-mode-filters button');
    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        hackathonState.mode = btn.dataset.mode;
        loadHackathonsList();
      });
    });

    // Category chips
    const catChips = document.querySelectorAll('#hackathon-cat-chips button');
    catChips.forEach(chip => {
      chip.addEventListener('click', () => {
        catChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        hackathonState.category = chip.dataset.cat;
        loadHackathonsList();
      });
    });

    // Sort select
    const sortSelect = document.getElementById('hackathon-sort-select');
    if (sortSelect) {
      sortSelect.addEventListener('change', () => {
        hackathonState.sort = sortSelect.value;
        loadHackathonsList();
      });
    }

    // Country select
    const countrySelect = document.getElementById('hackathon-country-select');
    if (countrySelect) {
      countrySelect.addEventListener('change', () => {
        hackathonState.country = countrySelect.value;
        loadHackathonsList();
      });
    }

    // Refresh button
    const refreshBtn = document.getElementById('hackathon-refresh-btn');
    const spinner = document.getElementById('hackathon-refresh-spinner');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        if (spinner) spinner.style.display = 'inline-block';
        refreshBtn.disabled = true;
        try {
          await apiFetch(`${API}/hackathons/refresh`, { method: 'POST' });
        } catch (e) {
          console.error('Refresh error', e);
        } finally {
          if (spinner) spinner.style.display = 'none';
          refreshBtn.disabled = false;
          loadHackathons();
        }
      });
    }
  }

  // Load Best Match Hero Card
  if (bestMatchContainer) {
    try {
      const recRes = await apiFetch(`${API}/hackathons/recommended?limit=1`);
      const recData = await recRes.json();
      if (recData.hackathons && recData.hackathons.length > 0) {
        bestMatchContainer.innerHTML = renderBestMatchHero(recData.hackathons[0]);
      } else {
        bestMatchContainer.innerHTML = '';
      }
    } catch {
      bestMatchContainer.innerHTML = '';
    }
  }

  loadHackathonsList();
}

async function loadHackathonsList() {
  const gridContainer = document.getElementById('hackathon-grid');
  const countEl = document.getElementById('hackathon-results-count');
  const updatedEl = document.getElementById('hackathon-last-updated');

  if (!gridContainer) return;

  gridContainer.innerHTML = `
    <div class="skeleton-card"><div class="skeleton-line title"></div><div class="skeleton-line sub"></div><div class="skeleton-line tag"></div></div>
    <div class="skeleton-card"><div class="skeleton-line title"></div><div class="skeleton-line sub"></div><div class="skeleton-line tag"></div></div>
    <div class="skeleton-card"><div class="skeleton-line title"></div><div class="skeleton-line sub"></div><div class="skeleton-line tag"></div></div>
  `;
  if (countEl) countEl.textContent = 'Searching hackathons...';

  try {
    const params = new URLSearchParams({
      search: hackathonState.search,
      mode: hackathonState.mode,
      category: hackathonState.category,
      country: hackathonState.country,
      sort: hackathonState.sort,
      limit: '50'
    });

    const res = await apiFetch(`${API}/hackathons?${params}`);
    const data = await res.json();
    const items = data.hackathons || [];

    if (updatedEl && data.last_updated) {
      const dt = new Date(data.last_updated);
      updatedEl.textContent = `Updated ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }

    if (countEl) {
      countEl.textContent = `Showing ${items.length} verified upcoming event${items.length === 1 ? '' : 's'}`;
    }

    if (!items.length) {
      gridContainer.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No hackathons match your filters.</div>';
      return;
    }

    gridContainer.innerHTML = items.map(h => renderHackathonCardHtml(h, false)).join('');
  } catch (err) {
    if (countEl) countEl.textContent = 'Error loading events';
    gridContainer.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        Failed to load hackathons. Please check your internet connection and try again.
        <button class="primary small-btn" style="margin-left:10px;" onclick="loadHackathonsList()">Retry</button>
      </div>
    `;
  }
}

async function executeLiveWebSearch(query) {
  const gridContainer = document.getElementById('hackathon-grid');
  const countEl = document.getElementById('hackathon-results-count');
  const searchTag = document.getElementById('hackathon-web-search-tag');

  if (!gridContainer) return;

  if (searchTag) {
    searchTag.style.display = 'inline-flex';
    searchTag.textContent = query ? `Live Web: "${query}"` : 'Live Web Search: Global';
  }

  gridContainer.innerHTML = `
    <div class="skeleton-card"><div class="skeleton-line title"></div><div class="skeleton-line sub"></div><div class="skeleton-line tag"></div></div>
    <div class="skeleton-card"><div class="skeleton-line title"></div><div class="skeleton-line sub"></div><div class="skeleton-line tag"></div></div>
    <div class="skeleton-card"><div class="skeleton-line title"></div><div class="skeleton-line sub"></div><div class="skeleton-line tag"></div></div>
  `;
  if (countEl) countEl.textContent = 'Searching live web and Google global hackathon indexes...';

  try {
    const res = await apiFetch(`${API}/hackathons/web-search?q=${encodeURIComponent(query || 'AI Hackathon')}&limit=30`);
    const data = await res.json();
    const items = data.hackathons || [];

    if (countEl) {
      countEl.textContent = `Found ${items.length} live web announcement${items.length === 1 ? '' : 's'} across technology feeds`;
    }

    if (!items.length) {
      gridContainer.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          No live web hackathons found matching "${escapeHtml(query)}". Try another topic like "AI", "Quantum", "Cybersecurity", or "Cloud".
        </div>
      `;
      return;
    }

    gridContainer.innerHTML = items.map(h => renderHackathonCardHtml(h, false)).join('');
  } catch (err) {
    if (countEl) countEl.textContent = 'Web search failed';
    gridContainer.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1;">
        Live web search temporarily unavailable. Check internet connection.
      </div>
    `;
  }
}

async function loadTrendingSkillsIntelligence() {
  const container = document.getElementById('dash-trending-skills');
  if (!container) return;

  try {
    const res = await apiFetch(`${API}/skills/trending-today`);
    const data = await res.json();
    if (!data || data.source_status !== 'ok') return;

    const matches = data.verified_matches || [];
    const recs = data.upskill_recommendations || [];
    const updatedDate = data.last_researched ? new Date(data.last_researched).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today';

    container.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-family:var(--font-mono); font-size:11px; text-transform:uppercase; color:var(--accent-strong); font-weight:700; letter-spacing:0.04em; display:flex; align-items:center; gap:6px;">
          <span class="live-dot" style="width:7px; height:7px;"></span>
          Market In-Demand Skills Today (Live Web Research)
        </span>
        <span style="font-size:10.5px; color:var(--text-muted);">Updated ${updatedDate}</span>
      </div>

      <div style="font-size:12px; color:var(--text-secondary); margin-bottom:8px;">
        Real-time technology hiring demand mined from global news and hiring indexes:
      </div>

      ${matches.length > 0 ? `
        <div style="margin-bottom:8px; background:rgba(34,197,94,0.08); border:1px solid rgba(34,197,94,0.25); border-radius:var(--radius-sm); padding:8px 10px;">
          <div style="font-size:11px; font-weight:600; color:#4ade80; margin-bottom:4px;">
            [Verified] Your Verified Skills in High Demand Today (${matches.length})
          </div>
          <div style="display:flex; flex-wrap:wrap; gap:5px;">
            ${matches.map(m => `
              <span class="skill-tag" style="background:rgba(34,197,94,0.15); border-color:rgba(34,197,94,0.35); color:#86efac; font-size:10.5px; padding:2px 8px;">
                ${escapeHtml(m.user_skill)} · ${escapeHtml(m.demand)}
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}

      ${recs.length > 0 ? `
        <div style="background:rgba(210,162,74,0.06); border:1px solid rgba(210,162,74,0.25); border-radius:var(--radius-sm); padding:8px 10px;">
          <div style="font-size:11px; font-weight:600; color:var(--accent-strong); margin-bottom:6px;">
            Recommended Skills to Learn Today (Web Trends)
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${recs.map(r => `
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:11.5px; gap:8px;">
                <div>
                  <span style="font-weight:600; color:var(--text-primary);">${escapeHtml(r.skill)}</span>
                  <span style="color:var(--text-muted); font-size:10.5px; margin-left:4px;">${escapeHtml(r.growth)}</span>
                </div>
                <button class="primary small-btn" style="padding:2px 8px; font-size:10.5px;" onclick="searchHackathonsForSkill('${escapeHtml(r.skill)}')">
                  Find Hackathons &rarr;
                </button>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}
    `;
  } catch (e) {
    console.error('Failed to load trending skills intelligence', e);
  }
}

function searchHackathonsForSkill(skillName) {
  activateTab('hackathons');
  const input = document.getElementById('hackathon-search-input');
  if (input) {
    const cleaned = skillName.split('&')[0].split('/')[0].trim();
    input.value = cleaned;
    hackathonState.search = cleaned;
    loadHackathonsList();
  }
}


// Dashboard refresh button
document.getElementById('dash-refresh')?.addEventListener('click', loadPremiumDashboard);

// ---------------------------------------------------------------- AI Assistant Floating Widget
function setupAiWidget() {
  if (typeof window.updateAiWidgetContext === "function") {
    window.updateAiWidgetContext(window.aiActiveTab || "premium-dashboard");
  }
}

setupAiWidget();

// ---------------------------------------------------------------- init
let appInitialized = false;
function initApp() {
  if (appInitialized) return; // avoid double-loading if auth state flips more than once
  appInitialized = true;
  refreshTotal();
  initTheme();
  setupAiWidget();
  activateTab("premium-dashboard");
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

// ---------------------------------------------------------------- Premium motion (visual-only, no API changes)
(function initPremiumMotion() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Topbar elevation on scroll
  const topbar = document.querySelector('.topbar');
  window.addEventListener('scroll', () => {
    if (topbar) topbar.classList.toggle('scrolled', window.scrollY > 12);
  }, { passive: true });
  // Sidebar collapse + mobile nav
  document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
    document.body.classList.toggle('collapsed-nav');
  });
  document.getElementById('mobile-menu')?.addEventListener('click', () => {
    document.body.classList.toggle('nav-open');
  });
  // Staggered reveal for active panel cards (clears delay so hovers stay snappy)
  function revealActivePanel() {
    if (reduceMotion) return;
    const active = document.querySelector('.panel.active');
    if (!active) return;
    const items = active.querySelectorAll('.card, .doc-card, .match-card, .timeline-year, .news-card');
    items.forEach((el, i) => {
      el.style.transitionDelay = Math.min(i * 28, 280) + 'ms';
      el.classList.add('reveal', 'visible');
      setTimeout(() => { el.style.transitionDelay = ''; }, 500 + Math.min(i * 28, 280));
    });
    const hero = active.querySelector('.dash-header');
    if (hero) { hero.classList.add('reveal', 'visible'); }
  }
  // Hook into existing tab activation without rewriting it
  document.querySelectorAll('.sidebar-item, nav.tabs button').forEach(b => {
    b.addEventListener('click', () => setTimeout(revealActivePanel, 30), { passive: true });
  });
  setTimeout(revealActivePanel, 400);
  // Skill bars: animate width when visible
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.querySelectorAll('.skill-bar > span').forEach(s => {
          s.style.width = s.dataset.w || s.style.width || '60%';
        });
      }
    });
  }, { threshold: 0.2 });
  document.querySelectorAll('.card').forEach(c => io.observe(c));
})();

// ==========================================================================
// MODULE 11: RESUME CREATOR LOGIC
// ==========================================================================
let activeResumeTarget = "General";
let activeResumeTemplate = "minimal_professional";
let currentResumeData = null;
let resumeTemplatesList = [];
let resumeTargetModesList = [];
let resumeZoomLevel = 1.0;
let resumeDebounceTimer = null;

// Accordion toggle helper
window.toggleResumeSection = function(sectionId) {
  const body = document.getElementById(sectionId);
  const arrow = document.getElementById(`sec-arrow-${sectionId}`);
  if (!body) return;
  body.classList.toggle("collapsed");
  if (arrow) {
    arrow.style.transform = body.classList.contains("collapsed") ? "rotate(-90deg)" : "rotate(0deg)";
  }
};

async function loadResumeCreator() {
  const saveStatus = document.getElementById("resume-save-status");
  if (saveStatus) saveStatus.textContent = "Loading...";

  try {
    const res = await apiFetch(`${API}/resume/data?target=${encodeURIComponent(activeResumeTarget)}&template=${encodeURIComponent(activeResumeTemplate)}`);
    if (!res.ok) throw new Error("Could not load resume data");
    const data = await res.json();

    currentResumeData = data.resume;
    resumeTemplatesList = data.templates || [];
    resumeTargetModesList = data.target_modes || [];

    // Populate dropdowns
    initResumeDropdowns();
    updateDirectDownloadLinks();

    // Populate editor
    populateResumeEditor();

    // Render skill intelligence & ATS quality checker
    renderSkillIntelligence(data.skill_intelligence);
    renderQualityChecker(data.analysis);

    // Render live preview
    renderLivePreview();

    if (saveStatus) saveStatus.textContent = "Synced";
  } catch (err) {
    console.error("[Resume] Load error:", err);
    if (saveStatus) saveStatus.textContent = "Sync Error";
  }
}

function initResumeDropdowns() {
  const targetSelect = document.getElementById("resume-target-select");
  const templateSelect = document.getElementById("resume-template-select");

  if (targetSelect && resumeTargetModesList.length) {
    targetSelect.innerHTML = resumeTargetModesList.map(t =>
      `<option value="${t.id}" ${t.id === (currentResumeData?.target || activeResumeTarget) ? 'selected' : ''}>${t.label}</option>`
    ).join("");

    targetSelect.onchange = async () => {
      activeResumeTarget = targetSelect.value;
      updateDirectDownloadLinks();
      if (currentResumeData) {
        currentResumeData.target = activeResumeTarget;
        // Re-fetch re-ordered data based on target
        try {
          const res = await apiFetch(`${API}/resume/data?target=${encodeURIComponent(activeResumeTarget)}&template=${encodeURIComponent(activeResumeTemplate)}`);
          if (res.ok) {
            const fresh = await res.json();
            // Preserve user-edited personal and summary, but adopt reordered skills & projects
            currentResumeData.skills = fresh.resume.skills;
            currentResumeData.projects = fresh.resume.projects;
            populateResumeEditor();
            renderLivePreview();
            runDebouncedQualityCheck();
          }
        } catch (e) {
          renderLivePreview();
        }
      }
    };
  }

  if (templateSelect && resumeTemplatesList.length) {
    templateSelect.innerHTML = resumeTemplatesList.map(tpl =>
      `<option value="${tpl.id}" ${tpl.id === (currentResumeData?.template || activeResumeTemplate) ? 'selected' : ''}>${tpl.name} (${tpl.badge})</option>`
    ).join("");

    templateSelect.onchange = () => {
      activeResumeTemplate = templateSelect.value;
      updateDirectDownloadLinks();
      if (currentResumeData) {
        currentResumeData.template = activeResumeTemplate;
        renderLivePreview();
      }
    };
  }
  updateDirectDownloadLinks();
}

function populateResumeEditor() {
  if (!currentResumeData) return;
  const p = currentResumeData.personal || {};

  // Personal inputs
  const bindInput = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = p[key] || "";
    el.oninput = () => {
      p[key] = el.value;
      renderLivePreview();
      runDebouncedQualityCheck();
    };
  };

  bindInput("res-name", "name");
  bindInput("res-email", "email");
  bindInput("res-phone", "phone");
  bindInput("res-location", "location");
  bindInput("res-linkedin", "linkedin");
  bindInput("res-github", "github");
  bindInput("res-portfolio", "portfolio");

  // Summary
  const sumEl = document.getElementById("res-summary");
  if (sumEl) {
    sumEl.value = currentResumeData.summary || "";
    sumEl.oninput = () => {
      currentResumeData.summary = sumEl.value;
      renderLivePreview();
      runDebouncedQualityCheck();
    };
  }

  // Regenerate Summary button
  const regenBtn = document.getElementById("res-regen-summary-btn");
  if (regenBtn) {
    regenBtn.onclick = async () => {
      try {
        const res = await apiFetch(`${API}/resume/data?target=${encodeURIComponent(activeResumeTarget)}&template=${encodeURIComponent(activeResumeTemplate)}`);
        if (res.ok) {
          const fresh = await res.json();
          currentResumeData.summary = fresh.resume.summary;
          sumEl.value = fresh.resume.summary;
          renderLivePreview();
          runDebouncedQualityCheck();
        }
      } catch (e) {
        console.error("Summary regen failed:", e);
      }
    };
  }

  // Education list
  renderEducationEditor();

  // Skills categorized
  renderSkillsEditor();

  // Projects list
  renderProjectsEditor();

  // Experience list
  renderExperienceEditor();

  // Certifications list
  renderCertificationsEditor();

  // Achievements list
  renderAchievementsEditor();

  // Languages
  const langInput = document.getElementById("res-languages-input");
  if (langInput) {
    langInput.value = (currentResumeData.languages || []).join(", ");
    langInput.oninput = () => {
      currentResumeData.languages = langInput.value.split(",").map(s => s.trim()).filter(Boolean);
      renderLivePreview();
      runDebouncedQualityCheck();
    };
  }
}

// ---------------- Education Editor
function renderEducationEditor() {
  const container = document.getElementById("res-education-list");
  if (!container) return;
  const eduList = currentResumeData.education || [];

  container.innerHTML = eduList.map((edu, idx) => `
    <div class="res-item-box">
      <div class="res-item-box-header">
        <span class="evidence-badge ${edu.evidence?.source_type === 'document' ? 'evidence-badge-verified' : 'evidence-badge-manual'}">
          ${edu.evidence?.source_type === 'document' ? '[Verified] ' + escapeHtml(edu.evidence.source_doc_title || 'Document') : 'Manual Entry'}
        </span>
        <button class="btn-remove-item" onclick="removeEducationItem(${idx})">Remove</button>
      </div>
      <div class="form-grid-2">
        <div class="field">
          <label class="field-label">Degree</label>
          <input type="text" value="${escapeHtml(edu.degree || '')}" oninput="updateEduField(${idx}, 'degree', this.value)" />
        </div>
        <div class="field">
          <label class="field-label">Institution</label>
          <input type="text" value="${escapeHtml(edu.institution || '')}" oninput="updateEduField(${idx}, 'institution', this.value)" />
        </div>
        <div class="field">
          <label class="field-label">Branch / Field</label>
          <input type="text" value="${escapeHtml(edu.branch || '')}" oninput="updateEduField(${idx}, 'branch', this.value)" />
        </div>
        <div class="field">
          <label class="field-label">Year / Duration</label>
          <input type="text" value="${escapeHtml(edu.year || '')}" oninput="updateEduField(${idx}, 'year', this.value)" />
        </div>
        <div class="field">
          <label class="field-label">Academic Score / CGPA</label>
          <input type="text" value="${escapeHtml(edu.cgpa || '')}" oninput="updateEduField(${idx}, 'cgpa', this.value)" />
        </div>
      </div>
    </div>
  `).join("");

  const addBtn = document.getElementById("res-add-edu-btn");
  if (addBtn) {
    addBtn.onclick = () => {
      eduList.push({
        degree: "Bachelor of Technology",
        institution: "University Institute",
        branch: "Computer Science",
        year: "2022 - 2026",
        cgpa: "8.5 / 10.0",
        evidence: { source_type: "manual", source_doc_title: "Manual" }
      });
      renderEducationEditor();
      renderLivePreview();
      runDebouncedQualityCheck();
    };
  }
}

window.updateEduField = function(idx, field, val) {
  if (currentResumeData?.education?.[idx]) {
    currentResumeData.education[idx][field] = val;
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

window.removeEducationItem = function(idx) {
  if (currentResumeData?.education) {
    currentResumeData.education.splice(idx, 1);
    renderEducationEditor();
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

// ---------------- Skills Editor
function renderSkillsEditor() {
  const container = document.getElementById("res-skills-categorized");
  if (!container) return;
  const skillsMap = currentResumeData.skills || {};

  container.innerHTML = Object.entries(skillsMap).map(([cat, list]) => `
    <div class="skill-category-block">
      <div class="skill-category-title">${escapeHtml(cat)}</div>
      <div class="skill-tags-wrap">
        ${list.map(s => `
          <span class="skill-tag-editable">
            ${escapeHtml(s)}
            <button onclick="removeSkillTag('${escapeHtml(cat)}', '${escapeHtml(s)}')">x</button>
          </span>
        `).join("")}
      </div>
      <div class="skill-add-input-wrap">
        <input type="text" id="add-skill-input-${cat.replace(/\s+/g, '')}" placeholder="+ Add ${escapeHtml(cat)}..." onkeydown="if(event.key==='Enter')addSkillTag('${escapeHtml(cat)}', this.value)" />
        <button class="secondary btn-xs" onclick="addSkillTag('${escapeHtml(cat)}', document.getElementById('add-skill-input-${cat.replace(/\s+/g, '')}').value)">Add</button>
      </div>
    </div>
  `).join("");
}

window.removeSkillTag = function(category, skillName) {
  if (currentResumeData?.skills?.[category]) {
    currentResumeData.skills[category] = currentResumeData.skills[category].filter(s => s !== skillName);
    if (currentResumeData.skills[category].length === 0) {
      delete currentResumeData.skills[category];
    }
    renderSkillsEditor();
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

window.addSkillTag = function(category, skillName) {
  const trimmed = skillName?.trim();
  if (!trimmed) return;
  if (!currentResumeData.skills[category]) {
    currentResumeData.skills[category] = [];
  }
  if (!currentResumeData.skills[category].includes(trimmed)) {
    currentResumeData.skills[category].push(trimmed);
  }
  renderSkillsEditor();
  renderLivePreview();
  runDebouncedQualityCheck();
};

// ---------------- Projects Editor
function renderProjectsEditor() {
  const container = document.getElementById("res-projects-list");
  if (!container) return;
  const projs = currentResumeData.projects || [];

  container.innerHTML = projs.map((p, idx) => `
    <div class="res-item-box">
      <div class="res-item-box-header">
        <span class="evidence-badge ${p.evidence?.source_type === 'document' ? 'evidence-badge-verified' : 'evidence-badge-manual'}">
          ${p.evidence?.source_type === 'document' ? '[Verified] ' + escapeHtml(p.evidence.source_doc_title || 'Document') : 'Manual Entry'}
        </span>
        <button class="btn-remove-item" onclick="removeProjectItem(${idx})">Remove</button>
      </div>
      <div class="form-grid-2">
        <div class="field" style="grid-column: 1 / -1;">
          <label class="field-label">Project Title</label>
          <input type="text" value="${escapeHtml(p.name || '')}" oninput="updateProjField(${idx}, 'name', this.value)" />
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <label class="field-label">Description & Architecture</label>
          <textarea rows="2" oninput="updateProjField(${idx}, 'description', this.value)">${escapeHtml(p.description || '')}</textarea>
        </div>
        <div class="field">
          <label class="field-label">Technologies (comma-separated)</label>
          <input type="text" value="${escapeHtml((p.technologies || []).join(', '))}" oninput="updateProjTechs(${idx}, this.value)" />
        </div>
        <div class="field">
          <label class="field-label">Project URL / GitHub</label>
          <input type="url" value="${escapeHtml(p.link || '')}" oninput="updateProjField(${idx}, 'link', this.value)" />
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <label class="field-label">Key Achievement / Quantified Result</label>
          <input type="text" value="${escapeHtml(p.achievements || '')}" oninput="updateProjField(${idx}, 'achievements', this.value)" />
        </div>
      </div>
    </div>
  `).join("");

  const addBtn = document.getElementById("res-add-project-btn");
  if (addBtn) {
    addBtn.onclick = () => {
      projs.push({
        name: "New Technical Project",
        description: "Built scalable software solution addressing target engineering requirements.",
        technologies: ["Python", "FastAPI"],
        role: "Developer",
        achievements: "Deployed production service with automated unit testing.",
        link: "",
        evidence: { source_type: "manual", source_doc_title: "Manual" }
      });
      renderProjectsEditor();
      renderLivePreview();
      runDebouncedQualityCheck();
    };
  }
}

window.updateProjField = function(idx, field, val) {
  if (currentResumeData?.projects?.[idx]) {
    currentResumeData.projects[idx][field] = val;
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

window.updateProjTechs = function(idx, val) {
  if (currentResumeData?.projects?.[idx]) {
    currentResumeData.projects[idx].technologies = val.split(",").map(t => t.trim()).filter(Boolean);
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

window.removeProjectItem = function(idx) {
  if (currentResumeData?.projects) {
    currentResumeData.projects.splice(idx, 1);
    renderProjectsEditor();
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

// ---------------- Experience Editor
function renderExperienceEditor() {
  const container = document.getElementById("res-experience-list");
  if (!container) return;
  const exps = currentResumeData.experience || [];

  container.innerHTML = exps.map((e, idx) => `
    <div class="res-item-box">
      <div class="res-item-box-header">
        <span class="evidence-badge ${e.evidence?.source_type === 'document' ? 'evidence-badge-verified' : 'evidence-badge-manual'}">
          ${e.evidence?.source_type === 'document' ? '[Verified] ' + escapeHtml(e.evidence.source_doc_title || 'Document') : 'Manual Entry'}
        </span>
        <button class="btn-remove-item" onclick="removeExperienceItem(${idx})">Remove</button>
      </div>
      <div class="form-grid-2">
        <div class="field">
          <label class="field-label">Role</label>
          <input type="text" value="${escapeHtml(e.role || '')}" oninput="updateExpField(${idx}, 'role', this.value)" />
        </div>
        <div class="field">
          <label class="field-label">Organization / Company</label>
          <input type="text" value="${escapeHtml(e.organization || '')}" oninput="updateExpField(${idx}, 'organization', this.value)" />
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <label class="field-label">Duration</label>
          <input type="text" value="${escapeHtml(e.duration || '')}" oninput="updateExpField(${idx}, 'duration', this.value)" />
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <label class="field-label">Responsibilities (One bullet per line)</label>
          <textarea rows="3" oninput="updateExpResps(${idx}, this.value)">${escapeHtml(Array.isArray(e.responsibilities) ? e.responsibilities.join('\n') : (e.responsibilities || ''))}</textarea>
        </div>
      </div>
    </div>
  `).join("");

  const addBtn = document.getElementById("res-add-exp-btn");
  if (addBtn) {
    addBtn.onclick = () => {
      exps.push({
        role: "Software Engineering Intern",
        organization: "Tech Organization",
        duration: "2025",
        responsibilities: [
          "Developed core backend modules and microservices.",
          "Implemented automated testing pipelines."
        ],
        technologies: ["Python", "SQL"],
        evidence: { source_type: "manual", source_doc_title: "Manual" }
      });
      renderExperienceEditor();
      renderLivePreview();
      runDebouncedQualityCheck();
    };
  }
}

window.updateExpField = function(idx, field, val) {
  if (currentResumeData?.experience?.[idx]) {
    currentResumeData.experience[idx][field] = val;
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

window.updateExpResps = function(idx, val) {
  if (currentResumeData?.experience?.[idx]) {
    currentResumeData.experience[idx].responsibilities = val.split("\n").map(l => l.trim()).filter(Boolean);
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

window.removeExperienceItem = function(idx) {
  if (currentResumeData?.experience) {
    currentResumeData.experience.splice(idx, 1);
    renderExperienceEditor();
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

// ---------------- Certifications Editor
function renderCertificationsEditor() {
  const container = document.getElementById("res-certifications-list");
  if (!container) return;
  const certs = currentResumeData.certifications || [];

  container.innerHTML = certs.map((c, idx) => `
    <div class="res-item-box">
      <div class="res-item-box-header">
        <span class="evidence-badge ${c.evidence?.source_type === 'document' ? 'evidence-badge-verified' : 'evidence-badge-manual'}">
          ${c.evidence?.source_type === 'document' ? '[Verified] ' + escapeHtml(c.evidence.source_doc_title || 'Document') : 'Manual Entry'}
        </span>
        <button class="btn-remove-item" onclick="removeCertificationItem(${idx})">Remove</button>
      </div>
      <div class="form-grid-2">
        <div class="field" style="grid-column: 1 / -1;">
          <label class="field-label">Certification Name</label>
          <input type="text" value="${escapeHtml(c.name || '')}" oninput="updateCertField(${idx}, 'name', this.value)" />
        </div>
        <div class="field">
          <label class="field-label">Issuing Organization</label>
          <input type="text" value="${escapeHtml(c.issuer || '')}" oninput="updateCertField(${idx}, 'issuer', this.value)" />
        </div>
        <div class="field">
          <label class="field-label">Date</label>
          <input type="text" value="${escapeHtml(c.date || '')}" oninput="updateCertField(${idx}, 'date', this.value)" />
        </div>
      </div>
    </div>
  `).join("");

  const addBtn = document.getElementById("res-add-cert-btn");
  if (addBtn) {
    addBtn.onclick = () => {
      certs.push({
        name: "Technical Certification",
        issuer: "Accredited Provider",
        date: "2024",
        credential_url: "",
        evidence: { source_type: "manual", source_doc_title: "Manual" }
      });
      renderCertificationsEditor();
      renderLivePreview();
      runDebouncedQualityCheck();
    };
  }
}

window.updateCertField = function(idx, field, val) {
  if (currentResumeData?.certifications?.[idx]) {
    currentResumeData.certifications[idx][field] = val;
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

window.removeCertificationItem = function(idx) {
  if (currentResumeData?.certifications) {
    currentResumeData.certifications.splice(idx, 1);
    renderCertificationsEditor();
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

// ---------------- Achievements Editor
function renderAchievementsEditor() {
  const container = document.getElementById("res-achievements-list");
  if (!container) return;
  const achs = currentResumeData.achievements || [];

  container.innerHTML = achs.map((a, idx) => `
    <div class="res-item-box">
      <div class="res-item-box-header">
        <span class="evidence-badge ${a.evidence?.source_type === 'document' ? 'evidence-badge-verified' : 'evidence-badge-manual'}">
          ${a.evidence?.source_type === 'document' ? '[Verified] ' + escapeHtml(a.evidence.source_doc_title || 'Document') : 'Manual Entry'}
        </span>
        <button class="btn-remove-item" onclick="removeAchievementItem(${idx})">Remove</button>
      </div>
      <div class="form-grid-2">
        <div class="field" style="grid-column: 1 / -1;">
          <label class="field-label">Award / Achievement Title</label>
          <input type="text" value="${escapeHtml(a.title || '')}" oninput="updateAchField(${idx}, 'title', this.value)" />
        </div>
        <div class="field" style="grid-column: 1 / -1;">
          <label class="field-label">Description</label>
          <input type="text" value="${escapeHtml(a.description || '')}" oninput="updateAchField(${idx}, 'description', this.value)" />
        </div>
        <div class="field">
          <label class="field-label">Date</label>
          <input type="text" value="${escapeHtml(a.date || '')}" oninput="updateAchField(${idx}, 'date', this.value)" />
        </div>
      </div>
    </div>
  `).join("");

  const addBtn = document.getElementById("res-add-ach-btn");
  if (addBtn) {
    addBtn.onclick = () => {
      achs.push({
        title: "Hackathon Award / Technical Honor",
        description: "Awarded 1st place in software development competition.",
        date: "2026",
        evidence: { source_type: "manual", source_doc_title: "Manual" }
      });
      renderAchievementsEditor();
      renderLivePreview();
      runDebouncedQualityCheck();
    };
  }
}

window.updateAchField = function(idx, field, val) {
  if (currentResumeData?.achievements?.[idx]) {
    currentResumeData.achievements[idx][field] = val;
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

window.removeAchievementItem = function(idx) {
  if (currentResumeData?.achievements) {
    currentResumeData.achievements.splice(idx, 1);
    renderAchievementsEditor();
    renderLivePreview();
    runDebouncedQualityCheck();
  }
};

// ---------------- Skill Intelligence Panel
function renderSkillIntelligence(intel) {
  if (!intel) return;

  const totalBadge = document.getElementById("resume-total-skills-badge");
  if (totalBadge) totalBadge.textContent = `${intel.total_skills} Skills`;

  const verifiedCount = document.getElementById("intel-verified-count");
  if (verifiedCount) verifiedCount.textContent = (intel.most_relevant || []).length;

  const catsCount = document.getElementById("intel-categories-count");
  if (catsCount) {
    const uniqueCats = new Set((intel.all_skills_with_evidence || []).map(s => s.category));
    catsCount.textContent = uniqueCats.size;
  }

  const recentCount = document.getElementById("intel-recent-count");
  if (recentCount) recentCount.textContent = (intel.recently_detected || []).length;

  const evidenceList = document.getElementById("resume-skill-evidence-list");
  if (evidenceList && intel.all_skills_with_evidence) {
    evidenceList.innerHTML = intel.all_skills_with_evidence.map(s => {
      const docTitles = (s.evidence || []).map(e => e.title).join(", ") || "Archive";
      return `
        <div class="evidence-item-row">
          <div>
            <span class="evidence-item-name">${escapeHtml(s.name)}</span>
            <span style="font-size:10px;color:var(--text-muted);margin-left:6px;">(${escapeHtml(s.category)})</span>
          </div>
          <div class="evidence-item-meta" title="${escapeHtml(docTitles)}">
            ${s.count} doc${s.count > 1 ? 's' : ''}
          </div>
        </div>
      `;
    }).join("");
  }
}

// ---------------- ATS Quality & Analysis Panel
function renderQualityChecker(analysis) {
  if (!analysis) return;

  const scoreVal = document.getElementById("ats-score-val");
  const gradeVal = document.getElementById("ats-grade-val");
  const scorePill = document.getElementById("ats-score-pill");

  if (scoreVal) scoreVal.textContent = analysis.ats_score;
  if (gradeVal) gradeVal.textContent = analysis.grade;

  if (scorePill) {
    if (analysis.ats_score >= 80) {
      scorePill.style.color = "#10b981";
      scorePill.style.borderColor = "rgba(16, 185, 129, 0.3)";
    } else if (analysis.ats_score >= 60) {
      scorePill.style.color = "#f59e0b";
      scorePill.style.borderColor = "rgba(245, 158, 11, 0.3)";
    } else {
      scorePill.style.color = "#ef4444";
      scorePill.style.borderColor = "rgba(239, 68, 68, 0.3)";
    }
  }

  const checksGrid = document.getElementById("resume-quality-checks");
  if (checksGrid && analysis.checks) {
    checksGrid.innerHTML = analysis.checks.map(c => `
      <div class="quality-check-item ${c.passed ? 'passed' : 'failed'}">
        <span>${c.passed ? '[Pass]' : '[Check]'}</span>
        <div>
          <div style="font-weight:600;">${escapeHtml(c.item)}</div>
          <div style="font-size:9.5px;color:var(--text-muted);">${c.score}/${c.max} pts</div>
        </div>
      </div>
    `).join("");
  }

  const suggList = document.getElementById("resume-quality-suggestions");
  if (suggList && analysis.suggestions) {
    suggList.innerHTML = analysis.suggestions.map(s => `
      <div class="quality-suggestion-item">
        <b>Recommendation:</b> ${escapeHtml(s)}
      </div>
    `).join("");
  }
}

function runDebouncedQualityCheck() {
  clearTimeout(resumeDebounceTimer);
  resumeDebounceTimer = setTimeout(async () => {
    if (!currentResumeData) return;
    try {
      const res = await apiFetch(`${API}/resume/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resume_data: currentResumeData })
      });
      if (res.ok) {
        const analysis = await res.json();
        renderQualityChecker(analysis);
      }
    } catch (e) {
      console.warn("Quality check error:", e);
    }
  }, 400);
}

// ---------------- LIVE RESUME PREVIEW RENDERER
function renderLivePreview() {
  if (!currentResumeData) return;

  const paper = document.getElementById("resume-paper");
  if (!paper) return;

  const tplId = currentResumeData.template || activeResumeTemplate || "minimal_professional";
  paper.className = `resume-paper template-${tplId}`;

  const tplTag = document.getElementById("preview-template-tag");
  if (tplTag) {
    const foundTpl = resumeTemplatesList.find(t => t.id === tplId);
    tplTag.textContent = foundTpl ? foundTpl.name : tplId;
  }

  const p = currentResumeData.personal || {};
  const summary = currentResumeData.summary || "";
  const skills = currentResumeData.skills || {};
  const projects = currentResumeData.projects || [];
  const exp = currentResumeData.experience || [];
  const edu = currentResumeData.education || [];
  const certs = currentResumeData.certifications || [];
  const achs = currentResumeData.achievements || [];
  const langs = currentResumeData.languages || [];

  // Contact list
  const contactParts = [];
  if (p.email) contactParts.push(`<a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a>`);
  if (p.phone) contactParts.push(`<span>${escapeHtml(p.phone)}</span>`);
  if (p.location) contactParts.push(`<span>${escapeHtml(p.location)}</span>`);
  if (p.linkedin) contactParts.push(`<a href="${escapeHtml(p.linkedin)}" target="_blank">LinkedIn</a>`);
  if (p.github) contactParts.push(`<a href="${escapeHtml(p.github)}" target="_blank">GitHub</a>`);
  if (p.portfolio) contactParts.push(`<a href="${escapeHtml(p.portfolio)}" target="_blank">Portfolio</a>`);

  const sep = tplId === "ats_friendly" ? " | " : " &bull; ";
  const contactHtml = contactParts.join(sep);

  // Section Ordering
  const target = currentResumeData.target || activeResumeTarget;
  let sectionOrder = ["summary", "skills", "experience", "projects", "education", "certifications", "achievements", "languages"];
  if (tplId === "student_internship" || target === "Student / Internship") {
    sectionOrder = ["summary", "education", "skills", "projects", "achievements", "experience", "certifications", "languages"];
  } else if (tplId === "technical") {
    sectionOrder = ["summary", "skills", "projects", "experience", "education", "certifications", "achievements", "languages"];
  }

  let sectionsHtml = "";

  for (const sec of sectionOrder) {
    if (sec === "summary" && summary) {
      sectionsHtml += `
        <div class="paper-section">
          <div class="paper-section-title">${tplId === "ats_friendly" ? "SUMMARY" : "Professional Summary"}</div>
          <div class="paper-body">${escapeHtml(summary)}</div>
        </div>
      `;
    } else if (sec === "skills" && Object.keys(skills).length) {
      sectionsHtml += `
        <div class="paper-section">
          <div class="paper-section-title">${tplId === "ats_friendly" ? "SKILLS" : "Technical Skills"}</div>
          <div class="paper-body ${tplId === 'technical' ? 'paper-skills-grid' : ''}">
            ${Object.entries(skills).map(([cat, list]) => `
              <div style="margin-bottom:3px;">
                <b>${escapeHtml(cat)}:</b>
                ${tplId === 'modern_developer'
                  ? list.map(s => `<span class="paper-tech-pill">${escapeHtml(s)}</span>`).join("")
                  : escapeHtml(list.join(", "))}
              </div>
            `).join("")}
          </div>
        </div>
      `;
    } else if (sec === "experience" && exp.length) {
      sectionsHtml += `
        <div class="paper-section">
          <div class="paper-section-title">${tplId === "ats_friendly" ? "EXPERIENCE" : "Experience & Internships"}</div>
          ${exp.map(e => `
            <div class="paper-entry">
              <div class="paper-entry-header">
                <span class="paper-entry-title">${escapeHtml(e.role || '')}${e.organization ? ' &mdash; ' + escapeHtml(e.organization) : ''}</span>
                <span class="paper-entry-date">${escapeHtml(e.duration || '')}</span>
              </div>
              ${Array.isArray(e.responsibilities) && e.responsibilities.length ? `
                <ul class="paper-bullet-list">
                  ${e.responsibilities.map(r => `<li>${escapeHtml(r)}</li>`).join("")}
                </ul>
              ` : ''}
            </div>
          `).join("")}
        </div>
      `;
    } else if (sec === "projects" && projects.length) {
      sectionsHtml += `
        <div class="paper-section">
          <div class="paper-section-title">${tplId === "ats_friendly" ? "PROJECTS" : "Projects"}</div>
          ${projects.map(prj => `
            <div class="paper-entry">
              <div class="paper-entry-header">
                <span class="paper-entry-title">
                  ${escapeHtml(prj.name || '')}
                  ${prj.technologies?.length ? ` | <i style="font-weight:normal;color:#475569;">${escapeHtml(prj.technologies.join(', '))}</i>` : ''}
                  ${prj.link ? ` [<a href="${escapeHtml(prj.link)}" target="_blank" style="color:var(--accent,#0f766e);">Link</a>]` : ''}
                </span>
              </div>
              <ul class="paper-bullet-list">
                ${prj.description ? `<li>${escapeHtml(prj.description)}</li>` : ''}
                ${prj.achievements ? `<li><b>Key Result:</b> ${escapeHtml(prj.achievements)}</li>` : ''}
              </ul>
            </div>
          `).join("")}
        </div>
      `;
    } else if (sec === "education" && edu.length) {
      sectionsHtml += `
        <div class="paper-section">
          <div class="paper-section-title">${tplId === "ats_friendly" ? "EDUCATION" : "Education"}</div>
          ${edu.map(ed => `
            <div class="paper-entry">
              <div class="paper-entry-header">
                <span class="paper-entry-title">
                  ${escapeHtml(ed.degree || '')}${ed.branch && !ed.degree.includes(ed.branch) ? ' in ' + escapeHtml(ed.branch) : ''}${ed.institution ? ' &mdash; ' + escapeHtml(ed.institution) : ''}
                </span>
                <span class="paper-entry-date">${escapeHtml(ed.year || '')}</span>
              </div>
              ${ed.cgpa ? `<div class="paper-entry-sub">&bull;&nbsp;<b>Academic Score:</b> ${escapeHtml(ed.cgpa)}</div>` : ''}
            </div>
          `).join("")}
        </div>
      `;
    } else if (sec === "certifications" && certs.length) {
      sectionsHtml += `
        <div class="paper-section">
          <div class="paper-section-title">${tplId === "ats_friendly" ? "CERTIFICATIONS" : "Certifications"}</div>
          ${certs.map(c => `
            <div class="paper-entry-header" style="margin-bottom:3px;">
              <span class="paper-entry-title">
                ${escapeHtml(c.name || '')}${c.issuer ? ' &mdash; ' + escapeHtml(c.issuer) : ''}
                ${c.credential_url ? ` [<a href="${escapeHtml(c.credential_url)}" target="_blank">Verify</a>]` : ''}
              </span>
              <span class="paper-entry-date">${escapeHtml(c.date || '')}</span>
            </div>
          `).join("")}
        </div>
      `;
    } else if (sec === "achievements" && achs.length) {
      sectionsHtml += `
        <div class="paper-section">
          <div class="paper-section-title">${tplId === "ats_friendly" ? "HONORS & AWARDS" : "Achievements & Honors"}</div>
          ${achs.map(a => `
            <div class="paper-entry">
              <div class="paper-entry-header">
                <span class="paper-entry-title">${escapeHtml(a.title || '')}</span>
                <span class="paper-entry-date">${escapeHtml(a.date || '')}</span>
              </div>
              ${a.description ? `<div class="paper-body">&bull;&nbsp;${escapeHtml(a.description)}</div>` : ''}
            </div>
          `).join("")}
        </div>
      `;
    } else if (sec === "languages" && langs.length) {
      sectionsHtml += `
        <div class="paper-section">
          <div class="paper-section-title">${tplId === "ats_friendly" ? "LANGUAGES" : "Languages"}</div>
          <div class="paper-body">${escapeHtml(langs.join(", "))}</div>
        </div>
      `;
    }
  }

  paper.innerHTML = `
    <div class="paper-header">
      <h1 class="paper-name">${escapeHtml(p.name || "Harshan")}</h1>
      ${contactHtml ? `<div class="paper-contact">${contactHtml}</div>` : ''}
    </div>
    <div class="paper-divider"></div>
    ${sectionsHtml}
  `;
}

// ---------------- Action Handlers: Download PDF, Save Draft, Reset
function updateDirectDownloadLinks() {
  const directLink = document.getElementById("resume-direct-download-link");
  if (directLink) {
    directLink.href = `${API}/resume/download?target=${encodeURIComponent(activeResumeTarget)}&template=${encodeURIComponent(activeResumeTemplate)}`;
  }
}

async function downloadResumePdf() {
  const btn = document.getElementById("resume-download-btn");
  const quickBtn = document.getElementById("preview-download-quick-btn");
  const origText = btn ? btn.textContent : "Download PDF";

  if (btn) btn.textContent = "Generating PDF...";
  if (quickBtn) quickBtn.textContent = "Generating...";

  try {
    if (!currentResumeData) {
      await loadResumeCreator();
    }
    if (!currentResumeData) {
      // Direct navigation fallback if data is not initialized
      window.location.href = `${API}/resume/download?target=${encodeURIComponent(activeResumeTarget)}&template=${encodeURIComponent(activeResumeTemplate)}`;
      return;
    }

    const res = await apiFetch(`${API}/resume/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume_data: currentResumeData })
    });

    if (!res.ok) {
      console.warn("Resume generate endpoint non-200 response, using direct download endpoint.");
      window.location.href = `${API}/resume/download?target=${encodeURIComponent(activeResumeTarget)}&template=${encodeURIComponent(activeResumeTemplate)}`;
      return;
    }

    const blob = await res.blob();
    if (!blob || blob.size === 0) {
      window.location.href = `${API}/resume/download?target=${encodeURIComponent(activeResumeTarget)}&template=${encodeURIComponent(activeResumeTemplate)}`;
      return;
    }

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    const name = (currentResumeData?.personal?.name || "Resume").replace(/\s+/g, "_");
    a.download = `${name}_Resume.pdf`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      a.remove();
    }, 30000);
  } catch (err) {
    console.warn("PDF generation error, triggering fallback direct download:", err);
    window.location.href = `${API}/resume/download?target=${encodeURIComponent(activeResumeTarget)}&template=${encodeURIComponent(activeResumeTemplate)}`;
  } finally {
    if (btn) btn.textContent = origText;
    if (quickBtn) quickBtn.textContent = "PDF";
  }
}

async function saveResumeDraft() {
  if (!currentResumeData) return;
  const statusEl = document.getElementById("resume-save-status");
  if (statusEl) statusEl.textContent = "Saving...";

  try {
    const res = await apiFetch(`${API}/resume/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target: currentResumeData.target || activeResumeTarget,
        template: currentResumeData.template || activeResumeTemplate,
        resume_data: currentResumeData
      })
    });

    if (res.ok) {
      if (statusEl) statusEl.textContent = "Saved " + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      if (statusEl) statusEl.textContent = "Save failed";
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = "Save error";
  }
}

// Attach event listeners for toolbar actions
document.getElementById("resume-download-btn")?.addEventListener("click", downloadResumePdf);
document.getElementById("preview-download-quick-btn")?.addEventListener("click", downloadResumePdf);
document.getElementById("resume-save-btn")?.addEventListener("click", saveResumeDraft);
document.getElementById("resume-refresh-btn")?.addEventListener("click", () => {
  if (confirm("Re-sync resume data with your latest uploaded documents? Any unsaved manual edits will be refreshed.")) {
    loadResumeCreator();
  }
});
document.getElementById("resume-analyze-btn")?.addEventListener("click", () => {
  runDebouncedQualityCheck();
  const qPanel = document.getElementById("resume-quality-panel");
  if (qPanel) qPanel.scrollIntoView({ behavior: "smooth" });
});

// Zoom controls
document.getElementById("preview-zoom-in")?.addEventListener("click", () => {
  resumeZoomLevel = Math.min(1.4, resumeZoomLevel + 0.1);
  const paper = document.getElementById("resume-paper");
  const zoomVal = document.getElementById("preview-zoom-val");
  if (paper) paper.style.transform = `scale(${resumeZoomLevel})`;
  if (zoomVal) zoomVal.textContent = Math.round(resumeZoomLevel * 100) + "%";
});

document.getElementById("preview-zoom-out")?.addEventListener("click", () => {
  resumeZoomLevel = Math.max(0.6, resumeZoomLevel - 0.1);
  const paper = document.getElementById("resume-paper");
  const zoomVal = document.getElementById("preview-zoom-val");
  if (paper) paper.style.transform = `scale(${resumeZoomLevel})`;
  if (zoomVal) zoomVal.textContent = Math.round(resumeZoomLevel * 100) + "%";
});


initAuth();

// Support direct hash navigation (e.g. #resume)
window.addEventListener("hashchange", () => {
  const h = window.location.hash.replace("#", "").trim();
  if (h) activateTab(h);
});

// Check initial URL hash on load
document.addEventListener("DOMContentLoaded", () => {
  const h = window.location.hash.replace("#", "").trim();
  if (h) {
    setTimeout(() => activateTab(h), 150);
  }
});

