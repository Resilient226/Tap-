// // ═══════════════════════════════════════════
// TAP+ MULTI-TENANT PLATFORM
// Routes: /              → super-admin
//         /[slug]        → customer tap page
//         /[slug]/tap/[id] → staff-specific tap
//         /[slug]/dashboard → business dashboard
// ═══════════════════════════════════════════

// ─── STORAGE ───────────────────────────────
const LS = {
  get:(k,d)=>{ try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch{return d;}},
  set:(k,v)=>{ try{localStorage.setItem(k,JSON.stringify(v));}catch{}},
  del:(k)=>{ try{localStorage.removeItem(k);}catch{}}
};

// ─── CONSTANTS ─────────────────────────────
const ADMIN_PIN     = LS.get("tp_admin_pin","0000");
const GROQ_URL      = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL    = "llama-3.3-70b-versatile";
const COLORS        = ["#00e5a0","#7c6aff","#ff6b35","#ffd166","#ff4455","#38bdf8","#f472b6","#a3e635"];

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
const DEFAULT_STAFF = [
  {id:"s1",name:"Staff Member",color:"#00e5a0",passcode:"1234",active:true}
];

// ─── HELPERS ───────────────────────────────
const $    = id => document.getElementById(id);
const uid  = () => Math.random().toString(36).slice(2,11);
const ini  = n => n.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
const esc  = s => (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const fmt  = ts => {
  const d=new Date(ts);
  return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+", "+d.toLocaleDateString([],{month:"short",day:"numeric"});
};
const wsStart = () => {
  const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-d.getDay());return d.getTime();
};

// ─── MULTI-TENANT STATE ─────────────────────
// Businesses stored as: tp_biz_[slug] = { name, slug, brand, links, staff, mgrPin, teamGoals, staffGoals }
// Super-admin state:    tp_businesses = ["slug1","slug2",...]
// Firebase config:      tp_fb = { apiKey, projectId, appId }
// Groq key:             tp_key
// Admin PIN:            tp_admin_pin

function getBizList() { return LS.get("tp_businesses",[]); }
function getBiz(sl) {
  var stored = LS.get("tp_biz_"+sl, null);
  if (!stored) return null;
  return Object.assign({ brand:DEFAULT_BRAND, links:DEFAULT_LINKS, staff:DEFAULT_STAFF, mgrPin:"1234", teamGoals:[], staffGoals:{} }, stored);
}
function saveBiz(biz) {
  LS.set("tp_biz_"+biz.slug, biz);
  var list = getBizList();
  if (list.indexOf(biz.slug) === -1) { list.push(biz.slug); LS.set("tp_businesses", list); }
}
function deleteBiz(sl) {
  LS.del("tp_biz_"+sl);
  var list = getBizList().filter(function(s){return s!==sl;});
  LS.set("tp_businesses",list);
}
function getApiKey() { return LS.get("tp_key",""); }
function getAdminPin() { return LS.get("tp_admin_pin","0000"); }

// ─── FIREBASE ──────────────────────────────
function getFbCfg() {
  try { var r=LS.get("tp_fb",""); return r ? (typeof r==="string"?JSON.parse(r):r) : null; } catch{return null;}
}
function fbUrl(cfg,col,docId) {
  var base="https://firestore.googleapis.com/v1/projects/"+cfg.projectId+"/databases/(default)/documents/";
  return docId ? base+col+"/"+docId : base+col;
}
function toFsVal(v) {
  if(v===null||v===undefined) return {nullValue:null};
  if(typeof v==="boolean") return {booleanValue:v};
  if(typeof v==="number") return {integerValue:String(Math.round(v))};
  if(typeof v==="string") return {stringValue:v};
  if(Array.isArray(v)) return {arrayValue:{values:v.map(toFsVal)}};
  if(typeof v==="object"){var f={};Object.keys(v).forEach(function(k){f[k]=toFsVal(v[k]);});return {mapValue:{fields:f}};}
  return {stringValue:String(v)};
}
function toFsDoc(data) {
  var f={};Object.keys(data).forEach(function(k){f[k]=toFsVal(data[k]);});return {fields:f};
}
async function fbWrite(col,docId,data) {
  var cfg=getFbCfg(); if(!cfg) return;
  try {
    await fetch(fbUrl(cfg,col,docId),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(toFsDoc(data))});
  } catch(e){console.warn("Firebase write error:",e);}
}
async function fbQuery(col,filters) {
  var cfg=getFbCfg(); if(!cfg) return [];
  try {
    var url="https://firestore.googleapis.com/v1/projects/"+cfg.projectId+"/databases/(default)/documents:runQuery";
    var q={structuredQuery:{from:[{collectionId:col}],orderBy:[{field:{fieldPath:"ts"},direction:"DESCENDING"}],limit:200}};
    if(filters&&filters.length) q.structuredQuery.where=filters.length===1?filters[0]:{compositeFilter:{op:"AND",filters:filters}};
    var r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(q)});
    var d=await r.json();
    if(!Array.isArray(d)) return [];
    return d.filter(function(x){return x.document;}).map(function(x){
      var f=x.document.fields||{};
      var out={};
      Object.keys(f).forEach(function(k){
        var v=f[k];
        if(v.stringValue!==undefined) out[k]=v.stringValue;
        else if(v.integerValue!==undefined) out[k]=parseInt(v.integerValue);
        else if(v.booleanValue!==undefined) out[k]=v.booleanValue;
        else if(v.nullValue!==undefined) out[k]=null;
        else out[k]=v;
      });
      return out;
    });
  } catch(e){console.warn("Firebase query error:",e);return [];}
}
function fsFilter(field,op,val) {
  return {fieldFilter:{field:{fieldPath:field},op:op,value:toFsVal(val)}};
}
async function saveTap(tapData) {
  await fbWrite("taps",tapData.id,tapData);
}

// ─── GROQ AI ───────────────────────────────
async function callGroq(prompt,key) {
  var sys="You are Tap+ AI, a restaurant performance analyst. Use **bold**, ## headings, - bullets. Be specific and concise. Never invent data.";
  var r=await fetch(GROQ_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
    body:JSON.stringify({model:GROQ_MODEL,messages:[{role:"system",content:sys},{role:"user",content:prompt}],max_tokens:900,temperature:0.7})});
  if(!r.ok){var e=await r.json().catch(()=>({}));throw new Error(r.status===401?"INVALID_KEY":e?.error?.message||"API error");}
  var d=await r.json();return d.choices?.[0]?.message?.content||"";
}
var _aiCache={};
function renderAIBlock(id,prompt,ckey,msg) {
  var el=$(id); if(!el) return;
  var key=getApiKey();
  if(!key){el.innerHTML="<div class='ai-nokey'>⚠️ No API key — set it in super-admin.</div>";return;}
  var k=ckey||prompt.slice(0,80);
  if(_aiCache[k]){el.innerHTML=aiOut(_aiCache[k],k);return;}
  el.innerHTML="<div class='ai-loading'><div class='ai-spinner'></div>"+esc(msg||"Analyzing…")+"</div>";
  callGroq(prompt,key).then(function(t){_aiCache[k]=t;el.innerHTML=aiOut(t,k);})
    .catch(function(e){el.innerHTML="<div class='ai-err'>"+(e.message==="INVALID_KEY"?"❌ Invalid key":"❌ "+esc(e.message))+"</div>";});
}
function aiOut(text,k) {
  return "<div class='ai-out'><div class='ai-out-lbl'><span class='ai-mini-dot'></span> AI Analysis</div><div class='ai-out-text'>"+mdRender(text)+"</div><button class='ai-refresh' onclick='delete _aiCache[\""+k+"\"];renderAIBlock.apply(null,window._lastAI&&window._lastAI[\""+k+"\"]||[])'>↻</button></div>";
}
function mdRender(text) {
  return (text||"").split("\n").map(function(line){
    var bold=function(s){return s.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>");};
    if(line.startsWith("## ")) return "<div style='font-weight:800;font-size:14px;margin:13px 0 6px;color:#eef0f8'>"+esc(line.slice(3))+"</div>";
    if(line.startsWith("- ")) return "<div style='display:flex;gap:7px;margin-bottom:5px'><span style='color:#a78bfa'>›</span><span>"+bold(esc(line.slice(2)))+"</span></div>";
    if(!line) return "<br/>";
    return "<div>"+bold(esc(line))+"</div>";
  }).join("");
}

// ─── MODAL / TOAST ─────────────────────────
var _modal=null;
function showModal(html) {
  if(_modal)_modal.remove();
  _modal=document.createElement("div");_modal.className="modal-overlay";
  _modal.innerHTML="<div class='modal'>"+html+"</div>";
  _modal.addEventListener("click",function(e){if(e.target===_modal)closeModal();});
  document.body.appendChild(_modal);
}
window.closeModal=function(){if(_modal){_modal.remove();_modal=null;}};
var _toastT;
function showToast(msg) {
  var t=$("toast-el");
  if(!t){t=document.createElement("div");t.id="toast-el";
    t.style.cssText="position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(60px);background:#0e0f15;border:1px solid rgba(167,139,250,.35);border-radius:100px;padding:10px 20px;font-size:13px;font-weight:600;transition:transform .35s cubic-bezier(.34,1.56,.64,1);z-index:9999;white-space:nowrap;color:#eef0f8;font-family:inherit";
    document.body.appendChild(t);}
  t.textContent=msg;t.style.transform="translateX(-50%) translateY(0)";
  clearTimeout(_toastT);_toastT=setTimeout(function(){t.style.transform="translateX(-50%) translateY(60px)";},2500);
}

// ─── PIN PAD ───────────────────────────────
function renderPinPad(containerId,title,sub,hint,dotColor,onSuccess,onBack) {
  var el=$(containerId); if(!el) return;
  var val="";
  function update() {
    var dots=el.querySelectorAll(".pin-dot");
    dots.forEach(function(d,i){d.style.background=i<val.length?dotColor:"transparent";d.style.borderColor=i<val.length?dotColor:"rgba(255,255,255,.15)";});
    el.querySelector(".pin-err").textContent="";
  }
  el.innerHTML=
    "<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;padding:40px 20px;text-align:center;position:relative'>" +
    (onBack?"<button onclick='"+onBack+"' style='position:absolute;top:16px;left:16px;background:none;border:none;color:rgba(238,240,248,.4);font-size:22px;cursor:pointer'>←</button>":"") +
    "<div style='font-size:20px;font-weight:800;margin-bottom:5px;letter-spacing:-.02em'>"+esc(title)+"</div>"+
    "<div style='font-size:13px;color:rgba(238,240,248,.4);margin-bottom:26px;font-weight:500'>"+esc(sub)+"</div>"+
    "<div style='display:flex;gap:11px;justify-content:center;margin-bottom:22px'>"+
      [0,1,2,3].map(function(i){return "<div class='pin-dot' style='width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.15);transition:all .18s'></div>";}).join("")+
    "</div>"+
    "<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:9px;max-width:210px'>"+
      ["1","2","3","4","5","6","7","8","9","C","0","⌫"].map(function(k){
        return "<div class='pin-key' style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:13px;padding:16px;font-size:19px;font-weight:700;cursor:pointer;text-align:center;user-select:none;-webkit-user-select:none;transition:background .1s' onclick='_pinTap(\""+k+"\")'>"+k+"</div>";
      }).join("")+
    "</div>"+
    "<div class='pin-err' style='color:#ff4455;font-size:13px;margin-top:11px;min-height:18px;font-weight:500'></div>"+
    (hint?"<div style='font-size:11px;color:rgba(238,240,248,.18);margin-top:14px;font-weight:500'>"+esc(hint)+"</div>":"")+
    "</div>";

  window._pinTap=function(k) {
    if(k==="C") val="";
    else if(k==="⌫") val=val.slice(0,-1);
    else if(val.length<4) val+=k;
    update();
    if(val.length===4) {
      var v=val; val=""; update();
      setTimeout(function(){
        if(!onSuccess(v)) {
          el.querySelector(".pin-err").textContent="Incorrect. Try again.";
        }
      },180);
    }
  };
}

// ═══════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════
function route() {
  var path=window.location.pathname.replace(/\/+$/,"");
  var app=document.getElementById("app"); if(!app) return;

  // / → super-admin
  if(path===""||path==="/") { renderSuperAdmin(app); return; }

  var parts=path.split("/").filter(Boolean); // ["slug"] or ["slug","dashboard"] or ["slug","tap","s1"]
  var bizSlug=parts[0];
  var biz=getBiz(bizSlug);

  // /[slug]/dashboard → business dashboard
  if(parts[1]==="dashboard") {
    if(!biz) { app.innerHTML=notFound(); return; }
    renderBizDash(app,biz);
    return;
  }

  // /[slug]/tap/[staff-id] or /[slug] → customer page
  var staffId = (parts[1]==="tap"&&parts[2]) ? parts[2] : null;
  var isCustomer = parts[1]==="tap" || parts.length===1;
  if(isCustomer) {
    if(!biz) { app.innerHTML=notFound(); return; }
    renderCustomerPage(app,biz,staffId);
    return;
  }

  app.innerHTML=notFound();
}

function notFound() {
  return "<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px;color:#eef0f8'><div style='font-size:44px;margin-bottom:14px'>🤔</div><div style='font-weight:800;font-size:20px;margin-bottom:8px'>Page not found</div><div style='font-size:13px;color:rgba(238,240,248,.4)'>Check the URL and try again.</div></div>";
}

// ═══════════════════════════════════════════
// SUPER-ADMIN
// ═══════════════════════════════════════════
function renderSuperAdmin(app) {
  app.innerHTML="<div id='sa-root' style='min-height:100vh'></div>";
  var el=$("sa-root");

  // Check if authenticated
  if(!sessionStorage.getItem("sa_auth")) {
    el.innerHTML="<div id='sa-pin'></div>";
    renderPinPad("sa-pin","Super Admin","Enter your PIN","Default: 0000","#a78bfa",function(v){
      if(v===getAdminPin()){sessionStorage.setItem("sa_auth","1");renderSAPanel(el);return true;}return false;
    },null);
    return;
  }
  renderSAPanel(el);
}

function renderSAPanel(el) {
  var bizList=getBizList();
  var apiKey=getApiKey();
  var fbCfg=getFbCfg();

  el.innerHTML=
    "<div style='max-width:520px;margin:0 auto;padding:24px 18px'>" +
    // Header
    "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:28px'>" +
      "<div><div style='font-weight:900;font-size:22px;letter-spacing:-.03em'>Tap<span style='color:#00e5a0'>+</span> Admin</div><div style='font-size:12px;color:rgba(238,240,248,.38);margin-top:2px;font-weight:500'>Super Admin Panel</div></div>" +
      "<button onclick='sessionStorage.removeItem(\"sa_auth\");route()' style='background:rgba(255,68,85,.08);border:1px solid rgba(255,68,85,.2);border-radius:9px;padding:7px 13px;font-size:12px;color:#ff4455;cursor:pointer;font-family:inherit;font-weight:600'>Sign Out</button>" +
    "</div>" +

    // Businesses
    "<div class='sec-lbl'>Businesses ("+bizList.length+")</div>" +
    (bizList.length===0
      ? "<div style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:20px;text-align:center;font-size:13px;color:rgba(238,240,248,.38);margin-bottom:12px'>No businesses yet. Add one below.</div>"
      : bizList.map(function(sl){
          var b=getBiz(sl);
          if(!b) return "";
          var brandColor=b.brand&&b.brand.brandColor?b.brand.brandColor:"#00e5a0";
          return "<div style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px 16px;margin-bottom:10px'>" +
            "<div style='display:flex;align-items:center;gap:12px'>" +
              "<div style='width:36px;height:36px;border-radius:10px;background:"+brandColor+"22;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:"+brandColor+";flex-shrink:0'>"+ini(b.name)+"</div>" +
              "<div style='flex:1'>" +
                "<div style='font-weight:700;font-size:14px'>"+esc(b.name)+"</div>" +
                "<div style='font-size:11px;color:rgba(238,240,248,.38);margin-top:2px;font-weight:500'>tapplus.link/"+esc(sl)+" · "+b.staff.filter(function(s){return s.active;}).length+" staff</div>" +
              "</div>" +
              "<div style='display:flex;gap:6px'>" +
                "<button onclick='window.open(\"/"+sl+"\",\"_blank\")' style='background:rgba(0,229,160,.08);border:1px solid rgba(0,229,160,.2);border-radius:8px;padding:5px 10px;font-size:11px;color:#00e5a0;cursor:pointer;font-weight:700;font-family:inherit'>👁 Page</button>" +
                "<button onclick='window.location.href=\"/"+sl+"/dashboard\"' style='background:#15171f;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:5px 10px;font-size:11px;color:rgba(238,240,248,.6);cursor:pointer;font-weight:600;font-family:inherit'>Dashboard</button>" +
                "<button onclick='saEditBiz(\""+sl+"\")' style='background:#15171f;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:5px 10px;font-size:11px;color:rgba(238,240,248,.6);cursor:pointer;font-weight:600;font-family:inherit'>✏</button>" +
                "<button onclick='saDeleteBiz(\""+sl+"\")' style='background:rgba(255,68,85,.08);border:1px solid rgba(255,68,85,.2);border-radius:8px;padding:5px 10px;font-size:11px;color:#ff4455;cursor:pointer;font-weight:600;font-family:inherit'>✕</button>" +
              "</div>" +
            "</div>" +
          "</div>";
        }).join("")
    ) +
    "<button onclick='saAddBiz()' style='width:100%;padding:13px;background:#00e5a0;color:#07080c;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:24px'>+ Add Business</button>" +

    // Settings
    "<div class='sec-lbl'>Platform Settings</div>" +
    "<div style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px;margin-bottom:10px'>" +
      "<div style='font-weight:700;font-size:13px;margin-bottom:10px'>Groq AI Key</div>" +
      "<div style='display:flex;gap:8px'>" +
        "<input id='sa-groq' class='inp' type='password' placeholder='gsk_…' value='"+(apiKey?"•".repeat(20):"")+"' style='flex:1'/>" +
        "<button onclick='saSaveGroq()' style='background:#a78bfa;color:#07080c;border:none;border-radius:10px;padding:0 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0'>Save</button>" +
      "</div>" +
      (apiKey?"<div style='font-size:11px;color:#00e5a0;margin-top:6px;font-weight:600'>✓ Connected</div>":"") +
    "</div>" +
    "<div style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px;margin-bottom:10px'>" +
      "<div style='font-weight:700;font-size:13px;margin-bottom:4px'>Firebase Config</div>" +
      "<div style='font-size:12px;color:rgba(238,240,248,.38);margin-bottom:10px;font-weight:500'>Stores real tap data from customer pages</div>" +
      "<div class='field-lbl'>API Key</div><input id='fb-ak' class='inp' placeholder='AIzaSy…' value='"+esc(fbCfg?fbCfg.apiKey:"")+"' style='margin-bottom:7px'/>" +
      "<div class='field-lbl'>Project ID</div><input id='fb-pid' class='inp' placeholder='tapplus-xyz' value='"+esc(fbCfg?fbCfg.projectId:"")+"' style='margin-bottom:7px'/>" +
      "<div class='field-lbl'>App ID</div><input id='fb-aid' class='inp' placeholder='1:123:web:abc' value='"+esc(fbCfg?fbCfg.appId:"")+"' style='margin-bottom:10px'/>" +
      "<button onclick='saSaveFb()' style='width:100%;padding:11px;background:#15171f;border:1px solid rgba(255,255,255,.1);border-radius:10px;font-size:13px;font-weight:700;color:rgba(238,240,248,.8);cursor:pointer;font-family:inherit'>"+( fbCfg?"✓ Update Firebase Config":"Save Firebase Config")+"</button>" +
    "</div>" +
    "<div style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px'>" +
      "<div style='font-weight:700;font-size:13px;margin-bottom:10px'>Admin PIN</div>" +
      "<div style='display:flex;gap:8px'>" +
        "<input id='sa-pin-new' class='inp' type='tel' maxlength='4' placeholder='New PIN' style='flex:1'/>" +
        "<button onclick='saSavePin()' style='background:#15171f;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:0 16px;font-size:13px;font-weight:700;color:rgba(238,240,248,.8);cursor:pointer;font-family:inherit;flex-shrink:0'>Update</button>" +
      "</div>" +
    "</div>" +
    "</div>";
}

window.saSaveGroq=function(){
  var k=($("sa-groq")||{}).value||"";
  if(k&&!k.startsWith("•")){ LS.set("tp_key",k); showToast("API key saved!"); renderSAPanel($("sa-root")); }
  else showToast("Enter a valid key starting with gsk_");
};
window.saSaveFb=function(){
  var ak=($("fb-ak")||{}).value||"",pid=($("fb-pid")||{}).value||"",aid=($("fb-aid")||{}).value||"";
  if(!ak||!pid||!aid){showToast("Fill in all three fields");return;}
  LS.set("tp_fb",JSON.stringify({apiKey:ak,projectId:pid,appId:aid}));
  showToast("Firebase config saved!"); renderSAPanel($("sa-root"));
};
window.saSavePin=function(){
  var p=($("sa-pin-new")||{}).value||"";
  if(!/^\d{4}$/.test(p)){showToast("PIN must be 4 digits");return;}
  LS.set("tp_admin_pin",p); showToast("Admin PIN updated!"); renderSAPanel($("sa-root"));
};
window.saDeleteBiz=function(sl){
  if(!confirm("Delete "+sl+"? This cannot be undone."))return;
  deleteBiz(sl); renderSAPanel($("sa-root")); showToast("Business removed");
};

window.saAddBiz=function(){
  showModal(
    "<div class='modal-head'><div class='modal-title'>Add Business</div><button class='modal-close' onclick='closeModal()'>×</button></div>"+
    "<div style='display:flex;flex-direction:column;gap:11px'>"+
      "<div><div class='field-lbl'>Business Name</div><input class='inp' id='nb-name' placeholder=\"e.g. Noah's Bagels\"/></div>"+
      "<div><div class='field-lbl'>URL Slug (auto-generated, editable)</div><input class='inp' id='nb-slug' placeholder='noahs-bagels'/></div>"+
      "<div><div class='field-lbl'>Manager PIN (4 digits)</div><input class='inp' id='nb-mpin' type='tel' maxlength='4' placeholder='e.g. 5678'/></div>"+
      "<div id='nb-err' style='color:#ff4455;font-size:12px;font-weight:500;min-height:14px'></div>"+
      "<button class='btn btn-primary btn-full' onclick='saveNewBiz()'>Create Business</button>"+
    "</div>"
  );
  // Auto-generate slug as user types name
  var nameInp=$("nb-name"),slugInp=$("nb-slug");
  if(nameInp&&slugInp) nameInp.addEventListener("input",function(){slugInp.value=slug(nameInp.value);});
};
window.saveNewBiz=function(){
  var name=(($("nb-name")||{}).value||"").trim();
  var sl=slug(($("nb-slug")||{}).value||name);
  var mpin=(($("nb-mpin")||{}).value||"").trim();
  var err=$("nb-err");
  if(!name){if(err)err.textContent="Business name required";return;}
  if(!sl){if(err)err.textContent="Slug required";return;}
  if(getBiz(sl)){if(err)err.textContent="Slug already in use";return;}
  if(!/^\d{4}$/.test(mpin)){if(err)err.textContent="Manager PIN must be 4 digits";return;}
  var biz={ name:name, slug:sl, mgrPin:mpin, brand:Object.assign({},DEFAULT_BRAND,{name:name}), links:JSON.parse(JSON.stringify(DEFAULT_LINKS)), staff:JSON.parse(JSON.stringify(DEFAULT_STAFF)), teamGoals:[], staffGoals:{} };
  saveBiz(biz); closeModal(); renderSAPanel($("sa-root")); showToast("Business created!");
};

window.saEditBiz=function(sl){
  var biz=getBiz(sl); if(!biz) return;
  var b=Object.assign({},DEFAULT_BRAND,biz.brand||{});
  showModal(
    "<div class='modal-head'><div class='modal-title'>Edit: "+esc(biz.name)+"</div><button class='modal-close' onclick='closeModal()'>×</button></div>"+
    "<div style='display:flex;flex-direction:column;gap:11px'>"+
      "<div class='sec-lbl' style='margin-bottom:0'>Branding</div>"+
      "<div><div class='field-lbl'>Business Name</div><input class='inp' id='eb-name' value='"+esc(b.name)+"'/></div>"+
      "<div><div class='field-lbl'>Tagline</div><input class='inp' id='eb-tagline' value='"+esc(b.tagline)+"'/></div>"+
      "<div><div class='field-lbl'>Logo URL</div><input class='inp' id='eb-logo' value='"+esc(b.logoUrl)+"' placeholder='https://…'/></div>"+
      "<div><div class='field-lbl'>Rating Question</div><input class='inp' id='eb-question' value='"+esc(b.ratingQuestion)+"'/></div>"+
      "<div><div class='field-lbl'>Review Prompt (4-5★)</div><input class='inp' id='eb-reviewprompt' value='"+esc(b.reviewPrompt)+"'/></div>"+
      "<div><div class='field-lbl'>Thank You Message</div><input class='inp' id='eb-thanks' value='"+esc(b.thankYouMsg)+"'/></div>"+
      "<div><div class='field-lbl'>Low Rating Message (1-3★)</div><input class='inp' id='eb-lowmsg' value='"+esc(b.lowRatingMsg)+"'/></div>"+
      "<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px'>"+
        "<div><div class='field-lbl'>Brand Color</div><input type='color' id='eb-color' value='"+(b.brandColor||"#00e5a0")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
        "<div><div class='field-lbl'>Background</div><input type='color' id='eb-bg' value='"+(b.bgColor||"#07080c")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
        "<div><div class='field-lbl'>Text</div><input type='color' id='eb-text' value='"+(b.textColor||"#ffffff")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
      "</div>"+
      "<div class='sec-lbl' style='margin-top:4px;margin-bottom:0'>Manager PIN</div>"+
      "<div><div class='field-lbl'>Current: "+biz.mgrPin+"</div><input class='inp' id='eb-mpin' type='tel' maxlength='4' placeholder='New PIN (leave blank to keep)'/></div>"+
      "<button class='btn btn-primary btn-full' onclick='saveEditBiz(\""+sl+"\")'>Save Changes</button>"+
    "</div>"
  );
};
window.saveEditBiz=function(sl){
  var biz=getBiz(sl); if(!biz) return;
  biz.brand={
    name:(($("eb-name")||{}).value||"").trim()||biz.brand.name,
    tagline:(($("eb-tagline")||{}).value||"").trim(),
    logoUrl:(($("eb-logo")||{}).value||"").trim(),
    ratingQuestion:(($("eb-question")||{}).value||"").trim()||DEFAULT_BRAND.ratingQuestion,
    reviewPrompt:(($("eb-reviewprompt")||{}).value||"").trim()||DEFAULT_BRAND.reviewPrompt,
    thankYouMsg:(($("eb-thanks")||{}).value||"").trim()||DEFAULT_BRAND.thankYouMsg,
    lowRatingMsg:(($("eb-lowmsg")||{}).value||"").trim()||DEFAULT_BRAND.lowRatingMsg,
    brandColor:($("eb-color")||{}).value||"#00e5a0",
    bgColor:($("eb-bg")||{}).value||"#07080c",
    textColor:($("eb-text")||{}).value||"#ffffff"
  };
  var newPin=(($("eb-mpin")||{}).value||"").trim();
  if(/^\d{4}$/.test(newPin)) biz.mgrPin=newPin;
  saveBiz(biz); closeModal(); renderSAPanel($("sa-root")); showToast("Saved!");
};

// ═══════════════════════════════════════════
// CUSTOMER PAGE
// ═══════════════════════════════════════════
function renderCustomerPage(app,biz,staffId) {
  var b=Object.assign({},DEFAULT_BRAND,biz.brand||{});
  var activeLinks=biz.links.filter(function(l){return l.active;});
  var firstLink=activeLinks[0]||null;
  var staffRec=staffId?biz.staff.find(function(s){return s.id===staffId;}):null;
  var staffName=staffRec?staffRec.name:"General";
  var rating=0;

  // Apply brand colors to whole page
  document.body.style.background=b.bgColor;
  document.body.style.backgroundImage="none";

  function draw() {
    var logoHTML=b.logoUrl
      ?"<img src='"+esc(b.logoUrl)+"' alt='"+esc(b.name)+"' style='height:68px;max-width:220px;object-fit:contain;margin-bottom:20px;border-radius:10px'/>"
      :"<div style='font-weight:900;font-size:28px;letter-spacing:-.03em;color:"+b.textColor+";margin-bottom:20px'>"+esc(b.name)+"</div>";

    app.innerHTML=
      "<div style='position:fixed;top:0;left:0;right:0;text-align:center;padding:9px;font-size:9px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.16);z-index:100;pointer-events:none'>POWERED BY TAP+</div>"+
      "<div style='position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;width:100%;max-width:400px;margin:0 auto;padding:52px 24px 40px;text-align:center'>"+
        logoHTML+
        (b.tagline?"<div style='font-size:13px;font-weight:500;color:"+b.textColor+";opacity:.5;margin-bottom:30px;line-height:1.55'>"+esc(b.tagline)+"</div>":"<div style='margin-bottom:24px'></div>")+
        "<div style='font-size:19px;font-weight:800;color:"+b.textColor+";margin-bottom:6px;letter-spacing:-.02em'>"+esc(b.ratingQuestion)+"</div>"+
        "<div style='font-size:12px;color:"+b.textColor+";opacity:.35;margin-bottom:22px;font-weight:500'>Tap a star below</div>"+
        "<div style='display:flex;gap:10px;justify-content:center;margin-bottom:20px'>"+
          [1,2,3,4,5].map(function(i){return "<div id='cstar-"+i+"' onclick='_cStar("+i+")' style='font-size:44px;cursor:pointer;filter:brightness(.22);transition:filter .12s,transform .12s;-webkit-user-select:none;user-select:none'>⭐</div>";}).join("")+
        "</div>"+
        "<div id='cust-after' style='width:100%'></div>"+
      "</div>"+
      "<div style='position:fixed;bottom:10px;left:0;right:0;text-align:center;font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.1);pointer-events:none'>TAP+</div>";

    window._cStar=function(r) {
      rating=r;
      for(var i=1;i<=5;i++){var s=$("cstar-"+i);if(s){s.style.filter=i<=r?"brightness(1)":"brightness(.22)";s.style.transform=i<=r?"scale(1.12)":"scale(1)";}}
      var after=$("cust-after"); if(!after) return;

      if(r===5&&firstLink) {
        // Auto-redirect immediately
        var tap={id:uid(),ts:Date.now(),bizSlug:biz.slug,staffId:staffId||"general",staffName:staffName,rating:r,platform:firstLink.label,review:true,feedback:"",redirected:true};
        saveTap(tap);
        after.innerHTML="<div style='animation:up .25s ease;text-align:center;padding:8px 0'><div style='font-size:38px;margin-bottom:10px'>🙏</div><div style='font-weight:800;font-size:18px;color:"+b.textColor+";margin-bottom:6px'>Thank you!</div><div style='font-size:13px;color:"+b.textColor+";opacity:.45;font-weight:500'>Taking you to leave a review…</div></div>";
        setTimeout(function(){window.location.href=firstLink.url;},1100);

      } else if(r>=4&&activeLinks.length>0) {
        // Show all links
        saveTap({id:uid(),ts:Date.now(),bizSlug:biz.slug,staffId:staffId||"general",staffName:staffName,rating:r,platform:null,review:false,feedback:"",redirected:false});
        after.innerHTML=
          "<div style='font-size:13px;font-weight:600;color:"+b.textColor+";opacity:.55;margin-bottom:12px'>"+esc(b.reviewPrompt)+"</div>"+
          activeLinks.map(function(link){
            return "<a href='"+esc(link.url)+"' target='_blank' rel='noreferrer' style='display:flex;align-items:center;gap:13px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);border-radius:14px;padding:15px 17px;text-decoration:none;margin-bottom:9px;text-align:left'>"+
              "<span style='font-size:24px'>"+link.icon+"</span>"+
              "<div style='flex:1'><div style='font-weight:700;font-size:14px;color:"+b.textColor+"'>Review on "+esc(link.label)+"</div><div style='font-size:11px;color:"+b.textColor+";opacity:.38;margin-top:2px'>Tap to open</div></div>"+
              "<span style='color:"+b.textColor+";opacity:.3;font-size:16px'>→</span></a>";
          }).join("")+
          "<button onclick='_cDone()' style='width:100%;margin-top:4px;padding:14px;background:"+b.brandColor+";color:#07080c;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit'>Done ✓</button>";

      } else if(r>0) {
        // Private feedback
        after.innerHTML=
          "<div style='font-size:13px;font-weight:600;color:"+b.textColor+";opacity:.55;margin-bottom:12px'>"+esc(b.lowRatingMsg)+"</div>"+
          "<textarea id='cust-fb' placeholder='What happened? (optional)' rows='4' style='width:100%;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px 13px;color:"+b.textColor+";font-size:14px;resize:none;outline:none;font-family:inherit;line-height:1.5'></textarea>"+
          "<button onclick='_cSubmit()' style='width:100%;margin-top:10px;padding:14px;background:"+b.brandColor+";color:#07080c;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit'>Submit</button>";
      }
    };

    window._cDone=function(){
      app.innerHTML=thankYouScreen(b);
    };
    window._cSubmit=function(){
      var fb=($("cust-fb")||{}).value||"";
      saveTap({id:uid(),ts:Date.now(),bizSlug:biz.slug,staffId:staffId||"general",staffName:staffName,rating:rating,platform:null,review:false,feedback:fb,redirected:false});
      app.innerHTML=thankYouScreen(b);
    };
  }
  draw();
}

function thankYouScreen(b) {
  return "<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px;background:"+b.bgColor+";animation:up .3s ease'>"+
    "<div style='font-size:52px;margin-bottom:16px'>🙏</div>"+
    "<div style='font-weight:900;font-size:22px;margin-bottom:10px;color:"+b.textColor+";letter-spacing:-.03em'>"+esc(b.thankYouMsg)+"</div>"+
    "<div style='font-size:13px;color:"+b.textColor+";opacity:.4;max-width:260px;line-height:1.65;font-weight:500'>Your feedback helps us improve.</div>"+
    "<div style='position:fixed;bottom:12px;left:0;right:0;text-align:center;font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.14)'>POWERED BY TAP+</div>"+
  "</div>";
}

// ═══════════════════════════════════════════
// BUSINESS DASHBOARD
// ═══════════════════════════════════════════
function renderBizDash(app,biz) {
  // If already authenticated in this session, go straight to dash
  var auth=sessionStorage.getItem("biz_auth_"+biz.slug)||"";

  if(!auth) {
    // Show pin pad directly in app container
    app.innerHTML="<div id='biz-pin' style='min-height:100vh;display:flex;flex-direction:column'></div>";
    // Wait one tick for DOM to settle
    setTimeout(function() {
      renderPinPad("biz-pin","Welcome to "+esc(biz.name),"Enter your PIN","",biz.brand&&biz.brand.brandColor||"#00e5a0",function(v){
        if(v===biz.mgrPin){
          sessionStorage.setItem("biz_auth_"+biz.slug,"manager");
          app.innerHTML="<div id='biz-dash' style='min-height:100vh;display:flex;flex-direction:column'></div>";
          setTimeout(function(){renderManagerDash($("biz-dash"),biz);},0);
          return true;
        }
        var s=biz.staff.find(function(x){return x.passcode===v&&x.active;});
        if(s){
          sessionStorage.setItem("biz_auth_"+biz.slug,"staff:"+s.id);
          app.innerHTML="<div id='biz-dash' style='min-height:100vh;display:flex;flex-direction:column'></div>";
          setTimeout(function(){renderStaffDash($("biz-dash"),biz,s);},0);
          return true;
        }
        return false;
      },function(){window.location.href="/";});
    },0);
    return;
  }

  // Already authed
  app.innerHTML="<div id='biz-dash' style='min-height:100vh;display:flex;flex-direction:column'></div>";
  setTimeout(function(){
    var el=$("biz-dash");
    if(auth==="manager") {
      renderManagerDash(el,biz);
    } else if(auth.startsWith("staff:")) {
      var sid=auth.slice(6);
      var s=biz.staff.find(function(x){return x.id===sid;});
      if(s) renderStaffDash(el,biz,s);
      else { sessionStorage.removeItem("biz_auth_"+biz.slug); renderBizDash(app,biz); }
    }
  },0);
}

// renderDashPanel removed — calls are now direct

// ─── STAFF DASHBOARD ───────────────────────
function renderStaffDash(el,biz,s) {
  var brandColor=biz.brand&&biz.brand.brandColor||"#00e5a0";
  var TABS=[{id:"coaching",lbl:"AI Coaching",ai:true},{id:"feedback",lbl:"My Feedback",ai:true},{id:"goals",lbl:"My Goals"},{id:"stats",lbl:"My Stats"}];
  var curTab="coaching";

  function frame() {
    el.innerHTML=
      "<div class='dash-header'>"+
        "<div><div class='dash-name'>"+esc(s.name.split(" ")[0])+"'s Dashboard</div><div class='dash-sub'>"+esc(biz.name)+"</div></div>"+
        "<button onclick='sessionStorage.removeItem(\"biz_auth_"+biz.slug+"\");window.location.reload()' class='dash-exit'>← Exit</button>"+
      "</div>"+
      "<div class='dash-tabs' id='staff-tabs'>"+
        TABS.map(function(t,i){return "<button class='dash-tab"+(i===0?" ai active":"")+"' onclick='_sTab(\""+t.id+"\",this)'>"+(t.ai?"<span class='ai-mini-dot'></span> ":"")+esc(t.lbl)+"</button>";}).join("")+
      "</div>"+
      "<div class='dash-body' id='staff-body'></div>";

    window._sTab=function(tab,btn) {
      document.querySelectorAll("#staff-tabs .dash-tab").forEach(function(b){b.classList.remove("active");});
      btn.classList.add("active"); curTab=tab; renderSTab(tab);
    };
    renderSTab("coaching");
  }

  function renderSTab(tab) {
    var body=$("staff-body"); if(!body) return;
    var apiKey=getApiKey();
    var taps=getDemoTaps(s.id);
    var st=calcStats(taps);

    if(tab==="coaching") {
      var p="Coach "+s.name.split(" ")[0]+" directly. Stats: "+st.count+" taps, "+st.reviews+" reviews, "+st.avgStr+"★ avg, "+st.ctr+"% CTR, score "+st.score+". Give 3 coaching tips: genuine compliment, one improvement, motivating close. Under 200 words.";
      body.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>💬</div><div><div class='ai-card-title'>Your AI Coach</div><div class='ai-card-sub'>"+st.count+" taps · "+st.avgStr+"★</div></div></div><div id='ai-coaching'></div></div>";
      renderAIBlock("ai-coaching",p,"sc_"+s.id,"Writing tips…");
    } else if(tab==="feedback") {
      body.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>💭</div><div><div class='ai-card-title'>Customer Feedback</div><div class='ai-card-sub'>"+st.negFb.length+" entries</div></div></div><div id='ai-fb'></div></div>"+
        (st.negFb.length?st.negFb.map(function(t){return "<div class='plain-card'><div style='font-size:12px;margin-bottom:4px'>"+"⭐".repeat(t.rating)+"</div><div style='font-size:13px;color:rgba(238,240,248,.65);font-style:italic'>\""+esc(t.feedback)+"\"</div></div>";}).join(""):"<div style='color:#00e5a0;font-size:13px;font-weight:500;padding:10px 0'>🎉 No negative feedback yet!</div>");
      if(st.negFb.length){var fp="Analyze: "+st.negFb.map(function(t){return t.rating+"★: \""+t.feedback+"\"";}).join("; ")+". Main theme, one action, positive reframe. Under 100 words.";renderAIBlock("ai-fb",fp,"ss_"+s.id,"Analyzing…");}
      else {var el2=$("ai-fb");if(el2)el2.innerHTML="";}
    } else if(tab==="goals") {
      var tGoals=biz.teamGoals||[];var sGoals=biz.staffGoals&&biz.staffGoals[s.id]||[];
      body.innerHTML=
        (tGoals.length?"<div class='sec-lbl'>Team Goals</div>"+tGoals.map(function(g){return staffGoalRow(g,true);}).join(""):"" )+
        (sGoals.length?"<div class='sec-lbl' style='margin-top:14px'>Your Goals</div>"+sGoals.map(function(g){return staffGoalRow(g,false);}).join(""):"")+
        (!tGoals.length&&!sGoals.length?"<div style='text-align:center;padding:40px 20px;color:rgba(238,240,248,.38);font-size:13px;font-weight:500'>🎯<br><br>No goals yet. Your manager will set them here.</div>":"");
    } else {
      body.innerHTML=
        "<div class='stat-grid'>"+
          [[st.count,"Taps",s.color],[st.reviews,"Reviews","#ffd166"],[st.avgStr,"Avg ★","#ff6b35"],[st.ctr+"%","CTR","#7c6aff"],[st.weekTaps,"This Week","#00e5a0"],[st.score,"Score","#ffd166"]].map(function(item){
            return "<div class='stat-box'><div class='stat-val' style='color:"+item[2]+"'>"+item[0]+"</div><div class='stat-lbl'>"+item[1]+"</div></div>";
          }).join("")+
        "</div>"+
        "<div class='sec-lbl'>Recent Taps</div>"+
        taps.slice(0,6).map(function(t){
          return "<div style='display:flex;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);gap:9px'>"+
            "<div style='width:6px;height:6px;border-radius:50%;background:"+(t.rating<=3?"#ff4455":"#00e5a0")+";flex-shrink:0;margin-top:4px'></div>"+
            "<div style='flex:1'><div style='font-size:12px;font-weight:600'>"+"⭐".repeat(t.rating)+(t.review?"<span style='font-size:10px;background:rgba(0,229,160,.1);color:#00e5a0;border-radius:5px;padding:1px 6px;margin-left:5px'>REVIEW</span>":"")+"</div>"+
            "<div style='font-size:11px;color:rgba(238,240,248,.38);margin-top:2px;font-weight:500'>"+fmt(t.ts)+"</div></div>"+
          "</div>";
        }).join("");
    }
  }
  frame();
}

function staffGoalRow(g,isTeam) {
  var pct=Math.min(100,g.target>0?Math.round((g.current/g.target)*100):0);
  var done=pct>=100;
  return "<div class='plain-card' style='margin-bottom:9px'>"+
    "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:6px'>"+
      "<div style='font-weight:700;font-size:13px'>"+esc(g.title)+(done?" <span style='font-size:10px;color:#00e5a0;background:rgba(0,229,160,.1);border-radius:5px;padding:1px 6px'>Done ✓</span>":"")+(isTeam?" <span style='font-size:10px;color:#7c6aff;background:rgba(124,106,255,.1);border-radius:5px;padding:1px 6px'>Team</span>":"")+"</div>"+
      "<div style='font-size:12px;font-weight:700;color:"+(done?"#00e5a0":"rgba(238,240,248,.5)")+"'>"+pct+"%</div>"+
    "</div>"+
    "<div style='height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden'><div style='height:100%;width:"+pct+"%;background:"+(done?"#00e5a0":"linear-gradient(90deg,#7c6aff,#a78bfa)")+";border-radius:3px'></div></div>"+
    "<div style='font-size:10px;color:rgba(238,240,248,.28);margin-top:5px;font-weight:500'>"+esc(g.period||"")+" · "+g.current+"/"+g.target+" "+esc(g.unit||"")+"</div>"+
  "</div>";
}

// ─── MANAGER DASHBOARD ─────────────────────
function renderManagerDash(el,biz) {
  var brandColor=biz.brand&&biz.brand.brandColor||"#00e5a0";
  var TABS=[
    {id:"ai",lbl:"AI Insights",ai:true},
    {id:"team",lbl:"Team"},
    {id:"estimator",lbl:"Estimator",ai:true},
    {id:"staff",lbl:"Staff"},
    {id:"links",lbl:"Links"},
    {id:"goals",lbl:"Goals"},
    {id:"branding",lbl:"Branding"}
  ];
  var curTab="ai";
  var activeStaff=biz.staff.filter(function(s){return s.active;});
  var sd=activeStaff.map(function(s){var st=calcStats(getDemoTaps(s.id));return s.name+": "+st.count+" taps, "+st.reviews+" reviews, "+st.avgStr+"★, score "+st.score;}).join("\n");
  var allFb=activeStaff.flatMap(function(s){return calcStats(getDemoTaps(s.id)).negFb.map(function(t){return s.name+"("+t.rating+"★): \""+t.feedback+"\"";});}).join("\n");

  el.innerHTML=
    "<div class='dash-header'>"+
      "<div><div class='dash-name'>"+esc(biz.name)+"</div><div class='dash-sub'>Manager Dashboard · Tap+</div></div>"+
      "<button onclick='sessionStorage.removeItem(\"biz_auth_\"+\""+biz.slug+"\");window.location.reload()' class='dash-exit'>← Exit</button>"+
    "</div>"+
    "<div class='dash-tabs' id='mgr-tabs'>"+
      TABS.map(function(t,i){return "<button class='dash-tab"+(t.ai?" ai":"")+(i===0?" active":"")+"' onclick='_mTab(\""+t.id+"\",this)'>"+(t.ai?"<span class='ai-mini-dot'></span> ":"")+esc(t.lbl)+"</button>";}).join("")+
    "</div>"+
    "<div class='dash-body' id='mgr-body'></div>";

  window._mTab=function(tab,btn){
    document.querySelectorAll("#mgr-tabs .dash-tab").forEach(function(b){b.classList.remove("active");});
    btn.classList.add("active"); curTab=tab; renderMTab(tab);
  };

  function renderMTab(tab) {
    var body=$("mgr-body"); if(!body) return;

    if(tab==="ai") {
      renderAIInsightsTab(body,activeStaff,sd,allFb);
    } else if(tab==="team") {
      renderTeamTab(body,activeStaff,sd);
    } else if(tab==="estimator") {
      renderEstimatorTab(body,activeStaff);
    } else if(tab==="staff") {
      renderStaffMgmtTab(body,biz);
    } else if(tab==="links") {
      renderLinksTab(body,biz);
    } else if(tab==="goals") {
      renderMgrGoalsTab(body,biz);
    } else if(tab==="branding") {
      renderBrandingTab(body,biz);
    }
  }
  renderMTab("ai");
}

// ─── AI INSIGHTS ───────────────────────────
function renderAIInsightsTab(body,activeStaff,sd,allFb) {
  var SUBS=["summary","coaching","feedback","export"];
  var LABELS={summary:"📋 Summary",coaching:"💬 Coaching",feedback:"🔍 Feedback",export:"📄 Export"};
  body.innerHTML=
    "<div id='ai-sub-tabs' style='display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap'>"+
      SUBS.map(function(s,i){return "<button data-sub='"+s+"' onclick='_aiSub(this.dataset.sub)' style='background:"+(i===0?"#a78bfa":"#15171f")+";color:"+(i===0?"#07080c":"rgba(238,240,248,.5)")+";border:1px solid "+(i===0?"#a78bfa":"rgba(255,255,255,.08)")+";border-radius:9px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit'>"+LABELS[s]+"</button>";}).join("")+
    "</div>"+
    "<div id='ai-sub-body'></div>";

  window._aiSub=function(sub) {
    document.querySelectorAll("#ai-sub-tabs button").forEach(function(b){var a=b.dataset.sub===sub;b.style.background=a?"#a78bfa":"#15171f";b.style.color=a?"#07080c":"rgba(238,240,248,.5)";b.style.borderColor=a?"#a78bfa":"rgba(255,255,255,.08)";});
    var el=$("ai-sub-body"); if(!el) return;
    if(sub==="summary"){
      var p="Weekly summary.\nTEAM:\n"+sd+"\nFEEDBACK:\n"+(allFb||"None")+"\nCover: overall, top performer, who needs support, feedback patterns, priority action. Under 280 words.";
      el.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>🧠</div><div><div class='ai-card-title'>Weekly Summary</div></div></div><div id='ai-sum'></div></div>";
      renderAIBlock("ai-sum",p,"mgr_sum","Generating…");
    } else if(sub==="coaching") {
      var first=activeStaff[0];
      el.innerHTML="<div class='pills' id='coach-pills'>"+activeStaff.map(function(s,i){return "<div class='pill"+(i===0?" active":"")+"' onclick='_cStaff(\""+s.id+"\",this)'><div class='pill-av' style='background:"+s.color+"22;color:"+s.color+"'>"+ini(s.name)+"</div>"+s.name.split(" ")[0]+"</div>";}).join("")+"</div><div id='coach-card'></div>";
      if(first) _cStaff(first.id,document.querySelector("#coach-pills .pill"));
    } else if(sub==="feedback") {
      var fbItems=activeStaff.flatMap(function(s){return calcStats(getDemoTaps(s.id)).negFb.map(function(t){return Object.assign({},t,{sName:s.name,sColor:s.color});});}).sort(function(a,b){return b.ts-a.ts;});
      var p2="Analyze feedback:\n"+(allFb||"None")+"\nGive: sentiment, patterns, urgent flags, positive signals. Under 200 words.";
      el.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>🔍</div><div><div class='ai-card-title'>Sentiment Analysis</div></div></div><div id='ai-fb-mgr'></div></div>"+
        (fbItems.length?"<div class='sec-lbl' style='margin-top:4px'>Raw Feedback</div>"+fbItems.map(function(f){return "<div class='plain-card'><div style='font-weight:700;font-size:13px;color:"+f.sColor+"'>"+esc(f.sName)+"</div><div style='font-size:13px;margin:4px 0'>"+"⭐".repeat(f.rating)+"</div><div style='font-size:13px;color:rgba(238,240,248,.65);font-style:italic'>\""+esc(f.feedback)+"\"</div></div>";}).join(""):"<div style='color:#00e5a0;font-size:13px;font-weight:500;margin-top:4px'>No feedback yet.</div>");
      renderAIBlock("ai-fb-mgr",p2,"mgr_fb","Analyzing…");
    } else {
      var p3="Professional weekly report. DATE: "+new Date().toLocaleDateString([],{weekday:"long",year:"numeric",month:"long",day:"numeric"})+"\nTEAM:\n"+sd+"\n## Executive Summary / ## Individual Performance / ## Sentiment / ## Recommendations / ## Next Week Goals.";
      el.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>📄</div><div><div class='ai-card-title'>Full Performance Report</div></div></div><button class='btn btn-ghost btn-sm' style='margin-bottom:6px' onclick='window.print()'>🖨 Print</button><div id='ai-report'></div></div>";
      renderAIBlock("ai-report",p3,"mgr_report","Writing…");
    }
  };
  _aiSub("summary");
}
window._cStaff=function(sid,pill) {
  document.querySelectorAll(".pill").forEach(function(p){p.classList.remove("active");});
  if(pill)pill.classList.add("active");
  // Find biz from current context
  var parts=window.location.pathname.split("/").filter(Boolean);
  var biz=getBiz(parts[0]);
  if(!biz) return;
  var s=biz.staff.find(function(x){return x.id===sid;});
  if(!s) return;
  var st=calcStats(getDemoTaps(s.id));
  var ctx=biz.staff.filter(function(x){return x.active;}).map(function(x){return x.name+": score "+calcStats(getDemoTaps(x.id)).score;}).join(", ");
  var fb=st.negFb.map(function(t){return "\""+t.feedback+"\"("+t.rating+"★)";}).join("; ")||"none";
  var p="Manager coaching for "+s.name+". Stats: "+st.count+" taps, "+st.reviews+" reviews, "+st.avgStr+"★, "+st.ctr+"% CTR, score "+st.score+". Team: "+ctx+". Feedback: "+fb+". What they do well, biggest improvement, coaching starter, suggested goal. Under 200 words.";
  var cc=$("coach-card"); if(!cc) return;
  cc.innerHTML="<div class='ai-card'><div class='ai-card-head'><div style='width:36px;height:36px;border-radius:50%;background:"+s.color+"22;color:"+s.color+";display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px'>"+ini(s.name)+"</div><div><div class='ai-card-title'>"+esc(s.name)+"</div><div class='ai-card-sub'>"+st.count+" taps · "+st.avgStr+"★ · score "+st.score+"</div></div></div><div id='ai-coach-"+sid+"'></div></div>";
  renderAIBlock("ai-coach-"+sid,p,"mgr_c_"+sid,"Writing…");
};

// ─── TEAM TAB ──────────────────────────────
var _teamSub="leaderboard";
function renderTeamTab(body,activeStaff,sd) {
  var SUBS={leaderboard:"🏆 Leaderboard",analytics:"📊 Analytics",goals_view:"🎯 Goals"};
  body.innerHTML=
    "<div id='team-sub-tabs' style='display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap'>"+
      Object.keys(SUBS).map(function(s){var a=s===_teamSub;return "<button data-ts='"+s+"' onclick='_teamSub_fn(this.dataset.ts)' style='background:"+(a?"#00e5a0":"#15171f")+";color:"+(a?"#07080c":"rgba(238,240,248,.5)")+";border:1px solid "+(a?"#00e5a0":"rgba(255,255,255,.08)")+";border-radius:9px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit'>"+SUBS[s]+"</button>";}).join("")+
    "</div>"+
    "<div id='team-sub-body'></div>";

  window._teamSub_fn=function(sub) {
    _teamSub=sub;
    document.querySelectorAll("#team-sub-tabs button").forEach(function(b){var a=b.dataset.ts===sub;b.style.background=a?"#00e5a0":"#15171f";b.style.color=a?"#07080c":"rgba(238,240,248,.5)";b.style.borderColor=a?"#00e5a0":"rgba(255,255,255,.08)";});
    var el=$("team-sub-body"); if(!el) return;
    if(sub==="leaderboard") renderLeaderboard(el,activeStaff);
    else if(sub==="analytics") renderAnalytics(el,activeStaff);
    else renderTeamGoalsView(el);
  };
  _teamSub_fn(_teamSub);
}

function renderLeaderboard(el,activeStaff) {
  var rows=activeStaff.map(function(s){return {s:s,st:calcStats(getDemoTaps(s.id))};}).sort(function(a,b){return b.st.score-a.st.score;});
  var maxScore=Math.max.apply(null,rows.map(function(r){return r.st.score;}))||1;
  var wkTop=rows.slice().sort(function(a,b){return b.st.weekTaps-a.st.weekTaps;})[0];
  function pctLabel(pct){if(pct>=.9)return{e:"🔥",l:"On Fire",c:"#ff6b35"};if(pct>=.75)return{e:"💪",l:"Strong",c:"#00e5a0"};if(pct>=.55)return{e:"✅",l:"Good",c:"#7c6aff"};if(pct>=.35)return{e:"📈",l:"Building",c:"#ffd166"};return{e:"💤",l:"Needs Push",c:"#ff4455"};}
  el.innerHTML=
    "<div class='lb-banner'><span style='font-size:22px'>🏆</span><div><div style='font-weight:700;font-size:13px;margin-bottom:2px'>This Week: "+esc(wkTop?wkTop.s.name:"—")+"</div><div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>"+(wkTop?wkTop.st.weekTaps:0)+" taps · Resets Monday</div></div></div>"+
    rows.map(function(row,i){
      var s=row.s,st=row.st,pct=st.score/maxScore,pl=pctLabel(pct),bar=Math.round(pct*100),dots="";
      for(var d=0;d<10;d++) dots+=d<Math.round(pct*10)?"●":"○";
      return "<div class='lb-item "+(i<3?"r"+(i+1):"")+"' style='flex-direction:column;align-items:stretch;gap:10px'>"+
        "<div style='display:flex;align-items:center;gap:12px'>"+
          "<div class='lb-rank'>"+["🥇","🥈","🥉"][i]||(i+1)+"</div>"+
          "<div class='lb-av' style='background:"+s.color+"22;color:"+s.color+"'>"+ini(s.name)+"</div>"+
          "<div style='flex:1'>"+
            "<div style='display:flex;align-items:center;gap:7px;margin-bottom:2px'>"+
              "<div class='lb-nm'>"+esc(s.name)+"</div>"+
              "<span style='font-size:16px'>"+pl.e+"</span>"+
              "<span style='font-size:10px;font-weight:700;color:"+pl.c+";background:"+pl.c+"18;border-radius:5px;padding:1px 7px'>"+pl.l+"</span>"+
            "</div>"+
            "<div class='lb-st'>"+st.count+" taps · "+st.reviews+" reviews · "+st.avgStr+"⭐ · CTR "+st.ctr+"%</div>"+
          "</div>"+
          "<div class='lb-sc'><div class='lb-sc-val'>"+st.score+"</div><div class='lb-sc-lbl'>pts</div></div>"+
        "</div>"+
        "<div style='display:flex;align-items:center;gap:8px'>"+
          "<div style='font-size:11px;color:"+s.color+";letter-spacing:.5px;font-family:monospace;flex:1'>"+dots+"</div>"+
          "<div style='font-size:10px;color:rgba(238,240,248,.35);font-weight:600'>"+bar+"%</div>"+
        "</div>"+
        "<div style='height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden'><div style='height:100%;width:"+bar+"%;background:linear-gradient(90deg,"+s.color+","+pl.c+");border-radius:2px'></div></div>"+
      "</div>";
    }).join("")+
    "<div style='margin-top:10px;font-size:11px;color:rgba(238,240,248,.28);font-weight:500'>Score = Taps×10 + Reviews×15 + 5★×5</div>";
}

var _chartMode="bar";
function renderAnalytics(el,activeStaff) {
  var all=activeStaff.flatMap(function(s){return getDemoTaps(s.id);});
  var tot=all.length,revs=all.filter(function(t){return t.review;}).length;
  var avg=all.length?(all.reduce(function(a,t){return a+t.rating;},0)/all.length).toFixed(1):"—";
  var pos=all.filter(function(t){return t.rating>=4;}).length,neg=all.filter(function(t){return t.rating<=3;}).length;
  var ctr=pos>0?Math.round((revs/pos)*100):0;
  var gT=all.filter(function(t){return t.platform==="google";}).length;
  var yT=all.filter(function(t){return t.platform==="yelp";}).length;
  var mx=Math.max.apply(null,activeStaff.map(function(s){return getDemoTaps(s.id).length;}));
  var isBar=_chartMode==="bar";
  var bStyle="background:"+(isBar?"#00e5a0":"#15171f")+";color:"+(isBar?"#07080c":"rgba(238,240,248,.5)")+";border:1px solid "+(isBar?"#00e5a0":"rgba(255,255,255,.08)")+";border-radius:9px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit";
  var dStyle="background:"+(!isBar?"#00e5a0":"#15171f")+";color:"+(!isBar?"#07080c":"rgba(238,240,248,.5)")+";border:1px solid "+(!isBar?"#00e5a0":"rgba(255,255,255,.08)")+";border-radius:9px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit";
  var cs="background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:13px;padding:15px;margin-bottom:9px";
  el.innerHTML=
    "<div style='display:flex;justify-content:flex-end;gap:6px;margin-bottom:10px'><button data-cm='bar' onclick='_setChart(this.dataset.cm)' style='"+bStyle+"'>▬ Bar</button><button data-cm='donut' onclick='_setChart(this.dataset.cm)' style='"+dStyle+"'>◉ Donut</button></div>"+
    "<div style='display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:9px'>"+
      [[tot,"Total Taps","#00e5a0"],[revs,"Reviews","#ffd166"],[avg+"⭐","Avg Rating","#ff6b35"],[ctr+"%","CTR","#7c6aff"],[pos,"Positive","#00e5a0"],[neg,"Negative","#ff4455"]].map(function(item){return "<div style='"+cs+"'><div style='font-weight:900;font-size:26px;line-height:1;margin-bottom:4px;color:"+item[2]+";letter-spacing:-.03em'>"+item[0]+"</div><div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:700'>"+item[1]+"</div></div>";}).join("")+
    "</div>"+
    "<div style='"+cs+"'><div class='sec-lbl'>Platform</div>"+buildPlatChart(gT,yT,0,tot)+"</div>"+
    "<div style='"+cs+"'><div class='sec-lbl'>Taps Per Staff</div>"+buildStaffBars(activeStaff,mx)+"</div>";
  window._setChart=function(m){_chartMode=m;renderAnalytics(el,activeStaff);};
}
function buildPlatChart(gT,yT,tT,tot) {
  if(_chartMode==="donut"){
    var total=gT+yT+tT||1;
    var segs=[{n:gT,c:"#00e5a0",l:"Google"},{n:yT,c:"#ffd166",l:"Yelp"},{n:tT,c:"#7c6aff",l:"Tripadvisor"}];
    return "<div style='display:flex;align-items:center;gap:16px'>"+buildDonut(segs.map(function(s){return {pct:s.n/total,c:s.c};}),80)+"<div>"+segs.map(function(s){return "<div style='display:flex;align-items:center;gap:7px;margin-bottom:7px'><div style='width:10px;height:10px;border-radius:50%;background:"+s.c+";flex-shrink:0'></div><div style='font-size:12px;font-weight:600;flex:1'>"+s.l+"</div><div style='font-size:12px;font-weight:800;color:"+s.c+"'>"+s.n+"</div></div>";}).join("")+"</div></div>";
  }
  return [["🔍",gT,"#00e5a0","Google"],["⭐",yT,"#ffd166","Yelp"],["✈️",tT,"#7c6aff","Tripadvisor"]].map(function(item){return "<div style='display:inline-block;text-align:center;background:#15171f;border-radius:9px;padding:10px 14px;margin-right:8px'><div style='font-size:18px'>"+item[0]+"</div><div style='font-weight:900;font-size:20px;color:"+item[2]+"'>"+item[1]+"</div><div style='font-size:10px;color:rgba(238,240,248,.38);font-weight:700'>"+item[3]+"</div></div>";}).join("");
}
function buildStaffBars(activeStaff,mx) {
  if(_chartMode==="donut"){
    var tot2=activeStaff.reduce(function(a,s){return a+getDemoTaps(s.id).length;},0)||1;
    var segs2=activeStaff.map(function(s){return {pct:getDemoTaps(s.id).length/tot2,c:s.color};});
    return "<div style='display:flex;align-items:center;gap:16px'>"+buildDonut(segs2,80)+"<div>"+activeStaff.map(function(s){var n=getDemoTaps(s.id).length;return "<div style='display:flex;align-items:center;gap:7px;margin-bottom:7px'><div style='width:10px;height:10px;border-radius:50%;background:"+s.color+";flex-shrink:0'></div><div style='font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>"+esc(s.name.split(" ")[0])+"</div><div style='font-size:12px;font-weight:800;color:"+s.color+"'>"+n+"</div></div>";}).join("")+"</div></div>";
  }
  return activeStaff.map(function(s){var n=getDemoTaps(s.id).length;return "<div class='bar-row'><div class='bar-nm'>"+esc(s.name.split(" ")[0])+"</div><div class='bar-track'><div class='bar-fill' style='width:"+Math.round(n/mx*100)+"%;background:"+s.color+"'></div></div><div class='bar-v' style='color:"+s.color+"'>"+n+"</div></div>";}).join("");
}
function buildDonut(segs,size) {
  var r=size*.35,cx=size/2,cy=size/2,sw=size*.18,circ=2*Math.PI*r,off=0;
  var paths=segs.map(function(seg){var dl=seg.pct*circ,gap=circ-dl,p="<circle cx='"+cx+"' cy='"+cy+"' r='"+r+"' fill='none' stroke='"+seg.c+"' stroke-width='"+sw+"' stroke-dasharray='"+dl.toFixed(2)+" "+gap.toFixed(2)+"' stroke-dashoffset='"+(-off*circ).toFixed(2)+"' stroke-linecap='round' transform='rotate(-90 "+cx+" "+cy+")'/>";off+=seg.pct;return p;});
  return "<svg width='"+size+"' height='"+size+"' style='flex-shrink:0'><circle cx='"+cx+"' cy='"+cy+"' r='"+r+"' fill='none' stroke='rgba(255,255,255,.06)' stroke-width='"+sw+"'/>"+paths.join("")+"</svg>";
}
function renderTeamGoalsView(el) {
  var parts=window.location.pathname.split("/").filter(Boolean);
  var biz=getBiz(parts[0]);
  if(!biz){el.innerHTML="";return;}
  var tGoals=biz.teamGoals||[];
  el.innerHTML="<div style='text-align:right;margin-bottom:10px'><button onclick='_addTeamGoal()' class='btn btn-primary btn-sm'>+ Add Goal</button></div>"+
    (tGoals.length?tGoals.map(function(g){return staffGoalRow(g,true);}).join(""):"<div style='text-align:center;padding:30px 20px;color:rgba(238,240,248,.38);font-size:13px'>No team goals yet.</div>");
}

// ─── ESTIMATOR ─────────────────────────────
function renderEstimatorTab(body,activeStaff) {
  body.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>📈</div><div><div class='ai-card-title'>Platform Rating Estimator</div><div class='ai-card-sub'>How many 5★ reviews to hit your target</div></div></div>"+
    "<div class='field-lbl' style='margin-top:4px'>Platform</div><select class='sel' id='est-plat' style='margin-bottom:10px'><option value='google'>Google</option><option value='yelp'>Yelp</option><option value='tripadvisor'>Tripadvisor</option></select>"+
    "<div class='field-lbl'>Current Review Count</div><input class='inp' id='est-count' type='number' value='71' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Current Rating</div><input class='inp' id='est-cur' type='number' step='0.1' value='4.2' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Target Rating</div><input class='inp' id='est-tgt' type='number' step='0.1' value='4.5' style='margin-bottom:12px'/>"+
    "<button onclick='_calcEst()' style='width:100%;padding:12px;background:linear-gradient(135deg,rgba(167,139,250,.16),rgba(129,140,248,.12));border:1px solid rgba(167,139,250,.28);color:#a78bfa;border-radius:11px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit'>✦ Calculate &amp; Predict</button>"+
    "<div id='est-result' style='margin-top:14px'></div></div>";

  window._calcEst=function(){
    var c=parseInt(($("est-count")||{}).value)||0,cur=parseFloat(($("est-cur")||{}).value)||0,tgt=parseFloat(($("est-tgt")||{}).value)||0;
    var plat=($("est-plat")||{}).value||"google";
    var el=$("est-result"); if(!el) return;
    if(!c||!cur||!tgt){el.innerHTML="<div style='color:#ff4455;font-size:13px'>Fill in all fields.</div>";return;}
    if(tgt<=cur){el.innerHTML="<div style='color:#ffd166;font-size:13px;font-weight:600;text-align:center;padding:8px'>✓ Already at or above target!</div>";return;}
    if(tgt>5){el.innerHTML="<div style='color:#ff4455;font-size:13px'>Target can't exceed 5.0</div>";return;}
    var n=Math.max(1,Math.ceil((c*(tgt-cur))/(5-tgt)));
    var tps=Math.ceil(n/0.65);
    var pace=Math.max(1,activeStaff.length*3);
    var wks=Math.ceil(tps/pace);
    var p="Restaurant wants "+plat+" from "+cur+"★ to "+tgt+"★. "+c+" reviews. Need ~"+n+" new 5★ reviews (~"+tps+" taps, ~"+wks+" weeks). Timeframe, strategy, 2 tactics, 1 risk. Under 150 words.";
    el.innerHTML="<div class='est-grid'>"+[[n,"5★ needed","#00e5a0"],[tps,"Taps needed","#ffd166"],[wks+"w","Est. time","#7c6aff"],[cur+"→"+tgt+"★","Jump","#ff6b35"]].map(function(item){return "<div class='est-card'><div class='est-val' style='color:"+item[2]+"'>"+item[0]+"</div><div class='est-lbl'>"+item[1]+"</div></div>";}).join("")+"</div><div id='ai-est'></div>";
    renderAIBlock("ai-est",p,"est_"+plat+"_"+cur+"_"+tgt,"Predicting…");
  };
}

// ─── STAFF MGMT ────────────────────────────
function renderStaffMgmtTab(body,biz) {
  body.innerHTML=
    "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'>"+
      "<div class='sec-lbl' style='margin-bottom:0'>Staff ("+biz.staff.length+")</div>"+
      "<div style='display:flex;gap:7px'>"+
        "<button onclick='_chgMgrPin()' class='btn btn-ghost btn-sm'>🔒 Manager PIN</button>"+
        "<button onclick='_addStaff()' class='btn btn-primary btn-sm'>+ Add</button>"+
      "</div>"+
    "</div>"+
    "<div id='staff-list'></div>";
  renderStaffList(biz);
}
function renderStaffList(biz) {
  var el=$("staff-list"); if(!el) return;
  var base=window.location.origin+"/"+biz.slug+"/tap/";
  el.innerHTML=biz.staff.map(function(s){
    return "<div class='plain-card' style='opacity:"+(s.active?1:0.5)+";margin-bottom:9px'>"+
      "<div style='display:flex;align-items:center;gap:11px'>"+
        "<div style='width:40px;height:40px;border-radius:50%;background:"+s.color+"22;color:"+s.color+";display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0'>"+ini(s.name)+"</div>"+
        "<div style='flex:1;min-width:0'>"+
          "<div style='font-weight:700;font-size:13px;margin-bottom:2px'>"+esc(s.name)+(!s.active?" <span style='font-size:10px;background:rgba(255,68,85,.1);color:#ff4455;border-radius:4px;padding:1px 6px'>Inactive</span>":"")+"</div>"+
          "<div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>Passcode: "+s.passcode+"</div>"+
        "</div>"+
        "<div style='display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end'>"+
          "<button onclick='_copyUrl(\""+base+s.id+"\")' class='btn btn-ghost btn-sm'>📋</button>"+
          "<button onclick='_editStaff(\""+s.id+"\")' class='btn btn-ghost btn-sm'>✏</button>"+
          "<button onclick='_toggleStaff(\""+s.id+"\")' class='btn btn-ghost btn-sm'>"+(s.active?"Deactivate":"Activate")+"</button>"+
          "<button onclick='_removeStaff(\""+s.id+"\")' class='btn btn-danger btn-sm'>✕</button>"+
        "</div>"+
      "</div>"+
      "<div style='margin-top:8px;padding:7px 9px;background:#15171f;border-radius:8px;font-size:11px;color:#00e5a0;word-break:break-all;font-weight:500'>"+base+s.id+"</div>"+
    "</div>";
  }).join("");

  var parts=window.location.pathname.split("/").filter(Boolean);
  window._copyUrl=function(url){navigator.clipboard.writeText(url).then(function(){showToast("URL copied!");}).catch(function(){showToast(url);});};
  window._toggleStaff=function(sid){biz.staff=biz.staff.map(function(s){return s.id===sid?Object.assign({},s,{active:!s.active}):s;});saveBiz(biz);renderStaffList(biz);};
  window._removeStaff=function(sid){var s=biz.staff.find(function(x){return x.id===sid;});if(!s||!confirm("Remove "+s.name+"?"))return;biz.staff=biz.staff.filter(function(x){return x.id!==sid;});saveBiz(biz);renderStaffList(biz);};
  window._addStaff=function(){
    window._selColor=COLORS[0];
    showModal("<div class='modal-head'><div class='modal-title'>Add Staff</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div><div class='field-lbl'>Name</div><input class='inp' id='ns-name' placeholder='e.g. Sam W.'/></div><div><div class='field-lbl'>4-Digit Passcode</div><input class='inp' id='ns-pass' type='tel' maxlength='4'/><div id='ns-err' style='color:#ff4455;font-size:12px;margin-top:4px;min-height:14px;font-weight:500'></div></div><div><div class='field-lbl'>Color</div><div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:4px'>"+COLORS.map(function(c,i){return "<div data-sc='"+c+"' onclick='_pickColor(this)' style='width:27px;height:27px;border-radius:50%;background:"+c+";cursor:pointer;outline:"+(i===0?"3px solid rgba(255,255,255,.8)":"none")+";outline-offset:2px'></div>";}).join("")+"</div></div><button class='btn btn-primary btn-full' onclick='_saveStaff()'>Add Staff Member</button></div>");
    window._pickColor=function(el){window._selColor=el.dataset.sc;document.querySelectorAll("[data-sc]").forEach(function(d){d.style.outline="none";});el.style.outline="3px solid rgba(255,255,255,.8)";el.style.outlineOffset="2px";};
    window._saveStaff=function(){
      var name=(($("ns-name")||{}).value||"").trim(),pass=(($("ns-pass")||{}).value||"").trim(),err=$("ns-err");
      if(!name){if(err)err.textContent="Name required";return;}
      if(!/^\d{4}$/.test(pass)){if(err)err.textContent="Must be 4 digits";return;}
      if(biz.staff.find(function(s){return s.passcode===pass;})){if(err)err.textContent="Passcode in use";return;}
      biz.staff.push({id:uid(),name:name,color:window._selColor||COLORS[0],passcode:pass,active:true});
      saveBiz(biz);closeModal();renderStaffList(biz);showToast("Staff added!");
    };
  };
  window._editStaff=function(sid){
    var s=biz.staff.find(function(x){return x.id===sid;}); if(!s) return;
    window._selColor=s.color;
    showModal("<div class='modal-head'><div class='modal-title'>Edit: "+esc(s.name)+"</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div><div class='field-lbl'>Name</div><input class='inp' id='es-name' value='"+esc(s.name)+"'/></div><div><div class='field-lbl'>Passcode</div><input class='inp' id='es-pass' type='tel' maxlength='4' value='"+s.passcode+"'/><div id='es-err' style='color:#ff4455;font-size:12px;margin-top:4px;min-height:14px;font-weight:500'></div></div><div><div class='field-lbl'>Color</div><div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:4px'>"+COLORS.map(function(c){return "<div data-sc='"+c+"' onclick='_pickColor(this)' style='width:27px;height:27px;border-radius:50%;background:"+c+";cursor:pointer;outline:"+(c===s.color?"3px solid rgba(255,255,255,.8)":"none")+";outline-offset:2px'></div>";}).join("")+"</div></div><button class='btn btn-primary btn-full' onclick='_saveEditStaff(\""+sid+"\")'>Save</button></div>");
    window._pickColor=function(el){window._selColor=el.dataset.sc;document.querySelectorAll("[data-sc]").forEach(function(d){d.style.outline="none";});el.style.outline="3px solid rgba(255,255,255,.8)";el.style.outlineOffset="2px";};
    window._saveEditStaff=function(sid2){
      var name=(($("es-name")||{}).value||"").trim(),pass=(($("es-pass")||{}).value||"").trim(),err=$("es-err");
      if(!name){if(err)err.textContent="Name required";return;}
      if(!/^\d{4}$/.test(pass)){if(err)err.textContent="Must be 4 digits";return;}
      if(biz.staff.find(function(s){return s.passcode===pass&&s.id!==sid2;})){if(err)err.textContent="Passcode in use";return;}
      biz.staff=biz.staff.map(function(s){return s.id===sid2?Object.assign({},s,{name:name,passcode:pass,color:window._selColor||s.color}):s;});
      saveBiz(biz);closeModal();renderStaffList(biz);showToast("Saved!");
    };
  };
  window._chgMgrPin=function(){
    showModal("<div class='modal-head'><div class='modal-title'>Change Manager PIN</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='background:#15171f;border-radius:9px;padding:10px 12px;font-size:12px;color:rgba(238,240,248,.38);font-weight:500'>Current PIN: <strong style='color:#eef0f8'>"+biz.mgrPin+"</strong></div><div><div class='field-lbl'>New PIN</div><input class='inp' id='mp-1' type='tel' maxlength='4'/></div><div><div class='field-lbl'>Confirm</div><input class='inp' id='mp-2' type='tel' maxlength='4'/></div><div id='mp-err' style='color:#ff4455;font-size:12px;min-height:14px;font-weight:500'></div><button class='btn btn-primary btn-full' onclick='_saveMgrPin()'>Update PIN</button></div>");
    window._saveMgrPin=function(){var p1=(($("mp-1")||{}).value||"").trim(),p2=(($("mp-2")||{}).value||"").trim(),err=$("mp-err");if(!/^\d{4}$/.test(p1)){if(err)err.textContent="Must be 4 digits";return;}if(p1!==p2){if(err)err.textContent="PINs don't match";return;}biz.mgrPin=p1;saveBiz(biz);closeModal();showToast("PIN updated!");};
  };
}

// ─── LINKS TAB ─────────────────────────────
function renderLinksTab(body,biz) {
  body.innerHTML=
    "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'>"+
      "<div class='sec-lbl' style='margin-bottom:0'>Review Links</div>"+
      "<button onclick='_addLink()' class='btn btn-primary btn-sm'>+ Add</button>"+
    "</div>"+
    "<div style='background:#15171f;border-radius:9px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:rgba(238,240,248,.38);line-height:1.6;font-weight:500'>5★ auto-redirects to first active link. 4★ shows all active links.</div>"+
    "<div id='links-list'></div>";
  renderLinksList(biz);
}
function renderLinksList(biz) {
  var el=$("links-list"); if(!el) return;
  el.innerHTML=biz.links.map(function(l){
    return "<div class='link-row'>"+
      "<div class='link-ico'>"+l.icon+"</div>"+
      "<div style='flex:1;min-width:0'><div style='font-weight:700;font-size:13px;margin-bottom:2px'>"+esc(l.label)+"</div><div style='font-size:11px;color:rgba(238,240,248,.38);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>"+esc(l.url)+"</div></div>"+
      "<div style='display:flex;gap:5px;flex-shrink:0'>"+
        "<button onclick='_toggleLink(\""+l.id+"\")' style='background:"+(l.active?"rgba(0,229,160,.1)":"rgba(255,255,255,.04)")+";border:1px solid "+(l.active?"rgba(0,229,160,.22)":"rgba(255,255,255,.06)")+";color:"+(l.active?"#00e5a0":"rgba(238,240,248,.38)")+";border-radius:7px;padding:4px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit'>"+(l.active?"On":"Off")+"</button>"+
        "<button onclick='_editLink(\""+l.id+"\")' class='btn btn-ghost btn-sm'>Edit</button>"+
        "<button onclick='_removeLink(\""+l.id+"\")' class='btn btn-danger btn-sm'>✕</button>"+
      "</div>"+
    "</div>";
  }).join("");

  window._toggleLink=function(id){biz.links=biz.links.map(function(l){return l.id===id?Object.assign({},l,{active:!l.active}):l;});saveBiz(biz);renderLinksList(biz);};
  window._removeLink=function(id){if(!confirm("Remove this link?"))return;biz.links=biz.links.filter(function(l){return l.id!==id;});saveBiz(biz);renderLinksList(biz);};
  window._addLink=function(){
    showModal("<div class='modal-head'><div class='modal-title'>Add Review Link</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='display:flex;gap:8px'><div style='width:70px;flex-shrink:0'><div class='field-lbl'>Icon</div><input class='inp' id='nl-icon' placeholder='🔗' style='text-align:center;font-size:18px'/></div><div style='flex:1'><div class='field-lbl'>Label</div><input class='inp' id='nl-label' placeholder='Google, Yelp…'/></div></div><div><div class='field-lbl'>URL</div><input class='inp' id='nl-url' placeholder='https://…'/></div><button class='btn btn-primary btn-full' onclick='_saveLink()'>Add Link</button></div>");
    window._saveLink=function(){var icon=(($("nl-icon")||{}).value||"").trim()||"🔗",label=(($("nl-label")||{}).value||"").trim(),url=(($("nl-url")||{}).value||"").trim();if(!label||!url){showToast("Label and URL required");return;}biz.links.push({id:uid(),label:label,icon:icon,url:url,active:true});saveBiz(biz);closeModal();renderLinksList(biz);};
  };
  window._editLink=function(id){
    var l=biz.links.find(function(x){return x.id===id;}); if(!l) return;
    showModal("<div class='modal-head'><div class='modal-title'>Edit Link</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='display:flex;gap:8px'><div style='width:70px;flex-shrink:0'><div class='field-lbl'>Icon</div><input class='inp' id='el-icon' value='"+esc(l.icon)+"' style='text-align:center;font-size:18px'/></div><div style='flex:1'><div class='field-lbl'>Label</div><input class='inp' id='el-label' value='"+esc(l.label)+"'/></div></div><div><div class='field-lbl'>URL</div><input class='inp' id='el-url' value='"+esc(l.url)+"'/></div><button class='btn btn-primary btn-full' onclick='_saveEditLink(\""+id+"\")'>Save</button></div>");
    window._saveEditLink=function(lid){var icon=(($("el-icon")||{}).value||"").trim()||"🔗",label=(($("el-label")||{}).value||"").trim(),url=(($("el-url")||{}).value||"").trim();if(!label||!url){showToast("Label and URL required");return;}biz.links=biz.links.map(function(l){return l.id===lid?Object.assign({},l,{icon:icon,label:label,url:url}):l;});saveBiz(biz);closeModal();renderLinksList(biz);};
  };
}

// ─── GOALS TAB ─────────────────────────────
function renderMgrGoalsTab(body,biz) {
  var SUBS={team:"Team Goals",individual:"Individual Goals"};
  var curSub="team";
  body.innerHTML=
    "<div id='goals-sub-tabs' style='display:flex;gap:6px;margin-bottom:14px'>"+
      Object.keys(SUBS).map(function(s,i){return "<button data-gs='"+s+"' onclick='_goalSub(this.dataset.gs)' style='background:"+(i===0?"#00e5a0":"#15171f")+";color:"+(i===0?"#07080c":"rgba(238,240,248,.5)")+";border:1px solid "+(i===0?"#00e5a0":"rgba(255,255,255,.08)")+";border-radius:9px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit'>"+SUBS[s]+"</button>";}).join("")+
    "</div>"+
    "<div id='goals-sub-body'></div>";

  window._goalSub=function(sub){
    curSub=sub;
    document.querySelectorAll("#goals-sub-tabs button").forEach(function(b){var a=b.dataset.gs===sub;b.style.background=a?"#00e5a0":"#15171f";b.style.color=a?"#07080c":"rgba(238,240,248,.5)";b.style.borderColor=a?"#00e5a0":"rgba(255,255,255,.08)";});
    var el=$("goals-sub-body"); if(!el) return;
    if(sub==="team") renderTeamGoalsEdit(el,biz);
    else renderIndividualGoals(el,biz);
  };
  _goalSub("team");
}

function renderTeamGoalsEdit(el,biz) {
  var goals=biz.teamGoals||[];
  el.innerHTML=
    "<div style='display:flex;justify-content:flex-end;margin-bottom:10px'><button onclick='_addTeamGoal()' class='btn btn-primary btn-sm'>+ Add Goal</button></div>"+
    (goals.length?goals.map(function(g){return goalRowMgr(g,"team",null,biz);}).join(""):"<div style='text-align:center;padding:30px;color:rgba(238,240,248,.38);font-size:13px'>No team goals yet.</div>");
  window._addTeamGoal=function(){showGoalModal(null,"team",biz,function(){var el2=$("goals-sub-body");if(el2)renderTeamGoalsEdit(el2,biz);});};
}

function renderIndividualGoals(el,biz) {
  var active=biz.staff.filter(function(s){return s.active;});
  var first=active[0];
  el.innerHTML=
    "<div class='pills' id='igoal-pills'>"+active.map(function(s,i){return "<div class='pill"+(i===0?" active":"")+"' onclick='_selGoalStaff(\""+s.id+"\",this)'><div class='pill-av' style='background:"+s.color+"22;color:"+s.color+"'>"+ini(s.name)+"</div>"+s.name.split(" ")[0]+"</div>";}).join("")+"</div>"+
    "<div id='igoal-body'></div>";
  window._selGoalStaff=function(sid,pill){
    document.querySelectorAll("#igoal-pills .pill").forEach(function(p){p.classList.remove("active");});
    if(pill)pill.classList.add("active");
    var s=biz.staff.find(function(x){return x.id===sid;}); if(!s) return;
    var sGoals=(biz.staffGoals&&biz.staffGoals[sid])||[];
    var ib=$("igoal-body"); if(!ib) return;
    ib.innerHTML=
      "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:10px'>"+
        "<div class='sec-lbl' style='margin-bottom:0'>Goals for "+esc(s.name)+"</div>"+
        "<button onclick='_addStaffGoal(\""+sid+"\")' class='btn btn-primary btn-sm'>+ Add Goal</button>"+
      "</div>"+
      (sGoals.length?sGoals.map(function(g){return goalRowMgr(g,"staff",sid,biz);}).join(""):"<div style='text-align:center;padding:24px;color:rgba(238,240,248,.38);font-size:13px'>No goals for "+esc(s.name.split(" ")[0])+" yet.</div>");
    window._addStaffGoal=function(sid2){showGoalModal(sid2,"staff",biz,function(){window._selGoalStaff&&_selGoalStaff(sid2,document.querySelector("#igoal-pills .pill.active"));});};
  };
  if(first) _selGoalStaff(first.id,document.querySelector("#igoal-pills .pill"));
}

function goalRowMgr(g,type,sid,biz) {
  var pct=Math.min(100,g.target>0?Math.round((g.current/g.target)*100):0),done=pct>=100;
  var sidParm=sid?'"'+sid+'"':"null";
  return "<div class='plain-card' style='margin-bottom:9px'>"+
    "<div style='display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px'>"+
      "<div style='flex:1'>"+
        "<div style='font-weight:700;font-size:13px;margin-bottom:3px'>"+esc(g.title)+(done?" <span style='font-size:10px;color:#00e5a0;background:rgba(0,229,160,.1);border-radius:5px;padding:1px 6px'>Done ✓</span>":"")+"</div>"+
        (g.note?"<div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500;margin-bottom:5px'>"+esc(g.note)+"</div>":"")+
        "<div style='display:flex;align-items:center;gap:8px'>"+
          "<div style='flex:1;height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden'><div style='height:100%;width:"+pct+"%;background:"+(done?"#00e5a0":"#7c6aff")+";border-radius:3px'></div></div>"+
          "<div style='font-size:11px;font-weight:700;color:"+(done?"#00e5a0":"rgba(238,240,248,.5)")+";flex-shrink:0'>"+g.current+"/"+g.target+" "+esc(g.unit||"")+"</div>"+
        "</div>"+
      "</div>"+
      "<div style='display:flex;gap:5px;flex-shrink:0'>"+
        "<button onclick='_updGoal(\""+g.id+"\",\""+type+"\","+sidParm+")' class='btn btn-ghost btn-sm'>Update</button>"+
        "<button onclick='_delGoal(\""+g.id+"\",\""+type+"\","+sidParm+")' class='btn btn-danger btn-sm'>✕</button>"+
      "</div>"+
    "</div>"+
    "<div style='font-size:10px;color:rgba(238,240,248,.25);font-weight:500'>"+esc(g.period||"")+(g.deadline?" · Due: "+esc(g.deadline):"")+"</div>"+
  "</div>";
}

function showGoalModal(sid,type,biz,onSave) {
  var sName=sid?(biz.staff.find(function(s){return s.id===sid;})||{}).name||"Staff":"Team";
  showModal(
    "<div class='modal-head'><div class='modal-title'>Add Goal"+(type==="staff"?" for "+esc(sName):" (Team)")+"</div><button class='modal-close' onclick='closeModal()'>×</button></div>"+
    "<div style='display:flex;flex-direction:column;gap:10px'>"+
      "<div><div class='field-lbl'>Goal Title</div><input class='inp' id='g-title' placeholder='e.g. Hit 20 reviews this week'/></div>"+
      "<div><div class='field-lbl'>Note (optional)</div><input class='inp' id='g-note' placeholder='Focus on Google reviews'/></div>"+
      "<div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px'>"+
        "<div><div class='field-lbl'>Target</div><input class='inp' id='g-target' type='number' placeholder='20' min='1'/></div>"+
        "<div><div class='field-lbl'>Current</div><input class='inp' id='g-current' type='number' placeholder='0' value='0' min='0'/></div>"+
        "<div><div class='field-lbl'>Unit</div><input class='inp' id='g-unit' placeholder='reviews'/></div>"+
      "</div>"+
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'>"+
        "<div><div class='field-lbl'>Period</div><select class='sel' id='g-period'><option>This week</option><option>This month</option><option>Ongoing</option></select></div>"+
        "<div><div class='field-lbl'>Deadline</div><input class='inp' id='g-deadline' type='date'/></div>"+
      "</div>"+
      "<button class='btn btn-primary btn-full' onclick='_saveGoal(\""+type+"\",\""+( sid||"")+"\")'>Add Goal</button>"+
    "</div>"
  );
  window._saveGoal=function(type2,sid2){
    var title=(($("g-title")||{}).value||"").trim();
    var target=parseInt(($("g-target")||{}).value)||0;
    if(!title||!target){showToast("Title and target required");return;}
    var goal={id:uid(),title:title,note:(($("g-note")||{}).value||"").trim(),target:target,current:parseInt(($("g-current")||{}).value)||0,unit:(($("g-unit")||{}).value||"").trim(),period:($("g-period")||{}).value||"This week",deadline:(($("g-deadline")||{}).value||"").trim(),createdAt:Date.now()};
    if(type2==="team"){biz.teamGoals=biz.teamGoals||[];biz.teamGoals.push(goal);}
    else{biz.staffGoals=biz.staffGoals||{};if(!biz.staffGoals[sid2])biz.staffGoals[sid2]=[];biz.staffGoals[sid2].push(goal);}
    saveBiz(biz);closeModal();if(onSave)onSave();showToast("Goal added!");
  };
}
window._updGoal=function(gid,type,sid){
  var parts=window.location.pathname.split("/").filter(Boolean);var biz=getBiz(parts[0]);if(!biz)return;
  var goals=type==="team"?biz.teamGoals:(biz.staffGoals&&biz.staffGoals[sid])||[];
  var g=goals.find(function(x){return x.id===gid;});if(!g)return;
  showModal("<div class='modal-head'><div class='modal-title'>Update Progress</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='background:#15171f;border-radius:10px;padding:12px 13px'><div style='font-weight:700;font-size:14px;margin-bottom:2px'>"+esc(g.title)+"</div><div style='font-size:12px;color:rgba(238,240,248,.38)'>Target: "+g.target+" "+esc(g.unit||"")+"</div></div><div><div class='field-lbl'>Current Progress</div><input class='inp' id='upd-cur' type='number' value='"+g.current+"' min='0'/></div><button class='btn btn-primary btn-full' onclick='_saveUpd(\""+gid+"\",\""+type+"\",\""+( sid||"")+"\")'>Save</button></div>");
  window._saveUpd=function(gid2,type2,sid2){
    var cur=parseInt(($("upd-cur")||{}).value)||0;
    if(type2==="team"){biz.teamGoals=biz.teamGoals.map(function(g){return g.id===gid2?Object.assign({},g,{current:cur}):g;});}
    else{biz.staffGoals[sid2]=(biz.staffGoals[sid2]||[]).map(function(g){return g.id===gid2?Object.assign({},g,{current:cur}):g;});}
    saveBiz(biz);closeModal();showToast("Progress updated!");
  };
};
window._delGoal=function(gid,type,sid){
  if(!confirm("Delete this goal?"))return;
  var parts=window.location.pathname.split("/").filter(Boolean);var biz=getBiz(parts[0]);if(!biz)return;
  if(type==="team"){biz.teamGoals=biz.teamGoals.filter(function(g){return g.id!==gid;});}
  else{biz.staffGoals[sid]=(biz.staffGoals[sid]||[]).filter(function(g){return g.id!==gid;});}
  saveBiz(biz);showToast("Goal removed");
};

// ─── BRANDING TAB ──────────────────────────
function renderBrandingTab(body,biz) {
  var b=Object.assign({},DEFAULT_BRAND,biz.brand||{});
  body.innerHTML=
    "<div style='background:#15171f;border-radius:9px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:rgba(238,240,248,.38);line-height:1.6;font-weight:500'>Controls what customers see at <strong style='color:#eef0f8'>tapplus.link/"+esc(biz.slug)+"</strong>. Customers see none of the dashboard.</div>"+
    "<div class='field-lbl'>Business Name</div><input class='inp' id='br-name' value='"+esc(b.name)+"' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Tagline</div><input class='inp' id='br-tag' value='"+esc(b.tagline)+"' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Logo URL (leave blank for business name)</div><input class='inp' id='br-logo' value='"+esc(b.logoUrl)+"' placeholder='https://…' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Rating Question</div><input class='inp' id='br-q' value='"+esc(b.ratingQuestion)+"' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Review Prompt (4-5★)</div><input class='inp' id='br-rp' value='"+esc(b.reviewPrompt)+"' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Thank You Message</div><input class='inp' id='br-ty' value='"+esc(b.thankYouMsg)+"' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Low Rating Message (1-3★)</div><input class='inp' id='br-lr' value='"+esc(b.lowRatingMsg)+"' style='margin-bottom:12px'/>"+
    "<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px'>"+
      "<div><div class='field-lbl'>Brand Color</div><input type='color' id='br-c' value='"+(b.brandColor||"#00e5a0")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
      "<div><div class='field-lbl'>Background</div><input type='color' id='br-bg' value='"+(b.bgColor||"#07080c")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
      "<div><div class='field-lbl'>Text</div><input type='color' id='br-tx' value='"+(b.textColor||"#ffffff")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
    "</div>"+
    "<div style='display:flex;gap:8px'>"+
      "<button onclick='window.open(\"/"+esc(biz.slug)+"\",\"_blank\")' class='btn btn-ghost btn-full'>👁 Preview</button>"+
      "<button onclick='_saveBranding()' class='btn btn-primary btn-full'>Save Branding</button>"+
    "</div>";

  window._saveBranding=function(){
    biz.brand={name:(($("br-name")||{}).value||"").trim()||b.name,tagline:(($("br-tag")||{}).value||"").trim(),logoUrl:(($("br-logo")||{}).value||"").trim(),ratingQuestion:(($("br-q")||{}).value||"").trim()||DEFAULT_BRAND.ratingQuestion,reviewPrompt:(($("br-rp")||{}).value||"").trim()||DEFAULT_BRAND.reviewPrompt,thankYouMsg:(($("br-ty")||{}).value||"").trim()||DEFAULT_BRAND.thankYouMsg,lowRatingMsg:(($("br-lr")||{}).value||"").trim()||DEFAULT_BRAND.lowRatingMsg,brandColor:($("br-c")||{}).value||"#00e5a0",bgColor:($("br-bg")||{}).value||"#07080c",textColor:($("br-tx")||{}).value||"#ffffff"};
    saveBiz(biz);showToast("Branding saved!");
  };
}

// ─── DEMO DATA ─────────────────────────────
function getDemoTaps(staffId) {
  var t=Date.now(),H=3600000,s=staffId?staffId.charCodeAt(staffId.length-1):1;
  return[
    {ts:t-H*1,rating:5,platform:"google",review:true,feedback:""},
    {ts:t-H*3,rating:4,platform:"yelp",review:true,feedback:""},
    {ts:t-H*6,rating:5,platform:null,review:false,feedback:""},
    {ts:t-H*25,rating:3,platform:null,review:false,feedback:"Food was a bit cold"},
    {ts:t-H*26,rating:5,platform:"google",review:true,feedback:""},
    {ts:t-H*50,rating:4,platform:"google",review:true,feedback:""},
    {ts:t-H*73,rating:2,platform:null,review:false,feedback:"Felt rushed, order wrong"},
    {ts:t-H*98,rating:5,platform:"google",review:true,feedback:""}
  ];
}
function calcStats(taps) {
  var reviews=taps.filter(function(t){return t.review;}).length;
  var ratings=taps.map(function(t){return t.rating;});
  var avg=ratings.length?ratings.reduce(function(a,b){return a+b;},0)/ratings.length:0;
  var wt=taps.filter(function(t){return t.ts>=wsStart();}).length;
  var score=taps.length*10+reviews*15+ratings.filter(function(r){return r===5;}).length*5;
  var pos=taps.filter(function(t){return t.rating>=4;}).length;
  var ctr=pos>0?Math.round((reviews/pos)*100):0;
  var negFb=taps.filter(function(t){return t.feedback&&t.rating<=3;});
  return{count:taps.length,reviews:reviews,avg:avg,avgStr:avg?avg.toFixed(1):"—",weekTaps:wt,score:score,ctr:ctr,negFb:negFb};
}

// ─── INIT ──────────────────────────────────
window.addEventListener("popstate",route);
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",route);
else route();
// TAP+ MULTI-TENANT PLATFORM
// Routes: /              → super-admin
//         /[slug]        → customer tap page
//         /[slug]/tap/[id] → staff-specific tap
//         /[slug]/dashboard → business dashboard
// ═══════════════════════════════════════════

// ─── STORAGE ───────────────────────────────
const LS = {
  get:(k,d)=>{ try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch{return d;}},
  set:(k,v)=>{ try{localStorage.setItem(k,JSON.stringify(v));}catch{}},
  del:(k)=>{ try{localStorage.removeItem(k);}catch{}}
};

// ─── CONSTANTS ─────────────────────────────
const ADMIN_PIN     = LS.get("tp_admin_pin","0000");
const GROQ_URL      = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL    = "llama-3.3-70b-versatile";
const COLORS        = ["#00e5a0","#7c6aff","#ff6b35","#ffd166","#ff4455","#38bdf8","#f472b6","#a3e635"];

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
const DEFAULT_STAFF = [
  {id:"s1",name:"Staff Member",color:"#00e5a0",passcode:"1234",active:true}
];

// ─── HELPERS ───────────────────────────────
const $    = id => document.getElementById(id);
const uid  = () => Math.random().toString(36).slice(2,11);
const ini  = n => n.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
const esc  = s => (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const fmt  = ts => {
  const d=new Date(ts);
  return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})+", "+d.toLocaleDateString([],{month:"short",day:"numeric"});
};
const wsStart = () => {
  const d=new Date();d.setHours(0,0,0,0);d.setDate(d.getDate()-d.getDay());return d.getTime();
};

// ─── MULTI-TENANT STATE ─────────────────────
// Businesses stored as: tp_biz_[slug] = { name, slug, brand, links, staff, mgrPin, teamGoals, staffGoals }
// Super-admin state:    tp_businesses = ["slug1","slug2",...]
// Firebase config:      tp_fb = { apiKey, projectId, appId }
// Groq key:             tp_key
// Admin PIN:            tp_admin_pin

function getBizList() { return LS.get("tp_businesses",[]); }
function getBiz(sl) {
  var stored = LS.get("tp_biz_"+sl, null);
  if (!stored) return null;
  return Object.assign({ brand:DEFAULT_BRAND, links:DEFAULT_LINKS, staff:DEFAULT_STAFF, mgrPin:"1234", teamGoals:[], staffGoals:{} }, stored);
}
function saveBiz(biz) {
  LS.set("tp_biz_"+biz.slug, biz);
  var list = getBizList();
  if (list.indexOf(biz.slug) === -1) { list.push(biz.slug); LS.set("tp_businesses", list); }
}
function deleteBiz(sl) {
  LS.del("tp_biz_"+sl);
  var list = getBizList().filter(function(s){return s!==sl;});
  LS.set("tp_businesses",list);
}
function getApiKey() { return LS.get("tp_key",""); }
function getAdminPin() { return LS.get("tp_admin_pin","0000"); }

// ─── FIREBASE ──────────────────────────────
function getFbCfg() {
  try { var r=LS.get("tp_fb",""); return r ? (typeof r==="string"?JSON.parse(r):r) : null; } catch{return null;}
}
function fbUrl(cfg,col,docId) {
  var base="https://firestore.googleapis.com/v1/projects/"+cfg.projectId+"/databases/(default)/documents/";
  return docId ? base+col+"/"+docId : base+col;
}
function toFsVal(v) {
  if(v===null||v===undefined) return {nullValue:null};
  if(typeof v==="boolean") return {booleanValue:v};
  if(typeof v==="number") return {integerValue:String(Math.round(v))};
  if(typeof v==="string") return {stringValue:v};
  if(Array.isArray(v)) return {arrayValue:{values:v.map(toFsVal)}};
  if(typeof v==="object"){var f={};Object.keys(v).forEach(function(k){f[k]=toFsVal(v[k]);});return {mapValue:{fields:f}};}
  return {stringValue:String(v)};
}
function toFsDoc(data) {
  var f={};Object.keys(data).forEach(function(k){f[k]=toFsVal(data[k]);});return {fields:f};
}
async function fbWrite(col,docId,data) {
  var cfg=getFbCfg(); if(!cfg) return;
  try {
    await fetch(fbUrl(cfg,col,docId),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(toFsDoc(data))});
  } catch(e){console.warn("Firebase write error:",e);}
}
async function fbQuery(col,filters) {
  var cfg=getFbCfg(); if(!cfg) return [];
  try {
    var url="https://firestore.googleapis.com/v1/projects/"+cfg.projectId+"/databases/(default)/documents:runQuery";
    var q={structuredQuery:{from:[{collectionId:col}],orderBy:[{field:{fieldPath:"ts"},direction:"DESCENDING"}],limit:200}};
    if(filters&&filters.length) q.structuredQuery.where=filters.length===1?filters[0]:{compositeFilter:{op:"AND",filters:filters}};
    var r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(q)});
    var d=await r.json();
    if(!Array.isArray(d)) return [];
    return d.filter(function(x){return x.document;}).map(function(x){
      var f=x.document.fields||{};
      var out={};
      Object.keys(f).forEach(function(k){
        var v=f[k];
        if(v.stringValue!==undefined) out[k]=v.stringValue;
        else if(v.integerValue!==undefined) out[k]=parseInt(v.integerValue);
        else if(v.booleanValue!==undefined) out[k]=v.booleanValue;
        else if(v.nullValue!==undefined) out[k]=null;
        else out[k]=v;
      });
      return out;
    });
  } catch(e){console.warn("Firebase query error:",e);return [];}
}
function fsFilter(field,op,val) {
  return {fieldFilter:{field:{fieldPath:field},op:op,value:toFsVal(val)}};
}
async function saveTap(tapData) {
  await fbWrite("taps",tapData.id,tapData);
}

// ─── GROQ AI ───────────────────────────────
async function callGroq(prompt,key) {
  var sys="You are Tap+ AI, a restaurant performance analyst. Use **bold**, ## headings, - bullets. Be specific and concise. Never invent data.";
  var r=await fetch(GROQ_URL,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
    body:JSON.stringify({model:GROQ_MODEL,messages:[{role:"system",content:sys},{role:"user",content:prompt}],max_tokens:900,temperature:0.7})});
  if(!r.ok){var e=await r.json().catch(()=>({}));throw new Error(r.status===401?"INVALID_KEY":e?.error?.message||"API error");}
  var d=await r.json();return d.choices?.[0]?.message?.content||"";
}
var _aiCache={};
function renderAIBlock(id,prompt,ckey,msg) {
  var el=$(id); if(!el) return;
  var key=getApiKey();
  if(!key){el.innerHTML="<div class='ai-nokey'>⚠️ No API key — set it in super-admin.</div>";return;}
  var k=ckey||prompt.slice(0,80);
  if(_aiCache[k]){el.innerHTML=aiOut(_aiCache[k],k);return;}
  el.innerHTML="<div class='ai-loading'><div class='ai-spinner'></div>"+esc(msg||"Analyzing…")+"</div>";
  callGroq(prompt,key).then(function(t){_aiCache[k]=t;el.innerHTML=aiOut(t,k);})
    .catch(function(e){el.innerHTML="<div class='ai-err'>"+(e.message==="INVALID_KEY"?"❌ Invalid key":"❌ "+esc(e.message))+"</div>";});
}
function aiOut(text,k) {
  return "<div class='ai-out'><div class='ai-out-lbl'><span class='ai-mini-dot'></span> AI Analysis</div><div class='ai-out-text'>"+mdRender(text)+"</div><button class='ai-refresh' onclick='delete _aiCache[\""+k+"\"];renderAIBlock.apply(null,window._lastAI&&window._lastAI[\""+k+"\"]||[])'>↻</button></div>";
}
function mdRender(text) {
  return (text||"").split("\n").map(function(line){
    var bold=function(s){return s.replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>");};
    if(line.startsWith("## ")) return "<div style='font-weight:800;font-size:14px;margin:13px 0 6px;color:#eef0f8'>"+esc(line.slice(3))+"</div>";
    if(line.startsWith("- ")) return "<div style='display:flex;gap:7px;margin-bottom:5px'><span style='color:#a78bfa'>›</span><span>"+bold(esc(line.slice(2)))+"</span></div>";
    if(!line) return "<br/>";
    return "<div>"+bold(esc(line))+"</div>";
  }).join("");
}

// ─── MODAL / TOAST ─────────────────────────
var _modal=null;
function showModal(html) {
  if(_modal)_modal.remove();
  _modal=document.createElement("div");_modal.className="modal-overlay";
  _modal.innerHTML="<div class='modal'>"+html+"</div>";
  _modal.addEventListener("click",function(e){if(e.target===_modal)closeModal();});
  document.body.appendChild(_modal);
}
window.closeModal=function(){if(_modal){_modal.remove();_modal=null;}};
var _toastT;
function showToast(msg) {
  var t=$("toast-el");
  if(!t){t=document.createElement("div");t.id="toast-el";
    t.style.cssText="position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(60px);background:#0e0f15;border:1px solid rgba(167,139,250,.35);border-radius:100px;padding:10px 20px;font-size:13px;font-weight:600;transition:transform .35s cubic-bezier(.34,1.56,.64,1);z-index:9999;white-space:nowrap;color:#eef0f8;font-family:inherit";
    document.body.appendChild(t);}
  t.textContent=msg;t.style.transform="translateX(-50%) translateY(0)";
  clearTimeout(_toastT);_toastT=setTimeout(function(){t.style.transform="translateX(-50%) translateY(60px)";},2500);
}

// ─── PIN PAD ───────────────────────────────
function renderPinPad(containerId,title,sub,hint,dotColor,onSuccess,onBack) {
  var el=$(containerId); if(!el) return;
  var val="";
  function update() {
    var dots=el.querySelectorAll(".pin-dot");
    dots.forEach(function(d,i){d.style.background=i<val.length?dotColor:"transparent";d.style.borderColor=i<val.length?dotColor:"rgba(255,255,255,.15)";});
    el.querySelector(".pin-err").textContent="";
  }
  el.innerHTML=
    "<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;padding:40px 20px;text-align:center;position:relative'>" +
    (onBack?"<button onclick='"+onBack+"' style='position:absolute;top:16px;left:16px;background:none;border:none;color:rgba(238,240,248,.4);font-size:22px;cursor:pointer'>←</button>":"") +
    "<div style='font-size:20px;font-weight:800;margin-bottom:5px;letter-spacing:-.02em'>"+esc(title)+"</div>"+
    "<div style='font-size:13px;color:rgba(238,240,248,.4);margin-bottom:26px;font-weight:500'>"+esc(sub)+"</div>"+
    "<div style='display:flex;gap:11px;justify-content:center;margin-bottom:22px'>"+
      [0,1,2,3].map(function(i){return "<div class='pin-dot' style='width:13px;height:13px;border-radius:50%;border:2px solid rgba(255,255,255,.15);transition:all .18s'></div>";}).join("")+
    "</div>"+
    "<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:9px;max-width:210px'>"+
      ["1","2","3","4","5","6","7","8","9","C","0","⌫"].map(function(k){
        return "<div class='pin-key' style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:13px;padding:16px;font-size:19px;font-weight:700;cursor:pointer;text-align:center;user-select:none;-webkit-user-select:none;transition:background .1s' onclick='_pinTap(\""+k+"\")'>"+k+"</div>";
      }).join("")+
    "</div>"+
    "<div class='pin-err' style='color:#ff4455;font-size:13px;margin-top:11px;min-height:18px;font-weight:500'></div>"+
    (hint?"<div style='font-size:11px;color:rgba(238,240,248,.18);margin-top:14px;font-weight:500'>"+esc(hint)+"</div>":"")+
    "</div>";

  window._pinTap=function(k) {
    if(k==="C") val="";
    else if(k==="⌫") val=val.slice(0,-1);
    else if(val.length<4) val+=k;
    update();
    if(val.length===4) {
      var v=val; val=""; update();
      setTimeout(function(){
        if(!onSuccess(v)) {
          el.querySelector(".pin-err").textContent="Incorrect. Try again.";
        }
      },180);
    }
  };
}

// ═══════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════
function route() {
  var path=window.location.pathname.replace(/\/+$/,"");
  var app=document.getElementById("app"); if(!app) return;

  // / → super-admin
  if(path===""||path==="/") { renderSuperAdmin(app); return; }

  var parts=path.split("/").filter(Boolean); // ["slug"] or ["slug","dashboard"] or ["slug","tap","s1"]
  var bizSlug=parts[0];
  var biz=getBiz(bizSlug);

  // /[slug]/dashboard → business dashboard
  if(parts[1]==="dashboard") {
    if(!biz) { app.innerHTML=notFound(); return; }
    renderBizDash(app,biz);
    return;
  }

  // /[slug]/tap/[staff-id] or /[slug] → customer page
  var staffId = (parts[1]==="tap"&&parts[2]) ? parts[2] : null;
  var isCustomer = parts[1]==="tap" || parts.length===1;
  if(isCustomer) {
    if(!biz) { app.innerHTML=notFound(); return; }
    renderCustomerPage(app,biz,staffId);
    return;
  }

  app.innerHTML=notFound();
}

function notFound() {
  return "<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px;color:#eef0f8'><div style='font-size:44px;margin-bottom:14px'>🤔</div><div style='font-weight:800;font-size:20px;margin-bottom:8px'>Page not found</div><div style='font-size:13px;color:rgba(238,240,248,.4)'>Check the URL and try again.</div></div>";
}

// ═══════════════════════════════════════════
// SUPER-ADMIN
// ═══════════════════════════════════════════
function renderSuperAdmin(app) {
  app.innerHTML="<div id='sa-root' style='min-height:100vh'></div>";
  var el=$("sa-root");

  // Check if authenticated
  if(!sessionStorage.getItem("sa_auth")) {
    el.innerHTML="<div id='sa-pin'></div>";
    renderPinPad("sa-pin","Super Admin","Enter your PIN","Default: 0000","#a78bfa",function(v){
      if(v===getAdminPin()){sessionStorage.setItem("sa_auth","1");renderSAPanel(el);return true;}return false;
    },null);
    return;
  }
  renderSAPanel(el);
}

function renderSAPanel(el) {
  var bizList=getBizList();
  var apiKey=getApiKey();
  var fbCfg=getFbCfg();

  el.innerHTML=
    "<div style='max-width:520px;margin:0 auto;padding:24px 18px'>" +
    // Header
    "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:28px'>" +
      "<div><div style='font-weight:900;font-size:22px;letter-spacing:-.03em'>Tap<span style='color:#00e5a0'>+</span> Admin</div><div style='font-size:12px;color:rgba(238,240,248,.38);margin-top:2px;font-weight:500'>Super Admin Panel</div></div>" +
      "<button onclick='sessionStorage.removeItem(\"sa_auth\");route()' style='background:rgba(255,68,85,.08);border:1px solid rgba(255,68,85,.2);border-radius:9px;padding:7px 13px;font-size:12px;color:#ff4455;cursor:pointer;font-family:inherit;font-weight:600'>Sign Out</button>" +
    "</div>" +

    // Businesses
    "<div class='sec-lbl'>Businesses ("+bizList.length+")</div>" +
    (bizList.length===0
      ? "<div style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:20px;text-align:center;font-size:13px;color:rgba(238,240,248,.38);margin-bottom:12px'>No businesses yet. Add one below.</div>"
      : bizList.map(function(sl){
          var b=getBiz(sl);
          if(!b) return "";
          var brandColor=b.brand&&b.brand.brandColor?b.brand.brandColor:"#00e5a0";
          return "<div style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:14px 16px;margin-bottom:10px'>" +
            "<div style='display:flex;align-items:center;gap:12px'>" +
              "<div style='width:36px;height:36px;border-radius:10px;background:"+brandColor+"22;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;color:"+brandColor+";flex-shrink:0'>"+ini(b.name)+"</div>" +
              "<div style='flex:1'>" +
                "<div style='font-weight:700;font-size:14px'>"+esc(b.name)+"</div>" +
                "<div style='font-size:11px;color:rgba(238,240,248,.38);margin-top:2px;font-weight:500'>tapplus.link/"+esc(sl)+" · "+b.staff.filter(function(s){return s.active;}).length+" staff</div>" +
              "</div>" +
              "<div style='display:flex;gap:6px'>" +
                "<button onclick='window.open(\"/"+sl+"\",\"_blank\")' style='background:rgba(0,229,160,.08);border:1px solid rgba(0,229,160,.2);border-radius:8px;padding:5px 10px;font-size:11px;color:#00e5a0;cursor:pointer;font-weight:700;font-family:inherit'>👁 Page</button>" +
                "<button onclick='window.location.href=\"/"+sl+"/dashboard\"' style='background:#15171f;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:5px 10px;font-size:11px;color:rgba(238,240,248,.6);cursor:pointer;font-weight:600;font-family:inherit'>Dashboard</button>" +
                "<button onclick='saEditBiz(\""+sl+"\")' style='background:#15171f;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:5px 10px;font-size:11px;color:rgba(238,240,248,.6);cursor:pointer;font-weight:600;font-family:inherit'>✏</button>" +
                "<button onclick='saDeleteBiz(\""+sl+"\")' style='background:rgba(255,68,85,.08);border:1px solid rgba(255,68,85,.2);border-radius:8px;padding:5px 10px;font-size:11px;color:#ff4455;cursor:pointer;font-weight:600;font-family:inherit'>✕</button>" +
              "</div>" +
            "</div>" +
          "</div>";
        }).join("")
    ) +
    "<button onclick='saAddBiz()' style='width:100%;padding:13px;background:#00e5a0;color:#07080c;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;margin-bottom:24px'>+ Add Business</button>" +

    // Settings
    "<div class='sec-lbl'>Platform Settings</div>" +
    "<div style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px;margin-bottom:10px'>" +
      "<div style='font-weight:700;font-size:13px;margin-bottom:10px'>Groq AI Key</div>" +
      "<div style='display:flex;gap:8px'>" +
        "<input id='sa-groq' class='inp' type='password' placeholder='gsk_…' value='"+(apiKey?"•".repeat(20):"")+"' style='flex:1'/>" +
        "<button onclick='saSaveGroq()' style='background:#a78bfa;color:#07080c;border:none;border-radius:10px;padding:0 16px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;flex-shrink:0'>Save</button>" +
      "</div>" +
      (apiKey?"<div style='font-size:11px;color:#00e5a0;margin-top:6px;font-weight:600'>✓ Connected</div>":"") +
    "</div>" +
    "<div style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px;margin-bottom:10px'>" +
      "<div style='font-weight:700;font-size:13px;margin-bottom:4px'>Firebase Config</div>" +
      "<div style='font-size:12px;color:rgba(238,240,248,.38);margin-bottom:10px;font-weight:500'>Stores real tap data from customer pages</div>" +
      "<div class='field-lbl'>API Key</div><input id='fb-ak' class='inp' placeholder='AIzaSy…' value='"+esc(fbCfg?fbCfg.apiKey:"")+"' style='margin-bottom:7px'/>" +
      "<div class='field-lbl'>Project ID</div><input id='fb-pid' class='inp' placeholder='tapplus-xyz' value='"+esc(fbCfg?fbCfg.projectId:"")+"' style='margin-bottom:7px'/>" +
      "<div class='field-lbl'>App ID</div><input id='fb-aid' class='inp' placeholder='1:123:web:abc' value='"+esc(fbCfg?fbCfg.appId:"")+"' style='margin-bottom:10px'/>" +
      "<button onclick='saSaveFb()' style='width:100%;padding:11px;background:#15171f;border:1px solid rgba(255,255,255,.1);border-radius:10px;font-size:13px;font-weight:700;color:rgba(238,240,248,.8);cursor:pointer;font-family:inherit'>"+( fbCfg?"✓ Update Firebase Config":"Save Firebase Config")+"</button>" +
    "</div>" +
    "<div style='background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:16px'>" +
      "<div style='font-weight:700;font-size:13px;margin-bottom:10px'>Admin PIN</div>" +
      "<div style='display:flex;gap:8px'>" +
        "<input id='sa-pin-new' class='inp' type='tel' maxlength='4' placeholder='New PIN' style='flex:1'/>" +
        "<button onclick='saSavePin()' style='background:#15171f;border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:0 16px;font-size:13px;font-weight:700;color:rgba(238,240,248,.8);cursor:pointer;font-family:inherit;flex-shrink:0'>Update</button>" +
      "</div>" +
    "</div>" +
    "</div>";
}

window.saSaveGroq=function(){
  var k=($("sa-groq")||{}).value||"";
  if(k&&!k.startsWith("•")){ LS.set("tp_key",k); showToast("API key saved!"); renderSAPanel($("sa-root")); }
  else showToast("Enter a valid key starting with gsk_");
};
window.saSaveFb=function(){
  var ak=($("fb-ak")||{}).value||"",pid=($("fb-pid")||{}).value||"",aid=($("fb-aid")||{}).value||"";
  if(!ak||!pid||!aid){showToast("Fill in all three fields");return;}
  LS.set("tp_fb",JSON.stringify({apiKey:ak,projectId:pid,appId:aid}));
  showToast("Firebase config saved!"); renderSAPanel($("sa-root"));
};
window.saSavePin=function(){
  var p=($("sa-pin-new")||{}).value||"";
  if(!/^\d{4}$/.test(p)){showToast("PIN must be 4 digits");return;}
  LS.set("tp_admin_pin",p); showToast("Admin PIN updated!"); renderSAPanel($("sa-root"));
};
window.saDeleteBiz=function(sl){
  if(!confirm("Delete "+sl+"? This cannot be undone."))return;
  deleteBiz(sl); renderSAPanel($("sa-root")); showToast("Business removed");
};

window.saAddBiz=function(){
  showModal(
    "<div class='modal-head'><div class='modal-title'>Add Business</div><button class='modal-close' onclick='closeModal()'>×</button></div>"+
    "<div style='display:flex;flex-direction:column;gap:11px'>"+
      "<div><div class='field-lbl'>Business Name</div><input class='inp' id='nb-name' placeholder=\"e.g. Noah's Bagels\"/></div>"+
      "<div><div class='field-lbl'>URL Slug (auto-generated, editable)</div><input class='inp' id='nb-slug' placeholder='noahs-bagels'/></div>"+
      "<div><div class='field-lbl'>Manager PIN (4 digits)</div><input class='inp' id='nb-mpin' type='tel' maxlength='4' placeholder='e.g. 5678'/></div>"+
      "<div id='nb-err' style='color:#ff4455;font-size:12px;font-weight:500;min-height:14px'></div>"+
      "<button class='btn btn-primary btn-full' onclick='saveNewBiz()'>Create Business</button>"+
    "</div>"
  );
  // Auto-generate slug as user types name
  var nameInp=$("nb-name"),slugInp=$("nb-slug");
  if(nameInp&&slugInp) nameInp.addEventListener("input",function(){slugInp.value=slug(nameInp.value);});
};
window.saveNewBiz=function(){
  var name=(($("nb-name")||{}).value||"").trim();
  var sl=slug(($("nb-slug")||{}).value||name);
  var mpin=(($("nb-mpin")||{}).value||"").trim();
  var err=$("nb-err");
  if(!name){if(err)err.textContent="Business name required";return;}
  if(!sl){if(err)err.textContent="Slug required";return;}
  if(getBiz(sl)){if(err)err.textContent="Slug already in use";return;}
  if(!/^\d{4}$/.test(mpin)){if(err)err.textContent="Manager PIN must be 4 digits";return;}
  var biz={ name:name, slug:sl, mgrPin:mpin, brand:Object.assign({},DEFAULT_BRAND,{name:name}), links:JSON.parse(JSON.stringify(DEFAULT_LINKS)), staff:JSON.parse(JSON.stringify(DEFAULT_STAFF)), teamGoals:[], staffGoals:{} };
  saveBiz(biz); closeModal(); renderSAPanel($("sa-root")); showToast("Business created!");
};

window.saEditBiz=function(sl){
  var biz=getBiz(sl); if(!biz) return;
  var b=Object.assign({},DEFAULT_BRAND,biz.brand||{});
  showModal(
    "<div class='modal-head'><div class='modal-title'>Edit: "+esc(biz.name)+"</div><button class='modal-close' onclick='closeModal()'>×</button></div>"+
    "<div style='display:flex;flex-direction:column;gap:11px'>"+
      "<div class='sec-lbl' style='margin-bottom:0'>Branding</div>"+
      "<div><div class='field-lbl'>Business Name</div><input class='inp' id='eb-name' value='"+esc(b.name)+"'/></div>"+
      "<div><div class='field-lbl'>Tagline</div><input class='inp' id='eb-tagline' value='"+esc(b.tagline)+"'/></div>"+
      "<div><div class='field-lbl'>Logo URL</div><input class='inp' id='eb-logo' value='"+esc(b.logoUrl)+"' placeholder='https://…'/></div>"+
      "<div><div class='field-lbl'>Rating Question</div><input class='inp' id='eb-question' value='"+esc(b.ratingQuestion)+"'/></div>"+
      "<div><div class='field-lbl'>Review Prompt (4-5★)</div><input class='inp' id='eb-reviewprompt' value='"+esc(b.reviewPrompt)+"'/></div>"+
      "<div><div class='field-lbl'>Thank You Message</div><input class='inp' id='eb-thanks' value='"+esc(b.thankYouMsg)+"'/></div>"+
      "<div><div class='field-lbl'>Low Rating Message (1-3★)</div><input class='inp' id='eb-lowmsg' value='"+esc(b.lowRatingMsg)+"'/></div>"+
      "<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px'>"+
        "<div><div class='field-lbl'>Brand Color</div><input type='color' id='eb-color' value='"+(b.brandColor||"#00e5a0")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
        "<div><div class='field-lbl'>Background</div><input type='color' id='eb-bg' value='"+(b.bgColor||"#07080c")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
        "<div><div class='field-lbl'>Text</div><input type='color' id='eb-text' value='"+(b.textColor||"#ffffff")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
      "</div>"+
      "<div class='sec-lbl' style='margin-top:4px;margin-bottom:0'>Manager PIN</div>"+
      "<div><div class='field-lbl'>Current: "+biz.mgrPin+"</div><input class='inp' id='eb-mpin' type='tel' maxlength='4' placeholder='New PIN (leave blank to keep)'/></div>"+
      "<button class='btn btn-primary btn-full' onclick='saveEditBiz(\""+sl+"\")'>Save Changes</button>"+
    "</div>"
  );
};
window.saveEditBiz=function(sl){
  var biz=getBiz(sl); if(!biz) return;
  biz.brand={
    name:(($("eb-name")||{}).value||"").trim()||biz.brand.name,
    tagline:(($("eb-tagline")||{}).value||"").trim(),
    logoUrl:(($("eb-logo")||{}).value||"").trim(),
    ratingQuestion:(($("eb-question")||{}).value||"").trim()||DEFAULT_BRAND.ratingQuestion,
    reviewPrompt:(($("eb-reviewprompt")||{}).value||"").trim()||DEFAULT_BRAND.reviewPrompt,
    thankYouMsg:(($("eb-thanks")||{}).value||"").trim()||DEFAULT_BRAND.thankYouMsg,
    lowRatingMsg:(($("eb-lowmsg")||{}).value||"").trim()||DEFAULT_BRAND.lowRatingMsg,
    brandColor:($("eb-color")||{}).value||"#00e5a0",
    bgColor:($("eb-bg")||{}).value||"#07080c",
    textColor:($("eb-text")||{}).value||"#ffffff"
  };
  var newPin=(($("eb-mpin")||{}).value||"").trim();
  if(/^\d{4}$/.test(newPin)) biz.mgrPin=newPin;
  saveBiz(biz); closeModal(); renderSAPanel($("sa-root")); showToast("Saved!");
};

// ═══════════════════════════════════════════
// CUSTOMER PAGE
// ═══════════════════════════════════════════
function renderCustomerPage(app,biz,staffId) {
  var b=Object.assign({},DEFAULT_BRAND,biz.brand||{});
  var activeLinks=biz.links.filter(function(l){return l.active;});
  var firstLink=activeLinks[0]||null;
  var staffRec=staffId?biz.staff.find(function(s){return s.id===staffId;}):null;
  var staffName=staffRec?staffRec.name:"General";
  var rating=0;

  // Apply brand colors to whole page
  document.body.style.background=b.bgColor;
  document.body.style.backgroundImage="none";

  function draw() {
    var logoHTML=b.logoUrl
      ?"<img src='"+esc(b.logoUrl)+"' alt='"+esc(b.name)+"' style='height:68px;max-width:220px;object-fit:contain;margin-bottom:20px;border-radius:10px'/>"
      :"<div style='font-weight:900;font-size:28px;letter-spacing:-.03em;color:"+b.textColor+";margin-bottom:20px'>"+esc(b.name)+"</div>";

    app.innerHTML=
      "<div style='position:fixed;top:0;left:0;right:0;text-align:center;padding:9px;font-size:9px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgba(255,255,255,.16);z-index:100;pointer-events:none'>POWERED BY TAP+</div>"+
      "<div style='position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;width:100%;max-width:400px;margin:0 auto;padding:52px 24px 40px;text-align:center'>"+
        logoHTML+
        (b.tagline?"<div style='font-size:13px;font-weight:500;color:"+b.textColor+";opacity:.5;margin-bottom:30px;line-height:1.55'>"+esc(b.tagline)+"</div>":"<div style='margin-bottom:24px'></div>")+
        "<div style='font-size:19px;font-weight:800;color:"+b.textColor+";margin-bottom:6px;letter-spacing:-.02em'>"+esc(b.ratingQuestion)+"</div>"+
        "<div style='font-size:12px;color:"+b.textColor+";opacity:.35;margin-bottom:22px;font-weight:500'>Tap a star below</div>"+
        "<div style='display:flex;gap:10px;justify-content:center;margin-bottom:20px'>"+
          [1,2,3,4,5].map(function(i){return "<div id='cstar-"+i+"' onclick='_cStar("+i+")' style='font-size:44px;cursor:pointer;filter:brightness(.22);transition:filter .12s,transform .12s;-webkit-user-select:none;user-select:none'>⭐</div>";}).join("")+
        "</div>"+
        "<div id='cust-after' style='width:100%'></div>"+
      "</div>"+
      "<div style='position:fixed;bottom:10px;left:0;right:0;text-align:center;font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.1);pointer-events:none'>TAP+</div>";

    window._cStar=function(r) {
      rating=r;
      for(var i=1;i<=5;i++){var s=$("cstar-"+i);if(s){s.style.filter=i<=r?"brightness(1)":"brightness(.22)";s.style.transform=i<=r?"scale(1.12)":"scale(1)";}}
      var after=$("cust-after"); if(!after) return;

      if(r===5&&firstLink) {
        // Auto-redirect immediately
        var tap={id:uid(),ts:Date.now(),bizSlug:biz.slug,staffId:staffId||"general",staffName:staffName,rating:r,platform:firstLink.label,review:true,feedback:"",redirected:true};
        saveTap(tap);
        after.innerHTML="<div style='animation:up .25s ease;text-align:center;padding:8px 0'><div style='font-size:38px;margin-bottom:10px'>🙏</div><div style='font-weight:800;font-size:18px;color:"+b.textColor+";margin-bottom:6px'>Thank you!</div><div style='font-size:13px;color:"+b.textColor+";opacity:.45;font-weight:500'>Taking you to leave a review…</div></div>";
        setTimeout(function(){window.location.href=firstLink.url;},1100);

      } else if(r>=4&&activeLinks.length>0) {
        // Show all links
        saveTap({id:uid(),ts:Date.now(),bizSlug:biz.slug,staffId:staffId||"general",staffName:staffName,rating:r,platform:null,review:false,feedback:"",redirected:false});
        after.innerHTML=
          "<div style='font-size:13px;font-weight:600;color:"+b.textColor+";opacity:.55;margin-bottom:12px'>"+esc(b.reviewPrompt)+"</div>"+
          activeLinks.map(function(link){
            return "<a href='"+esc(link.url)+"' target='_blank' rel='noreferrer' style='display:flex;align-items:center;gap:13px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.11);border-radius:14px;padding:15px 17px;text-decoration:none;margin-bottom:9px;text-align:left'>"+
              "<span style='font-size:24px'>"+link.icon+"</span>"+
              "<div style='flex:1'><div style='font-weight:700;font-size:14px;color:"+b.textColor+"'>Review on "+esc(link.label)+"</div><div style='font-size:11px;color:"+b.textColor+";opacity:.38;margin-top:2px'>Tap to open</div></div>"+
              "<span style='color:"+b.textColor+";opacity:.3;font-size:16px'>→</span></a>";
          }).join("")+
          "<button onclick='_cDone()' style='width:100%;margin-top:4px;padding:14px;background:"+b.brandColor+";color:#07080c;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit'>Done ✓</button>";

      } else if(r>0) {
        // Private feedback
        after.innerHTML=
          "<div style='font-size:13px;font-weight:600;color:"+b.textColor+";opacity:.55;margin-bottom:12px'>"+esc(b.lowRatingMsg)+"</div>"+
          "<textarea id='cust-fb' placeholder='What happened? (optional)' rows='4' style='width:100%;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px 13px;color:"+b.textColor+";font-size:14px;resize:none;outline:none;font-family:inherit;line-height:1.5'></textarea>"+
          "<button onclick='_cSubmit()' style='width:100%;margin-top:10px;padding:14px;background:"+b.brandColor+";color:#07080c;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit'>Submit</button>";
      }
    };

    window._cDone=function(){
      app.innerHTML=thankYouScreen(b);
    };
    window._cSubmit=function(){
      var fb=($("cust-fb")||{}).value||"";
      saveTap({id:uid(),ts:Date.now(),bizSlug:biz.slug,staffId:staffId||"general",staffName:staffName,rating:rating,platform:null,review:false,feedback:fb,redirected:false});
      app.innerHTML=thankYouScreen(b);
    };
  }
  draw();
}

function thankYouScreen(b) {
  return "<div style='display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px;background:"+b.bgColor+";animation:up .3s ease'>"+
    "<div style='font-size:52px;margin-bottom:16px'>🙏</div>"+
    "<div style='font-weight:900;font-size:22px;margin-bottom:10px;color:"+b.textColor+";letter-spacing:-.03em'>"+esc(b.thankYouMsg)+"</div>"+
    "<div style='font-size:13px;color:"+b.textColor+";opacity:.4;max-width:260px;line-height:1.65;font-weight:500'>Your feedback helps us improve.</div>"+
    "<div style='position:fixed;bottom:12px;left:0;right:0;text-align:center;font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.14)'>POWERED BY TAP+</div>"+
  "</div>";
}

// ═══════════════════════════════════════════
// BUSINESS DASHBOARD
// ═══════════════════════════════════════════
function renderBizDash(app,biz) {
  app.innerHTML="<div id='biz-root' style='min-height:100vh'></div>";
  var el=$("biz-root");

  if(!sessionStorage.getItem("biz_auth_"+biz.slug)) {
    el.innerHTML="<div id='biz-pin'></div>";
    // Check both staff and manager PINs
    renderPinPad("biz-pin","Welcome to "+biz.name,"Enter your PIN","",biz.brand&&biz.brand.brandColor||"#00e5a0",function(v){
      if(v===biz.mgrPin){sessionStorage.setItem("biz_auth_"+biz.slug,"manager");renderDashPanel(el,biz,"manager");return true;}
      var s=biz.staff.find(function(x){return x.passcode===v&&x.active;});
      if(s){sessionStorage.setItem("biz_auth_"+biz.slug,"staff:"+s.id);renderDashPanel(el,biz,"staff",s);return true;}
      return false;
    },function(){window.location.href="/";});
    return;
  }

  var auth=sessionStorage.getItem("biz_auth_"+biz.slug)||"";
  if(auth==="manager") { renderDashPanel(el,biz,"manager"); }
  else if(auth.startsWith("staff:")) {
    var sid=auth.slice(6);
    var s=biz.staff.find(function(x){return x.id===sid;});
    if(s) renderDashPanel(el,biz,"staff",s); else { sessionStorage.removeItem("biz_auth_"+biz.slug); renderBizDash(app,biz); }
  }
}

function renderDashPanel(el,biz,role,staffMember) {
  var brandColor=biz.brand&&biz.brand.brandColor||"#00e5a0";

  if(role==="manager") {
    renderManagerDash(el,biz);
  } else {
    renderStaffDash(el,biz,staffMember);
  }
}

// ─── STAFF DASHBOARD ───────────────────────
function renderStaffDash(el,biz,s) {
  var brandColor=biz.brand&&biz.brand.brandColor||"#00e5a0";
  var TABS=[{id:"coaching",lbl:"AI Coaching",ai:true},{id:"feedback",lbl:"My Feedback",ai:true},{id:"goals",lbl:"My Goals"},{id:"stats",lbl:"My Stats"}];
  var curTab="coaching";

  function frame() {
    el.innerHTML=
      "<div class='dash-header'>"+
        "<div><div class='dash-name'>"+esc(s.name.split(" ")[0])+"'s Dashboard</div><div class='dash-sub'>"+esc(biz.name)+"</div></div>"+
        "<button onclick='sessionStorage.removeItem(\"biz_auth_\"+\""+biz.slug+"\");renderBizDash($(\"+\"biz-root\"+\"),getBiz(\""+biz.slug+"\"))' class='dash-exit'>← Exit</button>"+
      "</div>"+
      "<div class='dash-tabs' id='staff-tabs'>"+
        TABS.map(function(t,i){return "<button class='dash-tab"+(i===0?" ai active":"")+"' onclick='_sTab(\""+t.id+"\",this)'>"+(t.ai?"<span class='ai-mini-dot'></span> ":"")+esc(t.lbl)+"</button>";}).join("")+
      "</div>"+
      "<div class='dash-body' id='staff-body'></div>";

    window._sTab=function(tab,btn) {
      document.querySelectorAll("#staff-tabs .dash-tab").forEach(function(b){b.classList.remove("active");});
      btn.classList.add("active"); curTab=tab; renderSTab(tab);
    };
    renderSTab("coaching");
  }

  function renderSTab(tab) {
    var body=$("staff-body"); if(!body) return;
    var apiKey=getApiKey();
    var taps=getDemoTaps(s.id);
    var st=calcStats(taps);

    if(tab==="coaching") {
      var p="Coach "+s.name.split(" ")[0]+" directly. Stats: "+st.count+" taps, "+st.reviews+" reviews, "+st.avgStr+"★ avg, "+st.ctr+"% CTR, score "+st.score+". Give 3 coaching tips: genuine compliment, one improvement, motivating close. Under 200 words.";
      body.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>💬</div><div><div class='ai-card-title'>Your AI Coach</div><div class='ai-card-sub'>"+st.count+" taps · "+st.avgStr+"★</div></div></div><div id='ai-coaching'></div></div>";
      renderAIBlock("ai-coaching",p,"sc_"+s.id,"Writing tips…");
    } else if(tab==="feedback") {
      body.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>💭</div><div><div class='ai-card-title'>Customer Feedback</div><div class='ai-card-sub'>"+st.negFb.length+" entries</div></div></div><div id='ai-fb'></div></div>"+
        (st.negFb.length?st.negFb.map(function(t){return "<div class='plain-card'><div style='font-size:12px;margin-bottom:4px'>"+"⭐".repeat(t.rating)+"</div><div style='font-size:13px;color:rgba(238,240,248,.65);font-style:italic'>\""+esc(t.feedback)+"\"</div></div>";}).join(""):"<div style='color:#00e5a0;font-size:13px;font-weight:500;padding:10px 0'>🎉 No negative feedback yet!</div>");
      if(st.negFb.length){var fp="Analyze: "+st.negFb.map(function(t){return t.rating+"★: \""+t.feedback+"\"";}).join("; ")+". Main theme, one action, positive reframe. Under 100 words.";renderAIBlock("ai-fb",fp,"ss_"+s.id,"Analyzing…");}
      else {var el2=$("ai-fb");if(el2)el2.innerHTML="";}
    } else if(tab==="goals") {
      var tGoals=biz.teamGoals||[];var sGoals=biz.staffGoals&&biz.staffGoals[s.id]||[];
      body.innerHTML=
        (tGoals.length?"<div class='sec-lbl'>Team Goals</div>"+tGoals.map(function(g){return staffGoalRow(g,true);}).join(""):"" )+
        (sGoals.length?"<div class='sec-lbl' style='margin-top:14px'>Your Goals</div>"+sGoals.map(function(g){return staffGoalRow(g,false);}).join(""):"")+
        (!tGoals.length&&!sGoals.length?"<div style='text-align:center;padding:40px 20px;color:rgba(238,240,248,.38);font-size:13px;font-weight:500'>🎯<br><br>No goals yet. Your manager will set them here.</div>":"");
    } else {
      body.innerHTML=
        "<div class='stat-grid'>"+
          [[st.count,"Taps",s.color],[st.reviews,"Reviews","#ffd166"],[st.avgStr,"Avg ★","#ff6b35"],[st.ctr+"%","CTR","#7c6aff"],[st.weekTaps,"This Week","#00e5a0"],[st.score,"Score","#ffd166"]].map(function(item){
            return "<div class='stat-box'><div class='stat-val' style='color:"+item[2]+"'>"+item[0]+"</div><div class='stat-lbl'>"+item[1]+"</div></div>";
          }).join("")+
        "</div>"+
        "<div class='sec-lbl'>Recent Taps</div>"+
        taps.slice(0,6).map(function(t){
          return "<div style='display:flex;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.06);gap:9px'>"+
            "<div style='width:6px;height:6px;border-radius:50%;background:"+(t.rating<=3?"#ff4455":"#00e5a0")+";flex-shrink:0;margin-top:4px'></div>"+
            "<div style='flex:1'><div style='font-size:12px;font-weight:600'>"+"⭐".repeat(t.rating)+(t.review?"<span style='font-size:10px;background:rgba(0,229,160,.1);color:#00e5a0;border-radius:5px;padding:1px 6px;margin-left:5px'>REVIEW</span>":"")+"</div>"+
            "<div style='font-size:11px;color:rgba(238,240,248,.38);margin-top:2px;font-weight:500'>"+fmt(t.ts)+"</div></div>"+
          "</div>";
        }).join("");
    }
  }
  frame();
}

function staffGoalRow(g,isTeam) {
  var pct=Math.min(100,g.target>0?Math.round((g.current/g.target)*100):0);
  var done=pct>=100;
  return "<div class='plain-card' style='margin-bottom:9px'>"+
    "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:6px'>"+
      "<div style='font-weight:700;font-size:13px'>"+esc(g.title)+(done?" <span style='font-size:10px;color:#00e5a0;background:rgba(0,229,160,.1);border-radius:5px;padding:1px 6px'>Done ✓</span>":"")+(isTeam?" <span style='font-size:10px;color:#7c6aff;background:rgba(124,106,255,.1);border-radius:5px;padding:1px 6px'>Team</span>":"")+"</div>"+
      "<div style='font-size:12px;font-weight:700;color:"+(done?"#00e5a0":"rgba(238,240,248,.5)")+"'>"+pct+"%</div>"+
    "</div>"+
    "<div style='height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden'><div style='height:100%;width:"+pct+"%;background:"+(done?"#00e5a0":"linear-gradient(90deg,#7c6aff,#a78bfa)")+";border-radius:3px'></div></div>"+
    "<div style='font-size:10px;color:rgba(238,240,248,.28);margin-top:5px;font-weight:500'>"+esc(g.period||"")+" · "+g.current+"/"+g.target+" "+esc(g.unit||"")+"</div>"+
  "</div>";
}

// ─── MANAGER DASHBOARD ─────────────────────
function renderManagerDash(el,biz) {
  var brandColor=biz.brand&&biz.brand.brandColor||"#00e5a0";
  var TABS=[
    {id:"ai",lbl:"AI Insights",ai:true},
    {id:"team",lbl:"Team"},
    {id:"estimator",lbl:"Estimator",ai:true},
    {id:"staff",lbl:"Staff"},
    {id:"links",lbl:"Links"},
    {id:"goals",lbl:"Goals"},
    {id:"branding",lbl:"Branding"}
  ];
  var curTab="ai";
  var activeStaff=biz.staff.filter(function(s){return s.active;});
  var sd=activeStaff.map(function(s){var st=calcStats(getDemoTaps(s.id));return s.name+": "+st.count+" taps, "+st.reviews+" reviews, "+st.avgStr+"★, score "+st.score;}).join("\n");
  var allFb=activeStaff.flatMap(function(s){return calcStats(getDemoTaps(s.id)).negFb.map(function(t){return s.name+"("+t.rating+"★): \""+t.feedback+"\"";});}).join("\n");

  el.innerHTML=
    "<div class='dash-header'>"+
      "<div><div class='dash-name'>"+esc(biz.name)+"</div><div class='dash-sub'>Manager Dashboard · Tap+</div></div>"+
      "<button onclick='sessionStorage.removeItem(\"biz_auth_\"+\""+biz.slug+"\");window.location.reload()' class='dash-exit'>← Exit</button>"+
    "</div>"+
    "<div class='dash-tabs' id='mgr-tabs'>"+
      TABS.map(function(t,i){return "<button class='dash-tab"+(t.ai?" ai":"")+(i===0?" active":"")+"' onclick='_mTab(\""+t.id+"\",this)'>"+(t.ai?"<span class='ai-mini-dot'></span> ":"")+esc(t.lbl)+"</button>";}).join("")+
    "</div>"+
    "<div class='dash-body' id='mgr-body'></div>";

  window._mTab=function(tab,btn){
    document.querySelectorAll("#mgr-tabs .dash-tab").forEach(function(b){b.classList.remove("active");});
    btn.classList.add("active"); curTab=tab; renderMTab(tab);
  };

  function renderMTab(tab) {
    var body=$("mgr-body"); if(!body) return;

    if(tab==="ai") {
      renderAIInsightsTab(body,activeStaff,sd,allFb);
    } else if(tab==="team") {
      renderTeamTab(body,activeStaff,sd);
    } else if(tab==="estimator") {
      renderEstimatorTab(body,activeStaff);
    } else if(tab==="staff") {
      renderStaffMgmtTab(body,biz);
    } else if(tab==="links") {
      renderLinksTab(body,biz);
    } else if(tab==="goals") {
      renderMgrGoalsTab(body,biz);
    } else if(tab==="branding") {
      renderBrandingTab(body,biz);
    }
  }
  renderMTab("ai");
}

// ─── AI INSIGHTS ───────────────────────────
function renderAIInsightsTab(body,activeStaff,sd,allFb) {
  var SUBS=["summary","coaching","feedback","export"];
  var LABELS={summary:"📋 Summary",coaching:"💬 Coaching",feedback:"🔍 Feedback",export:"📄 Export"};
  body.innerHTML=
    "<div id='ai-sub-tabs' style='display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap'>"+
      SUBS.map(function(s,i){return "<button data-sub='"+s+"' onclick='_aiSub(this.dataset.sub)' style='background:"+(i===0?"#a78bfa":"#15171f")+";color:"+(i===0?"#07080c":"rgba(238,240,248,.5)")+";border:1px solid "+(i===0?"#a78bfa":"rgba(255,255,255,.08)")+";border-radius:9px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit'>"+LABELS[s]+"</button>";}).join("")+
    "</div>"+
    "<div id='ai-sub-body'></div>";

  window._aiSub=function(sub) {
    document.querySelectorAll("#ai-sub-tabs button").forEach(function(b){var a=b.dataset.sub===sub;b.style.background=a?"#a78bfa":"#15171f";b.style.color=a?"#07080c":"rgba(238,240,248,.5)";b.style.borderColor=a?"#a78bfa":"rgba(255,255,255,.08)";});
    var el=$("ai-sub-body"); if(!el) return;
    if(sub==="summary"){
      var p="Weekly summary.\nTEAM:\n"+sd+"\nFEEDBACK:\n"+(allFb||"None")+"\nCover: overall, top performer, who needs support, feedback patterns, priority action. Under 280 words.";
      el.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>🧠</div><div><div class='ai-card-title'>Weekly Summary</div></div></div><div id='ai-sum'></div></div>";
      renderAIBlock("ai-sum",p,"mgr_sum","Generating…");
    } else if(sub==="coaching") {
      var first=activeStaff[0];
      el.innerHTML="<div class='pills' id='coach-pills'>"+activeStaff.map(function(s,i){return "<div class='pill"+(i===0?" active":"")+"' onclick='_cStaff(\""+s.id+"\",this)'><div class='pill-av' style='background:"+s.color+"22;color:"+s.color+"'>"+ini(s.name)+"</div>"+s.name.split(" ")[0]+"</div>";}).join("")+"</div><div id='coach-card'></div>";
      if(first) _cStaff(first.id,document.querySelector("#coach-pills .pill"));
    } else if(sub==="feedback") {
      var fbItems=activeStaff.flatMap(function(s){return calcStats(getDemoTaps(s.id)).negFb.map(function(t){return Object.assign({},t,{sName:s.name,sColor:s.color});});}).sort(function(a,b){return b.ts-a.ts;});
      var p2="Analyze feedback:\n"+(allFb||"None")+"\nGive: sentiment, patterns, urgent flags, positive signals. Under 200 words.";
      el.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>🔍</div><div><div class='ai-card-title'>Sentiment Analysis</div></div></div><div id='ai-fb-mgr'></div></div>"+
        (fbItems.length?"<div class='sec-lbl' style='margin-top:4px'>Raw Feedback</div>"+fbItems.map(function(f){return "<div class='plain-card'><div style='font-weight:700;font-size:13px;color:"+f.sColor+"'>"+esc(f.sName)+"</div><div style='font-size:13px;margin:4px 0'>"+"⭐".repeat(f.rating)+"</div><div style='font-size:13px;color:rgba(238,240,248,.65);font-style:italic'>\""+esc(f.feedback)+"\"</div></div>";}).join(""):"<div style='color:#00e5a0;font-size:13px;font-weight:500;margin-top:4px'>No feedback yet.</div>");
      renderAIBlock("ai-fb-mgr",p2,"mgr_fb","Analyzing…");
    } else {
      var p3="Professional weekly report. DATE: "+new Date().toLocaleDateString([],{weekday:"long",year:"numeric",month:"long",day:"numeric"})+"\nTEAM:\n"+sd+"\n## Executive Summary / ## Individual Performance / ## Sentiment / ## Recommendations / ## Next Week Goals.";
      el.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>📄</div><div><div class='ai-card-title'>Full Performance Report</div></div></div><button class='btn btn-ghost btn-sm' style='margin-bottom:6px' onclick='window.print()'>🖨 Print</button><div id='ai-report'></div></div>";
      renderAIBlock("ai-report",p3,"mgr_report","Writing…");
    }
  };
  _aiSub("summary");
}
window._cStaff=function(sid,pill) {
  document.querySelectorAll(".pill").forEach(function(p){p.classList.remove("active");});
  if(pill)pill.classList.add("active");
  // Find biz from current context
  var parts=window.location.pathname.split("/").filter(Boolean);
  var biz=getBiz(parts[0]);
  if(!biz) return;
  var s=biz.staff.find(function(x){return x.id===sid;});
  if(!s) return;
  var st=calcStats(getDemoTaps(s.id));
  var ctx=biz.staff.filter(function(x){return x.active;}).map(function(x){return x.name+": score "+calcStats(getDemoTaps(x.id)).score;}).join(", ");
  var fb=st.negFb.map(function(t){return "\""+t.feedback+"\"("+t.rating+"★)";}).join("; ")||"none";
  var p="Manager coaching for "+s.name+". Stats: "+st.count+" taps, "+st.reviews+" reviews, "+st.avgStr+"★, "+st.ctr+"% CTR, score "+st.score+". Team: "+ctx+". Feedback: "+fb+". What they do well, biggest improvement, coaching starter, suggested goal. Under 200 words.";
  var cc=$("coach-card"); if(!cc) return;
  cc.innerHTML="<div class='ai-card'><div class='ai-card-head'><div style='width:36px;height:36px;border-radius:50%;background:"+s.color+"22;color:"+s.color+";display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px'>"+ini(s.name)+"</div><div><div class='ai-card-title'>"+esc(s.name)+"</div><div class='ai-card-sub'>"+st.count+" taps · "+st.avgStr+"★ · score "+st.score+"</div></div></div><div id='ai-coach-"+sid+"'></div></div>";
  renderAIBlock("ai-coach-"+sid,p,"mgr_c_"+sid,"Writing…");
};

// ─── TEAM TAB ──────────────────────────────
var _teamSub="leaderboard";
function renderTeamTab(body,activeStaff,sd) {
  var SUBS={leaderboard:"🏆 Leaderboard",analytics:"📊 Analytics",goals_view:"🎯 Goals"};
  body.innerHTML=
    "<div id='team-sub-tabs' style='display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap'>"+
      Object.keys(SUBS).map(function(s){var a=s===_teamSub;return "<button data-ts='"+s+"' onclick='_teamSub_fn(this.dataset.ts)' style='background:"+(a?"#00e5a0":"#15171f")+";color:"+(a?"#07080c":"rgba(238,240,248,.5)")+";border:1px solid "+(a?"#00e5a0":"rgba(255,255,255,.08)")+";border-radius:9px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit'>"+SUBS[s]+"</button>";}).join("")+
    "</div>"+
    "<div id='team-sub-body'></div>";

  window._teamSub_fn=function(sub) {
    _teamSub=sub;
    document.querySelectorAll("#team-sub-tabs button").forEach(function(b){var a=b.dataset.ts===sub;b.style.background=a?"#00e5a0":"#15171f";b.style.color=a?"#07080c":"rgba(238,240,248,.5)";b.style.borderColor=a?"#00e5a0":"rgba(255,255,255,.08)";});
    var el=$("team-sub-body"); if(!el) return;
    if(sub==="leaderboard") renderLeaderboard(el,activeStaff);
    else if(sub==="analytics") renderAnalytics(el,activeStaff);
    else renderTeamGoalsView(el);
  };
  _teamSub_fn(_teamSub);
}

function renderLeaderboard(el,activeStaff) {
  var rows=activeStaff.map(function(s){return {s:s,st:calcStats(getDemoTaps(s.id))};}).sort(function(a,b){return b.st.score-a.st.score;});
  var maxScore=Math.max.apply(null,rows.map(function(r){return r.st.score;}))||1;
  var wkTop=rows.slice().sort(function(a,b){return b.st.weekTaps-a.st.weekTaps;})[0];
  function pctLabel(pct){if(pct>=.9)return{e:"🔥",l:"On Fire",c:"#ff6b35"};if(pct>=.75)return{e:"💪",l:"Strong",c:"#00e5a0"};if(pct>=.55)return{e:"✅",l:"Good",c:"#7c6aff"};if(pct>=.35)return{e:"📈",l:"Building",c:"#ffd166"};return{e:"💤",l:"Needs Push",c:"#ff4455"};}
  el.innerHTML=
    "<div class='lb-banner'><span style='font-size:22px'>🏆</span><div><div style='font-weight:700;font-size:13px;margin-bottom:2px'>This Week: "+esc(wkTop?wkTop.s.name:"—")+"</div><div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>"+(wkTop?wkTop.st.weekTaps:0)+" taps · Resets Monday</div></div></div>"+
    rows.map(function(row,i){
      var s=row.s,st=row.st,pct=st.score/maxScore,pl=pctLabel(pct),bar=Math.round(pct*100),dots="";
      for(var d=0;d<10;d++) dots+=d<Math.round(pct*10)?"●":"○";
      return "<div class='lb-item "+(i<3?"r"+(i+1):"")+"' style='flex-direction:column;align-items:stretch;gap:10px'>"+
        "<div style='display:flex;align-items:center;gap:12px'>"+
          "<div class='lb-rank'>"+["🥇","🥈","🥉"][i]||(i+1)+"</div>"+
          "<div class='lb-av' style='background:"+s.color+"22;color:"+s.color+"'>"+ini(s.name)+"</div>"+
          "<div style='flex:1'>"+
            "<div style='display:flex;align-items:center;gap:7px;margin-bottom:2px'>"+
              "<div class='lb-nm'>"+esc(s.name)+"</div>"+
              "<span style='font-size:16px'>"+pl.e+"</span>"+
              "<span style='font-size:10px;font-weight:700;color:"+pl.c+";background:"+pl.c+"18;border-radius:5px;padding:1px 7px'>"+pl.l+"</span>"+
            "</div>"+
            "<div class='lb-st'>"+st.count+" taps · "+st.reviews+" reviews · "+st.avgStr+"⭐ · CTR "+st.ctr+"%</div>"+
          "</div>"+
          "<div class='lb-sc'><div class='lb-sc-val'>"+st.score+"</div><div class='lb-sc-lbl'>pts</div></div>"+
        "</div>"+
        "<div style='display:flex;align-items:center;gap:8px'>"+
          "<div style='font-size:11px;color:"+s.color+";letter-spacing:.5px;font-family:monospace;flex:1'>"+dots+"</div>"+
          "<div style='font-size:10px;color:rgba(238,240,248,.35);font-weight:600'>"+bar+"%</div>"+
        "</div>"+
        "<div style='height:4px;background:rgba(255,255,255,.06);border-radius:2px;overflow:hidden'><div style='height:100%;width:"+bar+"%;background:linear-gradient(90deg,"+s.color+","+pl.c+");border-radius:2px'></div></div>"+
      "</div>";
    }).join("")+
    "<div style='margin-top:10px;font-size:11px;color:rgba(238,240,248,.28);font-weight:500'>Score = Taps×10 + Reviews×15 + 5★×5</div>";
}

var _chartMode="bar";
function renderAnalytics(el,activeStaff) {
  var all=activeStaff.flatMap(function(s){return getDemoTaps(s.id);});
  var tot=all.length,revs=all.filter(function(t){return t.review;}).length;
  var avg=all.length?(all.reduce(function(a,t){return a+t.rating;},0)/all.length).toFixed(1):"—";
  var pos=all.filter(function(t){return t.rating>=4;}).length,neg=all.filter(function(t){return t.rating<=3;}).length;
  var ctr=pos>0?Math.round((revs/pos)*100):0;
  var gT=all.filter(function(t){return t.platform==="google";}).length;
  var yT=all.filter(function(t){return t.platform==="yelp";}).length;
  var mx=Math.max.apply(null,activeStaff.map(function(s){return getDemoTaps(s.id).length;}));
  var isBar=_chartMode==="bar";
  var bStyle="background:"+(isBar?"#00e5a0":"#15171f")+";color:"+(isBar?"#07080c":"rgba(238,240,248,.5)")+";border:1px solid "+(isBar?"#00e5a0":"rgba(255,255,255,.08)")+";border-radius:9px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit";
  var dStyle="background:"+(!isBar?"#00e5a0":"#15171f")+";color:"+(!isBar?"#07080c":"rgba(238,240,248,.5)")+";border:1px solid "+(!isBar?"#00e5a0":"rgba(255,255,255,.08)")+";border-radius:9px;padding:5px 11px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit";
  var cs="background:#0e0f15;border:1px solid rgba(255,255,255,.06);border-radius:13px;padding:15px;margin-bottom:9px";
  el.innerHTML=
    "<div style='display:flex;justify-content:flex-end;gap:6px;margin-bottom:10px'><button data-cm='bar' onclick='_setChart(this.dataset.cm)' style='"+bStyle+"'>▬ Bar</button><button data-cm='donut' onclick='_setChart(this.dataset.cm)' style='"+dStyle+"'>◉ Donut</button></div>"+
    "<div style='display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:9px'>"+
      [[tot,"Total Taps","#00e5a0"],[revs,"Reviews","#ffd166"],[avg+"⭐","Avg Rating","#ff6b35"],[ctr+"%","CTR","#7c6aff"],[pos,"Positive","#00e5a0"],[neg,"Negative","#ff4455"]].map(function(item){return "<div style='"+cs+"'><div style='font-weight:900;font-size:26px;line-height:1;margin-bottom:4px;color:"+item[2]+";letter-spacing:-.03em'>"+item[0]+"</div><div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:700'>"+item[1]+"</div></div>";}).join("")+
    "</div>"+
    "<div style='"+cs+"'><div class='sec-lbl'>Platform</div>"+buildPlatChart(gT,yT,0,tot)+"</div>"+
    "<div style='"+cs+"'><div class='sec-lbl'>Taps Per Staff</div>"+buildStaffBars(activeStaff,mx)+"</div>";
  window._setChart=function(m){_chartMode=m;renderAnalytics(el,activeStaff);};
}
function buildPlatChart(gT,yT,tT,tot) {
  if(_chartMode==="donut"){
    var total=gT+yT+tT||1;
    var segs=[{n:gT,c:"#00e5a0",l:"Google"},{n:yT,c:"#ffd166",l:"Yelp"},{n:tT,c:"#7c6aff",l:"Tripadvisor"}];
    return "<div style='display:flex;align-items:center;gap:16px'>"+buildDonut(segs.map(function(s){return {pct:s.n/total,c:s.c};}),80)+"<div>"+segs.map(function(s){return "<div style='display:flex;align-items:center;gap:7px;margin-bottom:7px'><div style='width:10px;height:10px;border-radius:50%;background:"+s.c+";flex-shrink:0'></div><div style='font-size:12px;font-weight:600;flex:1'>"+s.l+"</div><div style='font-size:12px;font-weight:800;color:"+s.c+"'>"+s.n+"</div></div>";}).join("")+"</div></div>";
  }
  return [["🔍",gT,"#00e5a0","Google"],["⭐",yT,"#ffd166","Yelp"],["✈️",tT,"#7c6aff","Tripadvisor"]].map(function(item){return "<div style='display:inline-block;text-align:center;background:#15171f;border-radius:9px;padding:10px 14px;margin-right:8px'><div style='font-size:18px'>"+item[0]+"</div><div style='font-weight:900;font-size:20px;color:"+item[2]+"'>"+item[1]+"</div><div style='font-size:10px;color:rgba(238,240,248,.38);font-weight:700'>"+item[3]+"</div></div>";}).join("");
}
function buildStaffBars(activeStaff,mx) {
  if(_chartMode==="donut"){
    var tot2=activeStaff.reduce(function(a,s){return a+getDemoTaps(s.id).length;},0)||1;
    var segs2=activeStaff.map(function(s){return {pct:getDemoTaps(s.id).length/tot2,c:s.color};});
    return "<div style='display:flex;align-items:center;gap:16px'>"+buildDonut(segs2,80)+"<div>"+activeStaff.map(function(s){var n=getDemoTaps(s.id).length;return "<div style='display:flex;align-items:center;gap:7px;margin-bottom:7px'><div style='width:10px;height:10px;border-radius:50%;background:"+s.color+";flex-shrink:0'></div><div style='font-size:12px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>"+esc(s.name.split(" ")[0])+"</div><div style='font-size:12px;font-weight:800;color:"+s.color+"'>"+n+"</div></div>";}).join("")+"</div></div>";
  }
  return activeStaff.map(function(s){var n=getDemoTaps(s.id).length;return "<div class='bar-row'><div class='bar-nm'>"+esc(s.name.split(" ")[0])+"</div><div class='bar-track'><div class='bar-fill' style='width:"+Math.round(n/mx*100)+"%;background:"+s.color+"'></div></div><div class='bar-v' style='color:"+s.color+"'>"+n+"</div></div>";}).join("");
}
function buildDonut(segs,size) {
  var r=size*.35,cx=size/2,cy=size/2,sw=size*.18,circ=2*Math.PI*r,off=0;
  var paths=segs.map(function(seg){var dl=seg.pct*circ,gap=circ-dl,p="<circle cx='"+cx+"' cy='"+cy+"' r='"+r+"' fill='none' stroke='"+seg.c+"' stroke-width='"+sw+"' stroke-dasharray='"+dl.toFixed(2)+" "+gap.toFixed(2)+"' stroke-dashoffset='"+(-off*circ).toFixed(2)+"' stroke-linecap='round' transform='rotate(-90 "+cx+" "+cy+")'/>";off+=seg.pct;return p;});
  return "<svg width='"+size+"' height='"+size+"' style='flex-shrink:0'><circle cx='"+cx+"' cy='"+cy+"' r='"+r+"' fill='none' stroke='rgba(255,255,255,.06)' stroke-width='"+sw+"'/>"+paths.join("")+"</svg>";
}
function renderTeamGoalsView(el) {
  var parts=window.location.pathname.split("/").filter(Boolean);
  var biz=getBiz(parts[0]);
  if(!biz){el.innerHTML="";return;}
  var tGoals=biz.teamGoals||[];
  el.innerHTML="<div style='text-align:right;margin-bottom:10px'><button onclick='_addTeamGoal()' class='btn btn-primary btn-sm'>+ Add Goal</button></div>"+
    (tGoals.length?tGoals.map(function(g){return staffGoalRow(g,true);}).join(""):"<div style='text-align:center;padding:30px 20px;color:rgba(238,240,248,.38);font-size:13px'>No team goals yet.</div>");
}

// ─── ESTIMATOR ─────────────────────────────
function renderEstimatorTab(body,activeStaff) {
  body.innerHTML="<div class='ai-card'><div class='ai-card-head'><div class='ai-card-ico'>📈</div><div><div class='ai-card-title'>Platform Rating Estimator</div><div class='ai-card-sub'>How many 5★ reviews to hit your target</div></div></div>"+
    "<div class='field-lbl' style='margin-top:4px'>Platform</div><select class='sel' id='est-plat' style='margin-bottom:10px'><option value='google'>Google</option><option value='yelp'>Yelp</option><option value='tripadvisor'>Tripadvisor</option></select>"+
    "<div class='field-lbl'>Current Review Count</div><input class='inp' id='est-count' type='number' value='71' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Current Rating</div><input class='inp' id='est-cur' type='number' step='0.1' value='4.2' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Target Rating</div><input class='inp' id='est-tgt' type='number' step='0.1' value='4.5' style='margin-bottom:12px'/>"+
    "<button onclick='_calcEst()' style='width:100%;padding:12px;background:linear-gradient(135deg,rgba(167,139,250,.16),rgba(129,140,248,.12));border:1px solid rgba(167,139,250,.28);color:#a78bfa;border-radius:11px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit'>✦ Calculate &amp; Predict</button>"+
    "<div id='est-result' style='margin-top:14px'></div></div>";

  window._calcEst=function(){
    var c=parseInt(($("est-count")||{}).value)||0,cur=parseFloat(($("est-cur")||{}).value)||0,tgt=parseFloat(($("est-tgt")||{}).value)||0;
    var plat=($("est-plat")||{}).value||"google";
    var el=$("est-result"); if(!el) return;
    if(!c||!cur||!tgt){el.innerHTML="<div style='color:#ff4455;font-size:13px'>Fill in all fields.</div>";return;}
    if(tgt<=cur){el.innerHTML="<div style='color:#ffd166;font-size:13px;font-weight:600;text-align:center;padding:8px'>✓ Already at or above target!</div>";return;}
    if(tgt>5){el.innerHTML="<div style='color:#ff4455;font-size:13px'>Target can't exceed 5.0</div>";return;}
    var n=Math.max(1,Math.ceil((c*(tgt-cur))/(5-tgt)));
    var tps=Math.ceil(n/0.65);
    var pace=Math.max(1,activeStaff.length*3);
    var wks=Math.ceil(tps/pace);
    var p="Restaurant wants "+plat+" from "+cur+"★ to "+tgt+"★. "+c+" reviews. Need ~"+n+" new 5★ reviews (~"+tps+" taps, ~"+wks+" weeks). Timeframe, strategy, 2 tactics, 1 risk. Under 150 words.";
    el.innerHTML="<div class='est-grid'>"+[[n,"5★ needed","#00e5a0"],[tps,"Taps needed","#ffd166"],[wks+"w","Est. time","#7c6aff"],[cur+"→"+tgt+"★","Jump","#ff6b35"]].map(function(item){return "<div class='est-card'><div class='est-val' style='color:"+item[2]+"'>"+item[0]+"</div><div class='est-lbl'>"+item[1]+"</div></div>";}).join("")+"</div><div id='ai-est'></div>";
    renderAIBlock("ai-est",p,"est_"+plat+"_"+cur+"_"+tgt,"Predicting…");
  };
}

// ─── STAFF MGMT ────────────────────────────
function renderStaffMgmtTab(body,biz) {
  body.innerHTML=
    "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'>"+
      "<div class='sec-lbl' style='margin-bottom:0'>Staff ("+biz.staff.length+")</div>"+
      "<div style='display:flex;gap:7px'>"+
        "<button onclick='_chgMgrPin()' class='btn btn-ghost btn-sm'>🔒 Manager PIN</button>"+
        "<button onclick='_addStaff()' class='btn btn-primary btn-sm'>+ Add</button>"+
      "</div>"+
    "</div>"+
    "<div id='staff-list'></div>";
  renderStaffList(biz);
}
function renderStaffList(biz) {
  var el=$("staff-list"); if(!el) return;
  var base=window.location.origin+"/"+biz.slug+"/tap/";
  el.innerHTML=biz.staff.map(function(s){
    return "<div class='plain-card' style='opacity:"+(s.active?1:0.5)+";margin-bottom:9px'>"+
      "<div style='display:flex;align-items:center;gap:11px'>"+
        "<div style='width:40px;height:40px;border-radius:50%;background:"+s.color+"22;color:"+s.color+";display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px;flex-shrink:0'>"+ini(s.name)+"</div>"+
        "<div style='flex:1;min-width:0'>"+
          "<div style='font-weight:700;font-size:13px;margin-bottom:2px'>"+esc(s.name)+(!s.active?" <span style='font-size:10px;background:rgba(255,68,85,.1);color:#ff4455;border-radius:4px;padding:1px 6px'>Inactive</span>":"")+"</div>"+
          "<div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500'>Passcode: "+s.passcode+"</div>"+
        "</div>"+
        "<div style='display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end'>"+
          "<button onclick='_copyUrl(\""+base+s.id+"\")' class='btn btn-ghost btn-sm'>📋</button>"+
          "<button onclick='_editStaff(\""+s.id+"\")' class='btn btn-ghost btn-sm'>✏</button>"+
          "<button onclick='_toggleStaff(\""+s.id+"\")' class='btn btn-ghost btn-sm'>"+(s.active?"Deactivate":"Activate")+"</button>"+
          "<button onclick='_removeStaff(\""+s.id+"\")' class='btn btn-danger btn-sm'>✕</button>"+
        "</div>"+
      "</div>"+
      "<div style='margin-top:8px;padding:7px 9px;background:#15171f;border-radius:8px;font-size:11px;color:#00e5a0;word-break:break-all;font-weight:500'>"+base+s.id+"</div>"+
    "</div>";
  }).join("");

  var parts=window.location.pathname.split("/").filter(Boolean);
  window._copyUrl=function(url){navigator.clipboard.writeText(url).then(function(){showToast("URL copied!");}).catch(function(){showToast(url);});};
  window._toggleStaff=function(sid){biz.staff=biz.staff.map(function(s){return s.id===sid?Object.assign({},s,{active:!s.active}):s;});saveBiz(biz);renderStaffList(biz);};
  window._removeStaff=function(sid){var s=biz.staff.find(function(x){return x.id===sid;});if(!s||!confirm("Remove "+s.name+"?"))return;biz.staff=biz.staff.filter(function(x){return x.id!==sid;});saveBiz(biz);renderStaffList(biz);};
  window._addStaff=function(){
    window._selColor=COLORS[0];
    showModal("<div class='modal-head'><div class='modal-title'>Add Staff</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div><div class='field-lbl'>Name</div><input class='inp' id='ns-name' placeholder='e.g. Sam W.'/></div><div><div class='field-lbl'>4-Digit Passcode</div><input class='inp' id='ns-pass' type='tel' maxlength='4'/><div id='ns-err' style='color:#ff4455;font-size:12px;margin-top:4px;min-height:14px;font-weight:500'></div></div><div><div class='field-lbl'>Color</div><div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:4px'>"+COLORS.map(function(c,i){return "<div data-sc='"+c+"' onclick='_pickColor(this)' style='width:27px;height:27px;border-radius:50%;background:"+c+";cursor:pointer;outline:"+(i===0?"3px solid rgba(255,255,255,.8)":"none")+";outline-offset:2px'></div>";}).join("")+"</div></div><button class='btn btn-primary btn-full' onclick='_saveStaff()'>Add Staff Member</button></div>");
    window._pickColor=function(el){window._selColor=el.dataset.sc;document.querySelectorAll("[data-sc]").forEach(function(d){d.style.outline="none";});el.style.outline="3px solid rgba(255,255,255,.8)";el.style.outlineOffset="2px";};
    window._saveStaff=function(){
      var name=(($("ns-name")||{}).value||"").trim(),pass=(($("ns-pass")||{}).value||"").trim(),err=$("ns-err");
      if(!name){if(err)err.textContent="Name required";return;}
      if(!/^\d{4}$/.test(pass)){if(err)err.textContent="Must be 4 digits";return;}
      if(biz.staff.find(function(s){return s.passcode===pass;})){if(err)err.textContent="Passcode in use";return;}
      biz.staff.push({id:uid(),name:name,color:window._selColor||COLORS[0],passcode:pass,active:true});
      saveBiz(biz);closeModal();renderStaffList(biz);showToast("Staff added!");
    };
  };
  window._editStaff=function(sid){
    var s=biz.staff.find(function(x){return x.id===sid;}); if(!s) return;
    window._selColor=s.color;
    showModal("<div class='modal-head'><div class='modal-title'>Edit: "+esc(s.name)+"</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div><div class='field-lbl'>Name</div><input class='inp' id='es-name' value='"+esc(s.name)+"'/></div><div><div class='field-lbl'>Passcode</div><input class='inp' id='es-pass' type='tel' maxlength='4' value='"+s.passcode+"'/><div id='es-err' style='color:#ff4455;font-size:12px;margin-top:4px;min-height:14px;font-weight:500'></div></div><div><div class='field-lbl'>Color</div><div style='display:flex;gap:8px;flex-wrap:wrap;margin-top:4px'>"+COLORS.map(function(c){return "<div data-sc='"+c+"' onclick='_pickColor(this)' style='width:27px;height:27px;border-radius:50%;background:"+c+";cursor:pointer;outline:"+(c===s.color?"3px solid rgba(255,255,255,.8)":"none")+";outline-offset:2px'></div>";}).join("")+"</div></div><button class='btn btn-primary btn-full' onclick='_saveEditStaff(\""+sid+"\")'>Save</button></div>");
    window._pickColor=function(el){window._selColor=el.dataset.sc;document.querySelectorAll("[data-sc]").forEach(function(d){d.style.outline="none";});el.style.outline="3px solid rgba(255,255,255,.8)";el.style.outlineOffset="2px";};
    window._saveEditStaff=function(sid2){
      var name=(($("es-name")||{}).value||"").trim(),pass=(($("es-pass")||{}).value||"").trim(),err=$("es-err");
      if(!name){if(err)err.textContent="Name required";return;}
      if(!/^\d{4}$/.test(pass)){if(err)err.textContent="Must be 4 digits";return;}
      if(biz.staff.find(function(s){return s.passcode===pass&&s.id!==sid2;})){if(err)err.textContent="Passcode in use";return;}
      biz.staff=biz.staff.map(function(s){return s.id===sid2?Object.assign({},s,{name:name,passcode:pass,color:window._selColor||s.color}):s;});
      saveBiz(biz);closeModal();renderStaffList(biz);showToast("Saved!");
    };
  };
  window._chgMgrPin=function(){
    showModal("<div class='modal-head'><div class='modal-title'>Change Manager PIN</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='background:#15171f;border-radius:9px;padding:10px 12px;font-size:12px;color:rgba(238,240,248,.38);font-weight:500'>Current PIN: <strong style='color:#eef0f8'>"+biz.mgrPin+"</strong></div><div><div class='field-lbl'>New PIN</div><input class='inp' id='mp-1' type='tel' maxlength='4'/></div><div><div class='field-lbl'>Confirm</div><input class='inp' id='mp-2' type='tel' maxlength='4'/></div><div id='mp-err' style='color:#ff4455;font-size:12px;min-height:14px;font-weight:500'></div><button class='btn btn-primary btn-full' onclick='_saveMgrPin()'>Update PIN</button></div>");
    window._saveMgrPin=function(){var p1=(($("mp-1")||{}).value||"").trim(),p2=(($("mp-2")||{}).value||"").trim(),err=$("mp-err");if(!/^\d{4}$/.test(p1)){if(err)err.textContent="Must be 4 digits";return;}if(p1!==p2){if(err)err.textContent="PINs don't match";return;}biz.mgrPin=p1;saveBiz(biz);closeModal();showToast("PIN updated!");};
  };
}

// ─── LINKS TAB ─────────────────────────────
function renderLinksTab(body,biz) {
  body.innerHTML=
    "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:12px'>"+
      "<div class='sec-lbl' style='margin-bottom:0'>Review Links</div>"+
      "<button onclick='_addLink()' class='btn btn-primary btn-sm'>+ Add</button>"+
    "</div>"+
    "<div style='background:#15171f;border-radius:9px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:rgba(238,240,248,.38);line-height:1.6;font-weight:500'>5★ auto-redirects to first active link. 4★ shows all active links.</div>"+
    "<div id='links-list'></div>";
  renderLinksList(biz);
}
function renderLinksList(biz) {
  var el=$("links-list"); if(!el) return;
  el.innerHTML=biz.links.map(function(l){
    return "<div class='link-row'>"+
      "<div class='link-ico'>"+l.icon+"</div>"+
      "<div style='flex:1;min-width:0'><div style='font-weight:700;font-size:13px;margin-bottom:2px'>"+esc(l.label)+"</div><div style='font-size:11px;color:rgba(238,240,248,.38);overflow:hidden;text-overflow:ellipsis;white-space:nowrap'>"+esc(l.url)+"</div></div>"+
      "<div style='display:flex;gap:5px;flex-shrink:0'>"+
        "<button onclick='_toggleLink(\""+l.id+"\")' style='background:"+(l.active?"rgba(0,229,160,.1)":"rgba(255,255,255,.04)")+";border:1px solid "+(l.active?"rgba(0,229,160,.22)":"rgba(255,255,255,.06)")+";color:"+(l.active?"#00e5a0":"rgba(238,240,248,.38)")+";border-radius:7px;padding:4px 8px;font-size:10px;font-weight:700;cursor:pointer;font-family:inherit'>"+(l.active?"On":"Off")+"</button>"+
        "<button onclick='_editLink(\""+l.id+"\")' class='btn btn-ghost btn-sm'>Edit</button>"+
        "<button onclick='_removeLink(\""+l.id+"\")' class='btn btn-danger btn-sm'>✕</button>"+
      "</div>"+
    "</div>";
  }).join("");

  window._toggleLink=function(id){biz.links=biz.links.map(function(l){return l.id===id?Object.assign({},l,{active:!l.active}):l;});saveBiz(biz);renderLinksList(biz);};
  window._removeLink=function(id){if(!confirm("Remove this link?"))return;biz.links=biz.links.filter(function(l){return l.id!==id;});saveBiz(biz);renderLinksList(biz);};
  window._addLink=function(){
    showModal("<div class='modal-head'><div class='modal-title'>Add Review Link</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='display:flex;gap:8px'><div style='width:70px;flex-shrink:0'><div class='field-lbl'>Icon</div><input class='inp' id='nl-icon' placeholder='🔗' style='text-align:center;font-size:18px'/></div><div style='flex:1'><div class='field-lbl'>Label</div><input class='inp' id='nl-label' placeholder='Google, Yelp…'/></div></div><div><div class='field-lbl'>URL</div><input class='inp' id='nl-url' placeholder='https://…'/></div><button class='btn btn-primary btn-full' onclick='_saveLink()'>Add Link</button></div>");
    window._saveLink=function(){var icon=(($("nl-icon")||{}).value||"").trim()||"🔗",label=(($("nl-label")||{}).value||"").trim(),url=(($("nl-url")||{}).value||"").trim();if(!label||!url){showToast("Label and URL required");return;}biz.links.push({id:uid(),label:label,icon:icon,url:url,active:true});saveBiz(biz);closeModal();renderLinksList(biz);};
  };
  window._editLink=function(id){
    var l=biz.links.find(function(x){return x.id===id;}); if(!l) return;
    showModal("<div class='modal-head'><div class='modal-title'>Edit Link</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='display:flex;gap:8px'><div style='width:70px;flex-shrink:0'><div class='field-lbl'>Icon</div><input class='inp' id='el-icon' value='"+esc(l.icon)+"' style='text-align:center;font-size:18px'/></div><div style='flex:1'><div class='field-lbl'>Label</div><input class='inp' id='el-label' value='"+esc(l.label)+"'/></div></div><div><div class='field-lbl'>URL</div><input class='inp' id='el-url' value='"+esc(l.url)+"'/></div><button class='btn btn-primary btn-full' onclick='_saveEditLink(\""+id+"\")'>Save</button></div>");
    window._saveEditLink=function(lid){var icon=(($("el-icon")||{}).value||"").trim()||"🔗",label=(($("el-label")||{}).value||"").trim(),url=(($("el-url")||{}).value||"").trim();if(!label||!url){showToast("Label and URL required");return;}biz.links=biz.links.map(function(l){return l.id===lid?Object.assign({},l,{icon:icon,label:label,url:url}):l;});saveBiz(biz);closeModal();renderLinksList(biz);};
  };
}

// ─── GOALS TAB ─────────────────────────────
function renderMgrGoalsTab(body,biz) {
  var SUBS={team:"Team Goals",individual:"Individual Goals"};
  var curSub="team";
  body.innerHTML=
    "<div id='goals-sub-tabs' style='display:flex;gap:6px;margin-bottom:14px'>"+
      Object.keys(SUBS).map(function(s,i){return "<button data-gs='"+s+"' onclick='_goalSub(this.dataset.gs)' style='background:"+(i===0?"#00e5a0":"#15171f")+";color:"+(i===0?"#07080c":"rgba(238,240,248,.5)")+";border:1px solid "+(i===0?"#00e5a0":"rgba(255,255,255,.08)")+";border-radius:9px;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;font-family:inherit'>"+SUBS[s]+"</button>";}).join("")+
    "</div>"+
    "<div id='goals-sub-body'></div>";

  window._goalSub=function(sub){
    curSub=sub;
    document.querySelectorAll("#goals-sub-tabs button").forEach(function(b){var a=b.dataset.gs===sub;b.style.background=a?"#00e5a0":"#15171f";b.style.color=a?"#07080c":"rgba(238,240,248,.5)";b.style.borderColor=a?"#00e5a0":"rgba(255,255,255,.08)";});
    var el=$("goals-sub-body"); if(!el) return;
    if(sub==="team") renderTeamGoalsEdit(el,biz);
    else renderIndividualGoals(el,biz);
  };
  _goalSub("team");
}

function renderTeamGoalsEdit(el,biz) {
  var goals=biz.teamGoals||[];
  el.innerHTML=
    "<div style='display:flex;justify-content:flex-end;margin-bottom:10px'><button onclick='_addTeamGoal()' class='btn btn-primary btn-sm'>+ Add Goal</button></div>"+
    (goals.length?goals.map(function(g){return goalRowMgr(g,"team",null,biz);}).join(""):"<div style='text-align:center;padding:30px;color:rgba(238,240,248,.38);font-size:13px'>No team goals yet.</div>");
  window._addTeamGoal=function(){showGoalModal(null,"team",biz,function(){var el2=$("goals-sub-body");if(el2)renderTeamGoalsEdit(el2,biz);});};
}

function renderIndividualGoals(el,biz) {
  var active=biz.staff.filter(function(s){return s.active;});
  var first=active[0];
  el.innerHTML=
    "<div class='pills' id='igoal-pills'>"+active.map(function(s,i){return "<div class='pill"+(i===0?" active":"")+"' onclick='_selGoalStaff(\""+s.id+"\",this)'><div class='pill-av' style='background:"+s.color+"22;color:"+s.color+"'>"+ini(s.name)+"</div>"+s.name.split(" ")[0]+"</div>";}).join("")+"</div>"+
    "<div id='igoal-body'></div>";
  window._selGoalStaff=function(sid,pill){
    document.querySelectorAll("#igoal-pills .pill").forEach(function(p){p.classList.remove("active");});
    if(pill)pill.classList.add("active");
    var s=biz.staff.find(function(x){return x.id===sid;}); if(!s) return;
    var sGoals=(biz.staffGoals&&biz.staffGoals[sid])||[];
    var ib=$("igoal-body"); if(!ib) return;
    ib.innerHTML=
      "<div style='display:flex;align-items:center;justify-content:space-between;margin-bottom:10px'>"+
        "<div class='sec-lbl' style='margin-bottom:0'>Goals for "+esc(s.name)+"</div>"+
        "<button onclick='_addStaffGoal(\""+sid+"\")' class='btn btn-primary btn-sm'>+ Add Goal</button>"+
      "</div>"+
      (sGoals.length?sGoals.map(function(g){return goalRowMgr(g,"staff",sid,biz);}).join(""):"<div style='text-align:center;padding:24px;color:rgba(238,240,248,.38);font-size:13px'>No goals for "+esc(s.name.split(" ")[0])+" yet.</div>");
    window._addStaffGoal=function(sid2){showGoalModal(sid2,"staff",biz,function(){window._selGoalStaff&&_selGoalStaff(sid2,document.querySelector("#igoal-pills .pill.active"));});};
  };
  if(first) _selGoalStaff(first.id,document.querySelector("#igoal-pills .pill"));
}

function goalRowMgr(g,type,sid,biz) {
  var pct=Math.min(100,g.target>0?Math.round((g.current/g.target)*100):0),done=pct>=100;
  var sidParm=sid?'"'+sid+'"':"null";
  return "<div class='plain-card' style='margin-bottom:9px'>"+
    "<div style='display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px'>"+
      "<div style='flex:1'>"+
        "<div style='font-weight:700;font-size:13px;margin-bottom:3px'>"+esc(g.title)+(done?" <span style='font-size:10px;color:#00e5a0;background:rgba(0,229,160,.1);border-radius:5px;padding:1px 6px'>Done ✓</span>":"")+"</div>"+
        (g.note?"<div style='font-size:11px;color:rgba(238,240,248,.38);font-weight:500;margin-bottom:5px'>"+esc(g.note)+"</div>":"")+
        "<div style='display:flex;align-items:center;gap:8px'>"+
          "<div style='flex:1;height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden'><div style='height:100%;width:"+pct+"%;background:"+(done?"#00e5a0":"#7c6aff")+";border-radius:3px'></div></div>"+
          "<div style='font-size:11px;font-weight:700;color:"+(done?"#00e5a0":"rgba(238,240,248,.5)")+";flex-shrink:0'>"+g.current+"/"+g.target+" "+esc(g.unit||"")+"</div>"+
        "</div>"+
      "</div>"+
      "<div style='display:flex;gap:5px;flex-shrink:0'>"+
        "<button onclick='_updGoal(\""+g.id+"\",\""+type+"\","+sidParm+")' class='btn btn-ghost btn-sm'>Update</button>"+
        "<button onclick='_delGoal(\""+g.id+"\",\""+type+"\","+sidParm+")' class='btn btn-danger btn-sm'>✕</button>"+
      "</div>"+
    "</div>"+
    "<div style='font-size:10px;color:rgba(238,240,248,.25);font-weight:500'>"+esc(g.period||"")+(g.deadline?" · Due: "+esc(g.deadline):"")+"</div>"+
  "</div>";
}

function showGoalModal(sid,type,biz,onSave) {
  var sName=sid?(biz.staff.find(function(s){return s.id===sid;})||{}).name||"Staff":"Team";
  showModal(
    "<div class='modal-head'><div class='modal-title'>Add Goal"+(type==="staff"?" for "+esc(sName):" (Team)")+"</div><button class='modal-close' onclick='closeModal()'>×</button></div>"+
    "<div style='display:flex;flex-direction:column;gap:10px'>"+
      "<div><div class='field-lbl'>Goal Title</div><input class='inp' id='g-title' placeholder='e.g. Hit 20 reviews this week'/></div>"+
      "<div><div class='field-lbl'>Note (optional)</div><input class='inp' id='g-note' placeholder='Focus on Google reviews'/></div>"+
      "<div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px'>"+
        "<div><div class='field-lbl'>Target</div><input class='inp' id='g-target' type='number' placeholder='20' min='1'/></div>"+
        "<div><div class='field-lbl'>Current</div><input class='inp' id='g-current' type='number' placeholder='0' value='0' min='0'/></div>"+
        "<div><div class='field-lbl'>Unit</div><input class='inp' id='g-unit' placeholder='reviews'/></div>"+
      "</div>"+
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:8px'>"+
        "<div><div class='field-lbl'>Period</div><select class='sel' id='g-period'><option>This week</option><option>This month</option><option>Ongoing</option></select></div>"+
        "<div><div class='field-lbl'>Deadline</div><input class='inp' id='g-deadline' type='date'/></div>"+
      "</div>"+
      "<button class='btn btn-primary btn-full' onclick='_saveGoal(\""+type+"\",\""+( sid||"")+"\")'>Add Goal</button>"+
    "</div>"
  );
  window._saveGoal=function(type2,sid2){
    var title=(($("g-title")||{}).value||"").trim();
    var target=parseInt(($("g-target")||{}).value)||0;
    if(!title||!target){showToast("Title and target required");return;}
    var goal={id:uid(),title:title,note:(($("g-note")||{}).value||"").trim(),target:target,current:parseInt(($("g-current")||{}).value)||0,unit:(($("g-unit")||{}).value||"").trim(),period:($("g-period")||{}).value||"This week",deadline:(($("g-deadline")||{}).value||"").trim(),createdAt:Date.now()};
    if(type2==="team"){biz.teamGoals=biz.teamGoals||[];biz.teamGoals.push(goal);}
    else{biz.staffGoals=biz.staffGoals||{};if(!biz.staffGoals[sid2])biz.staffGoals[sid2]=[];biz.staffGoals[sid2].push(goal);}
    saveBiz(biz);closeModal();if(onSave)onSave();showToast("Goal added!");
  };
}
window._updGoal=function(gid,type,sid){
  var parts=window.location.pathname.split("/").filter(Boolean);var biz=getBiz(parts[0]);if(!biz)return;
  var goals=type==="team"?biz.teamGoals:(biz.staffGoals&&biz.staffGoals[sid])||[];
  var g=goals.find(function(x){return x.id===gid;});if(!g)return;
  showModal("<div class='modal-head'><div class='modal-title'>Update Progress</div><button class='modal-close' onclick='closeModal()'>×</button></div><div style='display:flex;flex-direction:column;gap:11px'><div style='background:#15171f;border-radius:10px;padding:12px 13px'><div style='font-weight:700;font-size:14px;margin-bottom:2px'>"+esc(g.title)+"</div><div style='font-size:12px;color:rgba(238,240,248,.38)'>Target: "+g.target+" "+esc(g.unit||"")+"</div></div><div><div class='field-lbl'>Current Progress</div><input class='inp' id='upd-cur' type='number' value='"+g.current+"' min='0'/></div><button class='btn btn-primary btn-full' onclick='_saveUpd(\""+gid+"\",\""+type+"\",\""+( sid||"")+"\")'>Save</button></div>");
  window._saveUpd=function(gid2,type2,sid2){
    var cur=parseInt(($("upd-cur")||{}).value)||0;
    if(type2==="team"){biz.teamGoals=biz.teamGoals.map(function(g){return g.id===gid2?Object.assign({},g,{current:cur}):g;});}
    else{biz.staffGoals[sid2]=(biz.staffGoals[sid2]||[]).map(function(g){return g.id===gid2?Object.assign({},g,{current:cur}):g;});}
    saveBiz(biz);closeModal();showToast("Progress updated!");
  };
};
window._delGoal=function(gid,type,sid){
  if(!confirm("Delete this goal?"))return;
  var parts=window.location.pathname.split("/").filter(Boolean);var biz=getBiz(parts[0]);if(!biz)return;
  if(type==="team"){biz.teamGoals=biz.teamGoals.filter(function(g){return g.id!==gid;});}
  else{biz.staffGoals[sid]=(biz.staffGoals[sid]||[]).filter(function(g){return g.id!==gid;});}
  saveBiz(biz);showToast("Goal removed");
};

// ─── BRANDING TAB ──────────────────────────
function renderBrandingTab(body,biz) {
  var b=Object.assign({},DEFAULT_BRAND,biz.brand||{});
  body.innerHTML=
    "<div style='background:#15171f;border-radius:9px;padding:10px 12px;margin-bottom:14px;font-size:12px;color:rgba(238,240,248,.38);line-height:1.6;font-weight:500'>Controls what customers see at <strong style='color:#eef0f8'>tapplus.link/"+esc(biz.slug)+"</strong>. Customers see none of the dashboard.</div>"+
    "<div class='field-lbl'>Business Name</div><input class='inp' id='br-name' value='"+esc(b.name)+"' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Tagline</div><input class='inp' id='br-tag' value='"+esc(b.tagline)+"' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Logo URL (leave blank for business name)</div><input class='inp' id='br-logo' value='"+esc(b.logoUrl)+"' placeholder='https://…' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Rating Question</div><input class='inp' id='br-q' value='"+esc(b.ratingQuestion)+"' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Review Prompt (4-5★)</div><input class='inp' id='br-rp' value='"+esc(b.reviewPrompt)+"' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Thank You Message</div><input class='inp' id='br-ty' value='"+esc(b.thankYouMsg)+"' style='margin-bottom:8px'/>"+
    "<div class='field-lbl'>Low Rating Message (1-3★)</div><input class='inp' id='br-lr' value='"+esc(b.lowRatingMsg)+"' style='margin-bottom:12px'/>"+
    "<div style='display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px'>"+
      "<div><div class='field-lbl'>Brand Color</div><input type='color' id='br-c' value='"+(b.brandColor||"#00e5a0")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
      "<div><div class='field-lbl'>Background</div><input type='color' id='br-bg' value='"+(b.bgColor||"#07080c")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
      "<div><div class='field-lbl'>Text</div><input type='color' id='br-tx' value='"+(b.textColor||"#ffffff")+"' style='width:100%;height:36px;border:none;background:none;cursor:pointer;border-radius:6px'/></div>"+
    "</div>"+
    "<div style='display:flex;gap:8px'>"+
      "<button onclick='window.open(\"/"+esc(biz.slug)+"\",\"_blank\")' class='btn btn-ghost btn-full'>👁 Preview</button>"+
      "<button onclick='_saveBranding()' class='btn btn-primary btn-full'>Save Branding</button>"+
    "</div>";

  window._saveBranding=function(){
    biz.brand={name:(($("br-name")||{}).value||"").trim()||b.name,tagline:(($("br-tag")||{}).value||"").trim(),logoUrl:(($("br-logo")||{}).value||"").trim(),ratingQuestion:(($("br-q")||{}).value||"").trim()||DEFAULT_BRAND.ratingQuestion,reviewPrompt:(($("br-rp")||{}).value||"").trim()||DEFAULT_BRAND.reviewPrompt,thankYouMsg:(($("br-ty")||{}).value||"").trim()||DEFAULT_BRAND.thankYouMsg,lowRatingMsg:(($("br-lr")||{}).value||"").trim()||DEFAULT_BRAND.lowRatingMsg,brandColor:($("br-c")||{}).value||"#00e5a0",bgColor:($("br-bg")||{}).value||"#07080c",textColor:($("br-tx")||{}).value||"#ffffff"};
    saveBiz(biz);showToast("Branding saved!");
  };
}

// ─── DEMO DATA ─────────────────────────────
function getDemoTaps(staffId) {
  var t=Date.now(),H=3600000,s=staffId?staffId.charCodeAt(staffId.length-1):1;
  return[
    {ts:t-H*1,rating:5,platform:"google",review:true,feedback:""},
    {ts:t-H*3,rating:4,platform:"yelp",review:true,feedback:""},
    {ts:t-H*6,rating:5,platform:null,review:false,feedback:""},
    {ts:t-H*25,rating:3,platform:null,review:false,feedback:"Food was a bit cold"},
    {ts:t-H*26,rating:5,platform:"google",review:true,feedback:""},
    {ts:t-H*50,rating:4,platform:"google",review:true,feedback:""},
    {ts:t-H*73,rating:2,platform:null,review:false,feedback:"Felt rushed, order wrong"},
    {ts:t-H*98,rating:5,platform:"google",review:true,feedback:""}
  ];
}
function calcStats(taps) {
  var reviews=taps.filter(function(t){return t.review;}).length;
  var ratings=taps.map(function(t){return t.rating;});
  var avg=ratings.length?ratings.reduce(function(a,b){return a+b;},0)/ratings.length:0;
  var wt=taps.filter(function(t){return t.ts>=wsStart();}).length;
  var score=taps.length*10+reviews*15+ratings.filter(function(r){return r===5;}).length*5;
  var pos=taps.filter(function(t){return t.rating>=4;}).length;
  var ctr=pos>0?Math.round((reviews/pos)*100):0;
  var negFb=taps.filter(function(t){return t.feedback&&t.rating<=3;});
  return{count:taps.length,reviews:reviews,avg:avg,avgStr:avg?avg.toFixed(1):"—",weekTaps:wt,score:score,ctr:ctr,negFb:negFb};
}

// ─── INIT ──────────────────────────────────
window.addEventListener("popstate",route);
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",route);
else route();