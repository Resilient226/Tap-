// ═══════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════
const LS = {
get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
del: (k) => { try { localStorage.removeItem(k); } catch {} }
d; } c
};
// ═══════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════
const DEFAULT_LINKS = [
{ id: "gl", label: "Google", icon: " { id: "yl", label: "Yelp", icon: " { id: "ta", label: "Tripadvisor", icon: " ", url: "https://search.google.com/local/writereview?
", url: "https://www.yelp.com/writeareview/biz/YOUR_BIZ
", url: "https://www.tripadvisor.com/UserReviewE
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
const COLORS = ["#00e5a0","#7c6aff","#ff6b35","#ffd166","#ff4455","#38bdf8","#f472b6","#a3e63
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
const esc = s => (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").re
const fmt = ts => { const d = new Date(ts); return d.toLocaleTimeString([], {hour:"2-digit",m
const wsStart = () => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-d.ge
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
{ ts: t-H*1, rating: 5, platform: "google", review: true, feedback: "" },
{ ts: t-H*3, rating: 4, platform: "yelp", review: true, feedback: "" },
{ ts: t-H*6, rating: 5, platform: null, review: false, feedback: "" },
{ ts: t-H*25, rating: 3, platform: null, review: false, feedback: "Food was a { ts: t-H*26, rating: 5, platform: "google", review: true, feedback: "" },
{ ts: t-H*50, rating: 4, platform: "google", review: true, feedback: "" },
{ ts: t-H*73, rating: 2, platform: null, review: false, feedback: "Felt rushed, orde
{ ts: t-H*98, rating: 5, platform: "google", review: true, feedback: "" }
bit co
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
return { count: taps.length, reviews, avg, avgStr: avg ? avg.toFixed(1) : "—", weekTaps: wt
}
// ═══════════════════════════════════════════
// GROQ
// ═══════════════════════════════════════════
async function callGroq(prompt, key) {
const sys = "You are Tap+ AI, a restaurant performance analyst. Be specific with numbers. U
const r = await fetch(GROQ_URL, {
method: "POST",
headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
body: JSON.stringify({ model: GROQ_MODEL, messages: [{role:"system",content:sys},{role:"u
});
if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(r.status===401 ? "
const d = await r.json();
return d.choices?.[0]?.message?.content || "";
}
function mdRender(text) {
return (text || "").split("\n").map(line => {
const bold = s => s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
if (line.startsWith("## ")) return "<div style='font-weight:800;font-size:14px;margin:13
if (line.startsWith("### ")) return "<div style='font-weight:700;font-size:11px;color:#a7
if (line.startsWith("- ")) return "<div style='display:flex;gap:7px;margin-bottom:5px'><
if (!line) return "<br/>";
return "<div>" + bold(esc(line)) + "</div>";
}).join("");
}
// ═══════════════════════════════════════════
// AI BLOCK
// ═══════════════════════════════════════════
function aiOutHTML(text, k) {
return "<div class='ai-out'><div class='ai-out-lbl'><span class='ai-mini-dot'></span> AI An
}
function renderAIBlock(containerId, prompt, ckey, msg) {
const el = $(containerId);
if (!el) return;
if (!STATE.apiKey) { el.innerHTML = "<div class='ai-nokey'> No API key — go back home and
const k = ckey || prompt.slice(0, 80);
if (STATE.aiCache[k]) { el.innerHTML = aiOutHTML(STATE.aiCache[k], k); return; }
el.innerHTML = "<div class='ai-loading'><div class='ai-spinner'></div>" + esc(msg || callGroq(prompt, STATE.apiKey).then(text => {
STATE.aiCache[k] = text;
el.innerHTML = aiOutHTML(text, k);
"Analy
}).catch(e => {
el.innerHTML = "<div class='ai-err'>" + (e.message==="INVALID_KEY" ? " Invalid key — up
});
}
function refreshAI(k, btn) {
delete STATE.aiCache[k];
const block = btn.closest("[data-aiblock]");
if (!block) return;
renderAIBlock(block.id, decodeURIComponent(block.dataset.prompt || ""), k, block.dataset.ms
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
app.innerHTML = renderHub() + renderPinView("staff-login","Staff Login","Enter your 4-digit
initHub();
}
// ═══════════════════════════════════════════
// HUB
// ═══════════════════════════════════════════
function renderHub() {
const connected = !!STATE.apiKey;
return "<div id='v-hub' class='view hub on'><div style='position:relative;z-index:1;display
}
function initHub() {
const sl = $("btn-staff-login"); if (sl) sl.addEventListener("click", () => openPin("staff-
const ml = $("btn-mgr-login"); if (ml) ml.addEventListener("click", () => openPin("mgr-pin"
const ai = $("ai-status-btn"); if (ai) ai.addEventListener("click", () => setView("setup"))
const ab = $("admin-btn"); if (ab) ab.addEventListener("click", showAdminPin);
}
// ═══════════════════════════════════════════
// PIN PAD
// ═══════════════════════════════════════════
function renderPinView(id, title, sub, hint, dotColor) {
return "<div id='v-" + id + "' class='view pin-view'><button class='pin-back' onclick='show
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
else { const e = $("err-staff-login"); if(e) e.textContent = "Incorrect passcode. Try
} else if (id === "mgr-pin") {
if (val === STATE.mgrPin) openMgrDash();
else { const e = $("err-mgr-pin"); if(e) e.textContent = "Incorrect PIN. Try again.";
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
return "<div id='v-setup' class='view setup-view'><div style='position:relative;z-index:1;d
}
async function testGroqKey() {
const inp = $("setup-key-inp");
const errEl = $("setup-err");
const k = (inp ? inp.value : "").trim();
if (!k.startsWith("gsk_")) { if(errEl) errEl.textContent = "Groq keys start with gsk_"; ret
if(errEl) errEl.textContent = "Testing…";
try {
await callGroq("Reply with one word: ready", k);
STATE.apiKey = k; save(); render();
} catch(e) {
if(errEl) errEl.textContent = e.message === "INVALID_KEY" ? "Invalid key — double-check i
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
const allCtx = STATE.staff.filter(x => x.active).map(x => x.name + ": score " + getStats(mk
const fb = st.negFb.map(t => '"' + t.feedback + '"(' + t.rating + "★)").join("; ") || "none
const coachP = "Coach " + s.name.split(" ")[0] + " directly (say 'you'). Data: " + st.count
const sentP = st.negFb.length ? "Analyze feedback for " + s.name.split(" ")[0] + " (speak t
const el = $("v-staff");
if (!el) return;
el.innerHTML = "<div class='dash-header'><div><div class='dash-name'>" + esc(s.name.split("
window._sData = { s, st, taps, coachP, sentP };
window.staffTab = function(tab, btn) {
document.querySelectorAll("#staff-tabs .dash-tab").forEach(b => b.classList.remove("activ
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
body.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'
renderAIBlock("ai-coaching", coachP, "sc_" + s.id, "Writing your coaching tips…");
} else if (tab === "sentiment") {
body.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'
if (st.negFb.length) renderAIBlock("ai-sentiment", sentP, "ss_" + s.id, "Analyzing else { const el = $("ai-sentiment"); if(el) el.innerHTML = "<div style='color:#00e5a0;fon
feedba
} else if (tab === "goals") {
const sid = window._sData.s.id;
const tGoals = STATE.teamGoals || [];
const sGoals = (STATE.staffGoals[sid] || []);
const allGoals = tGoals.map(g => Object.assign({}, g, {_isTeam:true})).concat(sGoals);
if (allGoals.length === 0) {
body.innerHTML = "<div style='display:flex;flex-direction:column;align-items:center;jus
} else {
body.innerHTML =
(tGoals.length>0 ? "<div class='sec-lbl'>Team Goals</div>" + tGoals.map(g => staffGoa
(sGoals.length>0 ? "<div class='sec-lbl' style='margin-top:14px'>Your Personal Goals<
}
} else {
body.innerHTML = "<div class='stat-grid'>" + [[st.count,"Taps",s.color],[st.reviews,"Revi
}
}
// ═══════════════════════════════════════════
// MANAGER DASHBOARD
// ═══════════════════════════════════════════
function openMgrDash() {
const activeStaff = STATE.staff.filter(s => s.active);
const sd = activeStaff.map(s => { const st = getStats(mkTaps(s.id.charCodeAt(1)||1)); retur
const allFb = activeStaff.flatMap(s => getStats(mkTaps(s.id.charCodeAt(1)||1)).negFb.map(t
const el = $("v-mgr");
if (!el) return;
el.innerHTML = "<div class='dash-header'><div><div class='dash-name'>Manager Dashboard</div
window._mgrData = { activeStaff, sd, allFb };
window.mgrTab = function(tab, btn) {
document.querySelectorAll("#mgr-tabs .dash-tab").forEach(b => b.classList.remove("active"
btn.classList.add("active");
renderMgrTab(tab);
};
setView("mgr");
renderMgrTab("ai");
}
function renderMgrTab(tab) {
const body = $("mgr-body");
if (!body) return;
const { activeStaff, sd, allFb } = window._mgrData || { activeStaff: [], sd: "", allFb: ""
if (tab === "ai") renderAIInsightsTab(body, activeStaff, sd, allFb);
else if (tab === "team") renderPerformanceTab(body, activeStaff, sd);
else if (tab === "estimator") renderEstimatorTab(body);
else if (tab === "staff") renderStaffMgmtTab(body);
}
// ═══════════════════════════════════════════
// AI INSIGHTS TAB (Summary + Coaching + Feedback + Export)
// ═══════════════════════════════════════════
function renderAIInsightsTab(body, activeStaff, sd, allFb) {
var subBtns = ["summary","coaching","feedback","export"];
var subLabels = { summary:" Summary", coaching:" Coaching", feedback:" Feedback", exp
body.innerHTML =
"<div id='ai-sub-tabs' style='display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap'>" +
subBtns.map(function(s,i) {
return "<button data-sub='" + s + "' onclick='aiSubTab(this.dataset.sub)' style='back
}).join("") +
"</div>" +
"<div id='ai-sub-body'></div>";
window._aiTabData = { activeStaff, sd, allFb };
window.aiSubTab = function(sub) {
var btns = document.querySelectorAll("#ai-sub-tabs button");
var labels = { summary:" Summary", coaching:" Coaching", feedback:" Feedback", exp
btns.forEach(function(b) {
var active = b.dataset.sub === sub;
b.style.background = active ? "#a78bfa" : "#15171f";
b.style.color = active ? "#07080c" : "rgba(238,240,248,.5)";
b.style.borderColor = active ? "#a78bfa" : "rgba(255,255,255,.08)";
});
var el = $("ai-sub-body"); if (!el) return;
var d = window._aiTabData || {};
var ast = d.activeStaff || [], sd2 = d.sd || "", fb2 = d.allFb || "";
if (sub === "summary") {
var p = "Weekly summary for restaurant manager.\nTEAM:\n" + sd2 + "\nFEEDBACK:\n" + (fb
el.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'
renderAIBlock("ai-summary", p, "mgr_sum", "Generating summary…");
} else if (sub === "coaching") {
var first = ast[0];
el.innerHTML =
"<div class='pills' id='coach-pills'>" +
ast.map(function(s) {
return "<div class='pill" + (s.id===(first&&first.id)?" active":"") + "' onclick='s
"<div class='pill-av' style='background:" + s.color + "22;color:" + s.color + "'>
s.name.split(" ")[0] + "</div>";
}).join("") +
"</div><div id='coach-card'></div>";
if (first) selectCoachStaff(first.id, document.querySelector("#coach-pills .pill"));
} else if (sub === "feedback") {
var allFbItems = ast.flatMap(function(s) {
var st = getStats(mkTaps(s.id.charCodeAt(1)||1));
return st.negFb.map(function(t) { return Object.assign({},t,{sName:s.name,sColor:s.co
}).sort(function(a,b) { return b.ts-a.ts; });
var p2 = "Analyze private customer feedback:\n" + (fb2||"No feedback yet.") + "\nGive:
el.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'
(allFbItems.length
? "<div class='sec-lbl' style='margin-top:4px'>Raw Feedback (" + allFbItems.length
var sv = f.rating>=4?{bg:"rgba(0,229,160,.08)",c:"#00e5a0",l:"positive"}:f.rati
return "<div class='plain-card'><div style='display:flex;justify-content:space-
}).join("")
: "<div style='color:#00e5a0;font-size:13px;font-weight:500;margin-top:4px'>No feed
);
renderAIBlock("ai-fb", p2, "mgr_fb", "Analyzing feedback…");
} else if (sub === "export") {
var p3 = "Professional weekly report. DATE: " + new Date().toLocaleDateString([],{weekd
el.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'
renderAIBlock("ai-report", p3, "mgr_report", "Writing report…");
}
};
window.aiSubTab("summary");
}
// ═══════════════════════════════════════════
// PERFORMANCE TAB (Leaderboard + Analytics + Goals — toggled)
// ═══════════════════════════════════════════
var _perfSub = "leaderboard";
function renderPerformanceTab(body, activeStaff, sd) {
var subBtns = ["leaderboard","analytics","goals"];
var subLabels = { leaderboard:" Leaderboard", analytics:" Analytics", goals:" Goals"
body.innerHTML =
"<div id='perf-sub-tabs' style='display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap'>"
subBtns.map(function(s) {
var active = s === _perfSub;
return "<button data-ps='" + s + "' onclick='perfSubTab(this.dataset.ps)' style='back
}).join("") +
"</div>" +
"<div id='perf-sub-body'></div>";
window._perfData = { activeStaff, sd };
window.perfSubTab = function(sub) {
_perfSub = sub;
var btns = document.querySelectorAll("#perf-sub-tabs button");
var labels = { leaderboard:" Leaderboard", analytics:" Analytics", goals:" Goals"
btns.forEach(function(b) {
var active = b.dataset.ps === sub;
b.style.background = active ? "#00e5a0" : "#15171f";
b.style.color = active ? "#07080c" : "rgba(238,240,248,.5)";
b.style.borderColor = active ? "#00e5a0" : "rgba(255,255,255,.08)";
});
var el = $("perf-sub-body"); if (!el) return;
var d = window._perfData || {};
if (sub === "leaderboard") renderLeaderboardSub(el, d.activeStaff||[]);
else if (sub === "analytics") renderAnalyticsTab(el);
else if (sub === "goals") renderGoalsTab(el);
};
window.perfSubTab(_perfSub);
}
// ═══════════════════════════════════════════
// LEADERBOARD — with emoji bar and performance indicator
// ═══════════════════════════════════════════
function renderLeaderboardSub(el, activeStaff) {
var rows = activeStaff.map(function(s) {
return { s: s, st: getStats(mkTaps(s.id.charCodeAt(1)||1)) };
}).sort(function(a,b) { return b.st.score - a.st.score; });
var maxScore = Math.max.apply(null, rows.map(function(r) { return r.st.score; })) || 1;
var wkTop = rows.slice().sort(function(a,b) { return b.st.weekTaps - a.st.weekTaps; })[0];
var rnkI = [" "," "," "];
// Emoji performance scale based on score pct
function perfEmoji(pct) {
if (pct >= 0.9) return " if (pct >= 0.75) return " if (pct >= 0.55) return " if (pct >= 0.35) return " return " ";
";
";
";
";
}
function perfLabel(pct) {
if (pct >= 0.9) return { l:"On Fire", c:"#ff6b35" };
if (pct >= 0.75) return { l:"Strong", c:"#00e5a0" };
if (pct >= 0.55) return { l:"Good", c:"#7c6aff" };
if (pct >= 0.35) return { l:"Building", c:"#ffd166" };
return { l:"Needs Push", c:"#ff4455" };
}
el.innerHTML =
// Week banner
"<div class='lb-banner'><span style='font-size:22px'> </span><div><div style='font-weigh
// Staff cards
rows.map(function(row, i) {
var s = row.s, st = row.st;
var pct = st.score / maxScore;
var pEmoji = perfEmoji(pct);
var pLabel = perfLabel(pct);
var barPct = Math.round(pct * 100);
// Emoji bar — filled circles proportional to score
var totalDots = 10;
var filledDots = Math.round(pct * totalDots);
var emojiBar = "";
for (var d = 0; d < totalDots; d++) {
emojiBar += d < filledDots ? "●" : "○";
}
return "<div class='lb-item " + (i<3?"r"+(i+1):"") + "' style='flex-direction:column;al
// Top row: rank + avatar + name + perf emoji
"<div style='display:flex;align-items:center;gap:12px'>" +
"<div class='lb-rank'>" + (rnkI[i]||i+1) + "</div>" +
"<div class='lb-av' style='background:" + s.color + "22;color:" + s.color + "'>" +
"<div style='flex:1'>" +
"<div style='display:flex;align-items:center;gap:7px;margin-bottom:2px'>" +
"<div class='lb-nm'>" + esc(s.name) + "</div>" +
"<span style='font-size:16px'>" + pEmoji + "</span>" +
"<span style='font-size:10px;font-weight:700;color:" + pLabel.c + ";background:
"</div>" +
"<div class='lb-st'>" + st.count + " taps · " + st.reviews + " reviews · " "</div>" +
+ st.a
"<div class='lb-sc'><div class='lb-sc-val'>" + st.score + "</div><div class='lb-sc-
"</div>" +
// Emoji progress bar row
"<div style='display:flex;align-items:center;gap:9px'>" +
"<div style='font-size:11px;color:" + s.color + ";letter-spacing:1px;font-family:mo
"<div style='font-size:10px;color:rgba(238,240,248,.35);font-weight:600;flex-shrink
"</div>" +
// Actual progress bar
"<div style='height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:h
"<div style='height:100%;width:" + barPct + "%;background:linear-gradient(90deg," +
"</div>" +
"</div>";
}).join("") +
"<div style='margin-top:10px;font-size:11px;color:rgba(238,240,248,.28);font-weight:500'>
}
window.selectCoachStaff = function(sid, el) {
document.querySelectorAll(".pill").forEach(p => p.classList.remove("active"));
if (el) el.classList.add("active");
const s = STATE.staff.find(x => x.id === sid);
if (!s) return;
const st = getStats(mkTaps(s.id.charCodeAt(1)||1));
const activeStaff = STATE.staff.filter(x => x.active);
const ctx = activeStaff.map(x => x.name + ": score " + getStats(mkTaps(x.id.charCodeAt(1)||
const fb = st.negFb.map(t => '"' + t.feedback + '"(' + t.rating + "★)").join("; ") || "none
const p = "Manager coaching notes for " + s.name + ". Stats: " + st.count + " taps, " + st.
const cc = $("coach-card");
if (!cc) return;
cc.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div style='width:36px;heigh
renderAIBlock("ai-coach-" + sid, p, "mgr_c_" + sid, "Writing coaching notes…");
};
// ═══════════════════════════════════════════
// COACHING + SMART GOALS (combined tab)
// ═══════════════════════════════════════════
function renderCoachingAndGoalsTab(body, activeStaff, sd) {
const first = activeStaff[0];
body.innerHTML =
"<div style='display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid rgba(255,255
"<button class='btn btn-primary btn-sm' id='cg-coaching-btn' onclick='cgSubTab(\"coachi
"<button class='btn btn-ghost btn-sm' id='cg-ai-goals-btn' onclick='cgSubTab(\"ai-goals
"</div>" +
"<div id='cg-sub'></div>";
window._cgData = { activeStaff, sd, first };
window.cgSubTab = function(sub) {
["coaching","ai-goals"].forEach(s => {
const b = $("cg-" + s + "-btn");
if (b) { b.style.background = sub===s?"#00e5a0":"#15171f"; b.style.color = sub===s?"#07
});
const el = $("cg-sub"); if (!el) return;
if (sub === "coaching") {
const { activeStaff, first } = window._cgData || {};
el.innerHTML =
"<div class='pills' id='coach-pills'>" +
(activeStaff||[]).map(s =>
"<div class='pill" + (s.id===(first&&first.id)?" active":"") + "' onclick='selectCo
"<div class='pill-av' style='background:" + s.color + "22;color:" + s.color + "'>"
s.name.split(" ")[0] + "</div>"
).join("") +
"</div><div id='coach-card'></div>";
if (first) selectCoachStaff(first.id, document.querySelector("#coach-pills .pill"));
} else {
const { sd } = window._cgData || {};
const p = "Suggest 5 smart, specific goals for this restaurant team:\n" + (sd||"") + "\
el.innerHTML =
"<div class='ai-card'>" +
"<div class='ai-card-head'><div class='ai-card-ico'> </div><div><div class='ai-car
"<div id='ai-goals' data-aiblock='1' data-prompt='" + encodeURIComponent(p) + "' da
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
"<div style='display:flex;gap:8px;margin-bottom:16px;border-bottom:1px solid rgba(255,255
"<button class='btn btn-primary btn-sm' id='g-team-btn' onclick='goalsSubTab(\"team\")'
"<button class='btn btn-ghost btn-sm' id='g-staff-btn' onclick='goalsSubTab(\"staff\")'
"</div>" +
"<div id='goals-sub'></div>";
window.goalsSubTab = function(sub) {
["team","staff"].forEach(s => {
const b = $("g-" + s + "-btn");
if (b) { b.className = "btn btn-sm " + (sub===s?"btn-primary":"btn-ghost"); b.style.bac
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
"<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:
"<div class='sec-lbl' style='margin-bottom:0'>Team Goals (" + goals.length + ")</div>"
"<button class='btn btn-primary btn-sm' onclick='openAddGoalModal(\"team\",null)'>+ Add
"</div>" +
(goals.length === 0
? "<div style='color:rgba(238,240,248,.38);font-size:13px;font-weight:500;text-align:ce
: goals.map(g => goalRowHTML(g, "team", null)).join("")
);
}
function renderIndividualGoals(el) {
const activeStaff = STATE.staff.filter(s => s.active);
const first = activeStaff[0];
el.innerHTML =
"<div class='pills' id='igoal-pills'>" +
activeStaff.map(s =>
"<div class='pill" + (s.id===(first&&first.id)?" active":"") + "' onclick='selectGoalSt
"<div class='pill-av' style='background:" + s.color + "22;color:" + s.color + "'>" + in
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
"<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:
"<div class='sec-lbl' style='margin-bottom:0'>Goals for " + esc(s.name) + " (" + "<button class='btn btn-primary btn-sm' onclick='openAddGoalModal(\"staff\",\"" + sid +
"</div>" +
(goals.length === 0
goals.
? "<div style='color:rgba(238,240,248,.38);font-size:13px;font-weight:500;text-align:ce
: goals.map(g => goalRowHTML(g, "staff", sid)).join("")
);
};
function goalRowHTML(g, type, sid) {
const pct = Math.min(100, g.target > 0 ? Math.round((g.current / g.target) * 100) : 0);
const done = pct >= 100;
const sidParam = sid ? "\\\"" + sid + "\\\"" : "null";
return "<div class='plain-card' style='margin-bottom:9px'>" +
"<div style='display:flex;align-items:flex-start;justify-content:space-between;gap:10px;m
"<div style='flex:1'>" +
"<div style='font-weight:700;font-size:13px;margin-bottom:3px'>" + esc(g.title) + (do
(g.note ? "<div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500;mar
"<div style='display:flex;align-items:center;gap:8px'>" +
"<div style='flex:1;height:6px;background:rgba(255,255,255,.06);border-radius:3px;o
"<div style='height:100%;width:" + pct + "%;background:" + (done?"#00e5a0":"#7c6a
"</div>" +
"<div style='font-size:11px;font-weight:700;color:" + (done?"#00e5a0":"rgba(238,240
"</div>" +
"</div>" +
"<div style='display:flex;gap:5px;flex-shrink:0'>" +
"<button class='btn btn-ghost btn-sm' onclick='openUpdateGoalModal(\"" + g.id + "\",\
"<button class='btn btn-danger btn-sm' onclick='deleteGoal(\"" + g.id + "\",\"" + typ
"</div>" +
"</div>" +
"<div style='font-size:10px;color:rgba(238,240,248,.25);font-weight:500'>" + esc(g.period
"</div>";
}
placeh
window.openAddGoalModal = function(type, sid) {
const title = type === "team" ? "Add Team Goal" : "Add Goal for " + esc((STATE.staff.find(s
showModal(
"<div class='modal-head'><div class='modal-title'>" + title + "</div><button class='modal
"<div style='display:flex;flex-direction:column;gap:11px'>" +
"<div><div class='field-lbl'>Goal Title</div><input class='inp' id='g-title' placeholde
"<div><div class='field-lbl'>Note (optional)</div><input class='inp' id='g-note' "<div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px'>" +
"<div><div class='field-lbl'>Target</div><input class='inp' id='g-target' type='numbe
"<div><div class='field-lbl'>Current</div><input class='inp' id='g-current' type='num
"<div><div class='field-lbl'>Unit</div><input class='inp' id='g-unit' placeholder='re
"</div>" +
"<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'>" +
"<div><div class='field-lbl'>Period</div>" +
"<select class='sel' id='g-period'>" +
"<option value='This week'>This week</option>" +
"<option value='This month'>This month</option>" +
"<option value='Ongoing'>Ongoing</option>" +
"</select>" +
"</div>" +
"<div><div class='field-lbl'>Deadline (optional)</div><input class='inp' id='g-deadli
"</div>" +
"<button class='btn btn-primary btn-full' onclick='saveNewGoal(\"" + type + "\",\"" + (
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
const goal = { id: uid(), title, note, target, current, unit, period, deadline, createdAt:
if (type === "team") {
STATE.teamGoals.push(goal);
} else {
if (!STATE.staffGoals[sid]) STATE.staffGoals[sid] = [];
STATE.staffGoals[sid].push(goal);
}
save(); closeModal();
if (type === "team") { const el = $("goals-sub"); if(el) renderTeamGoals(el); }
else { const el = $("igoal-body"); if(el) { const s=STATE.staff.find(x=>x.id===sid); showToast("Goal added!");
if(s)
};
window.openUpdateGoalModal = function(gid, type, sid) {
const goals = type==="team" ? STATE.teamGoals : (STATE.staffGoals[sid]||[]);
const g = goals.find(x=>x.id===gid);
if (!g) return;
showModal(
"<div class='modal-head'><div class='modal-title'>Update Progress</div><button class='mod
"<div style='display:flex;flex-direction:column;gap:11px'>" +
"<div style='background:#15171f;border-radius:10px;padding:12px 13px'><div style='font-
"<div><div class='field-lbl'>Current Progress</div><input class='inp' id='upd-current'
"<button class='btn btn-primary btn-full' onclick='saveGoalUpdate(\"" + gid + "\",\"" +
"</div>"
);
};
window.saveGoalUpdate = function(gid, type, sid) {
const current = parseInt(($("upd-current")||{}).value) || 0;
if (type === "team") {
STATE.teamGoals = STATE.teamGoals.map(g => g.id===gid ? Object.assign({},g,{current}) : g
} else {
STATE.staffGoals[sid] = (STATE.staffGoals[sid]||[]).map(g => g.id===gid ? Object.assign({
}
save(); closeModal();
if (type === "team") { const el=$("goals-sub"); if(el) renderTeamGoals(el); }
else { window.selectGoalStaff && selectGoalStaff(sid, document.querySelector("#igoal-pills
showToast("Progress updated!");
};
window.deleteGoal = function(gid, type, sid) {
if (!confirm("Delete this goal?")) return;
if (type === "team") { STATE.teamGoals = STATE.teamGoals.filter(g => g.id!==gid); }
else { STATE.staffGoals[sid] = (STATE.staffGoals[sid]||[]).filter(g => g.id!==gid); }
save();
if (type === "team") { const el=$("goals-sub"); if(el) renderTeamGoals(el); }
else { window.selectGoalStaff && selectGoalStaff(sid, document.querySelector("#igoal-pills
showToast("Goal removed");
};
// ═══════════════════════════════════════════
// ESTIMATOR TAB
// ═══════════════════════════════════════════
function renderEstimatorTab(body) {
body.innerHTML = "<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>
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
const avg = allTaps.length ? parseFloat((allTaps.reduce((a,t) => a+t.rating,0)/allTaps.leng
if (!c || !cur || !tgt) { el.innerHTML = "<div style='color:#ff4455;font-size:13px;font-wei
if (tgt <= cur) { el.innerHTML = "<div style='color:#ffd166;font-size:13px;font-weight:600;
if (avg <= tgt) { el.innerHTML = "<div style='color:#ff6b35;font-size:13px;line-height:1.6;
const n = Math.max(0, Math.ceil((tgt*(c+1) - cur*c) / (avg-tgt)));
const tps = Math.ceil(n / 0.65);
const pace = Math.max(1, STATE.staff.filter(s => s.active).length * 3);
const wks = Math.ceil(tps / pace);
const p = "Restaurant wants " + plat + " from " + cur + "★ to " + tgt + "★. Facts: " + c +
el.innerHTML = "<div class='est-grid'>" + [[n,"5★ reviews needed","#00e5a0"],[tps,"Est. tap
renderAIBlock("ai-est", p, "est_" + plat + "_" + cur + "_" + tgt, "Running AI prediction…")
};
// ═══════════════════════════════════════════
// STAFF MANAGEMENT TAB
// ═══════════════════════════════════════════
function renderStaffMgmtTab(body) {
body.innerHTML = "<div style='display:flex;align-items:center;justify-content:space-between
renderStaffList();
}
function renderStaffList() {
const el = $("staff-list");
if (!el) return;
const base = window.location.origin;
el.innerHTML = STATE.staff.map(s => "<div class='plain-card' style='opacity:" + (s.active ?
}
window.copyTapUrl = function(sid) {
const url = window.location.origin + "/tap/" + sid;
navigator.clipboard.writeText(url).then(() => showToast("Tap URL copied!")).catch(() => sho
};
window.toggleStaffActive = function(sid) { STATE.staff = STATE.staff.map(s => s.id===sid ? Ob
window.removeStaffMember = function(sid) { const s = STATE.staff.find(x => x.id===sid); if(!s
window.openAddStaffModal = function() {
window._selColor = COLORS[0];
showModal("<div class='modal-head'><div class='modal-title'>Add Staff Member</div><button c
};
window.selectColor = function(c, el) { window._selColor = c; document.querySelectorAll(".colo
window.saveNewStaff = function() {
const name = (($("new-name")||{}).value||"").trim();
const pass = (($("new-pass")||{}).value||"").trim();
const errEl = $("pass-err");
if (!name) { if(errEl) errEl.textContent = "Name required"; return; }
if (!/^\d{4}$/.test(pass)) { if(errEl) errEl.textContent = "Must be exactly 4 digits"; retu
if (STATE.staff.find(s => s.passcode===pass)) { if(errEl) errEl.textContent = "Passcode alr
STATE.staff.push({ id: uid(), name, color: window._selColor || COLORS[0], passcode: pass, a
save(); closeModal(); renderStaffList();
};
window.openEditStaffModal = function(sid) {
const s = STATE.staff.find(x => x.id===sid);
if (!s) return;
window._editStaffId = sid;
window._selEditColor = s.color;
const swatches = COLORS.map(function(c) {
const sel = c===s.color ? " outline:3px solid rgba(255,255,255,.8);outline-offset:2px;" :
return "<div data-ec='" + c + "' onclick='window._editColorClick(this)' style='width:27px
}).join("");
showModal(
"<div class='modal-head'><div class='modal-title'>Edit Staff Member</div><button class='m
"<div style='display:flex;flex-direction:column;gap:11px'>" +
"<div><div class='field-lbl'>Name</div><input class='inp' id='edit-name' value='" + esc
"<div><div class='field-lbl'>4-Digit Passcode</div><input class='inp' id='edit-pass' ty
"<div><div class='field-lbl'>Color</div><div id='edit-color-swatches' style='display:fl
"<button class='btn btn-primary btn-full' style='margin-top:4px' onclick='saveEditStaff
"</div>"
);
};
window._editColorClick = function(el) {
var c = el.dataset.ec;
window._selEditColor = c;
document.querySelectorAll("#edit-color-swatches div").forEach(function(d) { d.style.outline
el.style.outline = "3px solid rgba(255,255,255,.8)";
el.style.outlineOffset = "2px";
};
window.saveEditStaff = function() {
const sid = window._editStaffId;
const name = (($("edit-name")||{}).value||"").trim();
const pass = (($("edit-pass")||{}).value||"").trim();
const errEl = $("edit-pass-err");
if (!name) { if(errEl) errEl.textContent = "Name required"; return; }
if (!/^\d{4}$/.test(pass)) { if(errEl) errEl.textContent = "Must be exactly 4 digits"; retu
const conflict = STATE.staff.find(s => s.passcode===pass && s.id!==sid);
if (conflict) { if(errEl) errEl.textContent = "Passcode already in use by " + conflict.name
STATE.staff = STATE.staff.map(s => s.id===sid ? Object.assign({},s,{name,passcode:pass,colo
save(); closeModal(); renderStaffList(); showToast("Staff member updated!");
};
window.openChangePinModal = function() {
showModal("<div class='modal-head'><div class='modal-title'>Change Manager PIN</div><button
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
const rows = STATE.staff.filter(s => s.active).map(s => ({s, st: getStats(mkTaps(s.id.charC
const wkTop = [...rows].sort((a,b) => b.st.weekTaps-a.st.weekTaps)[0];
const rnkI = [" "," "," "];
const rnkC = ["rgba(255,209,102,.28)","rgba(200,200,200,.15)","rgba(205,127,50,.18)"];
body.innerHTML = "<div class='lb-banner'><span style='font-size:22px'> </span><div><div st
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
const cs = "background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:13px;pa
// stat cards
const statCards = [[tot,"Total Taps","#00e5a0"],[revs,"Reviews Driven","#ffd166"],[avg+" "
.map(([v,l,c]) => "<div style='" + cs + "'><div style='font-weight:900;font-size:26px;lin
// toggle button
var isBar = _chartMode === "bar";
var isDon = _chartMode === "donut";
var btnBase = "border-radius:9px;font-size:11px;font-weight:700;border:1px solid;padding:6p
var barStyle = btnBase + "background:" + (isBar?"#00e5a0":"#15171f") + ";color:" + (isBar?"
var donStyle = btnBase + "background:" + (isDon?"#00e5a0":"#15171f") + ";color:" + (isDon?"
var toggle = "<div style='display:flex;justify-content:flex-end;margin-bottom:10px;gap:6px'
"<button data-cm='bar' onclick='setChartMode(this.dataset.cm)' style='" + barStyle + "'>▬
"<button data-cm='donut' onclick='setChartMode(this.dataset.cm)' style='" + donStyle + "'
"</div>";
// platform block
const platBlock = "<div style='" + cs + "'><div class='sec-lbl'>Platform Breakdown</div>" +
// taps per staff
const tapsBlock = "<div style='" + cs + "'><div class='sec-lbl'>Taps Per Staff</div>" + bui
// ctr per staff
const ctrData = active.map(s => ({ s, v: getStats(mkTaps(s.id.charCodeAt(1)||1)).ctr, max:
const ctrBlock = "<div style='" + cs + "'><div class='sec-lbl'>Review CTR Per Staff</div>"
body.innerHTML = toggle + "<div style='display:grid;grid-template-columns:repeat(2,1fr);gap
}
window.setChartMode = function(mode) {
_chartMode = mode;
const body = $("mgr-body");
if (body) renderAnalyticsTab(body);
};
function buildPlatChart(gT, yT, tT, tot) {
const items = [[" ",gT,"#00e5a0","Google"],[" ",yT,"#ffd166","Yelp"],[" ",tT,"#7c6aff",
if (_chartMode === "donut") {
const total = gT + yT + tT || 1;
const segments = items.map(([,n,c]) => ({ n, c, pct: n/total }));
return "<div style='display:flex;align-items:center;gap:18px;flex-wrap:wrap'>" +
buildDonut(segments, 80) +
"<div style='flex:1;min-width:100px'>" +
items.map(([ico,n,c,l]) =>
"<div style='display:flex;align-items:center;gap:7px;margin-bottom:8px'>" +
"<div style='width:10px;height:10px;border-radius:50%;background:" + c + ";flex-s
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
"<div style='font-weight:900;font-size:20px;color:" + c + ";letter-spacing:-.03em'>
"<div style='font-size:10px;color:rgba(238,240,248,.38);font-weight:700;text-transf
"</div>"
).join("") +
"</div>";
}
}
function buildStaffChart(active, mx) {
if (_chartMode === "donut") {
const total = Math.max(1, active.reduce((a,s) => a + mkTaps(s.id.charCodeAt(1)||1).length
const segments = active.map(s => ({ n: mkTaps(s.id.charCodeAt(1)||1).length, c: s.color,
return "<div style='display:flex;align-items:center;gap:18px;flex-wrap:wrap'>" +
buildDonut(segments, 80) +
"<div style='flex:1;min-width:80px'>" +
active.map(s => {
const n = mkTaps(s.id.charCodeAt(1)||1).length;
return "<div style='display:flex;align-items:center;gap:7px;margin-bottom:8px'>" +
"<div style='width:10px;height:10px;border-radius:50%;background:" + s.color + ";
"<div style='font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:
"<div style='font-size:12px;font-weight:800;color:" + s.color + "'>" + n + "</div
"</div>";
}).join("") +
"</div>" +
"</div>";
} else {
return active.map(s => {
const n = mkTaps(s.id.charCodeAt(1)||1).length;
return "<div class='bar-row'><div class='bar-nm'>" + esc(s.name.split(" ")[0]) + }).join("");
"</div
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
"<div style='width:10px;height:10px;border-radius:50%;background:" + x.s.color +
"<div style='font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:
"<div style='font-size:12px;font-weight:800;color:" + x.s.color + "'>" + x.label
"</div>"
).join("") +
"</div>" +
"</div>";
} else {
return ctrData.map(x =>
"<div class='bar-row'><div class='bar-nm'>" + esc(x.s.name.split(" ")[0]) + "</div><div
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
var path = "<circle cx='" + cx + "' cy='" + cy + "' r='" + r + "' fill='none' stroke='" +
offset += seg.pct;
return path;
});
return "<svg width='" + size + "' height='" + size + "' style='flex-shrink:0'>" +
"<circle cx='" + cx + "' cy='" + cy + "' r='" + r + "' fill='none' stroke='rgba(255,255,2
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
el.innerHTML = "<div style='display:flex;flex-direction:column;align-items:center;justify
return;
}
let rating = 0, submitted = false;
function draw() {
if (submitted) {
return;
el.innerHTML = "<div style='display:flex;flex-direction:column;align-items:center;justi
}
const activeLinks = STATE.links.filter(l => l.active);
el.innerHTML = "<div style='position:relative;z-index:1;display:flex;flex-direction:colum
window.tapStar = function(r) {
rating = r;
[1,2,3,4,5].forEach(i => { const st = $("star-"+i); if(st) st.className = "tap-star" +
const after = $("tap-after");
if (!after) return;
if (r >= 4 && activeLinks.length > 0) {
after.innerHTML = "<div style='font-weight:600;font-size:13px;color:rgba(238,240,248,
} else if (r > 0) {
after.innerHTML = "<div style='font-weight:600;font-size:13px;color:rgba(238,240,248,
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
ov.innerHTML = "<div class='modal' style='max-width:320px;text-align:center'><div class='mo
document.body.appendChild(ov);
const inp = $("admin-pin-inp");
if (inp) { setTimeout(() => inp.focus(), 100); inp.addEventListener("keydown", e => { if(e.
}
window.checkAdminPin = function() {
const inp = $("admin-pin-inp");
const v = (inp ? inp.value : "").trim();
if (v === ADMIN_PIN) { const ov = $("admin-pin-ov"); if(ov) ov.remove(); openAdmin(); }
else { const e = $("admin-pin-err"); if(e) e.textContent = "Incorrect PIN"; if(inp) inp.val
};
let _adminOv = null;
function openAdmin() {
if (_adminOv) _adminOv.remove();
_adminOv = document.createElement("div");
_adminOv.className = "admin-overlay";
_adminOv.innerHTML = "<div class='admin-panel'><div class='dash-header' style='flex-shrink:
document.body.appendChild(_adminOv);
renderAdminTab("links");
}
window.closeAdmin = function() { if(_adminOv) { _adminOv.remove(); _adminOv = null; } };
window.adminTab = function(tab, btn) { document.querySelectorAll(".admin-tab").forEach(b => b
function renderAdminTab(tab) {
const body = $("admin-body");
if (!body) return;
if (tab === "links") {
body.innerHTML = "<div style='display:flex;align-items:center;justify-content:space-betwe
renderLinkList();
} else if (tab === "staff") {
body.innerHTML = "<div class='sec-lbl'>All Staff (" + STATE.staff.length + ")</div>" + ST
} else {
const conn = !!STATE.apiKey;
body.innerHTML = "<div style='background:#15171f;border:1px solid " + (conn?"rgba(0,229,1
}
}
window.adminToggleStaff = function(sid) { STATE.staff = STATE.staff.map(s => s.id===sid ? Obj
window.revokeAI = function() { if(!confirm("Revoke AI access for all users?")) return; STATE.
function renderLinkList() {
const el = $("link-list");
if (!el) return;
el.innerHTML = STATE.links.map(l => "<div class='link-row'><div class='link-ico'>" + l.icon
}
window.toggleLink = function(id) { STATE.links = STATE.links.map(l => l.id===id ? Object.assi
window.removeLink = function(id) { if(!confirm("Remove this link?")) return; STATE.links = ST
window.openAddLinkModal = function() {
showModal("<div class='modal-head'><div class='modal-title'>Add Review Link</div><button cl
};
window.saveNewLink = function() {
const icon = (($("nl-icon")||{}).value||"").trim() || " ";
const label = (($("nl-label")||{}).value||"").trim();
const url = (($("nl-url")||{}).value||"").trim();
if (!label || !url) { showToast("Label and URL required"); return; }
STATE.links.push({ id: uid(), label, icon, url, active: true });
save(); closeModal(); renderLinkList();
};
window.openEditLinkModal = function(id) {
const l = STATE.links.find(x => x.id===id);
if (!l) return;
showModal("<div class='modal-head'><div class='modal-title'>Edit Link</div><button class='m
};
window.saveEditLink = function(id) {
const icon = (($("el-icon")||{}).value||"").trim() || " ";
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
"<div style='display:flex;align-items:center;justify-content:space-between;margin-botto
"<div style='font-weight:700;font-size:13px'>" + esc(g.title) + (done?" <span style='
"<div style='font-size:12px;font-weight:700;color:" + (done?"#00e5a0":"rgba(238,240,2
"</div>" +
(g.note ? "<div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500;margi
"<div style='height:7px;background:rgba(255,255,255,.06);border-radius:4px;overflow:hid
"<div style='height:100%;width:" + pct + "%;background:" + (done?"#00e5a0":"linear-gr
"</div>" +
"</div>" +
"<div style='display:flex;align-items:center;justify-content:space-between'>" +
"<div style='font-size:10px;color:rgba(238,240,248,.25);font-weight:500'>" + esc(g.peri
"<div style='font-size:11px;font-weight:600;color:rgba(238,240,248,.5)'>" + g.current +
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
t.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%) transla
document.body.appendChild(t);
}
t.textContent = msg;
t.style.transform = "translateX(-50%) translateY(0)";
clearTimeout(_toastT);
_toastT = setTimeout(() => { t.style.transform = "translateX(-50%) translateY(60px)"; }, 25
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