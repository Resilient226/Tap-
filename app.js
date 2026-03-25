// ═══════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════
const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k) => { try { localStorage.removeItem(k); } catch {} }
};

// ═══════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════
const DEFAULT_LINKS = [
  { id: "gl", label: "Google", icon: "🔍", url: "https://search.google.com/local/writereview?placeid=YOUR_PLACE_ID", active: true },
  { id: "yl", label: "Yelp", icon: "⭐", url: "https://www.yelp.com/writeareview/biz/YOUR_BIZ_ID", active: true },
  { id: "ta", label: "Tripadvisor", icon: "✈️", url: "https://www.tripadvisor.com/UserReviewEdit-YOUR_ID", active: false }
];
const DEFAULT_STAFF = [
  { id: "s1", name: "Marcus J.", color: "#00e5a0", passcode: "1111", active: true },
  { id: "s2", name: "Priya S.", color: "#7c6aff", passcode: "2222", active: true },
  { id: "s3", name: "Leo R.", color: "#ff6b35", passcode: "3333", active: true },
  { id: "s4", name: "Dani K.", color: "#ffd166", passcode: "4444", active: true }
];
const ADMIN_PIN = "0000";
const MGR_PIN_DEFAULT = "1234";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const COLORS = ["#00e5a0","#7c6aff","#ff6b35","#ffd166","#ff4455","#38bdf8","#f472b6","#a3e635"];

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
const STATE = {
  staff: LS.get("tp_staff", DEFAULT_STAFF),
  links: LS.get("tp_links", DEFAULT_LINKS),
  apiKey: LS.get("tp_key", ""),
  mgrPin: LS.get("tp_mpin", MGR_PIN_DEFAULT),
  teamGoals: LS.get("tp_tgoals", []),
  staffGoals: LS.get("tp_sgoals", {}),
  currentStaff: null,
  aiCache: {}
};

function save() {
  LS.set("tp_staff", STATE.staff);
  LS.set("tp_links", STATE.links);
  if (STATE.apiKey) LS.set("tp_key", STATE.apiKey); else LS.del("tp_key");
  LS.set("tp_mpin", STATE.mgrPin);
  LS.set("tp_tgoals", STATE.teamGoals);
  LS.set("tp_sgoals", STATE.staffGoals);
}

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════
const ini = n => n.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
const uid = () => Math.random().toString(36).slice(2, 11);
const esc = s => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const fmt = ts => { const d = new Date(ts); return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}) + ", " + d.toLocaleDateString([], {month:"short",day:"numeric"}); };
const wsStart = () => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.getDay()); return d.getTime(); };
const $ = id => document.getElementById(id);

function setView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("on"));
  const v = $("v-" + name);
  if (v) v.classList.add("on");
}

function mkTaps(seed) {
  const t = Date.now(), H = 3600000;
  const s = (seed || 1);
  return [
    { ts: t-H*1,  rating: 5, platform: "google", review: true,  feedback: "" },
    { ts: t-H*3,  rating: 4, platform: "yelp",   review: true,  feedback: "" },
    { ts: t-H*6,  rating: 5, platform: null,      review: false, feedback: "" },
    { ts: t-H*25, rating: 3, platform: null,      review: false, feedback: "Food was a bit cold" },
    { ts: t-H*26, rating: 5, platform: "google",  review: true,  feedback: "" },
    { ts: t-H*50, rating: 4, platform: "google",  review: true,  feedback: "" },
    { ts: t-H*73, rating: 2, platform: null,      review: false, feedback: "Felt rushed, order wrong" },
    { ts: t-H*98, rating: 5, platform: "google",  review: true,  feedback: "" }
  ];
}

function getStats(taps) {
  const reviews = taps.filter(t => t.review).length;
  const ratings = taps.map(t => t.rating);
  const avg = ratings.length ? ratings.reduce((a,b) => a+b, 0) / ratings.length : 0;
  const wt = taps.filter(t => t.ts >= wsStart()).length;
  const score = taps.length*10 + reviews*15 + ratings.filter(r => r===5).length*5;
  const pos = taps.filter(t => t.rating >= 4).length;
  const ctr = pos > 0 ? Math.round((reviews/pos)*100) : 0;
  const negFb = taps.filter(t => t.feedback && t.rating <= 3);
  return { count: taps.length, reviews, avg, avgStr: avg ? avg.toFixed(1) : "—", weekTaps: wt, score, ctr, negFb, gC: taps.filter(t => t.platform==="google").length };
}

// ═══════════════════════════════════════════
// GROQ
// ═══════════════════════════════════════════
async function callGroq(prompt, key) {
  const sys = "You are Tap+ AI, a restaurant performance analyst. Be specific with numbers. Use **bold** for emphasis, ## for section headings, - for bullets. Keep responses concise and actionable. Never invent data.";
  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify({ model: GROQ_MODEL, messages: [{role:"system",content:sys},{role:"user",content:prompt}], max_tokens: 900, temperature: 0.7 })
  });
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(r.status===401 ? "INVALID_KEY" : (e?.error?.message || "API error")); }
  const d = await r.json();
  return d.choices?.[0]?.message?.content || "";
}

function mdRender(text) {
  return (text || "").split("\n").map(line => {
    const bold = s => s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    if (line.startsWith("## "))  return "<div style='font-weight:800;font-size:14px;margin:13px 0 6px;color:#eef0f8'>" + esc(line.slice(3)) + "</div>";
    if (line.startsWith("### ")) return "<div style='font-weight:700;font-size:11px;color:#a78bfa;margin:11px 0 5px;text-transform:uppercase;letter-spacing:.08em'>" + esc(line.slice(4)) + "</div>";
    if (line.startsWith("- "))  return "<div style='display:flex;gap:7px;margin-bottom:5px'><span style='color:#a78bfa;flex-shrink:0'>›</span><span>" + bold(esc(line.slice(2))) + "</span></div>";
    if (!line) return "<br/>";
    return "<div>" + bold(esc(line)) + "</div>";
  }).join("");
}

// ═══════════════════════════════════════════
// AI BLOCK
// ═══════════════════════════════════════════
function aiOutHTML(text, k) {
  return "<div class='ai-out'><div class='ai-out-lbl'><span class='ai-mini-dot'></span> AI Analysis</div><div class='ai-out-text'>" + mdRender(text) + "</div><button class='ai-refresh' onclick='refreshAI(\"" + k + "\",this)'>↻ Refresh</button></div>";
}

function renderAIBlock(containerId, prompt, ckey, msg) {
  const el = $(containerId);
  if (!el) return;
  if (!STATE.apiKey) { el.innerHTML = "<div class='ai-nokey'>⚠️ No API key — go back home and tap the AI status dot to connect.</div>"; return; }
  const k = ckey || prompt.slice(0, 80);
  if (STATE.aiCache[k]) { el.innerHTML = aiOutHTML(STATE.aiCache[k], k); return; }
  el.innerHTML = "<div class='ai-loading'><div class='ai-spinner'></div>" + esc(msg || "Analyzing…") + "</div>";
  callGroq(prompt, STATE.apiKey).then(text => {
    STATE.aiCache[k] = text;
    el.innerHTML = aiOutHTML(text, k);
  }).catch(e => {
    el.innerHTML = "<div class='ai-err'>" + (e.message==="INVALID_KEY" ? "❌ Invalid key — update from home screen" : "❌ " + esc(e.message)) + "</div><button class='btn btn-ghost btn-sm' style='margin-top:8px' onclick='renderAIBlock(\"" + containerId + "\",decodeURIComponent(\"" + encodeURIComponent(prompt) + "\"),\"" + k + "\",\"" + esc(msg||"") + "\")'>↻ Retry</button>";
  });
}

function refreshAI(k, btn) {
  delete STATE.aiCache[k];
  const block = btn.closest("[data-aiblock]");
  if (!block) return;
  renderAIBlock(block.id, decodeURIComponent(block.dataset.prompt || ""), k, block.dataset.msg || "");
}

// ═══════════════════════════════════════════
// RENDER — main entry point
// ═══════════════════════════════════════════
function render() {
  const app = document.getElementById("app");
  if (!app) return;
  const path = window.location.pathname;

  if (path.startsWith("/tap/")) {
    const sid = path.replace("/tap/", "").split("/")[0];
    app.innerHTML = "<div id='v-tap' class='view tap-view on'></div>";
    initTapPage(sid);
    return;
  }

  app.innerHTML = renderHub() + renderPinView("staff-login","Staff Login","Enter your 4-digit passcode","Your passcode is set by your manager","#7c6aff") + renderPinView("mgr-pin","Manager Login","Enter your 4-digit PIN","Default PIN: 1234","#00e5a0") + renderSetup() + "<div id='v-staff' class='view' style='flex-direction:column'></div>" + "<div id='v-mgr' class='view' style='flex-direction:column'></div>" + "<button id='admin-btn' class='admin-btn' title='Admin'>⚙</button>";

  initHub();
}

// ═══════════════════════════════════════════
// HUB
// ═══════════════════════════════════════════
function renderHub() {
  const connected = !!STATE.apiKey;
  return "<div id='v-hub' class='view hub on'><div style='position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;width:100%'><div class='hub-logo'>Tap<span>+</span></div><div class='hub-tag'>Smart review management for restaurants</div><div class='hub-cards'><div class='hub-card' id='btn-staff-login'><div class='hub-card-ico' style='background:rgba(0,229,160,.08)'>👤</div><div style='flex:1'><div class='hub-card-title'>Staff Login</div><div class='hub-card-sub'>Your stats, AI coaching &amp; feedback</div></div><div class='hub-card-arrow'>›</div></div><div class='hub-card' id='btn-mgr-login'><div class='hub-card-ico' style='background:rgba(167,139,250,.08)'>⚙️</div><div style='flex:1'><div class='hub-card-title'>Manager Login</div><div class='hub-card-sub'>Analytics, AI tools &amp; team management</div></div><div class='hub-card-arrow'>›</div></div></div><div class='ai-status' id='ai-status-btn' style='color:" + (connected ? "#00e5a0" : "rgba(238,240,248,.25)") + "'><div class='ai-dot' style='background:" + (connected ? "#00e5a0" : "rgba(238,240,248,.15)") + "'></div>" + (connected ? "AI connected via Groq ✓" : "AI not connected — tap to set up") + "</div></div></div>";
}

function initHub() {
  const sl = $("btn-staff-login"); if (sl) sl.addEventListener("click", () => openPin("staff-login"));
  const ml = $("btn-mgr-login"); if (ml) ml.addEventListener("click", () => openPin("mgr-pin"));
  const ai = $("ai-status-btn"); if (ai) ai.addEventListener("click", () => setView("setup"));
  const ab = $("admin-btn"); if (ab) ab.addEventListener("click", showAdminPin);
}

// ═══════════════════════════════════════════
// PIN PAD
// ═══════════════════════════════════════════
function renderPinView(id, title, sub, hint, dotColor) {
  return "<div id='v-" + id + "' class='view pin-view'><button class='pin-back' onclick='showHub()'>←</button><div class='pin-title'>" + esc(title) + "</div><div class='pin-sub'>" + esc(sub) + "</div><div class='pin-dots' id='dots-" + id + "'>" + [0,1,2,3].map(i => "<div class='pin-dot' id='dot-" + id + "-" + i + "'></div>").join("") + "</div><div class='pin-grid'>" + ["1","2","3","4","5","6","7","8","9","C","0","⌫"].map(k => "<div class='pin-key' onclick='pinKey(\"" + id + "\",\"" + k + "\")'>" + k + "</div>").join("") + "</div><div class='pin-err' id='err-" + id + "'></div><div class='pin-hint'>" + esc(hint) + "</div></div>";
}

const pinVals = {};
function openPin(id) { setView(id); pinVals[id] = ""; updateDots(id); }
function showHub() { setView("hub"); }

function pinKey(id, k) {
  if (!pinVals[id]) pinVals[id] = "";
  if (k === "C") { pinVals[id] = ""; const e = $("err-"+id); if(e) e.textContent = ""; }
  else if (k === "⌫") pinVals[id] = pinVals[id].slice(0,-1);
  else if (pinVals[id].length < 4) pinVals[id] += k;
  updateDots(id);
  const errEl = $("err-"+id); if(errEl) errEl.textContent = "";
  if (pinVals[id].length === 4) {
    const val = pinVals[id];
    pinVals[id] = "";
    setTimeout(() => {
      updateDots(id);
      if (id === "staff-login") {
        const s = STATE.staff.find(x => x.passcode === val && x.active);
        if (s) { STATE.currentStaff = s; openStaffDash(); }
        else { const e = $("err-staff-login"); if(e) e.textContent = "Incorrect passcode. Try again."; }
      } else if (id === "mgr-pin") {
        if (val === STATE.mgrPin) openMgrDash();
        else { const e = $("err-mgr-pin"); if(e) e.textContent = "Incorrect PIN. Try again."; }
      }
    }, 180);
  }
}

function updateDots(id) {
  const v = pinVals[id] || "";
  const color = id === "staff-login" ? "#7c6aff" : "#00e5a0";
  [0,1,2,3].forEach(i => {
    const d = $("dot-" + id + "-" + i);
    if (!d) return;
    d.style.background = i < v.length ? color : "transparent";
    d.style.borderColor = i < v.length ? color : "rgba(255,255,255,.15)";
  });
}

// ═══════════════════════════════════════════
// SETUP
// ═══════════════════════════════════════════
function renderSetup() {
  return "<div id='v-setup' class='view setup-view'><div style='position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;width:100%'><div style='font-weight:700;font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:#a78bfa;opacity:.7;margin-bottom:18px'>Tap+ AI</div><div style='font-weight:900;font-size:clamp(24px,5vw,34px);line-height:1.1;margin-bottom:9px;letter-spacing:-.03em;text-align:center'>Connect your <span style='background:linear-gradient(135deg,#a78bfa,#00e5a0);-webkit-background-clip:text;-webkit-text-fill-color:transparent'>free AI</span></div><div style='color:rgba(238,240,248,.38);font-size:13px;margin-bottom:26px;line-height:1.7;max-width:290px;text-align:center;font-weight:500'>Groq is free. No credit card required.</div><div class='setup-card'><div class='setup-steps'><div class='setup-step'><div class='step-num'>1</div><span>Go to <a href='https://console.groq.com/keys' target='_blank' style='color:#00e5a0;text-decoration:none'>console.groq.com/keys</a></span></div><div class='setup-step'><div class='step-num'>2</div><span>Click <strong style='color:#eef0f8'>Create API Key</strong></span></div><div class='setup-step'><div class='step-num'>3</div><span><strong style='color:#eef0f8'>Copy the key</strong> — it starts with gsk_</span></div></div><input id='setup-key-inp' class='inp' placeholder='Paste your key (gsk_…)' style='margin-bottom:8px'/><div id='setup-err' style='color:#ff4455;font-size:12px;margin-bottom:8px;font-weight:500;min-height:16px'></div><button class='btn btn-ai btn-full' style='font-size:14px;padding:13px;margin-bottom:10px' onclick='testGroqKey()'>✦ Connect &amp; Continue</button><div style='font-size:12px;color:rgba(238,240,248,.25);text-align:center;cursor:pointer;text-decoration:underline;font-weight:500' onclick='showHub()'>Skip — use without AI</div></div></div></div>";
}

async function testGroqKey() {
  const inp = $("setup-key-inp");
  const errEl = $("setup-err");
  const k = (inp ? inp.value : "").trim();
  if (!k.startsWith("gsk_")) { if(errEl) errEl.textContent = "Groq keys start with gsk_"; return; }
  if(errEl) errEl.textContent = "Testing…";
  try {
    await callGroq("Reply with one word: ready", k);
    STATE.apiKey = k; save(); render();
  } catch(e) {
    if(errEl) errEl.textContent = e.message === "INVALID_KEY" ? "Invalid key — double-check it" : "Connection failed — check your internet";
  }
}
window.testGroqKey = testGroqKey;

// ═══════════════════════════════════════════
// STAFF DASHBOARD
// ═══════════════════════════════════════════
function openStaffDash() {
  const s = STATE.currentStaff;
  if (!s) return;
  const taps = mkTaps(s.id.charCodeAt(1) || 1);
  const st = getStats(taps);
  const allCtx = STATE.staff.filter(x => x.active).map(x => x.name + ": score " + getStats(mkTaps(x.id.charCodeAt(1)||1)).score).join(", ");
  const fb = st.negFb.map(t => '"' + t.feedback + '"(' + t.rating + "★)").join("; ") || "none";
  const coachP = "Coach " + s.name.split(" ")[0] + " directly (say 'you'). Data: " + st.count + " taps, " + st.reviews + " reviews, " + st.avgStr + "★ avg, " + st.ctr + "% CTR, score " + st.score + ", " + st.weekTaps + " taps this week. Team: " + allCtx + ". Their feedback: " + fb + ". Write 3 coaching tips: genuine compliment from their data, one honest improvement, motivating close. Under 220 words.";
  const sentP = st.negFb.length ? "Analyze feedback for " + s.name.split(" ")[0] + " (speak to them directly).\n" + st.negFb.map(t => t.rating + "★: \"" + t.feedback + "\"").join("\n") + "\nGive: 1) Main theme 2) One specific change 3) Positive reframe. Kind, honest. Under 120 words." : "";

  const el = $("v-staff");
  if (!el) return;
  el.innerHTML = "<div class='dash-header'><div><div class='dash-name'>" + esc(s.name.split(" ")[0]) + "'s Dashboard</div><div class='dash-sub'>Powered by Tap+ AI</div></div><button class='dash-exit' onclick='showHub()'>← Exit</button></div><div class='dash-tabs' id='staff-tabs'><button class='dash-tab ai active' onclick='staffTab(\"coaching\",this)'><span class='ai-mini-dot'></span> AI Coaching</button><button class='dash-tab ai' onclick='staffTab(\"sentiment\",this)'><span class='ai-mini-dot'></span> My Feedback</button><button class='dash-tab' onclick='staffTab(\"goals\",this)'>My Goals</button><button class='dash-tab' onclick='staffTab(\"stats\",this)'>My Stats</button></div><div class='dash-body' id='staff-body'></div>";

  window._sData = { s, st, taps, coachP, sentP };

  window.staffTab = function(tab, btn) {
    document.querySelectorAll("#staff-tabs .dash-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderStaffTab(tab);
  };

  setView("staff");
  renderStaffTab("coaching");
}

function renderStaffTab(tab) {
  const body = $("staff-body");
  if (!body || !window._sData) return;
  const { s, st, taps, coachP, sentP } = window._sData;

  if (tab === "coaching") {
    body.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>💬</div><div><div class='ai-card-title'>Your AI Coach</div><div class='ai-card-sub'>" + st.count + " taps · " + st.avgStr + "★ · " + st.ctr + "% CTR</div></div></div><div id='ai-coaching' data-aiblock='1' data-prompt='" + encodeURIComponent(coachP) + "' data-msg='Writing your coaching tips…'></div></div>";
    renderAIBlock("ai-coaching", coachP, "sc_" + s.id, "Writing your coaching tips…");

  } else if (tab === "sentiment") {
    body.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>💭</div><div><div class='ai-card-title'>Your Customer Feedback</div><div class='ai-card-sub'>" + st.negFb.length + " feedback entries</div></div></div><div id='ai-sentiment' data-aiblock='1' data-prompt='" + encodeURIComponent(sentP) + "' data-msg='Analyzing feedback…'></div></div>" + (st.negFb.length > 0 ? "<div style='margin-top:4px'><div class='sec-lbl'>Feedback Log</div>" + st.negFb.map(t => "<div class='plain-card'><div style='display:flex;justify-content:space-between;margin-bottom:5px'><span style='font-size:13px'>" + "⭐".repeat(t.rating) + "☆".repeat(5-t.rating) + "</span><span style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>" + fmt(t.ts) + "</span></div><div style='font-size:13px;color:rgba(238,240,248,.65);font-style:italic'>\"" + esc(t.feedback) + "\"</div></div>").join("") + "</div>" : "");
    if (st.negFb.length) renderAIBlock("ai-sentiment", sentP, "ss_" + s.id, "Analyzing feedback…");
    else { const el = $("ai-sentiment"); if(el) el.innerHTML = "<div style='color:#00e5a0;font-size:13px;font-weight:600'>🎉 No negative feedback yet — keep it up!</div>"; }

  } else if (tab === "goals") {
    const sid = window._sData.s.id;
    const tGoals = STATE.teamGoals || [];
    const sGoals = (STATE.staffGoals[sid] || []);
    const allGoals = tGoals.map(g => Object.assign({}, g, {_isTeam:true})).concat(sGoals);
    if (allGoals.length === 0) {
      body.innerHTML = "<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 20px;text-align:center'><div style='font-size:36px;margin-bottom:12px'>🎯</div><div style='font-weight:700;font-size:15px;margin-bottom:6px'>No goals yet</div><div style='color:rgba(238,240,248,.38);font-size:13px;font-weight:500'>Your manager will set goals here for you to track.</div></div>";
    } else {
      body.innerHTML =
        (tGoals.length>0 ? "<div class='sec-lbl'>Team Goals</div>" + tGoals.map(g => staffGoalRowHTML(g)).join("") : "") +
        (sGoals.length>0 ? "<div class='sec-lbl' style='margin-top:14px'>Your Personal Goals</div>" + sGoals.map(g => staffGoalRowHTML(g)).join("") : "");
    }
  } else {
    body.innerHTML = "<div class='stat-grid'>" + [[st.count,"Taps",s.color],[st.reviews,"Reviews","#ffd166"],[st.avgStr,"Avg ★","#ff6b35"],[st.ctr+"%","CTR","#7c6aff"],[st.weekTaps,"This Week","#00e5a0"],[st.score,"Score","#ffd166"]].map(([v,l,c]) => "<div class='stat-box'><div class='stat-val' style='color:" + c + "'>" + v + "</div><div class='stat-lbl'>" + l + "</div></div>").join("") + "</div><div class='sec-lbl'>Recent Taps</div>" + [...taps].sort((a,b) => b.ts-a.ts).slice(0,6).map(t => "<div style='display:flex;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);gap:9px'><div style='width:6px;height:6px;border-radius:50%;background:" + (t.rating<=3?"#ff4455":"#00e5a0") + ";flex-shrink:0;margin-top:4px'></div><div style='flex:1'><div style='font-size:12px;font-weight:600'>" + "⭐".repeat(t.rating) + (t.review ? "<span style='font-size:10px;font-weight:700;background:rgba(0,229,160,.1);color:#00e5a0;border-radius:5px;padding:1px 6px;margin-left:5px'>REVIEW</span>" : "") + (t.platform ? "<span style='font-size:10px;font-weight:700;background:rgba(124,106,255,.1);color:#7c6aff;border-radius:5px;padding:1px 6px;margin-left:4px'>" + t.platform + "</span>" : "") + "</div><div style='font-size:11px;color:rgba(238,240,248,.38);margin-top:2px;font-weight:500'>" + fmt(t.ts) + "</div></div></div>").join("");
  }
}

// ═══════════════════════════════════════════
// MANAGER DASHBOARD
// ═══════════════════════════════════════════
function openMgrDash() {
  const activeStaff = STATE.staff.filter(s => s.active);
  const sd = activeStaff.map(s => { const st = getStats(mkTaps(s.id.charCodeAt(1)||1)); return s.name + ": " + st.count + " taps, " + st.reviews + " reviews, " + st.avgStr + "★, score " + st.score; }).join("\n");
  const allFb = activeStaff.flatMap(s => getStats(mkTaps(s.id.charCodeAt(1)||1)).negFb.map(t => s.name + "(" + t.rating + "★):\"" + t.feedback + "\"")).join("\n");

  const el = $("v-mgr");
  if (!el) return;
  el.innerHTML = "<div class='dash-header'><div><div class='dash-name'>Manager Dashboard</div><div class='dash-sub'>Tap+ AI</div></div><button class='dash-exit' onclick='showHub()'>← Exit</button></div><div class='dash-tabs' id='mgr-tabs'><button class='dash-tab ai active' onclick='mgrTab(\"summary\",this)'><span class='ai-mini-dot'></span> Summary</button><button class='dash-tab ai' onclick='mgrTab(\"coaching\",this)'><span class='ai-mini-dot'></span> Coaching</button><button class='dash-tab' onclick='mgrTab(\"goals\",this)'>Goals</button><button class='dash-tab ai' onclick='mgrTab(\"feedback\",this)'><span class='ai-mini-dot'></span> Feedback</button><button class='dash-tab ai' onclick='mgrTab(\"estimator\",this)'><span class='ai-mini-dot'></span> Estimator</button><button class='dash-tab' onclick='mgrTab(\"staff\",this)'>Staff</button><button class='dash-tab' onclick='mgrTab(\"leaderboard\",this)'>Leaderboard</button><button class='dash-tab' onclick='mgrTab(\"analytics\",this)'>Analytics</button><button class='dash-tab ai' onclick='mgrTab(\"export\",this)'><span class='ai-mini-dot'></span> Export</button></div><div class='dash-body' id='mgr-body'></div>";

  window._mgrData = { activeStaff, sd, allFb };

  window.mgrTab = function(tab, btn) {
    document.querySelectorAll("#mgr-tabs .dash-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    renderMgrTab(tab);
  };

  setView("mgr");
  renderMgrTab("summary");
}

function renderMgrTab(tab) {
  const body = $("mgr-body");
  if (!body) return;
  const { activeStaff, sd, allFb } = window._mgrData || { activeStaff: [], sd: "", allFb: "" };

  if (tab === "summary") {
    const p = "Weekly summary for restaurant manager.\nTEAM:\n" + sd + "\nFEEDBACK:\n" + (allFb || "None") + "\nCover: overall assessment, top performer with numbers, staff needing support + one suggestion, feedback patterns, one priority action. Under 280 words.";
    body.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>🧠</div><div><div class='ai-card-title'>Weekly Performance Summary</div><div class='ai-card-sub'>" + activeStaff.length + " active staff · " + new Date().toLocaleDateString([],{month:"short",day:"numeric"}) + "</div></div></div><div id='ai-summary' data-aiblock='1' data-prompt='" + encodeURIComponent(p) + "' data-msg='Generating summary…'></div></div>";
    renderAIBlock("ai-summary", p, "mgr_sum", "Generating summary…");

  } else if (tab === "coaching") {
    renderCoachingAndGoalsTab(body, activeStaff, sd);

  } else if (tab === "goals") {
    renderGoalsTab(body);

  } else if (tab === "feedback") {
    const allFbItems = activeStaff.flatMap(s => { const st = getStats(mkTaps(s.id.charCodeAt(1)||1)); return st.negFb.map(t => Object.assign({}, t, {sName:s.name, sColor:s.color})); }).sort((a,b) => b.ts-a.ts);
    const p = "Analyze private customer feedback:\n" + (allFb || "No feedback yet.") + "\nGive: 1) Overall sentiment 2) 2-3 recurring patterns 3) Operational issues 4) Urgent flags 5) Positive signals. Reference actual text. Under 240 words.";
    body.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>🔍</div><div><div class='ai-card-title'>Sentiment &amp; Pattern Analysis</div><div class='ai-card-sub'>All private customer feedback</div></div></div><div id='ai-fb' data-aiblock='1' data-prompt='" + encodeURIComponent(p) + "' data-msg='Analyzing feedback…'></div></div>" + (allFbItems.length ? "<div class='sec-lbl'>Raw Feedback (" + allFbItems.length + ")</div>" + allFbItems.map(f => { const s = f.rating>=4?{bg:"rgba(0,229,160,.08)",c:"#00e5a0",l:"positive"}:f.rating===3?{bg:"rgba(255,209,102,.08)",c:"#ffd166",l:"neutral"}:{bg:"rgba(255,68,85,.08)",c:"#ff4455",l:"negative"}; return "<div class='plain-card'><div style='display:flex;justify-content:space-between;align-items:center;margin-bottom:6px'><div style='font-weight:700;font-size:13px;color:" + f.sColor + "'>" + esc(f.sName) + "</div><div style='display:flex;align-items:center;gap:7px'><span style='background:" + s.bg + ";color:" + s.c + ";border-radius:5px;padding:2px 8px;font-size:10px;font-weight:700'>" + s.l + "</span><span style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>" + fmt(f.ts) + "</span></div></div><div style='font-size:13px;margin-bottom:4px'>" + "⭐".repeat(f.rating) + "☆".repeat(5-f.rating) + "</div><div style='font-size:13px;color:rgba(238,240,248,.65);font-style:italic'>\"" + esc(f.feedback) + "\"</div></div>"; }).join("") : "<div style='color:#00e5a0;font-size:13px;font-weight:500'>No feedback collected yet.</div>");
    renderAIBlock("ai-fb", p, "mgr_fb", "Analyzing feedback…");

  } else if (tab === "estimator") {
    renderEstimatorTab(body);

  } else if (tab === "staff") {
    renderStaffMgmtTab(body);

  } else if (tab === "leaderboard") {
    renderLeaderboardTab(body);

  } else if (tab === "analytics") {
    renderAnalyticsTab(body);

  } else if (tab === "export") {
    const p = "Professional weekly performance report. DATE: " + new Date().toLocaleDateString([],{weekday:"long",year:"numeric",month:"long",day:"numeric"}) + "\nTEAM:\n" + sd + "\nFEEDBACK:\n" + (allFb||"None") + "\nSections: ## Executive Summary / ## Individual Staff Performance / ## Customer Sentiment / ## Key Recommendations / ## Goals for Next Week. Professional tone, specific numbers.";
    body.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>📄</div><div><div class='ai-card-title'>Full AI Performance Report</div><div class='ai-card-sub'>Ready to copy or print</div></div></div><button class='btn btn-ghost btn-sm' style='margin-bottom:6px' onclick='window.print()'>🖨 Print / Save PDF</button><div id='ai-report' data-aiblock='1' data-prompt='" + encodeURIComponent(p) + "' data-msg='Writing report…'></div></div>";
    renderAIBlock("ai-report", p, "mgr_report", "Writing report…");
  }
}

window.selectCoachStaff = function(sid, el) {
  document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
  if (el) el.classList.add("active");
  const s = STATE.staff.find(x => x.id === sid);
  if (!s) return;
  const st = getStats(mkTaps(s.id.charCodeAt(1)||1));
  const activeStaff = STATE.staff.filter(x => x.active);
  const ctx = activeStaff.map(x => x.name + ": score " + getStats(mkTaps(x.id.charCodeAt(1)||1)).score).join(", ");
  const fb = st.negFb.map(t => '"' + t.feedback + '"(' + t.rating + "★)").join("; ") || "none";
  const p = "Manager coaching notes for " + s.name + ". Stats: " + st.count + " taps, " + st.reviews + " reviews, " + st.avgStr + "★, " + st.ctr + "% CTR, score " + st.score + ". Team: " + ctx + ". Feedback: " + fb + ". Give: 1) What they do well (specific) 2) Biggest improvement 3) Coaching conversation starter 4) Suggested weekly goal with number. Direct, practical. Under 220 words.";
  const cc = $("coach-card");
  if (!cc) return;
  cc.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div style='width:36px;height:36px;border-radius:50%;background:" + s.color + "22;color:" + s.color + ";display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0'>" + ini(s.name) + "</div><div><div class='ai-card-title'>" + esc(s.name) + "</div><div class='ai-card-sub'>" + st.count + " taps · " + st.avgStr + "★ · score " + st.score + "</div></div></div><div id='ai-coach-" + sid + "' data-aiblock='1' data-prompt='" + encodeURIComponent(p) + "' data-msg='Writing coaching notes…'></div></div>";
  renderAIBlock("ai-coach-" + sid, p, "mgr_c_" + sid, "Writing coaching notes…");
};


// ═══════════════════════════════════════════
// COACHING + SMART GOALS (combined tab)
// ═══════════════════════════════════════════
function renderCoachingAndGoalsTab(body, activeStaff, sd) {
  const first = activeStaff[0];
  body.innerHTML =
    "<div style='display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,.06);padding-bottom:14px'>" +
      "<button class='btn btn-primary btn-sm' id='cg-coaching-btn' onclick='cgSubTab(\"coaching\")' style='background:#00e5a0;color:#07080c'>Coaching</button>" +
      "<button class='btn btn-ghost btn-sm' id='cg-ai-goals-btn' onclick='cgSubTab(\"ai-goals\")'>AI Smart Goals</button>" +
    "</div>" +
    "<div id='cg-sub'></div>";

  window._cgData = { activeStaff, sd, first };

  window.cgSubTab = function(sub) {
    ["coaching","ai-goals"].forEach(s => {
      const b = $("cg-" + s + "-btn");
      if (b) { b.style.background = sub===s?"#00e5a0":"#15171f"; b.style.color = sub===s?"#07080c":"rgba(238,240,248,.38)"; b.className = "btn btn-sm " + (sub===s?"btn-primary":"btn-ghost"); }
    });
    const el = $("cg-sub"); if (!el) return;
    if (sub === "coaching") {
      const { activeStaff, first } = window._cgData || {};
      el.innerHTML =
        "<div class='pills' id='coach-pills'>" +
        (activeStaff||[]).map(s =>
          "<div class='pill" + (s.id===(first&&first.id)?" active":"") + "' onclick='selectCoachStaff(\"" + s.id + "\",this)'>" +
          "<div class='pill-av' style='background:" + s.color + "22;color:" + s.color + "'>" + ini(s.name) + "</div>" +
          s.name.split(" ")[0] + "</div>"
        ).join("") +
        "</div><div id='coach-card'></div>";
      if (first) selectCoachStaff(first.id, document.querySelector("#coach-pills .pill"));
    } else {
      const { sd } = window._cgData || {};
      const p = "Suggest 5 smart, specific goals for this restaurant team:\n" + (sd||"") + "\nFor each: a specific measurable target based on real numbers, who it is for (individual or whole team), a clear time period (this week or this month), and one sentence on why it matters for the business. Format each as a numbered list item.";
      el.innerHTML =
        "<div class='ai-card'>" +
          "<div class='ai-card-head'><div class='ai-card-ico'>🎯</div><div><div class='ai-card-title'>AI Smart Goals</div><div class='ai-card-sub'>Generated from actual performance gaps</div></div></div>" +
          "<div id='ai-goals' data-aiblock='1' data-prompt='" + encodeURIComponent(p) + "' data-msg='Identifying gaps…'></div>" +
        "</div>";
      renderAIBlock("ai-goals", p, "mgr_goals", "Identifying gaps…");
    }
  };

  cgSubTab("coaching");
}

// ═══════════════════════════════════════════
// GOALS TAB (team + individual, manager sets)
// ═══════════════════════════════════════════
function renderGoalsTab(body) {
  body.innerHTML =
    "<div style='display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid rgba(255,255,255,.06);padding-bottom:14px'>" +
      "<button class='btn btn-primary btn-sm' id='g-team-btn' onclick='goalsSubTab(\"team\")' style='background:#00e5a0;color:#07080c'>Team Goals</button>" +
      "<button class='btn btn-ghost btn-sm' id='g-staff-btn' onclick='goalsSubTab(\"staff\")'>Individual Goals</button>" +
    "</div>" +
    "<div id='goals-sub'></div>";
  window.goalsSubTab = function(sub) {
    ["team","staff"].forEach(s => {
      const b = $("g-" + s + "-btn");
      if (b) { b.className = "btn btn-sm " + (sub===s?"btn-primary":"btn-ghost"); b.style.background = sub===s?"#00e5a0":"#15171f"; b.style.color = sub===s?"#07080c":"rgba(238,240,248,.38)"; }
    });
    const el = $("goals-sub"); if (!el) return;
    if (sub === "team") renderTeamGoals(el);
    else renderIndividualGoals(el);
  };
  goalsSubTab("team");
}

function renderTeamGoals(el) {
  const goals = STATE.teamGoals || [];
  el.innerHTML =
    "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'>" +
      "<div class='sec-lbl' style='margin-bottom:0'>Team Goals (" + goals.length + ")</div>" +
      "<button class='btn btn-primary btn-sm' onclick='openAddGoalModal(\"team\",null)'>+ Add Goal</button>" +
    "</div>" +
    (goals.length === 0
      ? "<div style='color:rgba(238,240,248,.38);font-size:13px;font-weight:500;text-align:center;padding:24px 0'>No team goals yet. Add one to get started.</div>"
      : goals.map(g => goalRowHTML(g, "team", null)).join("")
    );
}

function renderIndividualGoals(el) {
  const activeStaff = STATE.staff.filter(s => s.active);
  const first = activeStaff[0];
  el.innerHTML =
    "<div class='pills' id='igoal-pills'>" +
    activeStaff.map(s =>
      "<div class='pill" + (s.id===(first&&first.id)?" active":"") + "' onclick='selectGoalStaff(\"" + s.id + "\",this)'>" +
      "<div class='pill-av' style='background:" + s.color + "22;color:" + s.color + "'>" + ini(s.name) + "</div>" +
      s.name.split(" ")[0] + "</div>"
    ).join("") +
    "</div>" +
    "<div id='igoal-body'></div>";
  if (first) selectGoalStaff(first.id, document.querySelector("#igoal-pills .pill"));
}

window.selectGoalStaff = function(sid, el) {
  document.querySelectorAll("#igoal-pills .pill").forEach(p => p.classList.remove("active"));
  if (el) el.classList.add("active");
  const s = STATE.staff.find(x => x.id === sid);
  const body = $("igoal-body"); if (!body || !s) return;
  const goals = (STATE.staffGoals[sid] || []);
  body.innerHTML =
    "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'>" +
      "<div class='sec-lbl' style='margin-bottom:0'>Goals for " + esc(s.name) + " (" + goals.length + ")</div>" +
      "<button class='btn btn-primary btn-sm' onclick='openAddGoalModal(\"staff\",\"" + sid + "\")'>+ Add Goal</button>" +
    "</div>" +
    (goals.length === 0
      ? "<div style='color:rgba(238,240,248,.38);font-size:13px;font-weight:500;text-align:center;padding:24px 0'>No goals set for " + esc(s.name.split(" ")[0]) + " yet.</div>"
      : goals.map(g => goalRowHTML(g, "staff", sid)).join("")
    );
};

function goalRowHTML(g, type, sid) {
  const pct = Math.min(100, g.target > 0 ? Math.round((g.current / g.target) * 100) : 0);
  const done = pct >= 100;
  const sidParam = sid ? "\\\"" + sid + "\\\"" : "null";
  return "<div class='plain-card' style='margin-bottom:9px'>" +
    "<div style='display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px'>" +
      "<div style='flex:1'>" +
        "<div style='font-weight:700;font-size:13px;margin-bottom:3px'>" + esc(g.title) + (done ? " <span style='font-size:10px;background:rgba(0,229,160,.12);color:#00e5a0;border-radius:5px;padding:1px 6px;font-weight:700'>Done ✓</span>" : "") + "</div>" +
        (g.note ? "<div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500;margin-bottom:6px'>" + esc(g.note) + "</div>" : "") +
        "<div style='display:flex;align-items:center;gap:8px'>" +
          "<div style='flex:1;height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden'>" +
            "<div style='height:100%;width:" + pct + "%;background:" + (done?"#00e5a0":"#7c6aff") + ";border-radius:3px;transition:width .4s'></div>" +
          "</div>" +
          "<div style='font-size:11px;font-weight:700;color:" + (done?"#00e5a0":"rgba(238,240,248,.6)") + ";flex-shrink:0'>" + g.current + "/" + g.target + " " + esc(g.unit||"") + "</div>" +
        "</div>" +
      "</div>" +
      "<div style='display:flex;gap:5px;flex-shrink:0'>" +
        "<button class='btn btn-ghost btn-sm' onclick='openUpdateGoalModal(\"" + g.id + "\",\"" + type + "\"," + sidParam + ")'>Update</button>" +
        "<button class='btn btn-danger btn-sm' onclick='deleteGoal(\"" + g.id + "\",\"" + type + "\"," + sidParam + ")'>✕</button>" +
      "</div>" +
    "</div>" +
    "<div style='font-size:10px;color:rgba(238,240,248,.25);font-weight:500'>" + esc(g.period||"") + (g.deadline ? " · Due: " + esc(g.deadline) : "") + "</div>" +
  "</div>";
}

window.openAddGoalModal = function(type, sid) {
  const title = type === "team" ? "Add Team Goal" : "Add Goal for " + esc((STATE.staff.find(s=>s.id===sid)||{}).name||"Staff");
  showModal(
    "<div class='modal-head'><div class='modal-title'>" + title + "</div><button class='modal-close' onclick='closeModal()'>×</button></div>" +
    "<div style='display:flex;flex-direction:column;gap:11px'>" +
      "<div><div class='field-lbl'>Goal Title</div><input class='inp' id='g-title' placeholder='e.g. Hit 20 reviews this week'/></div>" +
      "<div><div class='field-lbl'>Note (optional)</div><input class='inp' id='g-note' placeholder='e.g. Focus on Google reviews'/></div>" +
      "<div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px'>" +
        "<div><div class='field-lbl'>Target</div><input class='inp' id='g-target' type='number' placeholder='20' min='1'/></div>" +
        "<div><div class='field-lbl'>Current</div><input class='inp' id='g-current' type='number' placeholder='0' value='0' min='0'/></div>" +
        "<div><div class='field-lbl'>Unit</div><input class='inp' id='g-unit' placeholder='reviews'/></div>" +
      "</div>" +
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'>" +
        "<div><div class='field-lbl'>Period</div>" +
          "<select class='sel' id='g-period'>" +
            "<option value='This week'>This week</option>" +
            "<option value='This month'>This month</option>" +
            "<option value='Ongoing'>Ongoing</option>" +
          "</select>" +
        "</div>" +
        "<div><div class='field-lbl'>Deadline (optional)</div><input class='inp' id='g-deadline' type='date'/></div>" +
      "</div>" +
      "<button class='btn btn-primary btn-full' onclick='saveNewGoal(\"" + type + "\",\"" + (sid||"") + "\")'>Add Goal</button>" +
    "</div>"
  );
};

window.saveNewGoal = function(type, sid) {
  const title = (($("g-title")||{}).value||"").trim();
  const note = (($("g-note")||{}).value||"").trim();
  const target = parseInt(($("g-target")||{}).value) || 0;
  const current = parseInt(($("g-current")||{}).value) || 0;
  const unit = (($("g-unit")||{}).value||"").trim();
  const period = (($("g-period")||{}).value||"This week");
  const deadline = (($("g-deadline")||{}).value||"").trim();
  if (!title) { showToast("Goal title required"); return; }
  if (!target) { showToast("Target number required"); return; }
  const goal = { id: uid(), title, note, target, current, unit, period, deadline, createdAt: Date.now() };
  if (type === "team") {
    STATE.teamGoals.push(goal);
  } else {
    if (!STATE.staffGoals[sid]) STATE.staffGoals[sid] = [];
    STATE.staffGoals[sid].push(goal);
  }
  save(); closeModal();
  if (type === "team") { const el = $("goals-sub"); if(el) renderTeamGoals(el); }
  else { const el = $("igoal-body"); if(el) { const s=STATE.staff.find(x=>x.id===sid); if(s) { const goals=(STATE.staffGoals[sid]||[]); el.innerHTML="<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'><div class='sec-lbl' style='margin-bottom:0'>Goals for "+esc(s.name)+" ("+goals.length+")</div><button class='btn btn-primary btn-sm' onclick='openAddGoalModal(\"staff\",\""+sid+"\")'>+ Add Goal</button></div>"+(goals.length===0?"<div style='color:rgba(238,240,248,.38);font-size:13px;font-weight:500;text-align:center;padding:24px 0'>No goals yet.</div>":goals.map(g=>goalRowHTML(g,"staff",sid)).join("")); } } }
  showToast("Goal added!");
};

window.openUpdateGoalModal = function(gid, type, sid) {
  const goals = type==="team" ? STATE.teamGoals : (STATE.staffGoals[sid]||[]);
  const g = goals.find(x=>x.id===gid);
  if (!g) return;
  showModal(
    "<div class='modal-head'><div class='modal-title'>Update Progress</div><button class='modal-close' onclick='closeModal()'>×</button></div>" +
    "<div style='display:flex;flex-direction:column;gap:11px'>" +
      "<div style='background:#15171f;border-radius:10px;padding:12px 13px'><div style='font-weight:700;font-size:14px;margin-bottom:3px'>" + esc(g.title) + "</div><div style='font-size:12px;color:rgba(238,240,248,.38);font-weight:500'>Target: " + g.target + " " + esc(g.unit||"") + "</div></div>" +
      "<div><div class='field-lbl'>Current Progress</div><input class='inp' id='upd-current' type='number' value='" + g.current + "' min='0'/></div>" +
      "<button class='btn btn-primary btn-full' onclick='saveGoalUpdate(\"" + gid + "\",\"" + type + "\",\"" + (sid||"") + "\")'>Save Progress</button>" +
    "</div>"
  );
};

window.saveGoalUpdate = function(gid, type, sid) {
  const current = parseInt(($("upd-current")||{}).value) || 0;
  if (type === "team") {
    STATE.teamGoals = STATE.teamGoals.map(g => g.id===gid ? Object.assign({},g,{current}) : g);
  } else {
    STATE.staffGoals[sid] = (STATE.staffGoals[sid]||[]).map(g => g.id===gid ? Object.assign({},g,{current}) : g);
  }
  save(); closeModal();
  if (type === "team") { const el=$("goals-sub"); if(el) renderTeamGoals(el); }
  else { window.selectGoalStaff && selectGoalStaff(sid, document.querySelector("#igoal-pills .pill.active")); }
  showToast("Progress updated!");
};

window.deleteGoal = function(gid, type, sid) {
  if (!confirm("Delete this goal?")) return;
  if (type === "team") { STATE.teamGoals = STATE.teamGoals.filter(g => g.id!==gid); }
  else { STATE.staffGoals[sid] = (STATE.staffGoals[sid]||[]).filter(g => g.id!==gid); }
  save();
  if (type === "team") { const el=$("goals-sub"); if(el) renderTeamGoals(el); }
  else { window.selectGoalStaff && selectGoalStaff(sid, document.querySelector("#igoal-pills .pill.active")); }
  showToast("Goal removed");
};

// ═══════════════════════════════════════════
// ESTIMATOR TAB
// ═══════════════════════════════════════════
function renderEstimatorTab(body) {
  body.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>📈</div><div><div class='ai-card-title'>Platform Rating Estimator</div><div class='ai-card-sub'>AI predicts your path to your target</div></div></div><div class='field-lbl' style='margin-top:4px'>Platform</div><select class='sel' id='est-plat' style='margin-bottom:10px'><option value='google'>Google Reviews</option><option value='yelp'>Yelp</option><option value='tripadvisor'>Tripadvisor</option></select><div class='field-lbl'>Current Review Count</div><input class='inp' id='est-count' type='number' step='1' placeholder='71' value='71' style='margin-bottom:10px'/><div class='field-lbl'>Current Rating</div><input class='inp' id='est-cur' type='number' step='0.1' placeholder='4.2' value='4.2' style='margin-bottom:10px'/><div class='field-lbl'>Target Rating</div><input class='inp' id='est-tgt' type='number' step='0.1' placeholder='4.5' value='4.5' style='margin-bottom:12px'/><button class='btn btn-ai btn-full' style='font-size:14px;padding:12px' onclick='calcEstimate()'>✦ Calculate &amp; Predict</button><div id='est-result' style='margin-top:14px'></div></div>";
}

window.calcEstimate = function() {
  const plat = ($("est-plat")||{}).value || "google";
  const c = parseInt(($("est-count")||{}).value) || 0;
  const cur = parseFloat(($("est-cur")||{}).value) || 0;
  const tgt = parseFloat(($("est-tgt")||{}).value) || 0;
  const el = $("est-result");
  if (!el) return;
  // Auto-compute team avg from tap data
  const active = STATE.staff.filter(s => s.active);
  const allTaps = active.flatMap(s => mkTaps(s.id.charCodeAt(1)||1));
  const avg = allTaps.length ? parseFloat((allTaps.reduce((a,t) => a+t.rating,0)/allTaps.length).toFixed(1)) : 4.2;
  if (!c || !cur || !tgt) { el.innerHTML = "<div style='color:#ff4455;font-size:13px;font-weight:500'>Fill in all fields first.</div>"; return; }
  if (tgt <= cur) { el.innerHTML = "<div style='color:#ffd166;font-size:13px;font-weight:600;text-align:center;padding:8px 0'>✓ Already at or above target!</div>"; return; }
  if (avg <= tgt) { el.innerHTML = "<div style='color:#ff6b35;font-size:13px;line-height:1.6;font-weight:500'>⚠️ Your team\'s current average rating is at or below the target. Focus on improving service quality first.</div>"; return; }
  const n = Math.max(0, Math.ceil((tgt*(c+1) - cur*c) / (avg-tgt)));
  const tps = Math.ceil(n / 0.65);
  const pace = Math.max(1, STATE.staff.filter(s => s.active).length * 3);
  const wks = Math.ceil(tps / pace);
  const p = "Restaurant wants " + plat + " from " + cur + "★ to " + tgt + "★. Facts: " + c + " current reviews, team avg " + avg + "★, ~" + n + " more 5★ reviews needed, ~" + tps + " taps needed at 65% CTR, ~" + wks + " weeks at current pace. Give: 1) Realistic timeframe 2) Key strategy 3) 2 specific tactics 4) One risk to watch. Under 180 words.";
  el.innerHTML = "<div class='est-grid'>" + [[n,"5★ reviews needed","#00e5a0"],[tps,"Est. taps needed","#ffd166"],[wks+"w","At current pace","#7c6aff"],[avg+"★","Your team avg","#ff6b35"]].map(([v,l,c]) => "<div class='est-card'><div class='est-val' style='color:" + c + "'>" + v + "</div><div class='est-lbl'>" + l + "</div></div>").join("") + "</div><div id='ai-est' data-aiblock='1' data-prompt='" + encodeURIComponent(p) + "' data-msg='Running AI prediction…'></div>";
  renderAIBlock("ai-est", p, "est_" + plat + "_" + cur + "_" + tgt, "Running AI prediction…");
};

// ═══════════════════════════════════════════
// STAFF MANAGEMENT TAB
// ═══════════════════════════════════════════
function renderStaffMgmtTab(body) {
  body.innerHTML = "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:13px'><div class='sec-lbl' style='margin-bottom:0'>Staff Members (" + STATE.staff.length + ")</div><div style='display:flex;gap:7px'><button class='btn btn-ghost btn-sm' onclick='openChangePinModal()'>🔒 Change PIN</button><button class='btn btn-primary btn-sm' onclick='openAddStaffModal()'>+ Add Staff</button></div></div><div id='staff-list'></div>";
  renderStaffList();
}

function renderStaffList() {
  const el = $("staff-list");
  if (!el) return;
  const base = window.location.origin;
  el.innerHTML = STATE.staff.map(s => "<div class='plain-card' style='opacity:" + (s.active ? 1 : 0.5) + "'><div style='display:flex;align-items:center;gap:11px'><div style='width:40px;height:40px;border-radius:50%;background:" + s.color + "22;color:" + s.color + ";display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0'>" + ini(s.name) + "</div><div style='flex:1;min-width:0'><div style='font-weight:700;font-size:13px;margin-bottom:2px'>" + esc(s.name) + (!s.active ? " <span style='font-size:10px;background:rgba(255,68,85,.1);color:#ff4455;border-radius:4px;padding:1px 6px;margin-left:3px;font-weight:700'>Inactive</span>" : "") + "</div><div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>Passcode: " + s.passcode + "</div></div><div style='display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end'><button class='btn btn-ghost btn-sm' onclick='openEditStaffModal(\"" + s.id + "\")'>✏ Edit</button><button class='btn btn-ghost btn-sm' onclick='copyTapUrl(\"" + s.id + "\")'>📋 URL</button><button class='btn btn-ghost btn-sm' onclick='toggleStaffActive(\"" + s.id + "\")'>" + (s.active ? "Deactivate" : "Activate") + "</button><button class='btn btn-danger btn-sm' onclick='removeStaffMember(\"" + s.id + "\")'>Remove</button></div></div><div style='margin-top:9px;padding:7px 9px;background:#15171f;border-radius:8px;font-size:11px;color:rgba(238,240,248,.38);word-break:break-all;font-weight:500'><span style='color:#00e5a0'>" + base + "/tap/" + s.id + "</span></div></div>").join("");
}

window.copyTapUrl = function(sid) {
  const url = window.location.origin + "/tap/" + sid;
  navigator.clipboard.writeText(url).then(() => showToast("Tap URL copied!")).catch(() => showToast(url));
};
window.toggleStaffActive = function(sid) { STATE.staff = STATE.staff.map(s => s.id===sid ? Object.assign({},s,{active:!s.active}) : s); save(); renderStaffList(); };
window.removeStaffMember = function(sid) { const s = STATE.staff.find(x => x.id===sid); if(!s) return; if(!confirm("Remove " + s.name + "?")) return; STATE.staff = STATE.staff.filter(x => x.id!==sid); save(); renderStaffList(); };

window.openAddStaffModal = function() {
  window._selColor = COLORS[0];
  showModal("<div class='modal-head'><div class='modal-title'>Add Staff Member</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div><div class='field-lbl'>Name</div><input class='inp' id='new-name' placeholder='e.g. Sam W.'/></div><div><div class='field-lbl'>4-Digit Passcode</div><input class='inp' id='new-pass' type='tel' placeholder='e.g. 5678' maxlength='4'/><div id='pass-err' style='color:#ff4455;font-size:12px;margin-top:4px;font-weight:500;min-height:16px'></div></div><div><div class='field-lbl'>Color</div><div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:4px'>" + COLORS.map((c,i) => "<div class='color-swatch" + (i===0?" sel":"") + "' style='background:" + c + "' onclick='selectColor(\"" + c + "\",this)'></div>").join("") + "</div></div><button class='btn btn-primary btn-full' style='margin-top:4px' onclick='saveNewStaff()'>Add Staff Member</button></div>");
};
window.selectColor = function(c, el) { window._selColor = c; document.querySelectorAll(".color-swatch").forEach(s => s.classList.remove("sel")); el.classList.add("sel"); };
window.saveNewStaff = function() {
  const name = (($("new-name")||{}).value||"").trim();
  const pass = (($("new-pass")||{}).value||"").trim();
  const errEl = $("pass-err");
  if (!name) { if(errEl) errEl.textContent = "Name required"; return; }
  if (!/^\d{4}$/.test(pass)) { if(errEl) errEl.textContent = "Must be exactly 4 digits"; return; }
  if (STATE.staff.find(s => s.passcode===pass)) { if(errEl) errEl.textContent = "Passcode already in use"; return; }
  STATE.staff.push({ id: uid(), name, color: window._selColor || COLORS[0], passcode: pass, active: true });
  save(); closeModal(); renderStaffList();
};


window.openEditStaffModal = function(sid) {
  const s = STATE.staff.find(x => x.id===sid);
  if (!s) return;
  window._editStaffId = sid;
  window._selEditColor = s.color;
  const swatches = COLORS.map(function(c) {
    const sel = c===s.color ? " outline:3px solid rgba(255,255,255,.8);outline-offset:2px;" : "";
    return "<div data-ec='" + c + "' onclick='window._editColorClick(this)' style='width:27px;height:27px;border-radius:50%;background:" + c + ";cursor:pointer;flex-shrink:0;" + sel + "'></div>";
  }).join("");
  showModal(
    "<div class='modal-head'><div class='modal-title'>Edit Staff Member</div><button class='modal-close' onclick='closeModal()'>×</button></div>" +
    "<div style='display:flex;flex-direction:column;gap:11px'>" +
      "<div><div class='field-lbl'>Name</div><input class='inp' id='edit-name' value='" + esc(s.name) + "'/></div>" +
      "<div><div class='field-lbl'>4-Digit Passcode</div><input class='inp' id='edit-pass' type='tel' maxlength='4' value='" + s.passcode + "'/><div id='edit-pass-err' style='color:#ff4455;font-size:12px;margin-top:4px;font-weight:500;min-height:16px'></div></div>" +
      "<div><div class='field-lbl'>Color</div><div id='edit-color-swatches' style='display:flex;gap:8px;flex-wrap:wrap;margin-top:4px'>" + swatches + "</div></div>" +
      "<button class='btn btn-primary btn-full' style='margin-top:4px' onclick='saveEditStaff()'>Save Changes</button>" +
    "</div>"
  );
};
window._editColorClick = function(el) {
  var c = el.dataset.ec;
  window._selEditColor = c;
  document.querySelectorAll("#edit-color-swatches div").forEach(function(d) { d.style.outline = "none"; });
  el.style.outline = "3px solid rgba(255,255,255,.8)";
  el.style.outlineOffset = "2px";
};
window.saveEditStaff = function() {
  const sid = window._editStaffId;
  const name = (($("edit-name")||{}).value||"").trim();
  const pass = (($("edit-pass")||{}).value||"").trim();
  const errEl = $("edit-pass-err");
  if (!name) { if(errEl) errEl.textContent = "Name required"; return; }
  if (!/^\d{4}$/.test(pass)) { if(errEl) errEl.textContent = "Must be exactly 4 digits"; return; }
  const conflict = STATE.staff.find(s => s.passcode===pass && s.id!==sid);
  if (conflict) { if(errEl) errEl.textContent = "Passcode already in use by " + conflict.name; return; }
  STATE.staff = STATE.staff.map(s => s.id===sid ? Object.assign({},s,{name,passcode:pass,color:window._selEditColor||s.color}) : s);
  save(); closeModal(); renderStaffList(); showToast("Staff member updated!");
};
window.openChangePinModal = function() {
  showModal("<div class='modal-head'><div class='modal-title'>Change Manager PIN</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div><div class='field-lbl'>New PIN (4 digits)</div><input class='inp' id='new-pin1' type='tel' placeholder='New PIN' maxlength='4'/></div><div><div class='field-lbl'>Confirm PIN</div><input class='inp' id='new-pin2' type='tel' placeholder='Confirm' maxlength='4'/></div><div id='pin-change-msg' style='color:#ff4455;font-size:12px;font-weight:500;min-height:16px'></div><button class='btn btn-primary btn-full' onclick='saveMgrPin()'>Update PIN</button></div>");
};
window.saveMgrPin = function() {
  const p1 = (($("new-pin1")||{}).value||"").trim();
  const p2 = (($("new-pin2")||{}).value||"").trim();
  const msg = $("pin-change-msg");
  if (!/^\d{4}$/.test(p1)) { if(msg) msg.textContent = "PIN must be 4 digits"; return; }
  if (p1!==p2) { if(msg) msg.textContent = "PINs don't match"; return; }
  STATE.mgrPin = p1; save(); closeModal(); showToast("PIN updated!");
};

// ═══════════════════════════════════════════
// LEADERBOARD TAB
// ═══════════════════════════════════════════
function renderLeaderboardTab(body) {
  const rows = STATE.staff.filter(s => s.active).map(s => ({s, st: getStats(mkTaps(s.id.charCodeAt(1)||1))})).sort((a,b) => b.st.score-a.st.score);
  const wkTop = [...rows].sort((a,b) => b.st.weekTaps-a.st.weekTaps)[0];
  const rnkI = ["🥇","🥈","🥉"];
  const rnkC = ["rgba(255,209,102,.28)","rgba(200,200,200,.15)","rgba(205,127,50,.18)"];
  body.innerHTML = "<div class='lb-banner'><span style='font-size:22px'>🏆</span><div><div style='font-weight:700;font-size:13px;margin-bottom:2px'>This Week: " + esc(wkTop ? wkTop.s.name : "—") + "</div><div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>" + (wkTop ? wkTop.st.weekTaps : 0) + " taps · Resets Monday</div></div></div>" + rows.map(({s,st},i) => "<div class='lb-item " + (i<3?"r"+(i+1):"") + "'><div class='lb-rank'>" + (rnkI[i]||i+1) + "</div><div class='lb-av' style='background:" + s.color + "22;color:" + s.color + "'>" + ini(s.name) + "</div><div style='flex:1'><div class='lb-nm'>" + esc(s.name) + "</div><div class='lb-st'>" + st.count + " taps · " + st.reviews + " reviews · " + st.avgStr + "⭐ · CTR " + st.ctr + "%</div></div><div class='lb-sc'><div class='lb-sc-val'>" + st.score + "</div><div class='lb-sc-lbl'>pts</div></div></div>").join("") + "<div style='margin-top:12px;font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>Score = Taps×10 + Reviews×15 + 5★×5</div>";
}

// ═══════════════════════════════════════════
// ANALYTICS TAB — with bar/donut toggle
// ═══════════════════════════════════════════
var _chartMode = "bar"; // "bar" or "donut"

function renderAnalyticsTab(body) {
  const active = STATE.staff.filter(s => s.active);
  const all = active.flatMap(s => mkTaps(s.id.charCodeAt(1)||1));
  const tot = all.length, revs = all.filter(t => t.review).length;
  const avg = all.length ? (all.reduce((a,t) => a+t.rating, 0)/all.length).toFixed(1) : "—";
  const pos = all.filter(t => t.rating>=4).length, neg = all.filter(t => t.rating<=3).length;
  const ctr = pos > 0 ? Math.round((revs/pos)*100) : 0;
  const gT = all.filter(t => t.platform==="google").length;
  const yT = all.filter(t => t.platform==="yelp").length;
  const tT = all.filter(t => t.platform==="tripadvisor").length;
  const mx = Math.max(...active.map(s => mkTaps(s.id.charCodeAt(1)||1).length), 1);
  const cs = "background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:13px;padding:15px;margin-bottom:9px";

  // stat cards
  const statCards = [[tot,"Total Taps","#00e5a0"],[revs,"Reviews Driven","#ffd166"],[avg+"⭐","Avg Rating","#ff6b35"],[ctr+"%","CTR","#7c6aff"],[pos,"Positive","#00e5a0"],[neg,"Negative","#ff4455"]]
    .map(([v,l,c]) => "<div style='" + cs + "'><div style='font-weight:900;font-size:26px;line-height:1;margin-bottom:4px;color:" + c + ";letter-spacing:-.03em'>" + v + "</div><div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:700'>" + l + "</div></div>").join("");

  // toggle button
  var isBar = _chartMode === "bar";
  var isDon = _chartMode === "donut";
  var btnBase = "border-radius:9px;font-size:11px;font-weight:700;border:1px solid;padding:6px 12px;cursor:pointer;";
  var barStyle = btnBase + "background:" + (isBar?"#00e5a0":"#15171f") + ";color:" + (isBar?"#07080c":"rgba(238,240,248,.5)") + ";border-color:" + (isBar?"#00e5a0":"rgba(255,255,255,.08)") + ";";
  var donStyle = btnBase + "background:" + (isDon?"#00e5a0":"#15171f") + ";color:" + (isDon?"#07080c":"rgba(238,240,248,.5)") + ";border-color:" + (isDon?"#00e5a0":"rgba(255,255,255,.08)") + ";";
  var toggle = "<div style='display:flex;justify-content:flex-end;margin-bottom:10px;gap:6px'>" +
    "<button data-cm='bar' onclick='setChartMode(this.dataset.cm)' style='" + barStyle + "'>▬ Bar</button>" +
    "<button data-cm='donut' onclick='setChartMode(this.dataset.cm)' style='" + donStyle + "'>◉ Donut</button>" +
  "</div>";

  // platform block
  const platBlock = "<div style='" + cs + "'><div class='sec-lbl'>Platform Breakdown</div>" + buildPlatChart(gT, yT, tT, tot) + "</div>";

  // taps per staff
  const tapsBlock = "<div style='" + cs + "'><div class='sec-lbl'>Taps Per Staff</div>" + buildStaffChart(active, mx) + "</div>";

  // ctr per staff
  const ctrData = active.map(s => ({ s, v: getStats(mkTaps(s.id.charCodeAt(1)||1)).ctr, max: 100, label: getStats(mkTaps(s.id.charCodeAt(1)||1)).ctr + "%" }));
  const ctrBlock = "<div style='" + cs + "'><div class='sec-lbl'>Review CTR Per Staff</div>" + buildCtrChart(ctrData) + "</div>";

  body.innerHTML = toggle + "<div style='display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:9px'>" + statCards + "</div>" + platBlock + tapsBlock + ctrBlock;
}

window.setChartMode = function(mode) {
  _chartMode = mode;
  const body = $("mgr-body");
  if (body) renderAnalyticsTab(body);
};

function buildPlatChart(gT, yT, tT, tot) {
  const items = [["🔍",gT,"#00e5a0","Google"],["⭐",yT,"#ffd166","Yelp"],["✈️",tT,"#7c6aff","Tripadvisor"]];
  if (_chartMode === "donut") {
    const total = gT + yT + tT || 1;
    const segments = items.map(([,n,c]) => ({ n, c, pct: n/total }));
    return "<div style='display:flex;align-items:center;gap:18px;flex-wrap:wrap'>" +
      buildDonut(segments, 80) +
      "<div style='flex:1;min-width:100px'>" +
        items.map(([ico,n,c,l]) =>
          "<div style='display:flex;align-items:center;gap:7px;margin-bottom:8px'>" +
            "<div style='width:10px;height:10px;border-radius:50%;background:" + c + ";flex-shrink:0'></div>" +
            "<div style='font-size:12px;font-weight:600;flex:1'>" + l + "</div>" +
            "<div style='font-size:12px;font-weight:800;color:" + c + "'>" + n + "</div>" +
          "</div>"
        ).join("") +
      "</div>" +
    "</div>";
  } else {
    return "<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:9px'>" +
      items.map(([ico,n,c,l]) =>
        "<div style='background:#15171f;border-radius:9px;padding:11px;text-align:center'>" +
          "<div style='font-size:18px;margin-bottom:3px'>" + ico + "</div>" +
          "<div style='font-weight:900;font-size:20px;color:" + c + ";letter-spacing:-.03em'>" + n + "</div>" +
          "<div style='font-size:10px;color:rgba(238,240,248,.38);font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-top:2px'>" + l + "</div>" +
        "</div>"
      ).join("") +
    "</div>";
  }
}

function buildStaffChart(active, mx) {
  if (_chartMode === "donut") {
    const total = Math.max(1, active.reduce((a,s) => a + mkTaps(s.id.charCodeAt(1)||1).length, 0));
    const segments = active.map(s => ({ n: mkTaps(s.id.charCodeAt(1)||1).length, c: s.color, pct: mkTaps(s.id.charCodeAt(1)||1).length/total }));
    return "<div style='display:flex;align-items:center;gap:18px;flex-wrap:wrap'>" +
      buildDonut(segments, 80) +
      "<div style='flex:1;min-width:80px'>" +
        active.map(s => {
          const n = mkTaps(s.id.charCodeAt(1)||1).length;
          return "<div style='display:flex;align-items:center;gap:7px;margin-bottom:8px'>" +
            "<div style='width:10px;height:10px;border-radius:50%;background:" + s.color + ";flex-shrink:0'></div>" +
            "<div style='font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc(s.name.split(" ")[0]) + "</div>" +
            "<div style='font-size:12px;font-weight:800;color:" + s.color + "'>" + n + "</div>" +
          "</div>";
        }).join("") +
      "</div>" +
    "</div>";
  } else {
    return active.map(s => {
      const n = mkTaps(s.id.charCodeAt(1)||1).length;
      return "<div class='bar-row'><div class='bar-nm'>" + esc(s.name.split(" ")[0]) + "</div><div class='bar-track'><div class='bar-fill' style='width:" + Math.round(n/mx*100) + "%;background:" + s.color + "'></div></div><div class='bar-v' style='color:" + s.color + "'>" + n + "</div></div>";
    }).join("");
  }
}

function buildCtrChart(ctrData) {
  if (_chartMode === "donut") {
    const total = Math.max(1, ctrData.reduce((a,x) => a+x.v, 0));
    const segments = ctrData.map(x => ({ n: x.v, c: x.s.color, pct: x.v/total }));
    return "<div style='display:flex;align-items:center;gap:18px;flex-wrap:wrap'>" +
      buildDonut(segments, 80) +
      "<div style='flex:1;min-width:80px'>" +
        ctrData.map(x =>
          "<div style='display:flex;align-items:center;gap:7px;margin-bottom:8px'>" +
            "<div style='width:10px;height:10px;border-radius:50%;background:" + x.s.color + ";flex-shrink:0'></div>" +
            "<div style='font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>" + esc(x.s.name.split(" ")[0]) + "</div>" +
            "<div style='font-size:12px;font-weight:800;color:" + x.s.color + "'>" + x.label + "</div>" +
          "</div>"
        ).join("") +
      "</div>" +
    "</div>";
  } else {
    return ctrData.map(x =>
      "<div class='bar-row'><div class='bar-nm'>" + esc(x.s.name.split(" ")[0]) + "</div><div class='bar-track'><div class='bar-fill' style='width:" + x.v + "%;background:linear-gradient(90deg,#00e5a0,#7c6aff)'></div></div><div class='bar-v'>" + x.label + "</div></div>"
    ).join("");
  }
}

function buildDonut(segments, size) {
  // SVG donut chart
  var r = size * 0.35, cx = size/2, cy = size/2, stroke = size * 0.18;
  var total = segments.reduce((a,s) => a+s.pct, 0) || 1;
  var circumference = 2 * Math.PI * r;
  var offset = 0;
  var paths = segments.map(function(seg) {
    var dashLen = (seg.pct / total) * circumference;
    var gap = circumference - dashLen;
    var path = "<circle cx='" + cx + "' cy='" + cy + "' r='" + r + "' fill='none' stroke='" + seg.c + "' stroke-width='" + stroke + "' stroke-dasharray='" + dashLen.toFixed(2) + " " + gap.toFixed(2) + "' stroke-dashoffset='" + (-offset * circumference / total).toFixed(2) + "' stroke-linecap='round' transform='rotate(-90 " + cx + " " + cy + ")'/>";
    offset += seg.pct;
    return path;
  });
  return "<svg width='" + size + "' height='" + size + "' style='flex-shrink:0'>" +
    "<circle cx='" + cx + "' cy='" + cy + "' r='" + r + "' fill='none' stroke='rgba(255,255,255,.06)' stroke-width='" + stroke + "'/>" +
    paths.join("") +
  "</svg>";
}

// ═══════════════════════════════════════════
// TAP PAGE (customer facing)
// ═══════════════════════════════════════════
function initTapPage(sid) {
  const el = $("v-tap");
  if (!el) return;
  const s = STATE.staff.find(x => x.id===sid && x.active);
  if (!s) {
    el.innerHTML = "<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px;position:relative;z-index:1'><div style='font-size:44px;margin-bottom:14px'>🤔</div><div style='font-weight:800;font-size:19px;margin-bottom:7px;letter-spacing:-.02em'>Link not found</div><div style='color:rgba(238,240,248,.38);font-size:13px;font-weight:500'>This link may be inactive or incorrect.</div></div>";
    return;
  }
  let rating = 0, submitted = false;

  function draw() {
    if (submitted) {
      el.innerHTML = "<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px;position:relative;z-index:1;animation:up .3s ease'><div style='font-size:52px;margin-bottom:16px'>🙏</div><div style='font-weight:900;font-size:22px;margin-bottom:8px;letter-spacing:-.03em'>Thank you!</div><div style='color:rgba(238,240,248,.38);font-size:14px;max-width:270px;line-height:1.65;font-weight:500'>Your feedback has been noted. It helps us serve you better.</div></div>";
      return;
    }
    const activeLinks = STATE.links.filter(l => l.active);
    el.innerHTML = "<div style='position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;width:100%;max-width:420px;margin:0 auto'><div style='font-weight:900;font-size:28px;letter-spacing:-.04em;margin-bottom:32px;background:linear-gradient(135deg,#fff 60%,rgba(255,255,255,.5));-webkit-background-clip:text;-webkit-text-fill-color:transparent'>Tap<span style='background:linear-gradient(135deg,#00e5a0,#7c6aff);-webkit-background-clip:text;-webkit-text-fill-color:transparent'>+</span></div><div class='tap-av' style='background:" + s.color + "1a;border:3px solid " + s.color + "33;color:" + s.color + "'>" + ini(s.name) + "</div><div style='font-weight:800;font-size:20px;margin-bottom:5px;letter-spacing:-.02em'>How was your experience?</div><div style='color:rgba(238,240,248,.38);font-size:14px;margin-bottom:30px;font-weight:500'>with <strong style='color:#eef0f8'>" + esc(s.name) + "</strong></div><div class='tap-stars'>" + [1,2,3,4,5].map(i => "<div class='tap-star" + (i<=rating?" on":"") + "' id='star-" + i + "' onclick='tapStar(" + i + ")'>" + "⭐" + "</div>").join("") + "</div><div id='tap-after' style='width:100%;max-width:380px'></div></div>";

    window.tapStar = function(r) {
      rating = r;
      [1,2,3,4,5].forEach(i => { const st = $("star-"+i); if(st) st.className = "tap-star" + (i<=r?" on":""); });
      const after = $("tap-after");
      if (!after) return;
      if (r >= 4 && activeLinks.length > 0) {
        after.innerHTML = "<div style='font-weight:600;font-size:13px;color:rgba(238,240,248,.38);margin-bottom:13px;text-align:center'>Love it? Leave us a review! 🙌</div>" + activeLinks.map(link => "<a href='" + esc(link.url) + "' target='_blank' rel='noreferrer' class='tap-link'><span style='font-size:24px'>" + link.icon + "</span><div style='flex:1'><div style='font-weight:700;font-size:14px'>Review on " + esc(link.label) + "</div><div style='font-size:11px;color:rgba(238,240,248,.38);margin-top:2px;font-weight:500'>Tap to open →</div></div><span style='font-size:16px;color:rgba(238,240,248,.38)'>→</span></a>").join("") + "<button class='btn btn-primary btn-full' style='margin-top:13px;padding:14px;font-size:14px' onclick='submitTap()'>Done ✓</button>";
      } else if (r > 0) {
        after.innerHTML = "<div style='font-weight:600;font-size:13px;color:rgba(238,240,248,.38);margin-bottom:11px;text-align:center'>We're sorry! Tell us what went wrong.</div><textarea class='tap-textarea' id='tap-fb' placeholder='What happened? (optional)' rows='3'></textarea><button class='btn btn-primary btn-full' style='margin-top:11px;padding:14px;font-size:14px' onclick='submitTap()'>Submit</button>";
      }
    };
    window.submitTap = function() { submitted = true; draw(); };
  }
  draw();
}

// ═══════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════
function showAdminPin() {
  const ov = document.createElement("div");
  ov.className = "modal-overlay";
  ov.id = "admin-pin-ov";
  ov.innerHTML = "<div class='modal' style='max-width:320px;text-align:center'><div class='modal-title' style='margin-bottom:6px'>Admin Access</div><div style='color:rgba(238,240,248,.38);font-size:13px;margin-bottom:18px;font-weight:500'>Enter admin PIN</div><input id='admin-pin-inp' type='password' class='inp' placeholder='••••' maxlength='4' style='text-align:center;font-size:22px;letter-spacing:.4em;margin-bottom:8px'/><div id='admin-pin-err' style='color:#ff4455;font-size:12px;font-weight:500;min-height:16px;margin-bottom:8px'></div><div style='display:flex;gap:8px'><button class='btn btn-ghost btn-full' onclick='document.getElementById(\"admin-pin-ov\").remove()'>Cancel</button><button class='btn btn-primary btn-full' onclick='checkAdminPin()'>Enter</button></div><div style='font-size:11px;color:rgba(238,240,248,.18);margin-top:12px;font-weight:500'>Default: 0000</div></div>";
  document.body.appendChild(ov);
  const inp = $("admin-pin-inp");
  if (inp) { setTimeout(() => inp.focus(), 100); inp.addEventListener("keydown", e => { if(e.key==="Enter") checkAdminPin(); }); }
}

window.checkAdminPin = function() {
  const inp = $("admin-pin-inp");
  const v = (inp ? inp.value : "").trim();
  if (v === ADMIN_PIN) { const ov = $("admin-pin-ov"); if(ov) ov.remove(); openAdmin(); }
  else { const e = $("admin-pin-err"); if(e) e.textContent = "Incorrect PIN"; if(inp) inp.value = ""; }
};

let _adminOv = null;
function openAdmin() {
  if (_adminOv) _adminOv.remove();
  _adminOv = document.createElement("div");
  _adminOv.className = "admin-overlay";
  _adminOv.innerHTML = "<div class='admin-panel'><div class='dash-header' style='flex-shrink:0'><div><div class='dash-name'>Admin Panel</div><div class='dash-sub'>Tap+ Settings</div></div><button class='dash-exit' onclick='closeAdmin()'>× Close</button></div><div class='admin-tabs'><button class='admin-tab active' onclick='adminTab(\"links\",this)'>Review Links</button><button class='admin-tab' onclick='adminTab(\"staff\",this)'>Staff</button><button class='admin-tab' onclick='adminTab(\"ai\",this)'>AI Settings</button></div><div class='admin-body' id='admin-body'></div></div>";
  document.body.appendChild(_adminOv);
  renderAdminTab("links");
}
window.closeAdmin = function() { if(_adminOv) { _adminOv.remove(); _adminOv = null; } };
window.adminTab = function(tab, btn) { document.querySelectorAll(".admin-tab").forEach(b => b.classList.remove("active")); btn.classList.add("active"); renderAdminTab(tab); };

function renderAdminTab(tab) {
  const body = $("admin-body");
  if (!body) return;
  if (tab === "links") {
    body.innerHTML = "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:11px'><div class='sec-lbl' style='margin-bottom:0'>Customer Review Links</div><button class='btn btn-primary btn-sm' onclick='openAddLinkModal()'>+ Add</button></div><div style='background:#15171f;border-radius:9px;padding:10px 12px;margin-bottom:13px;font-size:12px;color:rgba(238,240,248,.38);line-height:1.6;font-weight:500'>These links appear when a customer gives 4–5 stars.</div><div id='link-list'></div>";
    renderLinkList();
  } else if (tab === "staff") {
    body.innerHTML = "<div class='sec-lbl'>All Staff (" + STATE.staff.length + ")</div>" + STATE.staff.map(s => "<div style='display:flex;align-items:center;gap:10px;background:#15171f;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:11px 13px;margin-bottom:8px;opacity:" + (s.active?1:0.5) + "'><div style='width:34px;height:34px;border-radius:50%;background:" + s.color + "22;color:" + s.color + ";display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;flex-shrink:0'>" + ini(s.name) + "</div><div style='flex:1'><div style='font-weight:700;font-size:13px'>" + esc(s.name) + "</div><div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>PIN: " + s.passcode + " · " + (s.active?"Active":"Inactive") + "</div></div><button class='btn btn-ghost btn-sm' onclick='adminToggleStaff(\"" + s.id + "\")'>" + (s.active?"Disable":"Enable") + "</button></div>").join("");
  } else {
    const conn = !!STATE.apiKey;
    body.innerHTML = "<div style='background:#15171f;border:1px solid " + (conn?"rgba(0,229,160,.18)":"rgba(255,68,85,.18)") + ";border-radius:12px;padding:13px 15px;margin-bottom:14px'><div style='display:flex;align-items:center;gap:8px;margin-bottom:5px'><div style='width:8px;height:8px;border-radius:50%;background:" + (conn?"#00e5a0":"#ff4455") + "'></div><div style='font-weight:700;font-size:13px'>" + (conn?"AI Connected":"AI Not Connected") + "</div></div><div style='font-size:12px;color:rgba(238,240,248,.38);line-height:1.6;font-weight:500'>" + (conn?"Groq API is active. All AI features enabled.":"No API key. AI features disabled for everyone.") + "</div></div>" + (conn ? "<div style='font-size:12px;color:rgba(238,240,248,.38);margin-bottom:12px;line-height:1.6;font-weight:500'>Revoking AI access immediately disables all AI features for all users.</div><button class='btn btn-danger btn-full' onclick='revokeAI()'>🔌 Revoke AI Access</button>" : "<div style='font-size:12px;color:rgba(238,240,248,.38);line-height:1.6;font-weight:500'>To connect AI, close this panel and tap the AI status dot on the home screen.</div>");
  }
}

window.adminToggleStaff = function(sid) { STATE.staff = STATE.staff.map(s => s.id===sid ? Object.assign({},s,{active:!s.active}) : s); save(); renderAdminTab("staff"); };
window.revokeAI = function() { if(!confirm("Revoke AI access for all users?")) return; STATE.apiKey = ""; save(); showToast("AI access revoked"); renderAdminTab("ai"); render(); };

function renderLinkList() {
  const el = $("link-list");
  if (!el) return;
  el.innerHTML = STATE.links.map(l => "<div class='link-row'><div class='link-ico'>" + l.icon + "</div><div style='flex:1;min-width:0'><div style='font-weight:700;font-size:13px;margin-bottom:2px'>" + esc(l.label) + "</div><div style='font-size:11px;color:rgba(238,240,248,.38);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500'>" + esc(l.url) + "</div></div><div style='display:flex;gap:5px;flex-shrink:0'><button class='btn btn-sm' style='background:" + (l.active?"rgba(0,229,160,.1)":"rgba(255,255,255,.04)") + ";border:1px solid " + (l.active?"rgba(0,229,160,.22)":"rgba(255,255,255,.06)") + ";color:" + (l.active?"#00e5a0":"rgba(238,240,248,.38)") + ";border-radius:7px;font-weight:700' onclick='toggleLink(\"" + l.id + "\")'>" + (l.active?"On":"Off") + "</button><button class='btn btn-ghost btn-sm' onclick='openEditLinkModal(\"" + l.id + "\")'>Edit</button><button class='btn btn-danger btn-sm' onclick='removeLink(\"" + l.id + "\")'>✕</button></div></div>").join("");
}

window.toggleLink = function(id) { STATE.links = STATE.links.map(l => l.id===id ? Object.assign({},l,{active:!l.active}) : l); save(); renderLinkList(); };
window.removeLink = function(id) { if(!confirm("Remove this link?")) return; STATE.links = STATE.links.filter(l => l.id!==id); save(); renderLinkList(); };

window.openAddLinkModal = function() {
  showModal("<div class='modal-head'><div class='modal-title'>Add Review Link</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='display:flex;gap:8px'><div style='width:70px;flex-shrink:0'><div class='field-lbl'>Icon</div><input class='inp' id='nl-icon' placeholder='🔗' style='text-align:center;font-size:18px'/></div><div style='flex:1'><div class='field-lbl'>Label</div><input class='inp' id='nl-label' placeholder='e.g. Google, Yelp…'/></div></div><div><div class='field-lbl'>Destination URL</div><input class='inp' id='nl-url' placeholder='https://…'/></div><button class='btn btn-primary btn-full' onclick='saveNewLink()'>Add Link</button></div>");
};
window.saveNewLink = function() {
  const icon = (($("nl-icon")||{}).value||"").trim() || "🔗";
  const label = (($("nl-label")||{}).value||"").trim();
  const url = (($("nl-url")||{}).value||"").trim();
  if (!label || !url) { showToast("Label and URL required"); return; }
  STATE.links.push({ id: uid(), label, icon, url, active: true });
  save(); closeModal(); renderLinkList();
};

window.openEditLinkModal = function(id) {
  const l = STATE.links.find(x => x.id===id);
  if (!l) return;
  showModal("<div class='modal-head'><div class='modal-title'>Edit Link</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='display:flex;gap:8px'><div style='width:70px;flex-shrink:0'><div class='field-lbl'>Icon</div><input class='inp' id='el-icon' value='" + esc(l.icon) + "' style='text-align:center;font-size:18px'/></div><div style='flex:1'><div class='field-lbl'>Label</div><input class='inp' id='el-label' value='" + esc(l.label) + "'/></div></div><div><div class='field-lbl'>Destination URL</div><input class='inp' id='el-url' value='" + esc(l.url) + "'/></div><button class='btn btn-primary btn-full' onclick='saveEditLink(\"" + id + "\")'>Save Changes</button></div>");
};
window.saveEditLink = function(id) {
  const icon = (($("el-icon")||{}).value||"").trim() || "🔗";
  const label = (($("el-label")||{}).value||"").trim();
  const url = (($("el-url")||{}).value||"").trim();
  if (!label || !url) { showToast("Label and URL required"); return; }
  STATE.links = STATE.links.map(l => l.id===id ? Object.assign({},l,{icon,label,url}) : l);
  save(); closeModal(); renderLinkList();
};

// Staff view of a goal (read-only progress)
function staffGoalRowHTML(g) {
  const pct = Math.min(100, g.target > 0 ? Math.round((g.current / g.target) * 100) : 0);
  const done = pct >= 100;
  return "<div class='plain-card' style='margin-bottom:9px'>" +
    "<div style='margin-bottom:8px'>" +
      "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:3px'>" +
        "<div style='font-weight:700;font-size:13px'>" + esc(g.title) + (done?" <span style='font-size:10px;background:rgba(0,229,160,.12);color:#00e5a0;border-radius:5px;padding:1px 6px;font-weight:700'>Done ✓</span>":"") + (g._isTeam?" <span style='font-size:10px;background:rgba(124,106,255,.1);color:#7c6aff;border-radius:5px;padding:1px 6px;font-weight:700'>Team</span>":"") + "</div>" +
        "<div style='font-size:12px;font-weight:700;color:" + (done?"#00e5a0":"rgba(238,240,248,.6)") + "'>" + pct + "%</div>" +
      "</div>" +
      (g.note ? "<div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500;margin-bottom:6px'>" + esc(g.note) + "</div>" : "") +
      "<div style='height:7px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hidden'>" +
        "<div style='height:100%;width:" + pct + "%;background:" + (done?"#00e5a0":"linear-gradient(90deg,#7c6aff,#a78bfa)") + ";border-radius:4px;transition:width .4s'></div>" +
      "</div>" +
    "</div>" +
    "<div style='display:flex;align-items:center;justify-content:space-between'>" +
      "<div style='font-size:10px;color:rgba(238,240,248,.25);font-weight:500'>" + esc(g.period||"") + (g.deadline?" · Due: "+esc(g.deadline):"") + "</div>" +
      "<div style='font-size:11px;font-weight:600;color:rgba(238,240,248,.5)'>" + g.current + " / " + g.target + " " + esc(g.unit||"") + "</div>" +
    "</div>" +
  "</div>";
}

// ═══════════════════════════════════════════
// MODAL + TOAST
// ═══════════════════════════════════════════
let _modal = null;
function showModal(html) {
  if (_modal) _modal.remove();
  _modal = document.createElement("div");
  _modal.className = "modal-overlay";
  _modal.innerHTML = "<div class='modal'>" + html + "</div>";
  _modal.addEventListener("click", e => { if (e.target === _modal) closeModal(); });
  document.body.appendChild(_modal);
}
window.closeModal = function() { if(_modal) { _modal.remove(); _modal = null; } };

let _toastT;
function showToast(msg) {
  let t = $("toast-el");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast-el";
    t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(60px);background:#0e0f15;border:1px solid rgba(167,139,250,.35);border-radius:100px;padding:10px 20px;font-size:13px;font-weight:600;transition:transform .35s cubic-bezier(.34,1.56,.64,1);z-index:500;white-space:nowrap;color:#eef0f8;font-family:'Nunito',system-ui,sans-serif";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.transform = "translateX(-50%) translateY(0)";
  clearTimeout(_toastT);
  _toastT = setTimeout(() => { t.style.transform = "translateX(-50%) translateY(60px)"; }, 2500);
}

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
window.addEventListener("popstate", () => render());
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", render);
} else {
  render();
}