import { $, showToast } from './helpers.js';
import { LS_KEY, loadPersisted, saveProfile, state } from './state.js';
import { renderAll } from './render.js';

// ── CROSS-DEVICE SYNC via a private GitHub Gist ──
// GitHub Pages is static, so there's no server to hold your data. Instead
// JAGU pushes/pulls its data to a private Gist in your own GitHub account.
// The token stays on each device; AI keys and the token are never uploaded.
//
// Auto-sync: local changes are uploaded a few seconds after you make them,
// and the cloud copy is checked when JAGU opens or the tab is shown again.
// We remember a fingerprint of the data at the last sync (syncHash) and the
// cloud copy's timestamp we last saw (syncRemoteAt), so we can tell whether
// this device, the cloud, or both have changed since.
const BUILD = "v13";
const FILE = "jagu-data.json";
const KEYS = ["projects","tasks","timetable","events","memory","updates","marking","termDates",
  "learners","enrollments","classAssignments","learnerProgress","learnerHighlights","classNotes"];
const SYNC_ONLY = ["apiKey","geminiKey","syncToken","syncGistId","lastSyncAt","syncHash","syncRemoteAt","autoSync","lastBackupAt"];
const api = (path, opts={})=> fetch("https://api.github.com"+path, Object.assign({}, opts, {
  headers: Object.assign({Authorization:"Bearer "+state.profile.syncToken, Accept:"application/vnd.github+json", "Content-Type":"application/json"}, opts.headers||{}),
}));

function snapshot(){
  const profile = Object.assign({}, state.profile);
  SYNC_ONLY.forEach(k=> delete profile[k]);
  const data = {profile};
  KEYS.forEach(k=> data[k] = state[k]);
  return data;
}
function fingerprint(){
  const str = JSON.stringify(snapshot());
  let h = 5381;
  for(let i=0;i<str.length;i++) h = ((h<<5)+h+str.charCodeAt(i))|0;
  return String(h);
}
const isEmptyLocal = ()=> !["projects","tasks","timetable","events","learners","classAssignments","marking"].some(k=> (state[k]||[]).length);

const summary = (d)=> (d.timetable||[]).length+" classes, "+(d.learners||[]).length+" learners, "+(d.classAssignments||[]).length+" assignments";

function setStatus(t){ const el = $("#sync-status"); if(el) el.textContent = t; }

async function findGist(){
  const res = await api("/gists?per_page=100");
  if(!res.ok) return null;
  const list = await res.json();
  const g = list.find(x=> x.files && x.files[FILE]);
  return g ? g.id : null;
}
// → {id, data} | null (no cloud copy yet). Throws on network / auth failure.
async function fetchRemote(){
  const id = state.profile.syncGistId || await findGist();
  if(!id) return null;
  const res = await api("/gists/"+id);
  if(res.status===404) return null;
  if(!res.ok) throw new Error("download "+res.status);
  const g = await res.json();
  const f = g.files && g.files[FILE];
  if(!f) return null;
  let text = f.content;
  if(f.truncated && f.raw_url) text = await (await fetch(f.raw_url)).text();
  return {id, data: JSON.parse(text)};
}

async function pushNow(){
  const savedAt = new Date().toISOString();
  const files = {[FILE]:{content:JSON.stringify(Object.assign(snapshot(), {savedAt}))}};
  const res = state.profile.syncGistId
    ? await api("/gists/"+state.profile.syncGistId, {method:"PATCH", body:JSON.stringify({files})})
    : await api("/gists", {method:"POST", body:JSON.stringify({description:"JAGU data (private)", public:false, files})});
  if(!res.ok) throw new Error("upload "+res.status);
  const g = await res.json();
  await saveProfile({syncGistId:g.id, lastSyncAt:savedAt, syncHash:fingerprint(), syncRemoteAt:savedAt});
  renderSyncFields();
  return savedAt;
}

async function applyRemote(id, data){
  const current = JSON.parse(localStorage.getItem(LS_KEY)) || {};
  const cp = current.profile || {};
  const merged = Object.assign({}, current, {
    profile: Object.assign({}, cp, data.profile||{}, {apiKey:cp.apiKey, geminiKey:cp.geminiKey, syncToken:cp.syncToken, autoSync:cp.autoSync, lastBackupAt:cp.lastBackupAt, syncGistId:id}),
    chat: current.chat||[],
  });
  KEYS.forEach(k=> merged[k] = data[k]||[]);
  localStorage.setItem(LS_KEY, JSON.stringify(merged));
  loadPersisted();
  const now = new Date().toISOString();
  await saveProfile({lastSyncAt:now, syncHash:fingerprint(), syncRemoteAt:data.savedAt||now});
  renderAll();
  renderSyncFields();
}

const fail = (e)=>{
  console.warn("sync failed", e);
  const m = String(e&&e.message||e);
  setStatus(/ 40[13]/.test(m) ? "GitHub rejected the token — check it has the 'gist' permission and hasn't expired." : "Sync failed ("+m+") — check your connection.");
};

// ── Manual buttons ──
async function manualPush(){
  setStatus("Uploading…");
  try{
    const remote = await fetchRemote();
    if(remote && remote.data.savedAt !== state.profile.syncRemoteAt){
      // The cloud holds a version this device has never downloaded -- don't silently replace it.
      const ok = confirm("The cloud already has a different copy ("+summary(remote.data)+").\nThis device has "+summary(state)+".\n\nUploading will REPLACE the cloud copy with this device's data.\n\nOK = replace the cloud copy   Cancel = keep the cloud copy");
      if(!ok){ setStatus("Upload cancelled — the cloud copy was left untouched. Use Download to get it instead."); return; }
    }
    await pushNow();
    setStatus("Uploaded "+summary(state)+" at "+new Date().toLocaleString()+". On your other device paste the same token and tap Download.");
    showToast("Uploaded "+summary(state)+".");
  }catch(e){ fail(e); showToast("Sync upload failed.","error"); }
}
async function manualPull(){
  if(!state.profile.syncToken){ showToast("Paste a GitHub token first.","error"); return; }
  setStatus("Downloading…");
  try{
    const r = await fetchRemote();
    if(!r){ setStatus("No JAGU data found in this GitHub account yet — tap Upload on your main device first."); return; }
    if(!confirm("This replaces the data on this device with the synced copy from "+(r.data.savedAt?new Date(r.data.savedAt).toLocaleString():"GitHub")+". Continue?")){ setStatus(""); return; }
    await applyRemote(r.id, r.data);
    setStatus("Downloaded "+summary(r.data)+" at "+new Date().toLocaleString()+".");
    showToast("Downloaded "+summary(r.data)+".");
  }catch(e){ fail(e); showToast("Sync download failed.","error"); }
}

// ── Auto-sync ──
let busy = false, timer = null;
async function autoSync(){
  const p = state.profile;
  if(!p.autoSync || !p.syncToken || busy) return;
  busy = true;
  try{
    const remote = await fetchRemote();
    const localChanged = fingerprint() !== p.syncHash;
    if(!remote){
      if(!isEmptyLocal()){ await pushNow(); setStatus("Auto-synced "+new Date().toLocaleString()); }
      return;
    }
    const remoteChanged = remote.data.savedAt !== p.syncRemoteAt;
    if(remoteChanged && (!localChanged || isEmptyLocal())){
      await applyRemote(remote.id, remote.data);
      setStatus("Auto-synced (downloaded) "+new Date().toLocaleString());
      showToast("Updated from your other device.");
    } else if(remoteChanged && localChanged){
      // Both sides differ (or this device has never synced before). Never guess which to keep.
      setStatus("⚠ Auto-sync paused: this device ("+summary(state)+") and the cloud ("+summary(remote.data)+") are different. Tap Download to use the cloud copy, or Upload to replace it with this device's data.");
      return;
    } else if(localChanged && isEmptyLocal()){
      // Never overwrite the cloud with an empty device (e.g. after "Clear all data").
      await applyRemote(remote.id, remote.data);
      showToast("This device was empty — restored from the cloud.");
    } else if(localChanged){
      await pushNow();
      setStatus("Auto-synced "+new Date().toLocaleString());
    }
  }catch(e){ fail(e); }
  finally{ busy = false; }
}
function schedule(ms){ clearTimeout(timer); timer = setTimeout(autoSync, ms); }

window.addEventListener("jagu:changed", ()=>{
  if(!state.profile.autoSync || !state.profile.syncToken) return;
  if(fingerprint() === state.profile.syncHash) return; // not a real data change (e.g. chat, sync bookkeeping)
  schedule(3000);
  renderSyncFields();
});
// Leaving the tab/app: upload right away instead of waiting for the debounce.
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") schedule(500); else { clearTimeout(timer); autoSync(); } });
window.addEventListener("pagehide", ()=>{ clearTimeout(timer); autoSync(); });
window.addEventListener("online", ()=> schedule(1000));

// Tablets often don't fire "change" on a pasted field before the next tap,
// so save the token as it's typed AND re-read the box right before any action.
function readToken(){
  const v = ($("#sync-token").value||"").trim().replace(/^["']|["']$/g,"");
  if(v && v!==state.profile.syncToken) state.profile.syncToken = v;
  return state.profile.syncToken;
}
$("#sync-token").addEventListener("input", (e)=>{ saveProfile({syncToken:(e.target.value||"").trim()}); setStatus("Token saved on this device."); });
$("#sync-token").addEventListener("change", ()=>{ readToken(); saveProfile({}); showToast("Token saved on this device."); });
const needToken = ()=>{ if(readToken()) return false; setStatus("⚠ Paste your GitHub token in the box above first."); showToast("Paste your GitHub token first.","error"); return true; };
$("#sync-push").addEventListener("click", ()=>{ if(!needToken()) manualPush(); });
$("#sync-pull").addEventListener("click", ()=>{ if(!needToken()) manualPull(); });
$("#toggle-autosync").addEventListener("click", async ()=>{
  const on = !state.profile.autoSync;
  if(on && needToken()) return;
  await saveProfile({autoSync:on});
  renderSyncFields();
  setStatus(on ? "Auto-sync is ON for this device." : "Auto-sync is off.");
  if(on){ showToast("Auto-sync on."); schedule(300); }
});

export function renderSyncFields(){
  const t = $("#sync-token"); if(t && document.activeElement!==t) t.value = state.profile.syncToken||"";
  $("#toggle-autosync").classList.toggle("on", !!state.profile.autoSync);
  const un = $("#sync-unsynced");
  if(un){
    const pending = !!state.profile.syncToken && !!state.profile.syncHash && fingerprint() !== state.profile.syncHash;
    un.textContent = pending ? (state.profile.autoSync ? "● Changes on this device not uploaded yet — uploading shortly." : "● Changes on this device are NOT uploaded. Tap Upload to cloud (or switch Auto-sync on).") : "";
  }
  if(state.profile.lastSyncAt && !$("#sync-status").textContent) setStatus("Last synced "+new Date(state.profile.lastSyncAt).toLocaleString());
}
// The module loads before saved data is read, so fill the fields once the app has booted.
window.addEventListener("load", ()=>{ renderSyncFields(); checkStorage(); });
renderSyncFields();
schedule(1500); // on open

// Tells the user plainly whether this browser is really keeping JAGU's data.
async function checkStorage(){
  const el = $("#storage-status"); if(!el) return;
  let ok = false;
  try{ localStorage.setItem("jagu_probe","1"); ok = localStorage.getItem("jagu_probe")==="1"; localStorage.removeItem("jagu_probe"); }catch(e){}
  let persisted = null;
  try{
    if(navigator.storage && navigator.storage.persist){ persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist()); }
  }catch(e){}
  const hasData = !!localStorage.getItem(LS_KEY);
  const pre = "[app "+BUILD+"] ";
  if(!ok) el.textContent = pre+"⚠ This browser is blocking saved data (private/incognito mode or site data blocked). Settings and keys will vanish on refresh — open JAGU in a normal (non-private) tab and allow site data.";
  else if(persisted===false) el.textContent = pre+"Storage works here, but the browser may clear it when space is low or after a few days without use. Adding JAGU to the home screen helps. "+(hasData?"":"(Nothing saved yet.)");
  else el.textContent = pre+"Storage OK — settings are kept on this device.";
}
