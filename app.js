// ═══════════════════════════════════════════
// TAP+ MULTI-TENANT PLATFORM — CLEAN REWRITE
// ═══════════════════════════════════════════

// ─── STORAGE ───────────────────────────────
const LS = {
  get(key, fallback) {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
  },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  del(key) { try { localStorage.removeItem(key); } catch {} }
};

// ─── CONSTANTS ─────────────────────────────
const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const COLORS     = ["#00e5a0","#7c6aff","#ff6b35","#ffd166","#ff4455","#38bdf8","#f472b6","#a3e635"];

// ─── DEFAULTS ──────────────────────────────
const DEFAULT_BRAND = {
  name:"Your Restaurant", tagline:"We'd love your feedback",
  ratingQuestion:"How was your experience today?",
  reviewPrompt:"Glad to hear it! Share your experience:",
  thankYouMsg:"Thank you! Your feedback means a lot.",
  lowRatingMsg:"We're sorry. Tell us what happened:",
  logoUrl:"", brandColor:"#00e5a0", bgColor:"#0a0a0f", textColor:"#ffffff"
};
const DEFAULT_LINKS = [
  {id:"gl",label:"Google",icon:"🔍",url:"https://search.google.com/local/writereview?placeid=YOUR_ID",active:true},
  {id:"yl",label:"Yelp",icon:"⭐",url:"https://www.yelp.com/writeareview/biz/YOUR_ID",active:false}
];
const DEFAULT_STAFF = [{id:"s1",firstName:"Staff",lastInitial:"M",color:"#00e5a0",passcode:"1234",active:true}];

// ─── HELPERS ───────────────────────────────
const $      = id => document.getElementById(id);
const uid    = () => Math.random().toString(36).slice(2,11);
const ini    = (n="") => n.split(" ").map(w=>w[0]||"").join("").toUpperCase().slice(0,2);
const esc    = (s="") => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const slugify= (s="") => s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const fmt    = ts => { const d=new Date(ts); return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+", "+d.toLocaleDateString([],{month:"short",day:"numeric"}); };
const wsStart= () => { const d=new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); return d.getTime(); };
const clone  = o => JSON.parse(JSON.stringify(o));

// Staff name helpers
// Stores: { firstName, lastInitial } → display as "Alisha S."
// URL slug: "alisha-s"
const staffDisplayName = s => s.firstName + (s.lastInitial ? " " + s.lastInitial.toUpperCase() + "." : "");
const staffUrlSlug     = s => (s.firstName + (s.lastInitial ? "-" + s.lastInitial : "")).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
// ini for avatar: first letter of first + last initial
const staffIni         = s => ((s.firstName||"")[0]||(s.name||"")[0]||"").toUpperCase() + ((s.lastInitial||"")[0]||(s.name||" ")[1]||"").toUpperCase();
// Backwards compat: parse old single-name into parts
function staffParts(s) {
  if (s.firstName) return s;
  const parts = (s.name||"").trim().split(/\s+/);
  return { ...s, firstName: parts[0]||"", lastInitial: parts[1] ? parts[1][0] : "" };
}

// ─── BUSINESS STORAGE ──────────────────────
function getBizList() { return LS.get("tp_businesses",[]); }

function getBiz(sl) {
  const s = LS.get("tp_biz_"+sl, null);
  if (!s) return null;
  return {
    name:         s.name         || "Unnamed",
    slug:         s.slug         || sl,
    storeCode:    s.storeCode    || sl,
    bizAdminPin:  s.bizAdminPin  || "",
    brand:        {...DEFAULT_BRAND, ...(s.brand     || {})},
    links:        Array.isArray(s.links)      ? s.links      : clone(DEFAULT_LINKS),
    staff:        Array.isArray(s.staff)      ? s.staff      : clone(DEFAULT_STAFF),
    mgrPin:       s.mgrPin   || "1234",
    teamGoals:    Array.isArray(s.teamGoals)  ? s.teamGoals  : [],
    staffGoals:   s.staffGoals || {}
  };
}

// Lookup biz by store code (case-insensitive)
function getBizByCode(code) {
  const normalized = code.trim().toLowerCase().replace(/\s+/g,"-");
  const list = getBizList();
  for (const sl of list) {
    const b = getBiz(sl);
    if (!b) continue;
    // Match against storeCode OR slug
    const sc = (b.storeCode||"").toLowerCase();
    if (sc === normalized || sl === normalized) return b;
  }
  return null;
}

function saveBiz(biz) {
  LS.set("tp_biz_"+biz.slug, biz);
  const list = getBizList();
  if (!list.includes(biz.slug)) { list.push(biz.slug); LS.set("tp_businesses",list); }
}

function deleteBiz(sl) {
  LS.del("tp_biz_"+sl);
  LS.set("tp_businesses", getBizList().filter(x=>x!==sl));
}

const getApiKey  = () => LS.get("tp_key","");
const getAdminPin= () => LS.get("tp_admin_pin","0000");

// ─── FIREBASE SDK ──────────────────────────
// Uses Firebase JS SDK loaded via CDN in index.html (compat version)
// firebase object is available globally after SDK scripts load

function getFbCfg() {
  try {
    const r = LS.get("tp_fb", null);
    if (!r) return null;
    const cfg = typeof r === "string" ? JSON.parse(r) : r;
    if (!cfg || !cfg.apiKey || !cfg.projectId) return null;
    return cfg;
  } catch(e) { return null; }
}

let _db = null;

// Load Firebase SDK dynamically if not already on page
function loadFbSdk() {
  return new Promise((resolve) => {
    if (typeof firebase !== "undefined") { resolve(true); return; }
    let loaded = 0;
    const done = () => { loaded++; if (loaded === 2) resolve(true); };
    const fail = () => resolve(false);
    const s1 = document.createElement("script");
    s1.src = "https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js";
    s1.crossOrigin = "anonymous";
    s1.onload = done; s1.onerror = fail;
    const s2 = document.createElement("script");
    s2.src = "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore-compat.js";
    s2.crossOrigin = "anonymous";
    s2.onload = done; s2.onerror = fail;
    document.head.appendChild(s1);
    // Load s2 after s1 to ensure correct order
    s1.onload = () => { done(); document.head.appendChild(s2); };
  });
}

async function getDb() {
  if (_db) return _db;
  const cfg = getFbCfg();
  if (!cfg) return null;
  try {
    // Ensure SDK is loaded
    if (typeof firebase === "undefined") {
      console.warn("Firebase not loaded, loading dynamically...");
      const ok = await loadFbSdk();
      if (!ok || typeof firebase === "undefined") {
        console.error("Firebase SDK failed to load");
        return null;
      }
    }
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    _db = firebase.firestore(app);
    return _db;
  } catch(e) {
    console.error("getDb error:", e.code, e.message);
    _db = null;
    return null;
  }
}

async function saveTap(tap) {
  const db = await getDb();
  if (!db) { console.warn("saveTap: no db"); return; }
  try {
    await db.collection("taps").doc(tap.id).set(tap);
    console.log("saveTap OK:", tap.id);
  } catch(e) { console.error("saveTap error:", e.code, e.message); }
}

async function fbQueryTaps(bizSlug, staffId) {
  const db = await getDb();
  if (!db) return null;
  try {
    let q = db.collection("taps").where("bizSlug", "==", bizSlug).limit(500);
    const snap = await q.get();
    let docs = snap.docs.map(d => d.data());
    docs = docs.filter(t => t.status === "rated" || t.rating != null);
    if (staffId) docs = docs.filter(t => t.staffId === staffId);
    docs.sort((a,b) => (b.ts||0)-(a.ts||0));
    console.log("fbQueryTaps:", bizSlug, staffId||"all", "→", docs.length);
    return docs;
  } catch(e) { console.error("fbQueryTaps error:", e.code, e.message); return []; }
}

const _tapCache = {};
async function getTaps(bizSlug, staffId) {
  const key = bizSlug + "|" + (staffId||"all");
  if (_tapCache[key]) return _tapCache[key];
  const result = await fbQueryTaps(bizSlug, staffId);
  if (result !== null) _tapCache[key] = result;
  return result || getDemoTaps();
}
function clearTapCache(bizSlug) {
  Object.keys(_tapCache).forEach(k => { if (k.startsWith(bizSlug)) delete _tapCache[k]; });
}

// ─── GROQ AI ───────────────────────────────
let _aiCache = {};
let _aiArgs  = {};

async function callGroq(prompt, key) {
  const sys = "You are Tap+ AI, a restaurant performance analyst. Use **bold**, ## headings, - bullets. Be specific and concise. Never invent data.";
  const res = await fetch(GROQ_URL, {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
    body:JSON.stringify({model:GROQ_MODEL,messages:[{role:"system",content:sys},{role:"user",content:prompt}],max_tokens:900,temperature:0.7})
  });
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(res.status===401?"INVALID_KEY":e?.error?.message||"API error"); }
  const d = await res.json();
  return d?.choices?.[0]?.message?.content || "";
}

function renderAIBlock(id, prompt, ckey, msg) {
  const el = $(id); if (!el) return;
  const key = getApiKey();
  if (!key) { el.innerHTML="<div class='ai-nokey'>⚠️ No API key — set it in super-admin.</div>"; return; }
  const k = ckey || prompt.slice(0,80);
  _aiArgs[k] = [id, prompt, ckey, msg];
  if (_aiCache[k]) { el.innerHTML = aiOut(_aiCache[k], k); return; }
  el.innerHTML = "<div class='ai-loading'><div class='ai-spinner'></div>"+esc(msg||"Analyzing…")+"</div>";
  callGroq(prompt, key)
    .then(t => { _aiCache[k]=t; el.innerHTML=aiOut(t,k); })
    .catch(e => { el.innerHTML="<div class='ai-err'>"+(e.message==="INVALID_KEY"?"❌ Invalid key":"❌ "+esc(e.message))+"</div>"; });
}

function aiOut(text, k) {
  return `<div class='ai-out'><div class='ai-out-lbl'><span class='ai-mini-dot'></span> AI Analysis</div><div class='ai-out-text'>${mdRender(text)}</div><button class='ai-refresh' onclick='refreshAI("${k}")'>↻ Refresh</button></div>`;
}

window.refreshAI = function(k) {
  delete _aiCache[k];
  const args = _aiArgs[k];
  if (args) renderAIBlock(...args);
};

function mdRender(text="") {
  return text.split("\n").map(line => {
    const bold = s => s.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>");
    if (line.startsWith("## "))  return `<div style="font-weight:800;font-size:14px;margin:13px 0 6px;color:#eef0f8">${esc(line.slice(3))}</div>`;
    if (line.startsWith("- "))  return `<div style="display:flex;gap:7px;margin-bottom:5px"><span style="color:#a78bfa">›</span><span>${bold(esc(line.slice(2)))}</span></div>`;
    if (!line.trim()) return "<br/>";
    return `<div>${bold(esc(line))}</div>`;
  }).join("");
}

// ─── MODAL / TOAST ─────────────────────────
let _modal = null, _toastT = null;

function showModal(html) {
  if (_modal) _modal.remove();
  _modal = document.createElement("div");
  _modal.className = "modal-overlay";
  _modal.innerHTML = `<div class='modal'>${html}</div>`;
  _modal.addEventListener("click", e => { if (e.target===_modal) closeModal(); });
  document.body.appendChild(_modal);
}
window.closeModal = function() { if (_modal) { _modal.remove(); _modal=null; } };

function showToast(msg) {
  let t = $("toast-el");
  if (!t) {
    t = document.createElement("div"); t.id="toast-el";
    t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(60px);background:#0e0f15;border:1px solid rgba(167,139,250,.35);border-radius:100px;padding:10px 20px;font-size:13px;font-weight:600;transition:transform .35s cubic-bezier(.34,1.56,.64,1);z-index:9999;white-space:nowrap;color:#eef0f8;font-family:inherit";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.transform = "translateX(-50%) translateY(0)";
  clearTimeout(_toastT);
  _toastT = setTimeout(() => t.style.transform="translateX(-50%) translateY(60px)", 2500);
}

// ─── PIN PAD ───────────────────────────────
function renderPinPad(containerId, title, sub, hint, dotColor, onSuccess, onBack) {
  const el = $(containerId); if (!el) return;
  let val = "";

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;padding:40px 20px;text-align:center;position:relative">
      ${onBack ? `<button id="pin-back" style="position:absolute;top:16px;left:16px;background:none;border:none;color:rgba(238,240,248,.4);font-size:22px;cursor:pointer">←</button>` : ""}
      <div style="font-size:20px;font-weight:800;margin-bottom:5px;letter-spacing:-.02em">${esc(title)}</div>
      <div style="font-size:13px;color:rgba(238,240,248,.4);margin-bottom:26px;font-weight:500">${esc(sub)}</div>
      <div style="display:flex;gap:11px;justify-content:center;margin-bottom:22px">
        ${[0,1,2,3].map(()=>`<div class="pd" style="width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.15);transition:all .18s"></div>`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:9px;max-width:210px">
        ${["1","2","3","4","5","6","7","8","9","C","0","⌫"].map(k=>`<div class="pin-key" data-k="${k}" style="background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:13px;padding:16px;font-size:19px;font-weight:700;cursor:pointer;text-align:center;user-select:none;-webkit-user-select:none">${k}</div>`).join("")}
      </div>
      <div class="pe" style="color:#ff4455;font-size:13px;margin-top:11px;min-height:18px;font-weight:500"></div>
      ${hint ? `<div style="font-size:11px;color:rgba(238,240,248,.18);margin-top:14px;font-weight:500">${esc(hint)}</div>` : ""}
    </div>`;

  const dots = el.querySelectorAll(".pd");
  const errEl = el.querySelector(".pe");

  function update() {
    dots.forEach((d,i) => { d.style.background=i<val.length?dotColor:"transparent"; d.style.borderColor=i<val.length?dotColor:"rgba(255,255,255,.15)"; });
    errEl.textContent = "";
  }

  const backBtn = el.querySelector("#pin-back");
  if (backBtn && onBack) backBtn.addEventListener("click", onBack);

  el.querySelectorAll(".pin-key").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.k;
      if (k==="C") val="";
      else if (k==="⌫") val=val.slice(0,-1);
      else if (val.length<4) val+=k;
      update();
      if (val.length===4) {
        const entered=val; val=""; update();
        setTimeout(() => { if (!onSuccess(entered)) errEl.textContent="Incorrect. Try again."; }, 180);
      }
    });
  });
}

// ─── ROUTER ────────────────────────────────
function route() {
  const path  = window.location.pathname.replace(/\/+$/,"");
  const app   = $("app"); if (!app) return;
  const parts = path.split("/").filter(Boolean);

  // / → platform home (staff/manager see this, admin button hidden bottom-left)
  if (!parts.length) { renderPlatformHome(app); return; }

  const sl  = parts[0];
  const biz = getBiz(sl);

  // /[slug]/dashboard → business staff + manager login
  if (parts[1]==="dashboard") { biz ? renderBizDash(app,biz) : (app.innerHTML=notFound()); return; }

  // /[slug]/tap/[id] or /[slug] → customer page
  if (parts[1]==="tap" || parts.length===1) { biz ? renderCustomerPage(app,biz,parts[1]==="tap"?parts[2]:null) : (app.innerHTML=notFound()); return; }

  app.innerHTML = notFound();
}

function notFound() {
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px;color:#eef0f8"><div style="font-size:44px;margin-bottom:14px">🤔</div><div style="font-weight:800;font-size:20px;margin-bottom:8px">Page not found</div><div style="font-size:13px;color:rgba(238,240,248,.4)">Check the URL and try again.</div></div>`;
}

// ═══════════════════════════════════════════
// SUPER ADMIN
// ═══════════════════════════════════════════
// ─── PLATFORM HOME (tapplus.link) ──────────
function renderPlatformHome(app) {
  app.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:40px 24px;text-align:center;position:relative;z-index:1">
      <div style="font-weight:900;font-size:52px;letter-spacing:-.04em;margin-bottom:8px;background:linear-gradient(135deg,#fff 60%,rgba(255,255,255,.4));-webkit-background-clip:text;-webkit-text-fill-color:transparent">Tap<span style="-webkit-text-fill-color:#00e5a0">+</span></div>
      <div style="font-size:14px;color:rgba(238,240,248,.4);font-weight:500;margin-bottom:48px;letter-spacing:.02em">Smart review management</div>

      <div style="width:100%;max-width:320px">
        <div style="font-size:13px;font-weight:600;color:rgba(238,240,248,.4);margin-bottom:16px;letter-spacing:.04em;text-transform:uppercase">Enter Store Code</div>
        <input id="store-code-inp" class="inp" placeholder="e.g. JAMES or 4821" maxlength="20"
          style="text-align:center;font-size:18px;font-weight:700;letter-spacing:.08em;margin-bottom:8px;text-transform:uppercase"
          oninput="this.value=this.value.toUpperCase()"
          onkeydown="if(event.key==='Enter')_submitStoreCode()"/>
        <div id="store-code-err" style="color:#ff4455;font-size:12px;font-weight:500;min-height:16px;margin-bottom:12px"></div>
        <button onclick="_submitStoreCode()" style="width:100%;padding:14px;background:#00e5a0;color:#07080c;border:none;border-radius:12px;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit">Continue →</button>
      </div>

      <button onclick="showSuperAdminPin()" style="position:fixed;bottom:16px;left:16px;background:none;border:none;cursor:pointer;padding:8px;border-radius:8px;color:rgba(238,240,248,.1);font-size:11px;font-weight:700;letter-spacing:.06em;font-family:inherit;transition:color .2s" onmouseover="this.style.color='rgba(238,240,248,.4)'" onmouseout="this.style.color='rgba(238,240,248,.1)'">Admin</button>
    </div>`;

  // Auto-focus the input
  setTimeout(() => { const inp = $("store-code-inp"); if (inp) inp.focus(); }, 100);

  window._submitStoreCode = function() {
    const raw = ($("store-code-inp") || {}).value || "";
    const code = raw.trim().toLowerCase().replace(/\s+/g, "-");
    const err = $("store-code-err");

    if (!code) {
      if (err) err.textContent = "Enter your store code";
      return;
    }

    const biz = getBizByCode(code);
    if (!biz) {
      if (err) err.textContent = "Store code not found. Check with your manager.";
      // Shake the input
      const inp = $("store-code-inp");
      if (inp) { inp.style.borderColor = "#ff4455"; setTimeout(() => inp.style.borderColor = "", 1500); }
      return;
    }

    // Valid — go to step 2: role select for this business
    renderRoleSelect(app, biz);
  };
}

function renderRoleSelect(app, biz) {
  const bc = biz.brand?.brandColor || "#00e5a0";
  app.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:40px 24px;text-align:center;position:relative;z-index:1">
      <button onclick="renderPlatformHome($('app'))" style="position:absolute;top:20px;left:20px;background:none;border:none;color:rgba(238,240,248,.4);font-size:22px;cursor:pointer">←</button>

      <div style="width:48px;height:48px;border-radius:14px;background:${bc}22;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:18px;color:${bc};margin-bottom:12px;flex-shrink:0">${ini(biz.name)}</div>
      <div style="font-weight:800;font-size:20px;letter-spacing:-.02em;margin-bottom:4px">${esc(biz.name)}</div>
      <div style="font-size:13px;color:rgba(238,240,248,.38);font-weight:500;margin-bottom:40px">Who are you?</div>

      <div style="width:100%;max-width:300px;display:flex;flex-direction:column;gap:11px">
        <div onclick="_goToPIN('staff')" style="background:#0e0f15;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px 22px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:14px;transition:border-color .15s" onmouseover="this.style.borderColor='rgba(255,255,255,.2)'" onmouseout="this.style.borderColor='rgba(255,255,255,.08)'">
          <div style="width:44px;height:44px;border-radius:13px;background:rgba(0,229,160,.08);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">👤</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:15px;margin-bottom:2px">Staff</div>
            <div style="font-size:12px;color:rgba(238,240,248,.38)">Enter your employee PIN</div>
          </div>
          <div style="font-size:18px;color:rgba(238,240,248,.25)">›</div>
        </div>

        <div onclick="_goToPIN('manager')" style="background:#0e0f15;border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:20px 22px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:14px;transition:border-color .15s" onmouseover="this.style.borderColor='rgba(255,255,255,.2)'" onmouseout="this.style.borderColor='rgba(255,255,255,.08)'">
          <div style="width:44px;height:44px;border-radius:13px;background:rgba(167,139,250,.08);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">⚙️</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:15px;margin-bottom:2px">Manager</div>
            <div style="font-size:12px;color:rgba(238,240,248,.38)">Enter your manager PIN</div>
          </div>
          <div style="font-size:18px;color:rgba(238,240,248,.25)">›</div>
        </div>

        <div onclick="_goToPIN('bizadmin')" style="background:#0e0f15;border:1px solid rgba(255,107,53,.18);border-radius:18px;padding:20px 22px;cursor:pointer;text-align:left;display:flex;align-items:center;gap:14px;transition:border-color .15s" onmouseover="this.style.borderColor='rgba(255,107,53,.4)'" onmouseout="this.style.borderColor='rgba(255,107,53,.18)'">
          <div style="width:44px;height:44px;border-radius:13px;background:rgba(255,107,53,.08);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">🏢</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:15px;margin-bottom:2px;color:#ff6b35">Business Admin</div>
            <div style="font-size:12px;color:rgba(238,240,248,.38)">Full access to this location</div>
          </div>
          <div style="font-size:18px;color:rgba(238,240,248,.25)">›</div>
        </div>
      </div>

      <button onclick="showSuperAdminPin()" style="position:fixed;bottom:16px;left:16px;background:none;border:none;cursor:pointer;padding:8px;color:rgba(238,240,248,.1);font-size:11px;font-weight:700;letter-spacing:.06em;font-family:inherit;transition:color .2s" onmouseover="this.style.color='rgba(238,240,248,.4)'" onmouseout="this.style.color='rgba(238,240,248,.1)'">Admin</button>
    </div>`;

  window._goToPIN = function(role) {
    renderLoginPIN(app, biz, role);
  };
}

function renderLoginPIN(app, biz, role) {
  const bc = biz.brand?.brandColor || "#00e5a0";
  const isMgr   = role === "manager";
  const isBizAdmin = role === "bizadmin";
  const title = isBizAdmin ? "Business Admin PIN" : isMgr ? "Manager PIN" : "Employee PIN";
  const color = isBizAdmin ? "#ff6b35" : isMgr ? "#a78bfa" : bc;

  app.innerHTML = `<div id="login-pin-wrap" style="min-height:100vh;display:flex;flex-direction:column;position:relative">
    <button onclick="renderRoleSelect($('app'),getBiz('${biz.slug}'))" style="position:absolute;top:20px;left:20px;background:none;border:none;color:rgba(238,240,248,.4);font-size:22px;cursor:pointer;z-index:10">←</button>
  </div>`;

  setTimeout(() => {
    renderPinPad("login-pin-wrap", title, biz.name, "", color, v => {
      if (isBizAdmin) {
        if (biz.bizAdminPin && v === biz.bizAdminPin) {
          sessionStorage.setItem("biz_auth_" + biz.slug, "bizadmin");
          app.innerHTML = "<div id='biz-dash' style='min-height:100vh;display:flex;flex-direction:column'></div>";
          setTimeout(() => renderBizAdminDash($("biz-dash"), biz), 0);
          return true;
        }
        return false;
      } else if (isMgr) {
        if (v === biz.mgrPin) {
          sessionStorage.setItem("biz_auth_" + biz.slug, "manager");
          app.innerHTML = "<div id='biz-dash' style='min-height:100vh;display:flex;flex-direction:column'></div>";
          setTimeout(() => renderManagerDash($("biz-dash"), biz), 0);
          return true;
        }
        return false;
      } else {
        const s = biz.staff.find(x => x.passcode === v && x.active);
        if (s) {
          sessionStorage.setItem("biz_auth_" + biz.slug, "staff:" + s.id);
          app.innerHTML = "<div id='biz-dash' style='min-height:100vh;display:flex;flex-direction:column'></div>";
          setTimeout(() => renderStaffDash($("biz-dash"), biz, s), 0);
          return true;
        }
        return false;
      }
    }, () => renderRoleSelect(app, biz));
  }, 0);
}

function showSuperAdminPin() {
  const app = $("app");
  // Overlay the pin pad without leaving the home page
  const overlay = document.createElement("div");
  overlay.id = "sa-overlay";
  overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:500;display:flex;align-items:center;justify-content:center";
  overlay.innerHTML = "<div id='sa-pin-inner' style='width:100%;max-width:360px;min-height:420px;display:flex;flex-direction:column'></div>";
  overlay.addEventListener("click", e => { if (e.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  setTimeout(() => {
    renderPinPad("sa-pin-inner","Tap+ Admin","Enter your PIN","",  "#a78bfa", v => {
      if (v===getAdminPin()) {
        overlay.remove();
        renderSuperAdmin(app);
        return true;
      }
      return false;
    }, () => overlay.remove());
  }, 0);
}

function renderSuperAdmin(app) {
  app.innerHTML = "<div id='sa-root' style='min-height:100vh'></div>";
  const el = $("sa-root");
  renderSAPanel(el);
}

function renderSAPanel(el) {
  const bizList = getBizList();
  const apiKey  = getApiKey();
  const fbCfg   = getFbCfg();

  el.innerHTML = `
    <div style="max-width:520px;margin:0 auto;padding:24px 18px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px">
        <div>
          <div style="font-weight:900;font-size:22px;letter-spacing:-.03em">Tap<span style="color:#00e5a0">+</span> Admin</div>
          <div style="font-size:12px;color:rgba(238,240,248,.38);margin-top:2px;font-weight:500">Super Admin Panel</div>
        </div>
        <div style="display:flex;gap:8px">
          <button onclick='window.location.href="/"' style="background:#15171f;border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:7px 13px;font-size:12px;color:rgba(238,240,248,.5);cursor:pointer;font-family:inherit;font-weight:600">← Home</button>
          <button onclick='sessionStorage.removeItem("sa_auth");window.location.href="/"' style="background:rgba(255,68,85,.08);border:1px solid rgba(255,68,85,.2);border-radius:9px;padding:7px 13px;font-size:12px;color:#ff4455;cursor:pointer;font-family:inherit;font-weight:600">Sign Out</button>
        </div>
      </div>

      <div class="sec-lbl">Businesses (${bizList.length})</div>
      ${bizList.length===0
        ? `<div style="background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:20px;text-align:center;font-size:13px;color:rgba(238,240,248,.38);margin-bottom:12px">No businesses yet.</div>`
        : bizList.map(sl => {
            const b = getBiz(sl); if (!b) return "";
            const bc = b.brand?.brandColor||"#00e5a0";
            return `<div style="background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px 16px;margin-bottom:10px">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:36px;height:36px;border-radius:10px;background:${bc}22;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:${bc};flex-shrink:0">${ini(b.name)}</div>
                <div style="flex:1">
                  <div style="font-weight:700;font-size:14px">${esc(b.name)}</div>
                  <div style="display:flex;align-items:center;gap:8px;margin-top:3px;flex-wrap:wrap">
                    <span style="font-size:11px;background:rgba(0,229,160,.1);color:#00e5a0;border-radius:6px;padding:2px 8px;font-weight:800;letter-spacing:.06em">${esc(b.storeCode||sl)}</span>
                    <span style="font-size:11px;color:rgba(238,240,248,.38);font-weight:500">${b.staff.filter(s=>s.active).length} staff · tapplus.link/${esc(sl)}</span>
                  </div>
                </div>
                <div style="display:flex;gap:6px">
                  <button onclick='window.open("/${sl}","_blank")' style="background:rgba(0,229,160,.08);border:1px solid rgba(0,229,160,.2);border-radius:8px;padding:5px 10px;font-size:11px;color:#00e5a0;cursor:pointer;font-weight:700;font-family:inherit">👁 Page</button>
                  <button onclick='window.location.href="/${sl}/dashboard"' style="background:#15171f;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:5px 10px;font-size:11px;color:rgba(238,240,248,.6);cursor:pointer;font-weight:600;font-family:inherit">Dashboard</button>
                  <button onclick='saEditBiz("${sl}")' style="background:#15171f;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:5px 10px;font-size:11px;color:rgba(238,240,248,.6);cursor:pointer;font-weight:600;font-family:inherit">✏</button>
                  <button onclick='saDeleteBiz("${sl}")' style="background:rgba(255,68,85,.08);border:1px solid rgba(255,68,85,.2);border-radius:8px;padding:5px 10px;font-size:11px;color:#ff4455;cursor:pointer;font-weight:600;font-family:inherit">✕</button>
                </div>
              </div>
            </div>`;
          }).join("")
      }

      <button onclick='saAddBiz()' style="width:100%;padding:13px;background:#00e5a0;color:#07080c;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:24px">+ Add Business</button>

      <div class="sec-lbl">Platform Settings</div>

      <div style="background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px;margin-bottom:10px">
        <div style="font-weight:700;font-size:13px;margin-bottom:10px">Groq AI Key</div>
        <div style="display:flex;gap:8px">
          <input id="sa-groq" class="inp" type="password" placeholder="gsk_…" value="${apiKey?"•".repeat(20):""}" style="flex:1"/>
          <button onclick='saSaveGroq()' style="background:#a78bfa;color:#07080c;border:none;border-radius:10px;padding:0 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0">Save</button>
        </div>
        ${apiKey?`<div style="font-size:11px;color:#00e5a0;margin-top:6px;font-weight:600">✓ Connected</div>`:""}
      </div>

      <div style="background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px;margin-bottom:10px">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px">Firebase Config</div>
        <div style="font-size:12px;color:rgba(238,240,248,.38);margin-bottom:10px;font-weight:500">Stores real tap data from customer pages</div>
        <div class="field-lbl">API Key</div><input id="fb-ak" class="inp" placeholder="AIzaSy…" value="${esc(fbCfg?.apiKey||"")}" style="margin-bottom:7px"/>
        <div class="field-lbl">Project ID</div><input id="fb-pid" class="inp" placeholder="tapplus-xyz" value="${esc(fbCfg?.projectId||"")}" style="margin-bottom:7px"/>
        <div class="field-lbl">App ID</div><input id="fb-aid" class="inp" placeholder="1:123:web:abc" value="${esc(fbCfg?.appId||"")}" style="margin-bottom:10px"/>
        <div style="display:flex;gap:8px">
          <button onclick='saSaveFb()' style="flex:1;padding:11px;background:#15171f;border:1px solid rgba(255,255,255,.1);border-radius:10px;font-size:13px;font-weight:700;color:rgba(238,240,248,.8);cursor:pointer;font-family:inherit">${fbCfg?"✓ Update Config":"Save Config"}</button>
          <button onclick='saTestFb()' style="padding:11px 14px;background:rgba(0,229,160,.08);border:1px solid rgba(0,229,160,.2);border-radius:10px;font-size:13px;font-weight:700;color:#00e5a0;cursor:pointer;font-family:inherit" title="Send a test write to Firestore">Test ✓</button>
        </div>
        <div id="fb-test-result" style="font-size:12px;margin-top:6px;min-height:16px;font-weight:600"></div>
      </div>

      <div style="background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px">
        <div style="font-weight:700;font-size:13px;margin-bottom:10px">Admin PIN</div>
        <div style="display:flex;gap:8px">
          <input id="sa-pin-new" class="inp" type="tel" maxlength="4" placeholder="New PIN" style="flex:1"/>
          <button onclick='saSavePin()' style="background:#15171f;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:0 16px;font-size:13px;font-weight:700;color:rgba(238,240,248,.8);cursor:pointer;font-family:inherit;flex-shrink:0">Update</button>
        </div>
      </div>
    </div>`;
}

window.saSaveGroq = function() {
  const k = ($("sa-groq")||{}).value||"";
  if (k && !k.startsWith("•")) { LS.set("tp_key",k); showToast("API key saved!"); renderSAPanel($("sa-root")); }
  else showToast("Enter a valid key starting with gsk_");
};
window.saTestFb = async function() {
  const el = $("fb-test-result");
  const set = (msg, color) => { if(el){el.innerHTML=msg;el.style.color=color;} };

  set("Checking SDK…", "rgba(238,240,248,.5)");
  await new Promise(r=>setTimeout(r,100));

  // SDK may load dynamically — don't block here

  const cfg = getFbCfg();
  if (!cfg) { set("❌ No config saved — enter all 3 fields and hit Save Config", "#ff4455"); return; }

  set("SDK ready · Project: <strong>" + cfg.projectId + "</strong><br>Connecting…", "rgba(238,240,248,.5)");
  await new Promise(r=>setTimeout(r,200));

  try {
    // Re-init with current config
    _db = null;
    set("Loading Firebase SDK…", "rgba(238,240,248,.5)");
    const db = await getDb();
    if (!db) { set("❌ Could not load Firebase SDK — check your internet connection", "#ff4455"); return; }

    set("Writing test document…", "rgba(238,240,248,.5)");
    await db.collection("_tapplus_test").doc("ping").set({
      ping: "ok",
      ts:   Date.now(),
      from: "admin-test"
    });
    set("✅ Firebase connected! Check Firestore → _tapplus_test → ping", "#00e5a0");
  } catch(e) {
    console.error("saTestFb:", e.code, e.message);
    if (e.code === "permission-denied") {
      set("❌ Permission denied — set Firestore rules to: allow read, write: if true", "#ff4455");
    } else if (e.code === "not-found") {
      set("❌ Database not found — create Firestore database in Firebase console", "#ff4455");
    } else if (e.code === "unauthenticated" || e.message?.includes("auth")) {
      set("❌ Auth error — check your API Key is correct", "#ff4455");
    } else {
      set("❌ " + (e.code||e.name) + ": " + e.message, "#ff4455");
    }
  }
};

window.saSaveFb = function() {
  const ak=($("fb-ak")||{}).value||"", pid=($("fb-pid")||{}).value||"", aid=($("fb-aid")||{}).value||"";
  if (!ak||!pid||!aid) { showToast("Fill in all three fields"); return; }
  LS.set("tp_fb",{apiKey:ak,projectId:pid,appId:aid});
  _db = null; // reset so next call re-inits with new config
  showToast("Firebase config saved!"); renderSAPanel($("sa-root"));
};
window.saSavePin = function() {
  const p = ($("sa-pin-new")||{}).value||"";
  if (!/^\d{4}$/.test(p)) { showToast("PIN must be 4 digits"); return; }
  LS.set("tp_admin_pin",p); showToast("Admin PIN updated!"); renderSAPanel($("sa-root"));
};
window.saDeleteBiz = function(sl) {
  if (!confirm("Delete "+sl+"? Cannot be undone.")) return;
  deleteBiz(sl); renderSAPanel($("sa-root")); showToast("Business removed");
};

window.saAddBiz = function() {
  const auto = genUniqueCode(null);
  showModal(`<div class='modal-head'><div class='modal-title'>Add Business</div><button class='modal-close' onclick='closeModal()'>×</button></div>
    <div style='display:flex;flex-direction:column;gap:11px'>
      <div><div class='field-lbl'>Business Name</div><input class='inp' id='nb-name' placeholder="e.g. Noah's Bagels"/></div>
      <div><div class='field-lbl'>URL Slug</div><input class='inp' id='nb-slug' placeholder='noahs-bagels'/></div>
      <div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'>
        <div>
          <div class='field-lbl'>Store Code</div>
          <div style='display:flex;gap:6px'>
            <input class='inp' id='nb-scode' type='tel' maxlength='4' value='${auto}' style='flex:1;text-align:center;font-size:18px;font-weight:800;letter-spacing:.1em'/>
            <button onclick='_regenAddCode()' style='background:#15171f;border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:0 10px;font-size:13px;color:rgba(238,240,248,.5);cursor:pointer;font-family:inherit;flex-shrink:0'>↺</button>
          </div>
          <div id='nb-scode-err' style='font-size:10px;color:#ff4455;margin-top:4px;font-weight:600;min-height:14px'></div>
          <div style='font-size:10px;color:rgba(238,240,248,.28);margin-top:2px;font-weight:500'>What staff type to log in</div>
        </div>
        <div>
          <div class='field-lbl'>Business Admin PIN</div>
          <input class='inp' id='nb-apin' type='tel' maxlength='4' placeholder='e.g. 9999' style='text-align:center;font-size:18px;font-weight:800;letter-spacing:.1em'/>
          <div style='font-size:10px;color:rgba(238,240,248,.28);margin-top:4px;font-weight:500'>Full access PIN</div>
        </div>
      </div>
      <div><div class='field-lbl'>Manager PIN</div><input class='inp' id='nb-mpin' type='tel' maxlength='4' placeholder='e.g. 5678'/></div>
      <div id='nb-err' style='color:#ff4455;font-size:12px;font-weight:500;min-height:14px'></div>
      <button class='btn btn-primary btn-full' onclick='saveNewBiz()'>Create Business</button>
    </div>`);
  const ni=$("nb-name"), si=$("nb-slug");
  if (ni&&si) ni.addEventListener("input",()=>si.value=slugify(ni.value));

  // Regen button — always unique
  window._regenAddCode = function() {
    const inp = $("nb-scode"); if (!inp) return;
    const code = genUniqueCode(null);
    inp.value = code;
    const errEl = $("nb-scode-err"); if (errEl) errEl.textContent = "";
    inp.style.borderColor = "";
  };

  // Live validation as they type
  const scInp = $("nb-scode");
  if (scInp) {
    scInp.addEventListener("input", function() {
      const errEl = $("nb-scode-err"); if (!errEl) return;
      const v = this.value.trim();
      if (v.length === 4 && isCodeTaken(v, null)) {
        errEl.textContent = "⚠ Code already in use";
        this.style.borderColor = "#ff4455";
      } else {
        errEl.textContent = "";
        this.style.borderColor = "";
      }
    });
  }
};

// Random 4-digit code generator
function genCode() { return String(Math.floor(1000+Math.random()*9000)); }

function isCodeTaken(code, excludeSlug) {
  const list = getBizList();
  for (const sl of list) {
    if (sl === excludeSlug) continue; // skip self when editing
    const b = LS.get("tp_biz_"+sl, null);
    if (!b) continue;
    const sc = (b.storeCode || sl || "").toString().toLowerCase();
    if (sc === code.toLowerCase()) return true;
  }
  return false;
}

// Generates a code guaranteed not to clash with existing businesses
function genUniqueCode(excludeSlug) {
  let code, attempts = 0;
  do { code = genCode(); attempts++; } while (isCodeTaken(code, excludeSlug) && attempts < 50);
  return code;
}

window.saveNewBiz = function() {
  const name=(($("nb-name")||{}).value||"").trim();
  const sl  =slugify(($("nb-slug")||{}).value||name);
  const mpin=(($("nb-mpin")||{}).value||"").trim();
  const apin=(($("nb-apin")||{}).value||"").trim();
  const scode=(($("nb-scode")||{}).value||"").trim();
  const err =$("nb-err");
  if (!name) { if(err) err.textContent="Name required"; return; }
  if (!sl)   { if(err) err.textContent="Slug required"; return; }
  if (getBiz(sl)) { if(err) err.textContent="Slug already in use"; return; }
  if (!/^\d{4}$/.test(mpin)) { if(err) err.textContent="Manager PIN must be 4 digits"; return; }
  if (!/^\d{4}$/.test(apin)) { if(err) err.textContent="Business Admin PIN must be 4 digits"; return; }
  if (!scode) { if(err) err.textContent="Store code required"; return; }
  if (isCodeTaken(scode, null)) { if(err) err.textContent="Store code already in use — pick another"; return; }
  saveBiz({name,slug:sl,storeCode:scode,bizAdminPin:apin,mgrPin:mpin,brand:{...clone(DEFAULT_BRAND),name},links:clone(DEFAULT_LINKS),staff:clone(DEFAULT_STAFF),teamGoals:[],staffGoals:{}});
  closeModal(); renderSAPanel($("sa-root")); showToast("Business created!");
};

window.saEditBiz = function(sl) {
  const biz=getBiz(sl); if(!biz) return;
  const b={...DEFAULT_BRAND,...(biz.brand||{})};
  showModal(`<div class='modal-head'><div class='modal-title'>Edit: ${esc(biz.name)}</div><button class='modal-close' onclick='closeModal()'>×</button></div>
    <div style='display:flex;flex-direction:column;gap:11px'>
      <div class='sec-lbl' style='margin-bottom:0'>Access</div>
      <div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'>
        <div>
          <div class='field-lbl'>Store Code</div>
          <div style='display:flex;gap:6px'>
            <input class='inp' id='eb-scode' type='tel' maxlength='4' value='${esc(biz.storeCode||"")}' style='flex:1;text-align:center;font-size:18px;font-weight:800;letter-spacing:.1em'/>
            <button onclick='document.getElementById("eb-scode").value=genUniqueCode("${sl}")' style='background:#15171f;border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:0 10px;font-size:13px;color:rgba(238,240,248,.5);cursor:pointer;font-family:inherit;flex-shrink:0'>↺</button>
          </div>
        </div>
        <div>
          <div class='field-lbl'>Biz Admin PIN</div>
          <input class='inp' id='eb-apin' type='tel' maxlength='4' value='${esc(biz.bizAdminPin||"")}' style='text-align:center;font-size:18px;font-weight:800;letter-spacing:.1em'/>
        </div>
      </div>
      <div><div class='field-lbl'>Manager PIN (current: ${biz.mgrPin})</div><input class='inp' id='eb-mp' type='tel' maxlength='4' placeholder='Leave blank to keep'/></div>
      <div class='sec-lbl' style='margin-top:4px;margin-bottom:0'>Branding</div>
      <div><div class='field-lbl'>Business Name</div><input class='inp' id='eb-name' value='${esc(b.name)}'/></div>
      <div><div class='field-lbl'>Tagline</div><input class='inp' id='eb-tag' value='${esc(b.tagline)}'/></div>
      <div><div class='field-lbl'>Logo URL</div><input class='inp' id='eb-logo' value='${esc(b.logoUrl)}' placeholder='https://…'/></div>
      <div><div class='field-lbl'>Rating Question</div><input class='inp' id='eb-q' value='${esc(b.ratingQuestion)}'/></div>
      <div><div class='field-lbl'>Review Prompt (4-5★)</div><input class='inp' id='eb-rp' value='${esc(b.reviewPrompt)}'/></div>
      <div><div class='field-lbl'>Thank You Message</div><input class='inp' id='eb-ty' value='${esc(b.thankYouMsg)}'/></div>
      <div><div class='field-lbl'>Low Rating Message (1-3★)</div><input class='inp' id='eb-lr' value='${esc(b.lowRatingMsg)}'/></div>
      <div style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px'>
        <div><div class='field-lbl'>Brand Color</div><input type='color' id='eb-bc' value='${b.brandColor||"#00e5a0"}' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>
        <div><div class='field-lbl'>Background</div><input type='color' id='eb-bg' value='${b.bgColor||"#07080c"}' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>
        <div><div class='field-lbl'>Text</div><input type='color' id='eb-tc' value='${b.textColor||"#ffffff"}' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>
      </div>
      <button class='btn btn-primary btn-full' onclick='saveEditBiz("${sl}")'>Save Changes</button>
    </div>`);
};

window.saveEditBiz = function(sl) {
  const biz=getBiz(sl); if(!biz) return;
  const ns=(($("eb-scode")||{}).value||"").trim();
  const na=(($("eb-apin")||{}).value||"").trim();
  const np=(($("eb-mp")  ||{}).value||"").trim();
  if (ns && isCodeTaken(ns, sl)) { showToast("Store code " + ns + " is already in use"); return; }
  if (ns) biz.storeCode = ns;
  if (/^\d{4}$/.test(na)) biz.bizAdminPin = na;
  if (/^\d{4}$/.test(np)) biz.mgrPin = np;
  biz.brand = {
    name:          (($("eb-name")||{}).value||"").trim()||biz.brand.name,
    tagline:       (($("eb-tag") ||{}).value||"").trim(),
    logoUrl:       (($("eb-logo")||{}).value||"").trim(),
    ratingQuestion:(($("eb-q")  ||{}).value||"").trim()||DEFAULT_BRAND.ratingQuestion,
    reviewPrompt:  (($("eb-rp") ||{}).value||"").trim()||DEFAULT_BRAND.reviewPrompt,
    thankYouMsg:   (($("eb-ty") ||{}).value||"").trim()||DEFAULT_BRAND.thankYouMsg,
    lowRatingMsg:  (($("eb-lr") ||{}).value||"").trim()||DEFAULT_BRAND.lowRatingMsg,
    brandColor:    ($("eb-bc")||{}).value||"#00e5a0",
    bgColor:       ($("eb-bg")||{}).value||"#07080c",
    textColor:     ($("eb-tc")||{}).value||"#ffffff"
  };
  saveBiz(biz); closeModal(); renderSAPanel($("sa-root")); showToast("Saved!");
};

// ═══════════════════════════════════════════
// CUSTOMER PAGE
// ═══════════════════════════════════════════
function renderCustomerPage(app, biz, staffId) {
  const b          = {...DEFAULT_BRAND,...(biz.brand||{})};
  const activeLinks= biz.links.filter(l=>l.active);
  const firstLink  = activeLinks[0]||null;
  // Support both old ID-based and new slug-based lookup
  const staffRec = staffId ? (
    biz.staff.find(s => staffUrlSlug(staffParts(s)) === staffId) ||
    biz.staff.find(s => s.id === staffId)
  ) : null;
  const staffName = staffRec ? staffDisplayName(staffParts(staffRec)) : "General";

  // ── LOG TAP IMMEDIATELY on page load ─────────────────────────────────────
  // This is the true "card tap" moment — the instant the customer's phone loads.
  // We write a pending record now, then update it with rating/feedback when they submit.
  const tapId = uid();
  const tapTs = Date.now();
  saveTap({
    id:        tapId,
    ts:        tapTs,
    bizSlug:   biz.slug,
    staffId:   staffId || "general",
    staffName: staffName,
    rating:    null,
    platform:  null,
    review:    false,
    feedback:  "",
    redirected:false,
    status:    "tapped"   // pending — no rating yet
  });

  let rating = 0;

  document.body.style.background = b.bgColor;
  document.body.style.backgroundImage = "none";

  const logo = b.logoUrl
    ? `<img src='${esc(b.logoUrl)}' alt='${esc(b.name)}' style='height:68px;max-width:220px;object-fit:contain;margin-bottom:20px;border-radius:10px'/>`
    : `<div style='font-weight:900;font-size:28px;letter-spacing:-.03em;color:${b.textColor};margin-bottom:20px'>${esc(b.name)}</div>`;

  app.innerHTML = `
    <div style='position:fixed;top:0;left:0;right:0;text-align:center;padding:9px;font-size:9px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.16);z-index:100;pointer-events:none'>POWERED BY TAP+</div>
    <div style='position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;width:100%;max-width:400px;margin:0 auto;padding:52px 24px 40px;text-align:center'>
      ${logo}
      ${b.tagline?`<div style='font-size:13px;font-weight:500;color:${b.textColor};opacity:.5;margin-bottom:30px;line-height:1.55'>${esc(b.tagline)}</div>`:`<div style='margin-bottom:24px'></div>`}
      <div style='font-size:19px;font-weight:800;color:${b.textColor};margin-bottom:6px;letter-spacing:-.02em'>${esc(b.ratingQuestion)}</div>
      <div style='font-size:12px;color:${b.textColor};opacity:.35;margin-bottom:22px;font-weight:500'>Tap a star below</div>
      <div style='display:flex;gap:10px;justify-content:center;margin-bottom:20px'>
        ${[1,2,3,4,5].map(i=>`<div id='cs${i}' onclick='_cStar(${i})' style='font-size:44px;cursor:pointer;filter:brightness(.22);transition:filter .12s,transform .12s;-webkit-user-select:none;user-select:none'>⭐</div>`).join("")}
      </div>
      <div id='cust-after' style='width:100%'></div>
    </div>
    <div style='position:fixed;bottom:10px;left:0;right:0;text-align:center;font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.1);pointer-events:none'>TAP+</div>`;

  window._cStar = function(r) {
    rating = r;
    for (let i=1;i<=5;i++) { const s=$("cs"+i); if(s){s.style.filter=i<=r?"brightness(1)":"brightness(.22)";s.style.transform=i<=r?"scale(1.12)":"scale(1)";} }
    const after=$("cust-after"); if(!after) return;

    if (r===5 && firstLink) {
      // Update the existing tap record with rating + redirect info
      saveTap({id:tapId,ts:tapTs,bizSlug:biz.slug,staffId:staffId||"general",staffName,rating:r,platform:firstLink.label,review:true,feedback:"",redirected:true,status:"rated"});
      after.innerHTML=`<div style='animation:up .25s ease;text-align:center;padding:8px 0'><div style='font-size:38px;margin-bottom:10px'>🙏</div><div style='font-weight:800;font-size:18px;color:${b.textColor};margin-bottom:6px'>Thank you!</div><div style='font-size:13px;color:${b.textColor};opacity:.45;font-weight:500'>Taking you to leave a review…</div></div>`;
      setTimeout(()=>window.location.href=firstLink.url, 1100);
      return;
    }

    if (r>=4 && activeLinks.length>0) {
      saveTap({id:tapId,ts:tapTs,bizSlug:biz.slug,staffId:staffId||"general",staffName,rating:r,platform:null,review:false,feedback:"",redirected:false,status:"rated"});
      after.innerHTML=`<div style='font-size:13px;font-weight:600;color:${b.textColor};opacity:.55;margin-bottom:12px'>${esc(b.reviewPrompt)}</div>`+
        activeLinks.map(l=>`<a href='${esc(l.url)}' target='_blank' rel='noreferrer' style='display:flex;align-items:center;gap:13px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);border-radius:14px;padding:15px 17px;text-decoration:none;margin-bottom:9px;text-align:left'><span style='font-size:24px'>${l.icon}</span><div style='flex:1'><div style='font-weight:700;font-size:14px;color:${b.textColor}'>Review on ${esc(l.label)}</div><div style='font-size:11px;color:${b.textColor};opacity:.38;margin-top:2px'>Tap to open</div></div><span style='color:${b.textColor};opacity:.3;font-size:16px'>→</span></a>`).join("")+
        `<button onclick='_cDone()' style='width:100%;margin-top:4px;padding:14px;background:${b.brandColor};color:#07080c;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit'>Done ✓</button>`;
      return;
    }

    if (r>0) {
      after.innerHTML=`<div style='font-size:13px;font-weight:600;color:${b.textColor};opacity:.55;margin-bottom:12px'>${esc(b.lowRatingMsg)}</div><textarea id='cust-fb' placeholder='What happened? (optional)' rows='4' style='width:100%;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px 13px;color:${b.textColor};font-size:14px;resize:none;outline:none;font-family:inherit;line-height:1.5'></textarea><button onclick='_cSubmit()' style='width:100%;margin-top:10px;padding:14px;background:${b.brandColor};color:#07080c;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit'>Submit</button>`;
    }
  };

  window._cDone   = () => app.innerHTML=tyScreen(b);
  window._cSubmit = () => {
    const fb=($("cust-fb")||{}).value||"";
    saveTap({id:tapId,ts:tapTs,bizSlug:biz.slug,staffId:staffId||"general",staffName,rating,platform:null,review:false,feedback:fb,redirected:false,status:"rated"});
    app.innerHTML=tyScreen(b);
  };
}

function tyScreen(b) {
  return `<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px;background:${b.bgColor};animation:up .3s ease'><div style='font-size:52px;margin-bottom:16px'>🙏</div><div style='font-weight:900;font-size:22px;margin-bottom:10px;color:${b.textColor};letter-spacing:-.03em'>${esc(b.thankYouMsg)}</div><div style='font-size:13px;color:${b.textColor};opacity:.4;max-width:260px;line-height:1.65;font-weight:500'>Your feedback helps us improve.</div><div style='position:fixed;bottom:12px;left:0;right:0;text-align:center;font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.14)'>POWERED BY TAP+</div></div>`;
}

// ═══════════════════════════════════════════
// BIZ DASHBOARD AUTH
// ═══════════════════════════════════════════
function renderBizDash(app, biz) {
  const auth = sessionStorage.getItem("biz_auth_"+biz.slug)||"";

  if (!auth) {
    // Use the same clean role-select flow
    renderRoleSelect(app, biz);
    return;
  }

  app.innerHTML = "<div id='biz-dash' style='min-height:100vh;display:flex;flex-direction:column'></div>";
  setTimeout(()=>{
    const el=$("biz-dash");
    if (auth==="manager")   { renderManagerDash(el,biz); return; }
    if (auth==="bizadmin")  { renderBizAdminDash(el,biz); return; }
    if (auth.startsWith("staff:")) {
      const sid=auth.slice(6), s=biz.staff.find(x=>x.id===sid);
      if (s) renderStaffDash(el,biz,s);
      else { sessionStorage.removeItem("biz_auth_"+biz.slug); renderRoleSelect(app,biz); }
    }
  },0);
}

// ═══════════════════════════════════════════
// DEMO DATA + STATS
// ═══════════════════════════════════════════
// Fallback demo data — only used when Firebase is not configured
function getDemoTaps() {
  const t=Date.now(), H=3600000;
  return [
    {ts:t-H*1,  rating:5,platform:"google",review:true, feedback:"",status:"rated"},
    {ts:t-H*3,  rating:4,platform:"yelp",  review:true, feedback:"",status:"rated"},
    {ts:t-H*6,  rating:5,platform:null,    review:false,feedback:"",status:"rated"},
    {ts:t-H*25, rating:3,platform:null,    review:false,feedback:"Food was a bit cold",status:"rated"},
    {ts:t-H*26, rating:5,platform:"google",review:true, feedback:"",status:"rated"},
    {ts:t-H*50, rating:4,platform:"google",review:true, feedback:"",status:"rated"},
    {ts:t-H*73, rating:2,platform:null,    review:false,feedback:"Felt rushed, order wrong",status:"rated"},
    {ts:t-H*98, rating:5,platform:"google",review:true, feedback:"",status:"rated"}
  ];
}

function calcStats(taps) {
  const reviews  = taps.filter(t=>t.review).length;
  const ratings  = taps.map(t=>t.rating);
  const avg      = ratings.length ? ratings.reduce((a,b)=>a+b,0)/ratings.length : 0;
  const weekTaps = taps.filter(t=>t.ts>=wsStart()).length;
  const score    = taps.length*10 + reviews*15 + ratings.filter(r=>r===5).length*5;
  const pos      = taps.filter(t=>t.rating>=4).length;
  const ctr      = pos>0 ? Math.round((reviews/pos)*100) : 0;
  const negFb    = taps.filter(t=>t.feedback&&t.rating<=3);
  return {count:taps.length,reviews,avg,avgStr:avg?avg.toFixed(1):"—",weekTaps,score,ctr,negFb};
}

// ═══════════════════════════════════════════
// STAFF DASHBOARD
// ═══════════════════════════════════════════
function renderStaffDash(el, biz, s) {
  el.innerHTML=`
    <div class='dash-header'>
      <div><div class='dash-name'>${esc(staffParts(s).firstName||s.name)}'s Dashboard</div><div class='dash-sub'>${esc(biz.name)}</div></div>
      <div style='display:flex;gap:7px;align-items:center'>
        <button id='staff-refresh-btn' onclick='_refreshStaffDash()' class='dash-exit' title='Refresh data' style='font-size:15px;padding:6px 10px'>↻</button>
        <button onclick='sessionStorage.removeItem("biz_auth_${biz.slug}");window.location.href="/${biz.slug}/dashboard"' class='dash-exit'>← Exit</button>
      </div>
    </div>
    <div class='dash-tabs' id='stabs'>
      <button class='dash-tab ai active' onclick='_sTab("coaching",this)'><span class='ai-mini-dot'></span> AI Coaching</button>
      <button class='dash-tab ai' onclick='_sTab("feedback",this)'><span class='ai-mini-dot'></span> My Feedback</button>
      <button class='dash-tab' onclick='_sTab("goals",this)'>My Goals</button>
      <button class='dash-tab' onclick='_sTab("stats",this)'>My Stats</button>
    </div>
    <div class='dash-body' id='sbody'></div>`;

  // Show loading state, fetch real data
  const sbody=$("sbody");
  // taps will be loaded async per tab — use closure
  let _staffTaps = null;
  async function loadStaffTaps() {
    if (_staffTaps) return _staffTaps;
    const sid = staffUrlSlug(staffParts(s));
    _staffTaps = await getTaps(biz.slug, sid);
    if (!_staffTaps || _staffTaps.length===0) _staffTaps = await getTaps(biz.slug, s.id);
    return _staffTaps;
  }

  window._sTab=async function(tab,btn) {
    document.querySelectorAll("#stabs .dash-tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const body=$("sbody"); if(!body) return;

    // Show spinner while loading
    body.innerHTML="<div class='ai-loading' style='padding:30px 0'><div class='ai-spinner'></div>Loading…</div>";
    const taps = await loadStaffTaps();
    const st   = calcStats(taps);

    if (tab==="coaching") {
      const p=`Coach ${staffParts(s).firstName||s.name} directly. Stats: ${st.count} taps, ${st.reviews} reviews, ${st.avgStr}★, ${st.ctr}% CTR, score ${st.score}. 3 coaching tips: genuine compliment, one improvement, motivating close. Under 200 words.`;
      body.innerHTML=`<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>💬</div><div><div class='ai-card-title'>Your AI Coach</div><div class='ai-card-sub'>${st.count} taps · ${st.avgStr}★</div></div></div><div id='ai-coaching'></div></div>`;
      renderAIBlock("ai-coaching",p,"sc_"+s.id,"Writing tips…");
    }
    else if (tab==="feedback") {
      const fb=st.negFb;
      body.innerHTML=`<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>💭</div><div><div class='ai-card-title'>Customer Feedback</div><div class='ai-card-sub'>${fb.length} entries</div></div></div><div id='ai-fb'></div></div>`+
        (fb.length ? fb.map(t=>`<div class='plain-card'><div style='font-size:12px;margin-bottom:4px'>${"⭐".repeat(t.rating||0)}</div><div style='font-size:13px;color:rgba(238,240,248,.65);font-style:italic'>"${esc(t.feedback)}"</div></div>`).join("") : "<div style='color:#00e5a0;font-size:13px;font-weight:500;padding:10px 0'>🎉 No negative feedback yet!</div>");
      if (fb.length) renderAIBlock("ai-fb","Analyze: "+fb.map(t=>t.rating+"★: \""+t.feedback+"\"").join("; ")+". Main theme, one action, positive reframe. Under 100 words.","ss_"+s.id,"Analyzing…");
    }
    else if (tab==="goals") {
      const tG=biz.teamGoals||[], sG=(biz.staffGoals&&biz.staffGoals[s.id])||[];
      body.innerHTML=(tG.length?"<div class='sec-lbl'>Team Goals</div>"+tG.map(g=>goalRowRO(g,true)).join(""):"")+
        (sG.length?"<div class='sec-lbl' style='margin-top:14px'>Your Goals</div>"+sG.map(g=>goalRowRO(g,false)).join(""):"")  +
        (!tG.length&&!sG.length?"<div style='text-align:center;padding:40px 20px;color:rgba(238,240,248,.38);font-size:13px;font-weight:500'>🎯<br><br>No goals set yet.</div>":"");
    }
    else {
      body.innerHTML=`<div class='stat-grid'>${[[st.count,"Taps",s.color],[st.reviews,"Reviews","#ffd166"],[st.avgStr,"Avg ★","#ff6b35"],[st.ctr+"%","CTR","#7c6aff"],[st.weekTaps,"This Week","#00e5a0"],[st.score,"Score","#ffd166"]].map(([v,l,c])=>`<div class='stat-box'><div class='stat-val' style='color:${c}'>${v}</div><div class='stat-lbl'>${l}</div></div>`).join("")}</div><div class='sec-lbl'>Recent Taps</div>`+taps.slice(0,6).map(t=>`<div style='display:flex;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);gap:9px'><div style='width:6px;height:6px;border-radius:50%;background:${(t.rating||0)<=3?"#ff4455":"#00e5a0"};flex-shrink:0;margin-top:4px'></div><div style='flex:1'><div style='font-size:12px;font-weight:600'>${"⭐".repeat(t.rating||0)}${t.review?"<span style='font-size:10px;background:rgba(0,229,160,.1);color:#00e5a0;border-radius:5px;padding:1px 6px;margin-left:5px'>REVIEW</span>":""}</div><div style='font-size:11px;color:rgba(238,240,248,.38);margin-top:2px;font-weight:500'>${fmt(t.ts)}</div></div></div>`).join("");
    }
  };
  _sTab("coaching", el.querySelector(".dash-tab"));

  window._refreshStaffDash = function() {
    const btn = $("staff-refresh-btn");
    if (btn) { btn.style.opacity="0.4"; btn.style.pointerEvents="none"; }
    clearTapCache(biz.slug);
    _staffTaps = null; // clear local cache too
    const activeTab = el.querySelector("#stabs .dash-tab.active");
    const tabId = activeTab ? activeTab.getAttribute("onclick").match(/"([^"]+)"/)?.[1] : "coaching";
    _sTab(tabId||"coaching", activeTab||el.querySelector(".dash-tab"));
    setTimeout(()=>{ if(btn){btn.style.opacity="";btn.style.pointerEvents="";} }, 1500);
  };
}

function goalRowRO(g, isTeam) {
  const pct=Math.min(100,g.target>0?Math.round((g.current/g.target)*100):0), done=pct>=100;
  return `<div class='plain-card' style='margin-bottom:9px'><div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:6px'><div style='font-weight:700;font-size:13px'>${esc(g.title)}${done?" <span style='font-size:10px;color:#00e5a0;background:rgba(0,229,160,.1);border-radius:5px;padding:1px 6px'>Done ✓</span>":""}${isTeam?" <span style='font-size:10px;color:#7c6aff;background:rgba(124,106,255,.1);border-radius:5px;padding:1px 6px'>Team</span>":""}</div><div style='font-size:12px;font-weight:700;color:${done?"#00e5a0":"rgba(238,240,248,.5)"}'>${pct}%</div></div><div style='height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden'><div style='height:100%;width:${pct}%;background:${done?"#00e5a0":"linear-gradient(90deg,#7c6aff,#a78bfa)"};border-radius:3px'></div></div><div style='font-size:10px;color:rgba(238,240,248,.28);margin-top:5px;font-weight:500'>${esc(g.period||"")} · ${g.current}/${g.target} ${esc(g.unit||"")}</div></div>`;
}

// ═══════════════════════════════════════════
// MANAGER DASHBOARD
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// BUSINESS ADMIN DASHBOARD
// Full access: all manager tabs + Settings
// ═══════════════════════════════════════════
async function renderBizAdminDash(el, biz) {
  const active = biz.staff.filter(s=>s.active);

  el.innerHTML="<div style='display:flex;align-items:center;justify-content:center;min-height:60vh'><div class='ai-loading'><div class='ai-spinner'></div>Loading dashboard…</div></div>";
  await new Promise(r=>setTimeout(r,0));

  const tapsByStaff = {};
  await Promise.all(active.map(async s => {
    const sid = staffUrlSlug(staffParts(s));
    tapsByStaff[s.id] = await getTaps(biz.slug, sid);
  }));
  await Promise.all(active.map(async s => {
    if (!tapsByStaff[s.id] || tapsByStaff[s.id].length===0)
      tapsByStaff[s.id] = await getTaps(biz.slug, s.id);
  }));
  const getStaffTaps = s => tapsByStaff[s.id] || [];
  window.tapsByStaff = tapsByStaff;
  const sd    = active.map(s=>{const st=calcStats(getStaffTaps(s));return `${staffDisplayName(staffParts(s))}: ${st.count} taps, ${st.reviews} reviews, ${st.avgStr}★, score ${st.score}`;}).join("\n");
  const allFb = active.flatMap(s=>calcStats(getStaffTaps(s)).negFb.map(t=>`${staffDisplayName(staffParts(s))}(${t.rating}★): "${t.feedback}"`)).join("\n");

  el.innerHTML=`
    <div class='dash-header'>
      <div>
        <div class='dash-name'>${esc(biz.name)}</div>
        <div class='dash-sub' style='color:#ff6b35'>Business Admin · Tap+</div>
      </div>
      <div style='display:flex;gap:7px;align-items:center'>
        <button onclick='_refreshBizAdmin()' class='dash-exit' title='Refresh data' style='font-size:15px;padding:6px 10px' id='ba-refresh-btn'>↻</button>
        <button onclick='sessionStorage.removeItem("biz_auth_${biz.slug}");window.location.href="/${biz.slug}/dashboard"' class='dash-exit'>← Exit</button>
      </div>
    </div>
    <div class='dash-tabs' id='batabs'>
      <button class='dash-tab ai active' onclick='_baTab("ai",this)'><span class='ai-mini-dot'></span> AI Insights</button>
      <button class='dash-tab' onclick='_baTab("team",this)'>Team</button>
      <button class='dash-tab' onclick='_baTab("staff",this)'>Staff</button>
      <button class='dash-tab' onclick='_baTab("links",this)'>Links</button>
      <button class='dash-tab' onclick='_baTab("goals",this)'>Goals</button>
      <button class='dash-tab' onclick='_baTab("branding",this)'>Branding</button>
      <button class='dash-tab ai' onclick='_baTab("estimator",this)'><span class='ai-mini-dot'></span> Estimator</button>
      <button class='dash-tab' onclick='_baTab("settings",this)' style='color:#ff6b35'>⚙ Settings</button>
    </div>
    <div class='dash-body' id='babody'></div>`;

  window._baTab=function(tab,btn) {
    document.querySelectorAll("#batabs .dash-tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const body=$("babody"); if(!body) return;
    if      (tab==="ai")        renderAITab(body,active,sd,allFb);
    else if (tab==="team")      renderTeamTab(body,active,getStaffTaps);
    else if (tab==="staff")     renderStaffMgmt(body,biz);
    else if (tab==="links")     renderLinksTab(body,biz);
    else if (tab==="goals")     renderGoalsTab(body,biz);
    else if (tab==="branding")  renderBrandingTab(body,biz);
    else if (tab==="estimator") renderEstimatorTab(body,active,getStaffTaps);
    else if (tab==="settings")  renderBizAdminSettings(body,biz,getStaffTaps);
  };
  _baTab("ai", el.querySelector(".dash-tab"));

  window._refreshBizAdmin = function() {
    const btn = $("ba-refresh-btn");
    if (btn) { btn.style.opacity="0.4"; btn.style.pointerEvents="none"; }
    clearTapCache(biz.slug);
    const app = $("app"); if (app) renderBizAdminDash(app, getBiz(biz.slug)||biz);
  };
}

function renderBizAdminSettings(body, biz, getStaffTaps) {
  if (!getStaffTaps) getStaffTaps = () => getDemoTaps();
  const bc = biz.brand?.brandColor || "#00e5a0";
  body.innerHTML=`
    <div class='plain-card' style='margin-bottom:12px'>
      <div style='font-weight:700;font-size:13px;margin-bottom:14px;color:#ff6b35'>🏢 Business Access</div>

      <div class='field-lbl'>Store Code (what staff type to log in)</div>
      <div style='display:flex;gap:8px;margin-bottom:14px'>
        <input class='inp' id='bas-code' type='tel' maxlength='4' value='${esc(biz.storeCode||"")}' style='flex:1;text-align:center;font-size:22px;font-weight:900;letter-spacing:.12em'/>
        <button onclick='document.getElementById("bas-code").value=genUniqueCode("${biz.slug}")' style='background:#15171f;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:0 13px;font-size:13px;color:rgba(238,240,248,.5);cursor:pointer;font-family:inherit;flex-shrink:0'>↺ New</button>
      </div>

      <div class='field-lbl'>Manager PIN (current: ${biz.mgrPin})</div>
      <input class='inp' id='bas-mpin' type='tel' maxlength='4' placeholder='New PIN (leave blank to keep)' style='margin-bottom:14px'/>

      <div class='field-lbl'>Your Business Admin PIN</div>
      <input class='inp' id='bas-apin' type='tel' maxlength='4' placeholder='New PIN (leave blank to keep)' style='margin-bottom:16px'/>

      <button onclick='_saveBizAdminSettings()' class='btn btn-primary btn-full'>Save Settings</button>
    </div>

    <div class='plain-card'>
      <div style='font-weight:700;font-size:13px;margin-bottom:10px'>📋 Tap Analytics</div>
      <div style='display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px'>
        ${(()=>{
          const all = active.flatMap(s=>getStaffTaps(s));
          const revs = all.filter(t=>t.review).length;
          const pos  = all.filter(t=>t.rating>=4).length;
          const avg  = all.length?(all.reduce((a,t)=>a+t.rating,0)/all.length).toFixed(1):"—";
          const ctr  = pos>0?Math.round((revs/pos)*100):0;
          return [
            [all.length,"Total Taps","#00e5a0"],
            [revs,"Reviews","#ffd166"],
            [avg+"★","Avg Rating","#ff6b35"],
            [ctr+"%","Conversion","#7c6aff"]
          ].map(([v,l,c])=>`<div style='background:#15171f;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:12px;text-align:center'><div style='font-weight:900;font-size:24px;color:${c};letter-spacing:-.03em;margin-bottom:3px'>${v}</div><div style='font-size:10px;color:rgba(238,240,248,.38);font-weight:700;text-transform:uppercase;letter-spacing:.08em'>${l}</div></div>`).join("");
        })()}
      </div>
      <div class='sec-lbl' style='margin-top:8px'>Per Staff</div>
      ${active.map(s=>{
        const st=calcStats(getStaffTaps(s));
        const pct=st.count>0?Math.round((st.reviews/st.count)*100):0;
        return `<div style='display:flex;align-items:center;gap:10px;margin-bottom:8px'>
          <div style='width:32px;height:32px;border-radius:50%;background:${s.color}22;color:${s.color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;flex-shrink:0'>${staffIni(staffParts(s))}</div>
          <div style='flex:1;min-width:0'>
            <div style='display:flex;justify-content:space-between;margin-bottom:4px'>
              <span style='font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>${esc(s.name)}</span>
              <span style='font-size:11px;color:rgba(238,240,248,.4);flex-shrink:0;margin-left:8px'>${st.count} taps · ${st.reviews} reviews · ${st.avgStr}★</span>
            </div>
            <div style='height:5px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden'>
              <div style='height:100%;width:${pct}%;background:${s.color};border-radius:3px'></div>
            </div>
          </div>
          <div style='font-size:11px;font-weight:700;color:${s.color};flex-shrink:0'>${pct}%</div>
        </div>`;
      }).join("")}
    </div>`;

  window._saveBizAdminSettings = function() {
    const code = ($("bas-code")||{}).value?.trim()||"";
    const mp   = ($("bas-mpin")||{}).value?.trim()||"";
    const ap   = ($("bas-apin")||{}).value?.trim()||"";
    if (code && isCodeTaken(code, biz.slug)) { showToast("Code " + code + " is already in use"); return; }
    if (code) biz.storeCode = code;
    if (/^\d{4}$/.test(mp)) biz.mgrPin = mp;
    if (/^\d{4}$/.test(ap)) biz.bizAdminPin = ap;
    saveBiz(biz);
    showToast("Settings saved!");
  };
}

async function renderManagerDash(el, biz) {
  const active = biz.staff.filter(s=>s.active);

  // Load real tap data for all staff from Firebase (or demo fallback)
  const tapsByStaff = {};
  await Promise.all(active.map(async s => {
    const sid = staffUrlSlug(staffParts(s));
    tapsByStaff[s.id] = await getTaps(biz.slug, sid);
  }));
  // Also load taps with old-style IDs for backwards compat
  await Promise.all(active.map(async s => {
    if (!tapsByStaff[s.id] || tapsByStaff[s.id].length===0) {
      tapsByStaff[s.id] = await getTaps(biz.slug, s.id);
    }
  }));

  const getStaffTaps = s => tapsByStaff[s.id] || [];
  window.tapsByStaff = tapsByStaff; // expose for _cStaff
  const sd    = active.map(s=>{const st=calcStats(getStaffTaps(s));return `${staffDisplayName(staffParts(s))}: ${st.count} taps, ${st.reviews} reviews, ${st.avgStr}★, score ${st.score}`;}).join("\n");
  const allFb = active.flatMap(s=>calcStats(getStaffTaps(s)).negFb.map(t=>`${staffDisplayName(staffParts(s))}(${t.rating}★): "${t.feedback}"`)).join("\n");

  // Show loading while fetching Firebase data
  el.innerHTML="<div style='display:flex;align-items:center;justify-content:center;min-height:60vh'><div class='ai-loading'><div class='ai-spinner'></div>Loading dashboard…</div></div>";
  // Small delay to let the spinner render before async work
  await new Promise(r=>setTimeout(r,0));

  el.innerHTML=`
    <div class='dash-header'>
      <div><div class='dash-name'>${esc(biz.name)}</div><div class='dash-sub'>Manager Dashboard · Tap+</div></div>
      <div style='display:flex;gap:7px;align-items:center'>
        <button onclick='_refreshMgrDash()' class='dash-exit' title='Refresh data' style='font-size:15px;padding:6px 10px' id='mgr-refresh-btn'>↻</button>
        <button onclick='sessionStorage.removeItem("biz_auth_${biz.slug}");window.location.href="/${biz.slug}/dashboard"' class='dash-exit'>← Exit</button>
      </div>
    </div>
    <div class='dash-tabs' id='mtabs'>
      <button class='dash-tab ai active' onclick='_mTab("ai",this)'><span class='ai-mini-dot'></span> AI Insights</button>
      <button class='dash-tab' onclick='_mTab("team",this)'>Team</button>
      <button class='dash-tab' onclick='_mTab("staff",this)'>Staff</button>
      <button class='dash-tab' onclick='_mTab("links",this)'>Links</button>
      <button class='dash-tab' onclick='_mTab("goals",this)'>Goals</button>
      <button class='dash-tab ai' onclick='_mTab("estimator",this)'><span class='ai-mini-dot'></span> Estimator</button>
    </div>
    <div class='dash-body' id='mbody'></div>`;

  window._mTab=function(tab,btn) {
    document.querySelectorAll("#mtabs .dash-tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    const body=$("mbody"); if(!body) return;
    if (tab==="ai")        renderAITab(body,active,sd,allFb);
    else if (tab==="team") renderTeamTab(body,active);
    else if (tab==="staff")    renderStaffMgmt(body,biz);
    else if (tab==="links")    renderLinksTab(body,biz);
    else if (tab==="goals")    renderGoalsTab(body,biz);
    else if (tab==="branding") renderBrandingTab(body,biz);
    else if (tab==="estimator") renderEstimatorTab(body,active);
  };
  _mTab("ai", el.querySelector(".dash-tab"));

  window._refreshMgrDash = function() {
    const btn = $("mgr-refresh-btn");
    if (btn) { btn.style.opacity="0.4"; btn.style.pointerEvents="none"; }
    clearTapCache(biz.slug);
    const app = $("app"); if (app) renderManagerDash($("biz-dash")||app, getBiz(biz.slug)||biz);
  };
}

// ─── AI INSIGHTS ───────────────────────────
function renderAITab(body, active, sd, allFb) {
  const subs=["summary","coaching","feedback","export"];
  const labels={summary:"📋 Summary",coaching:"💬 Coaching",feedback:"🔍 Feedback",export:"📄 Export"};
  body.innerHTML=`<div id='ai-subs' style='display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap'>${subs.map((s,i)=>`<button data-s='${s}' onclick='_aiSub(this.dataset.s)' style='background:${i===0?"#a78bfa":"#15171f"};color:${i===0?"#07080c":"rgba(238,240,248,.5)"};border:1px solid ${i===0?"#a78bfa":"rgba(255,255,255,.08)"};border-radius:9px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit'>${labels[s]}</button>`).join("")}</div><div id='ai-sub-body'></div>`;

  window._aiSub=function(sub) {
    document.querySelectorAll("#ai-subs button").forEach(b=>{const a=b.dataset.s===sub;b.style.background=a?"#a78bfa":"#15171f";b.style.color=a?"#07080c":"rgba(238,240,248,.5)";b.style.borderColor=a?"#a78bfa":"rgba(255,255,255,.08)";});
    const el=$("ai-sub-body"); if(!el) return;
    if (sub==="summary") {
      const p=`Weekly summary.\nTEAM:\n${sd}\nFEEDBACK:\n${allFb||"None"}\nOverall assessment, top performer, who needs support, feedback patterns, priority action. Under 280 words.`;
      el.innerHTML=`<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>🧠</div><div><div class='ai-card-title'>Weekly Summary</div></div></div><div id='ai-sum'></div></div>`;
      renderAIBlock("ai-sum",p,"mgr_sum","Generating…");
    } else if (sub==="coaching") {
      el.innerHTML=`<div class='pills' id='cpills'>${active.map((s,i)=>`<div class='pill${i===0?" active":""}' onclick='_cStaff("${s.id}",this)'><div class='pill-av' style='background:${s.color}22;color:${s.color}'>${staffIni(staffParts(s))}</div>${staffParts(s).firstName||s.name}</div>`).join("")}</div><div id='ccard'></div>`;
      if (active[0]) _cStaff(active[0].id, el.querySelector(".pill"));
    } else if (sub==="feedback") {
      const items=active.flatMap(s=>calcStats(getDemoTaps()).negFb.map(t=>({...t,sName:s.name,sColor:s.color}))).sort((a,b)=>b.ts-a.ts);
      const p2=`Analyze feedback:\n${allFb||"None"}\nSentiment, patterns, urgent flags, positive signals. Under 200 words.`;
      el.innerHTML=`<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>🔍</div><div><div class='ai-card-title'>Sentiment Analysis</div></div></div><div id='ai-fb-mgr'></div></div>${items.length?"<div class='sec-lbl' style='margin-top:4px'>Raw Feedback</div>"+items.map(f=>`<div class='plain-card'><div style='font-weight:700;font-size:13px;color:${f.sColor}'>${esc(f.sName)}</div><div style='font-size:13px;margin:4px 0'>${"⭐".repeat(f.rating)}</div><div style='font-size:13px;color:rgba(238,240,248,.65);font-style:italic'>"${esc(f.feedback)}"</div></div>`).join(""):"<div style='color:#00e5a0;font-size:13px;font-weight:500;margin-top:4px'>No feedback yet.</div>"}`;
      renderAIBlock("ai-fb-mgr",p2,"mgr_fb","Analyzing…");
    } else {
      const p3=`Professional weekly report. DATE: ${new Date().toLocaleDateString([],{weekday:"long",year:"numeric",month:"long",day:"numeric"})}\nTEAM:\n${sd}\n## Executive Summary / ## Individual Performance / ## Sentiment / ## Recommendations / ## Next Week Goals.`;
      el.innerHTML=`<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>📄</div><div><div class='ai-card-title'>Full Report</div></div></div><button class='btn btn-ghost btn-sm' style='margin-bottom:6px' onclick='window.print()'>🖨 Print</button><div id='ai-report'></div></div>`;
      renderAIBlock("ai-report",p3,"mgr_report","Writing…");
    }
  };
  _aiSub("summary");
}

window._cStaff=function(sid,pill) {
  document.querySelectorAll(".pill").forEach(p=>p.classList.remove("active"));
  if (pill) pill.classList.add("active");
  const parts=window.location.pathname.split("/").filter(Boolean);
  const biz=getBiz(parts[0]); if(!biz) return;
  const s=biz.staff.find(x=>x.id===sid); if(!s) return;
  const allTaps=tapsByStaff&&tapsByStaff[s.id]?tapsByStaff[s.id]:getDemoTaps();
  const st=calcStats(allTaps);
  const ctx=biz.staff.filter(x=>x.active).map(x=>`${staffDisplayName(staffParts(x))}: score ${calcStats(tapsByStaff&&tapsByStaff[x.id]?tapsByStaff[x.id]:getDemoTaps()).score}`).join(", ");
  const fb=st.negFb.map(t=>`"${t.feedback}"(${t.rating}★)`).join("; ")||"none";
  const p=`Manager coaching for ${s.name}. Stats: ${st.count} taps, ${st.reviews} reviews, ${st.avgStr}★, ${st.ctr}% CTR, score ${st.score}. Team: ${ctx}. Feedback: ${fb}. What they do well, biggest improvement, coaching starter, suggested goal. Under 200 words.`;
  const cc=$("ccard"); if(!cc) return;
  cc.innerHTML=`<div class='ai-card'><div class='ai-card-head'><div style='width:36px;height:36px;border-radius:50%;background:${s.color}22;color:${s.color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px'>${staffIni(staffParts(s))}</div><div><div class='ai-card-title'>${esc(s.name)}</div><div class='ai-card-sub'>${st.count} taps · ${st.avgStr}★ · score ${st.score}</div></div></div><div id='aic-${sid}'></div></div>`;
  renderAIBlock("aic-"+sid,p,"mgr_c_"+sid,"Writing…");
};

// ─── TEAM TAB ──────────────────────────────
let _teamSub="leaderboard", _chartMode="bar";

function renderTeamTab(body, active, getStaffTaps) {
  if (!getStaffTaps) getStaffTaps = () => getDemoTaps();
  body.innerHTML=`<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:14px'><div id='tsubs' style='display:flex;gap:6px;flex-wrap:wrap'>${["leaderboard","analytics"].map((s,i)=>`<button data-ts='${s}' onclick='_tSub(this.dataset.ts)' style='background:${i===0?"#00e5a0":"#15171f"};color:${i===0?"#07080c":"rgba(238,240,248,.5)"};border:1px solid ${i===0?"#00e5a0":"rgba(255,255,255,.08)"};border-radius:9px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit'>${i===0?"🏆 Leaderboard":"📊 Analytics"}</button>`).join("")}</div><button id='team-refresh-btn' onclick='_refreshTeam()' style='background:#15171f;border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:6px 11px;font-size:14px;color:rgba(238,240,248,.5);cursor:pointer;font-family:inherit' title='Refresh'>↻</button></div><div id='tsub-body'></div>`;
  window._tSub=function(sub) {
    _teamSub=sub;
    document.querySelectorAll("#tsubs button").forEach(b=>{const a=b.dataset.ts===sub;b.style.background=a?"#00e5a0":"#15171f";b.style.color=a?"#07080c":"rgba(238,240,248,.5)";b.style.borderColor=a?"#00e5a0":"rgba(255,255,255,.08)";});
    const el=$("tsub-body"); if(!el) return;
    if (sub==="leaderboard") renderLeaderboard(el,active,getStaffTaps);
    else renderAnalytics(el,active,getStaffTaps);
  };
  _tSub(_teamSub);
}

function renderLeaderboard(el, active, getStaffTaps) {
  if (!getStaffTaps) getStaffTaps = () => getDemoTaps();
  const rows=active.map(s=>({s,st:calcStats(getStaffTaps(s))})).sort((a,b)=>b.st.score-a.st.score);
  const maxScore=Math.max(...rows.map(r=>r.st.score),1);
  const wkTop=[...rows].sort((a,b)=>b.st.weekTaps-a.st.weekTaps)[0];
  const pl=pct=>{if(pct>=.9)return{e:"🔥",l:"On Fire",c:"#ff6b35"};if(pct>=.75)return{e:"💪",l:"Strong",c:"#00e5a0"};if(pct>=.55)return{e:"✅",l:"Good",c:"#7c6aff"};if(pct>=.35)return{e:"📈",l:"Building",c:"#ffd166"};return{e:"💤",l:"Needs Push",c:"#ff4455"};};
  el.innerHTML=`<div class='lb-banner'><span style='font-size:22px'>🏆</span><div><div style='font-weight:700;font-size:13px;margin-bottom:2px'>This Week: ${esc(wkTop?wkTop.s.name:"—")}</div><div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>${wkTop?wkTop.st.weekTaps:0} taps · Resets Monday</div></div></div>`+
    rows.map((r,i)=>{const s=r.s,st=r.st,p=st.score/maxScore,badge=pl(p),bar=Math.round(p*100),dots=Array.from({length:10},(_,d)=>d<Math.round(p*10)?"●":"○").join("");return`<div class='lb-item ${i<3?"r"+(i+1):""}' style='flex-direction:column;align-items:stretch;gap:10px'><div style='display:flex;align-items:center;gap:12px'><div class='lb-rank'>${["🥇","🥈","🥉"][i]||i+1}</div><div class='lb-av' style='background:${s.color}22;color:${s.color}'>${staffIni(staffParts(s))}</div><div style='flex:1'><div style='display:flex;align-items:center;gap:7px;margin-bottom:2px'><div class='lb-nm'>${esc(staffDisplayName(staffParts(s)))}</div><span style='font-size:16px'>${badge.e}</span><span style='font-size:10px;font-weight:700;color:${badge.c};background:${badge.c}18;border-radius:5px;padding:1px 7px'>${badge.l}</span></div><div class='lb-st'>${st.count} taps · ${st.reviews} reviews · ${st.avgStr}⭐ · CTR ${st.ctr}%</div></div><div class='lb-sc'><div class='lb-sc-val'>${st.score}</div><div class='lb-sc-lbl'>pts</div></div></div><div style='display:flex;align-items:center;gap:8px'><div style='font-size:11px;color:${s.color};letter-spacing:.5px;font-family:monospace;flex:1'>${dots}</div><div style='font-size:10px;color:rgba(238,240,248,.35);font-weight:600'>${bar}%</div></div><div style='height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden'><div style='height:100%;width:${bar}%;background:linear-gradient(90deg,${s.color},${badge.c});border-radius:2px'></div></div></div>`;}).join("")+
    `<div style='margin-top:10px;font-size:11px;color:rgba(238,240,248,.28);font-weight:500'>Score = Taps×10 + Reviews×15 + 5★×5</div>`;
}

function renderAnalytics(el, active, getStaffTaps) {
  if (!getStaffTaps) getStaffTaps = () => getDemoTaps();
  const all=active.flatMap(s=>getStaffTaps(s));
  const tot=all.length,revs=all.filter(t=>t.review).length;
  const avg=all.length?(all.reduce((a,t)=>a+t.rating,0)/all.length).toFixed(1):"—";
  const pos=all.filter(t=>t.rating>=4).length,neg=all.filter(t=>t.rating<=3).length;
  const ctr=pos>0?Math.round((revs/pos)*100):0;
  const gT=all.filter(t=>t.platform==="google").length,yT=all.filter(t=>t.platform==="yelp").length;
  const mx=Math.max(...active.map(s=>getStaffTaps(s).length),1);
  const isBar=_chartMode==="bar";
  const bs=a=>`background:${a?"#00e5a0":"#15171f"};color:${a?"#07080c":"rgba(238,240,248,.5)"};border:1px solid ${a?"#00e5a0":"rgba(255,255,255,.08)"};border-radius:9px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit`;
  const cs="background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:13px;padding:15px;margin-bottom:9px";
  el.innerHTML=`<div style='display:flex;justify-content:flex-end;gap:6px;margin-bottom:10px'><button data-cm='bar' onclick='_setChart(this.dataset.cm)' style='${bs(isBar)}'>▬ Bar</button><button data-cm='donut' onclick='_setChart(this.dataset.cm)' style='${bs(!isBar)}'>◉ Donut</button></div><div style='display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:9px'>${[[tot,"Total Taps","#00e5a0"],[revs,"Reviews","#ffd166"],[avg+"⭐","Avg Rating","#ff6b35"],[ctr+"%","CTR","#7c6aff"],[pos,"Positive","#00e5a0"],[neg,"Negative","#ff4455"]].map(([v,l,c])=>`<div style='${cs}'><div style='font-weight:900;font-size:26px;line-height:1;margin-bottom:4px;color:${c};letter-spacing:-.03em'>${v}</div><div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:700'>${l}</div></div>`).join("")}</div><div style='${cs}'><div class='sec-lbl'>Platform</div>${buildPlatChart(gT,yT)}</div><div style='${cs}'><div class='sec-lbl'>Taps Per Staff</div>${buildStaffChart(active,mx,getStaffTaps)}</div>`;
  window._setChart=c=>{_chartMode=c;renderAnalytics(el,active);};
}

function buildPlatChart(gT,yT) {
  const segs=[{n:gT,c:"#00e5a0",l:"Google"},{n:yT,c:"#ffd166",l:"Yelp"}];
  if (_chartMode==="donut") {
    const tot=gT+yT||1;
    return `<div style='display:flex;align-items:center;gap:16px'>${buildDonut(segs.map(s=>({pct:s.n/tot,c:s.c})),80)}<div>${segs.map(s=>`<div style='display:flex;align-items:center;gap:7px;margin-bottom:7px'><div style='width:10px;height:10px;border-radius:50%;background:${s.c};flex-shrink:0'></div><div style='font-size:12px;font-weight:600;flex:1'>${s.l}</div><div style='font-size:12px;font-weight:800;color:${s.c}'>${s.n}</div></div>`).join("")}</div></div>`;
  }
  return segs.map(s=>`<div class='bar-row'><div class='bar-nm'>${s.l}</div><div class='bar-track'><div class='bar-fill' style='width:${gT+yT?Math.round(s.n/(gT+yT)*100):0}%;background:${s.c}'></div></div><div class='bar-v' style='color:${s.c}'>${s.n}</div></div>`).join("");
}

function buildStaffChart(active, mx, getStaffTaps) {
  if (!getStaffTaps) getStaffTaps = () => getDemoTaps();
  if (_chartMode==="donut") {
    const tot=active.reduce((a,s)=>a+getStaffTaps(s).length,0)||1;
    const segs=active.map(s=>({pct:getStaffTaps(s).length/tot,c:s.color}));
    return `<div style='display:flex;align-items:center;gap:16px'>${buildDonut(segs,80)}<div>${active.map(s=>{const n=getStaffTaps(s).length;return`<div style='display:flex;align-items:center;gap:7px;margin-bottom:7px'><div style='width:10px;height:10px;border-radius:50%;background:${s.color};flex-shrink:0'></div><div style='font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>${esc(staffParts(s).firstName||s.name)}</div><div style='font-size:12px;font-weight:800;color:${s.color}'>${n}</div></div>`}).join("")}</div></div>`;
  }
  return active.map(s=>{const n=getStaffTaps(s).length;return`<div class='bar-row'><div class='bar-nm'>${esc(staffParts(s).firstName||s.name)}</div><div class='bar-track'><div class='bar-fill' style='width:${Math.round(n/mx*100)}%;background:${s.color}'></div></div><div class='bar-v' style='color:${s.color}'>${n}</div></div>`;}).join("");
}

function buildDonut(segs, size) {
  const r=size*.35,cx=size/2,cy=size/2,sw=size*.18,circ=2*Math.PI*r;
  let off=0;
  const paths=segs.map(seg=>{const dl=seg.pct*circ,gap=circ-dl,p=`<circle cx='${cx}' cy='${cy}' r='${r}' fill='none' stroke='${seg.c}' stroke-width='${sw}' stroke-dasharray='${dl.toFixed(2)} ${gap.toFixed(2)}' stroke-dashoffset='${(-off*circ).toFixed(2)}' stroke-linecap='round' transform='rotate(-90 ${cx} ${cy})'/>`;off+=seg.pct;return p;});
  return `<svg width='${size}' height='${size}' style='flex-shrink:0'><circle cx='${cx}' cy='${cy}' r='${r}' fill='none' stroke='rgba(255,255,255,.06)' stroke-width='${sw}'/>${paths.join("")}</svg>`;
}

// ─── STAFF MGMT ────────────────────────────
function renderStaffMgmt(body, biz) {
  body.innerHTML=`<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'><div class='sec-lbl' style='margin-bottom:0'>Staff (${biz.staff.length})</div><div style='display:flex;gap:7px'><button onclick='_chgMgrPin()' class='btn btn-ghost btn-sm'>🔒 PIN</button><button onclick='_addStaff()' class='btn btn-primary btn-sm'>+ Add</button></div></div><div id='slist'></div>`;
  renderSList(biz);
}

function renderSList(biz) {
  const el=$("slist"); if(!el) return;
  const base=window.location.origin+"/"+biz.slug+"/tap/";
  el.innerHTML=biz.staff.map(s=>{
    const sp=staffParts(s);
    const displayName=staffDisplayName(sp);
    const urlSlug=staffUrlSlug(sp);
    const tapUrl=base+urlSlug;
    return `<div class='plain-card' style='opacity:${s.active?1:0.5};margin-bottom:9px'>
      <div style='display:flex;align-items:center;gap:11px'>
        <div style='width:40px;height:40px;border-radius:50%;background:${s.color}22;color:${s.color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0'>${staffIni(sp)}</div>
        <div style='flex:1;min-width:0'>
          <div style='font-weight:700;font-size:13px;margin-bottom:2px'>${esc(displayName)}${!s.active?" <span style='font-size:10px;background:rgba(255,68,85,.1);color:#ff4455;border-radius:4px;padding:1px 6px'>Inactive</span>":""}</div>
          <div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>Passcode: ${s.passcode}</div>
        </div>
        <div style='display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end'>
          <button onclick='_copyUrl("${tapUrl}")' class='btn btn-ghost btn-sm'>📋</button>
          <button onclick='_editStaff("${s.id}")' class='btn btn-ghost btn-sm'>✏</button>
          <button onclick='_togStaff("${s.id}")' class='btn btn-ghost btn-sm'>${s.active?"Deactivate":"Activate"}</button>
          <button onclick='_rmStaff("${s.id}")' class='btn btn-danger btn-sm'>✕</button>
        </div>
      </div>
      <div style='margin-top:8px;padding:7px 9px;background:#15171f;border-radius:8px;font-size:11px;color:#00e5a0;word-break:break-all;font-weight:500'>${tapUrl}</div>
    </div>`;
  }).join("");

  window._previewStaffUrl=function() {
    const fn=($("ns-fn")||$("es-fn")||{}).value?.trim()||"";
    const li=($("ns-li")||$("es-li")||{}).value?.trim().slice(0,1)||"";
    const preview=$("ns-url-preview"); if(!preview) return;
    if(!fn) { preview.textContent=""; return; }
    const urlSlug=staffUrlSlug({firstName:fn,lastInitial:li});
    preview.textContent="tapplus.link/"+biz.slug+"/tap/"+urlSlug;
  };
  window._copyUrl=url=>navigator.clipboard.writeText(url).then(()=>showToast("URL copied!")).catch(()=>showToast(url));
  window._togStaff=sid=>{biz.staff=biz.staff.map(s=>s.id===sid?{...s,active:!s.active}:s);saveBiz(biz);renderSList(biz);};
  window._rmStaff=sid=>{const s=biz.staff.find(x=>x.id===sid);if(!s||!confirm("Remove "+staffDisplayName(staffParts(s))+"?"))return;biz.staff=biz.staff.filter(x=>x.id!==sid);saveBiz(biz);renderSList(biz);};
  window._chgMgrPin=()=>{
    showModal(`<div class='modal-head'><div class='modal-title'>Change Manager PIN</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='background:#15171f;border-radius:9px;padding:10px 12px;font-size:12px;color:rgba(238,240,248,.38);font-weight:500'>Current: <strong style='color:#eef0f8'>${biz.mgrPin}</strong></div><div><div class='field-lbl'>New PIN</div><input class='inp' id='mp1' type='tel' maxlength='4'/></div><div><div class='field-lbl'>Confirm</div><input class='inp' id='mp2' type='tel' maxlength='4'/></div><div id='mp-err' style='color:#ff4455;font-size:12px;min-height:14px;font-weight:500'></div><button class='btn btn-primary btn-full' onclick='_saveMPin()'>Update PIN</button></div>`);
    window._saveMPin=()=>{const p1=($("mp1")||{}).value||"",p2=($("mp2")||{}).value||"",err=$("mp-err");if(!/^\d{4}$/.test(p1)){if(err)err.textContent="Must be 4 digits";return;}if(p1!==p2){if(err)err.textContent="PINs don't match";return;}biz.mgrPin=p1;saveBiz(biz);closeModal();showToast("PIN updated!");};
  };
  window._addStaff=()=>{
    window._selC=COLORS[0];
    showModal(`<div class='modal-head'><div class='modal-title'>Add Staff</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'>
      <div style='display:grid;grid-template-columns:1fr 80px;gap:8px'>
        <div><div class='field-lbl'>First Name</div><input class='inp' id='ns-fn' placeholder='Alisha' oninput='_previewStaffUrl()'/>  </div>
        <div><div class='field-lbl'>Last Initial</div><input class='inp' id='ns-li' placeholder='S' maxlength='1' style='text-align:center;text-transform:uppercase;font-size:18px;font-weight:800' oninput='this.value=this.value.toUpperCase();_previewStaffUrl()'/></div>
      </div>
      <div id='ns-url-preview' style='font-size:11px;color:#00e5a0;font-weight:600;min-height:14px'></div>
      <div><div class='field-lbl'>4-Digit Passcode</div><input class='inp' id='ns-p' type='tel' maxlength='4'/><div id='ns-err' style='color:#ff4455;font-size:12px;margin-top:4px;min-height:14px;font-weight:500'></div></div>
      <div><div class='field-lbl'>Color</div><div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:4px'>${COLORS.map((c,i)=>`<div data-c='${c}' onclick='_pC(this)' style='width:27px;height:27px;border-radius:50%;background:${c};cursor:pointer;outline:${i===0?"3px solid rgba(255,255,255,.8)":"none"};outline-offset:2px'></div>`).join("")}</div></div>
      <button class='btn btn-primary btn-full' onclick='_saveStaff()'>Add</button>
    </div>`);
    window._pC=el=>{window._selC=el.dataset.c;document.querySelectorAll("[data-c]").forEach(d=>d.style.outline="none");el.style.outline="3px solid rgba(255,255,255,.8)";el.style.outlineOffset="2px";};
    window._saveStaff=()=>{
      const fn=($("ns-fn")||{}).value?.trim()||"";
      const li=($("ns-li")||{}).value?.trim().slice(0,1).toUpperCase()||"";
      const p =($("ns-p") ||{}).value?.trim()||"";
      const err=$("ns-err");
      if(!fn){if(err)err.textContent="First name required";return;}
      if(!/^\d{4}$/.test(p)){if(err)err.textContent="Must be 4 digits";return;}
      if(biz.staff.find(s=>s.passcode===p)){if(err)err.textContent="Passcode in use";return;}
      biz.staff.push({id:uid(),firstName:fn,lastInitial:li,color:window._selC||COLORS[0],passcode:p,active:true});
      saveBiz(biz);closeModal();renderSList(biz);showToast("Staff added!");
    };
  };
  window._editStaff=sid=>{
    const s=biz.staff.find(x=>x.id===sid);if(!s)return;
    const sp=staffParts(s);
    window._selC=s.color;
    showModal(`<div class='modal-head'><div class='modal-title'>Edit: ${esc(staffDisplayName(sp))}</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'>
      <div style='display:grid;grid-template-columns:1fr 80px;gap:8px'>
        <div><div class='field-lbl'>First Name</div><input class='inp' id='es-fn' value='${esc(sp.firstName)}' oninput='_previewStaffUrl()'/>  </div>
        <div><div class='field-lbl'>Last Initial</div><input class='inp' id='es-li' value='${esc(sp.lastInitial||"")}' maxlength='1' style='text-align:center;text-transform:uppercase;font-size:18px;font-weight:800' oninput='this.value=this.value.toUpperCase();_previewStaffUrl()'/></div>
      </div>
      <div id='ns-url-preview' style='font-size:11px;color:#00e5a0;font-weight:600;min-height:14px'></div>
      <div><div class='field-lbl'>Passcode</div><input class='inp' id='es-p' type='tel' maxlength='4' value='${s.passcode}'/><div id='es-err' style='color:#ff4455;font-size:12px;margin-top:4px;min-height:14px;font-weight:500'></div></div>
      <div><div class='field-lbl'>Color</div><div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:4px'>${COLORS.map(c=>`<div data-c='${c}' onclick='_pC(this)' style='width:27px;height:27px;border-radius:50%;background:${c};cursor:pointer;outline:${c===s.color?"3px solid rgba(255,255,255,.8)":"none"};outline-offset:2px'></div>`).join("")}</div></div>
      <button class='btn btn-primary btn-full' onclick='_saveEdit("${sid}")'>Save</button>
    </div>`);
    window._pC=el=>{window._selC=el.dataset.c;document.querySelectorAll("[data-c]").forEach(d=>d.style.outline="none");el.style.outline="3px solid rgba(255,255,255,.8)";el.style.outlineOffset="2px";};
    window._saveEdit=sid2=>{
      const fn=($("es-fn")||{}).value?.trim()||"";
      const li=($("es-li")||{}).value?.trim().slice(0,1).toUpperCase()||"";
      const p =($("es-p") ||{}).value?.trim()||"";
      const err=$("es-err");
      if(!fn){if(err)err.textContent="First name required";return;}
      if(!/^\d{4}$/.test(p)){if(err)err.textContent="Must be 4 digits";return;}
      if(biz.staff.find(s=>s.passcode===p&&s.id!==sid2)){if(err)err.textContent="Passcode in use";return;}
      biz.staff=biz.staff.map(s=>s.id===sid2?{...s,firstName:fn,lastInitial:li,passcode:p,color:window._selC||s.color}:s);
      saveBiz(biz);closeModal();renderSList(biz);showToast("Saved!");
    };
  };
;
}

// ─── LINKS TAB ─────────────────────────────
function renderLinksTab(body, biz) {
  body.innerHTML=`<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'><div class='sec-lbl' style='margin-bottom:0'>Review Links</div><button onclick='_addLink()' class='btn btn-primary btn-sm'>+ Add</button></div><div style='background:#15171f;border-radius:9px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:rgba(238,240,248,.38);line-height:1.6;font-weight:500'>5★ auto-redirects to first active link. 4★ shows all.</div><div id='llist'></div>`;
  renderLList(biz);
}
function renderLList(biz) {
  const el=$("llist"); if(!el) return;
  el.innerHTML=biz.links.map(l=>`<div class='link-row'><div class='link-ico'>${l.icon}</div><div style='flex:1;min-width:0'><div style='font-weight:700;font-size:13px;margin-bottom:2px'>${esc(l.label)}</div><div style='font-size:11px;color:rgba(238,240,248,.38);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>${esc(l.url)}</div></div><div style='display:flex;gap:5px;flex-shrink:0'><button onclick='_togLink("${l.id}")' style='background:${l.active?"rgba(0,229,160,.1)":"rgba(255,255,255,.04)"};border:1px solid ${l.active?"rgba(0,229,160,.22)":"rgba(255,255,255,.06)"};color:${l.active?"#00e5a0":"rgba(238,240,248,.38)"};border-radius:7px;padding:4px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit'>${l.active?"On":"Off"}</button><button onclick='_editLink("${l.id}")' class='btn btn-ghost btn-sm'>Edit</button><button onclick='_rmLink("${l.id}")' class='btn btn-danger btn-sm'>✕</button></div></div>`).join("");
  window._togLink=id=>{biz.links=biz.links.map(l=>l.id===id?{...l,active:!l.active}:l);saveBiz(biz);renderLList(biz);};
  window._rmLink=id=>{if(!confirm("Remove this link?"))return;biz.links=biz.links.filter(l=>l.id!==id);saveBiz(biz);renderLList(biz);};
  window._addLink=()=>{
    showModal(`<div class='modal-head'><div class='modal-title'>Add Link</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='display:flex;gap:8px'><div style='width:70px;flex-shrink:0'><div class='field-lbl'>Icon</div><input class='inp' id='nl-i' placeholder='🔗' style='text-align:center;font-size:18px'/></div><div style='flex:1'><div class='field-lbl'>Label</div><input class='inp' id='nl-l' placeholder='Google, Yelp…'/></div></div><div><div class='field-lbl'>URL</div><input class='inp' id='nl-u' placeholder='https://…'/></div><button class='btn btn-primary btn-full' onclick='_saveLink()'>Add</button></div>`);
    window._saveLink=()=>{const icon=($("nl-i")||{}).value?.trim()||"🔗",label=($("nl-l")||{}).value?.trim()||"",url=($("nl-u")||{}).value?.trim()||"";if(!label||!url){showToast("Label and URL required");return;}biz.links.push({id:uid(),label,icon,url,active:true});saveBiz(biz);closeModal();renderLList(biz);};
  };
  window._editLink=id=>{
    const l=biz.links.find(x=>x.id===id);if(!l)return;
    showModal(`<div class='modal-head'><div class='modal-title'>Edit Link</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='display:flex;gap:8px'><div style='width:70px;flex-shrink:0'><div class='field-lbl'>Icon</div><input class='inp' id='el-i' value='${esc(l.icon)}' style='text-align:center;font-size:18px'/></div><div style='flex:1'><div class='field-lbl'>Label</div><input class='inp' id='el-l' value='${esc(l.label)}'/></div></div><div><div class='field-lbl'>URL</div><input class='inp' id='el-u' value='${esc(l.url)}'/></div><button class='btn btn-primary btn-full' onclick='_saveEditLink("${id}")'>Save</button></div>`);
    window._saveEditLink=lid=>{const icon=($("el-i")||{}).value?.trim()||"🔗",label=($("el-l")||{}).value?.trim()||"",url=($("el-u")||{}).value?.trim()||"";if(!label||!url){showToast("Label and URL required");return;}biz.links=biz.links.map(l=>l.id===lid?{...l,icon,label,url}:l);saveBiz(biz);closeModal();renderLList(biz);};
  };
}

// ─── GOALS TAB ─────────────────────────────
function renderGoalsTab(body, biz) {
  body.innerHTML=`<div id='gsubs' style='display:flex;gap:6px;margin-bottom:14px'><button data-gs='team' onclick='_gSub(this.dataset.gs)' style='background:#00e5a0;color:#07080c;border:1px solid #00e5a0;border-radius:9px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit'>Team Goals</button><button data-gs='ind' onclick='_gSub(this.dataset.gs)' style='background:#15171f;color:rgba(238,240,248,.5);border:1px solid rgba(255,255,255,.08);border-radius:9px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit'>Individual Goals</button></div><div id='gsub-body'></div>`;
  window._gSub=function(sub) {
    document.querySelectorAll("#gsubs button").forEach(b=>{const a=b.dataset.gs===sub;b.style.background=a?"#00e5a0":"#15171f";b.style.color=a?"#07080c":"rgba(238,240,248,.5)";b.style.borderColor=a?"#00e5a0":"rgba(255,255,255,.08)";});
    const el=$("gsub-body");if(!el)return;
    if (sub==="team") {
      const goals=biz.teamGoals||[];
      el.innerHTML=`<div style='display:flex;justify-content:flex-end;margin-bottom:10px'><button onclick='_addGoal("team",null)' class='btn btn-primary btn-sm'>+ Add Team Goal</button></div>`+(goals.length?goals.map(g=>goalRowMgr(g,"team",null,biz)).join(""):"<div style='text-align:center;padding:30px;color:rgba(238,240,248,.38);font-size:13px'>No team goals yet.</div>");
    } else {
      const active=biz.staff.filter(s=>s.active);
      el.innerHTML=`<div class='pills' id='gpills'>${active.map((s,i)=>`<div class='pill${i===0?" active":""}' onclick='_gStaff("${s.id}",this)'><div class='pill-av' style='background:${s.color}22;color:${s.color}'>${staffIni(staffParts(s))}</div>${staffParts(s).firstName||s.name}</div>`).join("")}</div><div id='gbody'></div>`;
      window._gStaff=function(sid,pill){
        document.querySelectorAll("#gpills .pill").forEach(p=>p.classList.remove("active"));if(pill)pill.classList.add("active");
        const s=biz.staff.find(x=>x.id===sid);const goals=(biz.staffGoals&&biz.staffGoals[sid])||[];
        const gb=$("gbody");if(!gb)return;
        gb.innerHTML=`<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:10px'><div class='sec-lbl' style='margin-bottom:0'>Goals for ${esc(s?.name||"")}</div><button onclick='_addGoal("staff","${sid}")' class='btn btn-primary btn-sm'>+ Add Goal</button></div>`+(goals.length?goals.map(g=>goalRowMgr(g,"staff",sid,biz)).join(""):"<div style='text-align:center;padding:24px;color:rgba(238,240,248,.38);font-size:13px'>No goals set yet.</div>");
      };
      if (active[0]) _gStaff(active[0].id,el.querySelector(".pill"));
    }
  };
  _gSub("team");

  window._addGoal=function(type,sid) {
    showModal(`<div class='modal-head'><div class='modal-title'>Add Goal</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:10px'><div><div class='field-lbl'>Title</div><input class='inp' id='g-t' placeholder='e.g. Hit 20 reviews this week'/></div><div><div class='field-lbl'>Note (optional)</div><input class='inp' id='g-n' placeholder='Focus on Google reviews'/></div><div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px'><div><div class='field-lbl'>Target</div><input class='inp' id='g-tg' type='number' placeholder='20' min='1'/></div><div><div class='field-lbl'>Current</div><input class='inp' id='g-c' type='number' placeholder='0' value='0' min='0'/></div><div><div class='field-lbl'>Unit</div><input class='inp' id='g-u' placeholder='reviews'/></div></div><div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'><div><div class='field-lbl'>Period</div><select class='sel' id='g-p'><option>This week</option><option>This month</option><option>Ongoing</option></select></div><div><div class='field-lbl'>Deadline</div><input class='inp' id='g-d' type='date'/></div></div><button class='btn btn-primary btn-full' onclick='_saveGoal("${type}","${sid||""}")'>Add Goal</button></div>`);
    window._saveGoal=function(type2,sid2){const title=($("g-t")||{}).value?.trim()||"",target=parseInt(($("g-tg")||{}).value)||0;if(!title||!target){showToast("Title and target required");return;}const goal={id:uid(),title,note:($("g-n")||{}).value?.trim()||"",target,current:parseInt(($("g-c")||{}).value)||0,unit:($("g-u")||{}).value?.trim()||"",period:($("g-p")||{}).value||"This week",deadline:($("g-d")||{}).value?.trim()||"",createdAt:Date.now()};if(type2==="team"){biz.teamGoals=biz.teamGoals||[];biz.teamGoals.push(goal);}else{biz.staffGoals=biz.staffGoals||{};if(!biz.staffGoals[sid2])biz.staffGoals[sid2]=[];biz.staffGoals[sid2].push(goal);}saveBiz(biz);closeModal();_gSub(type2==="team"?"team":"ind");showToast("Goal added!");};
  };
}

function goalRowMgr(g, type, sid, biz) {
  const pct=Math.min(100,g.target>0?Math.round((g.current/g.target)*100):0),done=pct>=100;
  const sidP=sid?`"${sid}"`:null;
  return `<div class='plain-card' style='margin-bottom:9px'><div style='display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px'><div style='flex:1'><div style='font-weight:700;font-size:13px;margin-bottom:3px'>${esc(g.title)}${done?" <span style='font-size:10px;color:#00e5a0;background:rgba(0,229,160,.1);border-radius:5px;padding:1px 6px'>Done ✓</span>":""}</div>${g.note?`<div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500;margin-bottom:5px'>${esc(g.note)}</div>`:""}<div style='display:flex;align-items:center;gap:8px'><div style='flex:1;height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden'><div style='height:100%;width:${pct}%;background:${done?"#00e5a0":"#7c6aff"};border-radius:3px'></div></div><div style='font-size:11px;font-weight:700;color:${done?"#00e5a0":"rgba(238,240,248,.5)"};flex-shrink:0'>${g.current}/${g.target} ${esc(g.unit||"")}</div></div></div><div style='display:flex;gap:5px;flex-shrink:0'><button onclick='_updGoal("${g.id}","${type}",${sidP})' class='btn btn-ghost btn-sm'>Update</button><button onclick='_delGoal("${g.id}","${type}",${sidP})' class='btn btn-danger btn-sm'>✕</button></div></div><div style='font-size:10px;color:rgba(238,240,248,.25);font-weight:500'>${esc(g.period||"")}${g.deadline?" · Due: "+esc(g.deadline):""}</div></div>`;
}

window._updGoal=function(gid,type,sid) {
  const parts=window.location.pathname.split("/").filter(Boolean);const biz=getBiz(parts[0]);if(!biz)return;
  const goals=type==="team"?biz.teamGoals:(biz.staffGoals&&biz.staffGoals[sid])||[];
  const g=goals.find(x=>x.id===gid);if(!g)return;
  showModal(`<div class='modal-head'><div class='modal-title'>Update Progress</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='background:#15171f;border-radius:10px;padding:12px 13px'><div style='font-weight:700;font-size:14px;margin-bottom:2px'>${esc(g.title)}</div><div style='font-size:12px;color:rgba(238,240,248,.38)'>Target: ${g.target} ${esc(g.unit||"")}</div></div><div><div class='field-lbl'>Current Progress</div><input class='inp' id='upd-c' type='number' value='${g.current}' min='0'/></div><button class='btn btn-primary btn-full' onclick='_saveUpd("${gid}","${type}","${sid||""}",this)'>Save</button></div>`);
  window._saveUpd=function(gid2,type2,sid2){const cur=parseInt(($("upd-c")||{}).value)||0;if(type2==="team"){biz.teamGoals=biz.teamGoals.map(g=>g.id===gid2?{...g,current:cur}:g);}else{biz.staffGoals[sid2]=(biz.staffGoals[sid2]||[]).map(g=>g.id===gid2?{...g,current:cur}:g);}saveBiz(biz);closeModal();showToast("Progress updated!");};
};
window._delGoal=function(gid,type,sid) {
  if(!confirm("Delete this goal?"))return;
  const parts=window.location.pathname.split("/").filter(Boolean);const biz=getBiz(parts[0]);if(!biz)return;
  if(type==="team"){biz.teamGoals=biz.teamGoals.filter(g=>g.id!==gid);}
  else{biz.staffGoals[sid]=(biz.staffGoals[sid]||[]).filter(g=>g.id!==gid);}
  saveBiz(biz);showToast("Goal removed");
};

// ─── BRANDING TAB ──────────────────────────
function renderBrandingTab(body, biz) {
  const b={...DEFAULT_BRAND,...(biz.brand||{})};
  body.innerHTML=`<div style='background:#15171f;border-radius:9px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:rgba(238,240,248,.38);line-height:1.6;font-weight:500'>Controls what customers see at <strong style='color:#eef0f8'>tapplus.link/${esc(biz.slug)}</strong>. Customers see none of the dashboard.</div><div class='field-lbl'>Business Name</div><input class='inp' id='br-n' value='${esc(b.name)}' style='margin-bottom:8px'/><div class='field-lbl'>Tagline</div><input class='inp' id='br-t' value='${esc(b.tagline)}' style='margin-bottom:8px'/><div class='field-lbl'>Logo URL</div>
      <input class='inp' id='br-l' value='${esc(b.logoUrl)}' placeholder='https://your-logo.png' style='margin-bottom:6px' oninput='_previewLogo()'/>
      <div id='logo-preview' style='margin-bottom:8px;min-height:0'>
        ${b.logoUrl ? `<img src='${esc(b.logoUrl)}' style='height:52px;max-width:160px;object-fit:contain;border-radius:8px;border:1px solid rgba(255,255,255,.08);padding:6px;background:#0e0f15' onerror='this.style.display="none"'/>` : ""}
      </div>
      <div style='background:#15171f;border-radius:8px;padding:9px 11px;margin-bottom:8px;font-size:11px;color:rgba(238,240,248,.38);line-height:1.6'>
        💡 Use a direct image link. Upload your logo free at
        <a href='https://imgbb.com' target='_blank' style='color:#00e5a0;text-decoration:none'>imgbb.com</a> or
        <a href='https://postimages.org' target='_blank' style='color:#00e5a0;text-decoration:none'>postimages.org</a>
        — copy the direct link and paste above.
      </div><div class='field-lbl'>Rating Question</div><input class='inp' id='br-q' value='${esc(b.ratingQuestion)}' style='margin-bottom:8px'/><div class='field-lbl'>Review Prompt (4-5★)</div><input class='inp' id='br-rp' value='${esc(b.reviewPrompt)}' style='margin-bottom:8px'/><div class='field-lbl'>Thank You Message</div><input class='inp' id='br-ty' value='${esc(b.thankYouMsg)}' style='margin-bottom:8px'/><div class='field-lbl'>Low Rating Message (1-3★)</div><input class='inp' id='br-lr' value='${esc(b.lowRatingMsg)}' style='margin-bottom:12px'/><div style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px'><div><div class='field-lbl'>Brand Color</div><input type='color' id='br-bc' value='${b.brandColor||"#00e5a0"}' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div><div><div class='field-lbl'>Background</div><input type='color' id='br-bg' value='${b.bgColor||"#07080c"}' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div><div><div class='field-lbl'>Text</div><input type='color' id='br-tc' value='${b.textColor||"#ffffff"}' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div></div><div style='display:flex;gap:8px'><button onclick='window.open("/${esc(biz.slug)}","_blank")' class='btn btn-ghost btn-full'>👁 Preview</button><button onclick='_saveBrand()' class='btn btn-primary btn-full'>Save Branding</button></div>`;
  window._saveBrand=()=>{biz.brand={name:($("br-n")||{}).value?.trim()||b.name,tagline:($("br-t")||{}).value?.trim()||"",logoUrl:($("br-l")||{}).value?.trim()||"",ratingQuestion:($("br-q")||{}).value?.trim()||DEFAULT_BRAND.ratingQuestion,reviewPrompt:($("br-rp")||{}).value?.trim()||DEFAULT_BRAND.reviewPrompt,thankYouMsg:($("br-ty")||{}).value?.trim()||DEFAULT_BRAND.thankYouMsg,lowRatingMsg:($("br-lr")||{}).value?.trim()||DEFAULT_BRAND.lowRatingMsg,brandColor:($("br-bc")||{}).value||"#00e5a0",bgColor:($("br-bg")||{}).value||"#07080c",textColor:($("br-tc")||{}).value||"#ffffff"};saveBiz(biz);showToast("Branding saved!");};
  window._previewLogo = function() {
    const url = ($("br-l")||{}).value?.trim()||"";
    const prev = $("logo-preview"); if (!prev) return;
    if (!url) { prev.innerHTML = ""; return; }
    prev.innerHTML = `<img src='${esc(url)}' style='height:52px;max-width:160px;object-fit:contain;border-radius:8px;border:1px solid rgba(255,255,255,.08);padding:6px;background:#0e0f15' onerror='this.style.display="none"'/>`;
  };

}

// ─── ESTIMATOR ─────────────────────────────
function renderEstimatorTab(body, active, getStaffTaps) {
  if (!getStaffTaps) getStaffTaps = () => getDemoTaps();
  body.innerHTML=`<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>📈</div><div><div class='ai-card-title'>Platform Rating Estimator</div><div class='ai-card-sub'>How many 5★ reviews to hit your target</div></div></div><div class='field-lbl' style='margin-top:4px'>Platform</div><select class='sel' id='e-plat' style='margin-bottom:10px'><option value='google'>Google</option><option value='yelp'>Yelp</option><option value='tripadvisor'>Tripadvisor</option></select><div class='field-lbl'>Current Review Count</div><input class='inp' id='e-count' type='number' value='71' style='margin-bottom:8px'/><div class='field-lbl'>Current Rating</div><input class='inp' id='e-cur' type='number' step='0.1' value='4.2' style='margin-bottom:8px'/><div class='field-lbl'>Target Rating</div><input class='inp' id='e-tgt' type='number' step='0.1' value='4.5' style='margin-bottom:12px'/><button onclick='_calcEst()' style='width:100%;padding:12px;background:linear-gradient(135deg,rgba(167,139,250,.16),rgba(129,140,248,.12));border:1px solid rgba(167,139,250,.28);color:#a78bfa;border-radius:11px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit'>✦ Calculate &amp; Predict</button><div id='e-result' style='margin-top:14px'></div></div>`;
  window._calcEst=function(){
    const c=parseInt(($("e-count")||{}).value)||0,cur=parseFloat(($("e-cur")||{}).value)||0,tgt=parseFloat(($("e-tgt")||{}).value)||0,plat=($("e-plat")||{}).value||"google";
    const el=$("e-result");if(!el)return;
    if(!c||!cur||!tgt){el.innerHTML="<div style='color:#ff4455;font-size:13px'>Fill in all fields.</div>";return;}
    if(tgt<=cur){el.innerHTML="<div style='color:#ffd166;font-size:13px;font-weight:600;text-align:center;padding:8px'>✓ Already at or above target!</div>";return;}
    if(tgt>5){el.innerHTML="<div style='color:#ff4455;font-size:13px'>Target can't exceed 5.0</div>";return;}
    const n=Math.max(1,Math.ceil((c*(tgt-cur))/(5-tgt))),tps=Math.ceil(n/0.65),pace=Math.max(1,active.length*3),wks=Math.ceil(tps/pace);
    const p=`Restaurant wants ${plat} from ${cur}★ to ${tgt}★. ${c} reviews. Need ~${n} new 5★ reviews (~${tps} taps, ~${wks} weeks). Timeframe, strategy, 2 tactics, 1 risk. Under 150 words.`;
    el.innerHTML=`<div class='est-grid'>${[[n,"5★ needed","#00e5a0"],[tps,"Taps needed","#ffd166"],[wks+"w","Est. time","#7c6aff"],[cur+"→"+tgt+"★","Jump","#ff6b35"]].map(([v,l,c])=>`<div class='est-card'><div class='est-val' style='color:${c}'>${v}</div><div class='est-lbl'>${l}</div></div>`).join("")}</div><div id='ai-est'></div>`;
    renderAIBlock("ai-est",p,"est_"+plat+"_"+cur+"_"+tgt,"Predicting…");
  };
}

// ─── INIT ──────────────────────────────────
window.addEventListener("popstate", route);
if (document.readyState==="loading") document.addEventListener("DOMContentLoaded", route);
else route();