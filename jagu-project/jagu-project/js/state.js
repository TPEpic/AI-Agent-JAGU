import { $, showToast, uid } from './helpers.js';
import { renderAll } from './render.js';
import { greet } from './ai.js';

// ── CONSTANTS & STATE ──
export const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
export const DAY_LABELS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

export const state = {
  ready:false,
  profile: { name:"", onboarded:false, theme:"dark", voiceOut:true, convoMode:false, voiceURI:null, rate:1, pitch:1, avatar:null, role:"", about:"" },
  projects: [],
  tasks: [],
  timetable: [],
  events: [],
  memory: [],
  updates: [], // {projectId, text, createdAt} — voice/manual progress notes
  chatTurns: [], // {role:'user'|'assistant', text, ts}
  selectedDay: (new Date().getDay()+6)%7,
};

export const LS_KEY = "jagu_store_v1";


// ── STANDALONE DATA LAYER ──
export function persist(){
  const toSave = {
    profile: state.profile,
    projects: state.projects, tasks: state.tasks, timetable: state.timetable,
    events: state.events, memory: state.memory, updates: state.updates,
    chat: state.chatTurns,
  };
  try{ localStorage.setItem(LS_KEY, JSON.stringify(toSave)); }
  catch(e){ console.warn("localStorage save failed", e); showToast("Couldn't save — your browser's local storage may be full or disabled.", "error"); }
}
export function loadPersisted(){
  let saved = {};
  try{ saved = JSON.parse(localStorage.getItem(LS_KEY)) || {}; }catch(e){ saved = {}; }
  Object.assign(state.profile, {
    theme:"dark", voiceOut:true, convoMode:false, voiceURI:null, rate:1, pitch:1,
    provider:"gemini",
    geminiKey:"", geminiModel:"gemini-flash-latest",
    apiKey:"", model:"claude-sonnet-5",
    avatar:null, role:"", about:"",
  }, saved.profile||{});
  state.projects = saved.projects || [];
  state.tasks = saved.tasks || [];
  state.timetable = saved.timetable || [];
  state.events = saved.events || [];
  state.memory = saved.memory || [];
  state.updates = saved.updates || [];
  state.chatTurns = saved.chat || [];
}

export let bootDone = false;
function finishBoot(){
  if(bootDone) return; bootDone = true;
  applyTheme();
  if(!state.profile.onboarded){
    $("#onboarding").classList.remove("hidden");
  } else {
    greet();
  }
  renderAll();
}

export function activeProviderHasKey(){
  const p = state.profile.provider||"gemini";
  return p==="gemini" ? !!(state.profile.geminiKey||"").trim() : !!(state.profile.apiKey||"").trim();
}

export function initStandalone(){
  loadPersisted();
  const aiDot = $("#status-ai"), memDot = $("#status-mem");
  const hasKey = activeProviderHasKey();
  if(aiDot) aiDot.classList.add(hasKey ? "ok" : "warn");
  if(memDot) memDot.classList.add("ok");
  if(aiDot) aiDot.title = hasKey ? "AI key set" : "No API key set — add one in Settings for JAGU's AI brain";
  if(memDot) memDot.title = "Saved locally in this browser";
  finishBoot();
}



// ── PROFILE/SETTINGS PERSISTENCE ──
export async function saveProfile(patch){
  Object.assign(state.profile, patch);
  applyTheme();
  persist();
}

function applyTheme(){
  document.documentElement.setAttribute("data-theme", state.profile.theme==="light" ? "light" : "dark");
}


// ── GENERIC LOCAL WRITE HELPERS ──
export async function dbAdd(col, data){
  if(!Array.isArray(state[col])){ console.warn("unknown collection", col); return null; }
  const id = uid();
  const item = Object.assign({id: id}, data, {createdAt: new Date().toISOString()});
  state[col].push(item);
  persist();
  renderAll();
  return id;
}
export async function dbUpdate(col, id, patch){
  const item = (state[col]||[]).find(x=>x.id===id);
  if(!item) return false;
  Object.assign(item, patch);
  persist();
  renderAll();
  return true;
}
export async function dbDelete(col, id){
  if(!Array.isArray(state[col])) return false;
  const before = state[col].length;
  state[col] = state[col].filter(x=>x.id!==id);
  const found = state[col].length !== before;
  persist();
  renderAll();
  return found;
}

