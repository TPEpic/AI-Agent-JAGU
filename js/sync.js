import { $, showToast } from './helpers.js';
import { LS_KEY, loadPersisted, saveProfile, state } from './state.js';
import { renderAll } from './render.js';

// ── CROSS-DEVICE SYNC via a private GitHub Gist ──
// GitHub Pages is static, so there's no server to hold your data. Instead
// JAGU can push/pull its data to a private Gist in your own GitHub account.
// The token stays on each device; AI keys and the token are never uploaded.
const FILE = "jagu-data.json";
const KEYS = ["projects","tasks","timetable","events","memory","updates","marking","termDates",
  "learners","enrollments","classAssignments","learnerProgress","learnerHighlights","classNotes"];
const api = (path, opts={})=> fetch("https://api.github.com"+path, Object.assign({}, opts, {
  headers: Object.assign({Authorization:"Bearer "+state.profile.syncToken, Accept:"application/vnd.github+json", "Content-Type":"application/json"}, opts.headers||{}),
}));

function snapshot(){
  const profile = Object.assign({}, state.profile);
  ["apiKey","geminiKey","syncToken","syncGistId"].forEach(k=> delete profile[k]);
  const data = {profile, savedAt:new Date().toISOString()};
  KEYS.forEach(k=> data[k] = state[k]);
  return data;
}

function setStatus(t){ const el = $("#sync-status"); if(el) el.textContent = t; }

async function push(){
  if(!state.profile.syncToken){ showToast("Paste a GitHub token first.","error"); return; }
  setStatus("Uploading…");
  const files = {[FILE]:{content:JSON.stringify(snapshot())}};
  let res;
  if(state.profile.syncGistId){
    res = await api("/gists/"+state.profile.syncGistId, {method:"PATCH", body:JSON.stringify({files})});
  } else {
    res = await api("/gists", {method:"POST", body:JSON.stringify({description:"JAGU data (private)", public:false, files})});
  }
  if(!res.ok){ setStatus("Upload failed ("+res.status+") — check the token has the 'gist' permission."); showToast("Sync upload failed.","error"); return; }
  const g = await res.json();
  await saveProfile({syncGistId:g.id, lastSyncAt:new Date().toISOString()});
  setStatus("Uploaded "+new Date().toLocaleString()+". On your other device paste the same token and tap Download.");
  showToast("Data uploaded to your private Gist.");
}

async function findGist(){
  const res = await api("/gists?per_page=100");
  if(!res.ok) return null;
  const list = await res.json();
  const g = list.find(x=> x.files && x.files[FILE]);
  return g ? g.id : null;
}

async function pull(){
  if(!state.profile.syncToken){ showToast("Paste a GitHub token first.","error"); return; }
  setStatus("Downloading…");
  let id = state.profile.syncGistId || await findGist();
  if(!id){ setStatus("No JAGU data found in this GitHub account yet — tap Upload on your main device first."); return; }
  const res = await api("/gists/"+id);
  if(!res.ok){ setStatus("Download failed ("+res.status+")."); showToast("Sync download failed.","error"); return; }
  const g = await res.json();
  const f = g.files && g.files[FILE];
  let text = f && f.content;
  if(f && f.truncated && f.raw_url){ text = await (await fetch(f.raw_url)).text(); }
  let data;
  try{ data = JSON.parse(text); }catch(e){ setStatus("The synced file is unreadable."); return; }
  if(!confirm("This replaces the data on this device with the synced copy from "+(data.savedAt?new Date(data.savedAt).toLocaleString():"GitHub")+". Continue?")) { setStatus(""); return; }
  const current = JSON.parse(localStorage.getItem(LS_KEY)) || {};
  const cp = current.profile || {};
  const merged = Object.assign({}, current, {
    profile: Object.assign({}, cp, data.profile||{}, {apiKey:cp.apiKey, geminiKey:cp.geminiKey, syncToken:cp.syncToken, syncGistId:id, lastSyncAt:new Date().toISOString()}),
    chat: current.chat||[],
  });
  KEYS.forEach(k=> merged[k] = data[k]||[]);
  localStorage.setItem(LS_KEY, JSON.stringify(merged));
  loadPersisted();
  renderAll();
  setStatus("Downloaded "+new Date().toLocaleString()+".");
  showToast("Data synced to this device.");
}

const wrap = fn=> async ()=>{ try{ await fn(); }catch(e){ console.warn("sync failed", e); setStatus("Sync failed — check your connection."); showToast("Sync failed.","error"); } };
$("#sync-token").addEventListener("change", (e)=>{ saveProfile({syncToken:e.target.value.trim()}); showToast("Token saved on this device."); });
$("#sync-push").addEventListener("click", wrap(push));
$("#sync-pull").addEventListener("click", wrap(pull));
export function renderSyncFields(){
  const t = $("#sync-token"); if(t && document.activeElement!==t) t.value = state.profile.syncToken||"";
  if(state.profile.lastSyncAt) setStatus("Last synced "+new Date(state.profile.lastSyncAt).toLocaleString());
}
renderSyncFields();
