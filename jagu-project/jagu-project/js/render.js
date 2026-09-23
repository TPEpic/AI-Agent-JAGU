import { $, $$, daysUntil, esc, fmtMinutes, minToLabel, nowMin, pad2, showToast, timeToMin, todayIdx } from './helpers.js';
import { DAY_LABELS, DAY_NAMES, activeProviderHasKey, bootDone, dbAdd, dbDelete, dbUpdate, persist, state } from './state.js';
import { openFormModal, openTaskModal } from './modals.js';
import { openFocusSession } from './focus.js';

// ── NAVIGATION ──
function goScreen(name){
  $$(".screen").forEach(s=>s.classList.remove("active"));
  $("#screen-"+name).classList.add("active");
  $$(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.screen===name));
  if(name==="timetable") renderTimetable();
}
$$(".nav-btn").forEach(b=> b.addEventListener("click", ()=>goScreen(b.dataset.screen)));


// ── TIME/STATUS LOGIC ──
function todaysEntries(){
  const idx = todayIdx();
  return state.timetable.filter(e=>e.day===idx).sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));
}

export function computeStatus(){
  const entries = todaysEntries();
  const nm = nowMin();
  const current = entries.find(e=> timeToMin(e.start)<=nm && nm<timeToMin(e.end));
  if(current){
    return { state:"class", current, freeMinutes:0 };
  }
  const next = entries.find(e=> timeToMin(e.start) > nm);
  if(next){
    return { state:"free", next, freeMinutes: timeToMin(next.start)-nm };
  }
  return { state:"free", next:null, freeMinutes: 1440-nm };
}

export function greetingWord(){
  const h = new Date().getHours();
  if(h<12) return "Good morning";
  if(h<17) return "Good afternoon";
  return "Good evening";
}

function updateClock(){
  const d = new Date();
  $("#clock").textContent = pad2(d.getHours())+":"+pad2(d.getMinutes());
}
setInterval(updateClock, 15000); updateClock();


// ── RENDERING HOME ──
export function renderAll(){
  if(!bootDone) return;
  renderHomeStatus();
  renderSuggestion();
  renderDashboard();
  renderLearning();
  renderTimetable();
  renderSettingsFields();
}

function renderHomeStatus(){
  const name = state.profile.name || "there";
  $("#greeting-text").textContent = greetingWord()+", "+name.split(" ")[0]+".";

  const st = computeStatus();
  let line = "";
  if(st.state==="class"){
    line = "In "+esc(st.current.subject)+(st.current.room? " · Room "+esc(st.current.room):"")+" until "+minToLabel(timeToMin(st.current.end))+".";
  } else if(st.next){
    line = "Free for "+fmtMinutes(st.freeMinutes)+" · next: "+esc(st.next.subject)+" at "+minToLabel(timeToMin(st.next.start))+".";
  } else if(state.timetable.length===0){
    line = "No timetable added yet — add your classes so I can spot free time.";
  } else {
    line = "Free for the rest of the day.";
  }
  $("#status-line").textContent = line;
}

function pendingTasksFor(projectId){
  return state.tasks.filter(t=>t.projectId===projectId && t.status!=="done");
}
export function allPendingTasks(){
  return state.tasks.filter(t=>t.status!=="done");
}
export function projectById(id){ return state.projects.find(p=>p.id===id); }

export function projectProgress(project){
  const ts = state.tasks.filter(t=>t.projectId===project.id);
  if(ts.length===0) return project.progress||0;
  const done = ts.filter(t=>t.status==="done").length;
  return Math.round(done/ts.length*100);
}

export function pickFallbackTask(freeMinutes){
  const pending = allPendingTasks();
  if(pending.length===0) return null;
  // prefer tasks that fit the free window, from the project with the nearest deadline, else oldest
  const withMeta = pending.map(t=>{
    const p = projectById(t.projectId);
    const deadlineDays = p && p.deadline ? daysUntil(p.deadline) : 9999;
    return {t, p, deadlineDays, fits: freeMinutes ? (t.estMinutes||20) <= freeMinutes+5 : true};
  });
  withMeta.sort((a,b)=>{
    if(a.fits !== b.fits) return a.fits ? -1 : 1;
    if(a.deadlineDays !== b.deadlineDays) return a.deadlineDays - b.deadlineDays;
    return new Date(a.t.createdAt||0) - new Date(b.t.createdAt||0);
  });
  return withMeta[0];
}

function renderSuggestion(){
  const st = computeStatus();
  const box = $("#quick-suggestion");
  if(st.state==="class"){ box.classList.add("hidden"); return; }
  const pick = pickFallbackTask(st.freeMinutes);
  if(!pick){ box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  $("#suggestion-title").textContent = pick.t.title;
  const projName = pick.p ? pick.p.name : "Standalone";
  $("#suggestion-meta").textContent = projName+" · ~"+(pick.t.estMinutes||20)+" min";
  $("#suggestion-start").onclick = ()=> openFocusSession(pick.t, pick.t.estMinutes||25);
}


// ── RENDERING DASHBOARD ──
function renderDashboard(){
  const st = computeStatus();
  const entries = todaysEntries();
  let html = "";
  if(st.state==="class"){
    html += row("Now", esc(st.current.subject)+(st.current.room?" · Room "+esc(st.current.room):"")+" · until "+minToLabel(timeToMin(st.current.end)));
  } else {
    html += row("Free time", fmtMinutes(st.freeMinutes)+(st.next? " · until "+minToLabel(timeToMin(st.next.start)):""));
  }
  if(st.next) html += row("Next class", esc(st.next.subject)+" at "+minToLabel(timeToMin(st.next.start))+(st.next.room?" · Room "+esc(st.next.room):""));
  if(entries.length===0) html += row("Today", "No classes scheduled");
  const pick = pickFallbackTask(st.state==="free"?st.freeMinutes:null);
  if(pick) html += row("Recommended", pick.t.title+" · ~"+(pick.t.estMinutes||20)+" min");
  $("#today-card").innerHTML = html || row("Today","Nothing scheduled");

  function row(l,v){ return '<div class="today-row"><span class="label">'+esc(l)+'</span><span class="val">'+v+'</span></div>'; }

  const activeProjects = state.projects.filter(p=>!p.archived);
  $("#progress-list").innerHTML = activeProjects.length ? activeProjects.map(p=>{
    const pct = projectProgress(p);
    return '<div class="card"><div class="proj-top"><div><div class="proj-name">'+esc(p.name)+'</div><div class="proj-kind">'+esc(p.kind)+'</div></div><div class="proj-pct">'+pct+'%</div></div><div class="progress-track"><div class="progress-fill" style="width:'+pct+'%"></div></div></div>';
  }).join("") : '<div class="empty-state">No projects or courses yet. Add one from the Learning tab.</div>';

  renderUpcomingEvents("#events-list");

  const recentNotes = state.updates.slice(0,5);
  const notesTarget = $("#dash-notes");
  if(notesTarget){
    notesTarget.innerHTML = recentNotes.length ? recentNotes.map(n=>{
      const p = projectById(n.projectId);
      const d = new Date(n.createdAt);
      const when = d.toLocaleDateString("en-GB",{day:"numeric",month:"short"});
      return '<div class="note-row"><span class="note-dot"></span><div class="note-body"><div class="note-text">'+esc(n.text)+(p?' <span style="color:var(--text-faint);">— '+esc(p.name)+'</span>':'')+'</div><div class="note-when">'+when+'</div></div></div>';
    }).join("") : '<div class="empty-state">No notes yet — tell JAGU an update and I\'ll log it here.</div>';
  }
}

function renderUpcomingEvents(sel){
  const upcoming = state.events.filter(e=>daysUntil(e.date)>=0).sort((a,b)=>daysUntil(a.date)-daysUntil(b.date)).slice(0,6);
  const target = $(sel);
  if(!target) return;
  target.innerHTML = upcoming.length ? upcoming.map(e=>{
    const dleft = daysUntil(e.date);
    const when = dleft===0?"Today":dleft===1?"Tomorrow":"In "+dleft+" days";
    return '<div class="event-row"><div><div class="event-title">'+esc(e.title)+'</div><div class="event-when">'+when+'</div></div><div class="event-badge">'+esc(when)+'</div></div>';
  }).join("") : '<div class="empty-state">No upcoming events.</div>';
}


// ── RENDERING LEARNING ──
function renderLearning(){
  const list = $("#projects-list");
  const projects = state.projects.filter(p=>!p.archived);
  if(projects.length===0){
    list.innerHTML = '<div class="empty-state">Nothing here yet. Add a project or course to start tracking progress.</div>';
    return;
  }
  list.innerHTML = projects.map(p=>{
    const pct = projectProgress(p);
    const tasks = state.tasks.filter(t=>t.projectId===p.id).sort((a,b)=> (a.status==="done")-(b.status==="done") || new Date(a.createdAt)-new Date(b.createdAt));
    const taskHtml = tasks.length ? tasks.map(t=>taskRowHtml(t)).join("") : '<div style="color:var(--text-faint); font-size:12.5px; padding:6px 0;">No tasks yet.</div>';
    const notes = state.updates.filter(u=>u.projectId===p.id).slice(0,3);
    const notesHtml = notes.length ? '<div class="note-list">'+notes.map(n=>noteRowHtml(n)).join("")+'</div>' : '';
    return '<div class="proj-card" data-project="'+p.id+'">'
      + '<div class="proj-top"><div><div class="proj-name">'+esc(p.name)+'</div><div class="proj-kind">'+esc(p.kind)+(p.deadline?" · due "+esc(p.deadline):"")+'</div></div><div class="proj-pct">'+pct+'%</div></div>'
      + '<div class="progress-track"><div class="progress-fill" style="width:'+pct+'%"></div></div>'
      + '<div class="task-list">'+taskHtml+'</div>'
      + '<a class="link-row" data-add-task="'+p.id+'">+ Add task</a>'
      + '<a class="link-row" data-add-note="'+p.id+'" style="margin-left:14px;">+ Note</a>'
      + '<a class="link-row" data-del-project="'+p.id+'" style="color:var(--danger); float:right;">Delete</a>'
      + notesHtml
      + '</div>';
  }).join("");

  $$('[data-add-task]', list).forEach(el=> el.addEventListener("click", ()=> openTaskModal(el.dataset.addTask)));
  $$('[data-add-note]', list).forEach(el=> el.addEventListener("click", ()=> openNoteModal(el.dataset.addNote)));
  $$('[data-del-project]', list).forEach(el=> el.addEventListener("click", ()=> confirmDeleteProject(el.dataset.delProject)));
  $$('.task-check', list).forEach(el=> el.addEventListener("click", ()=> toggleTask(el.dataset.task)));
  $$('.task-del', list).forEach(el=> el.addEventListener("click", ()=> deleteTask(el.dataset.task)));
  $$('.note-del', list).forEach(el=> el.addEventListener("click", ()=> deleteNote(el.dataset.note)));
}

function noteRowHtml(n){
  const d = new Date(n.createdAt);
  const when = d.toLocaleDateString("en-GB",{day:"numeric",month:"short"});
  return '<div class="note-row"><span class="note-dot"></span><div class="note-body"><div class="note-text">'+esc(n.text)+'</div><div class="note-when">'+when+'</div></div><span class="task-del note-del" data-note="'+n.id+'">✕</span></div>';
}
async function deleteNote(id){ await dbDelete("updates", id); }

function openNoteModal(projectId){
  openFormModal("Add note", [
    {name:"text", label:"What's the update?", placeholder:"e.g. Finished the literature review draft"},
  ], async (data)=>{
    if(!data.text) return;
    await dbAdd("updates", {projectId, text:data.text});
    showToast("Noted.");
  }, "Save");
}

function taskRowHtml(t){
  const done = t.status==="done";
  return '<div class="task-row">'
    + '<button class="task-check '+(done?"done":"")+'" data-task="'+t.id+'">'+(done?"✓":"")+'</button>'
    + '<span class="task-title '+(done?"done":"")+'">'+esc(t.title)+'</span>'
    + '<span class="task-min">'+(t.estMinutes||20)+'m</span>'
    + '<span class="task-del" data-task="'+t.id+'">✕</span>'
    + '</div>';
}

export async function toggleTask(taskId){
  const t = state.tasks.find(x=>x.id===taskId); if(!t) return;
  const done = t.status!=="done";
  await dbUpdate("tasks", taskId, { status: done?"done":"pending", completedAt: done? new Date().toISOString(): null });
  if(done) showToast("Nice work — marked complete.");
}
async function deleteTask(taskId){
  if(!confirm("Delete this task?")) return;
  await dbDelete("tasks", taskId);
}
async function confirmDeleteProject(id){
  if(!confirm("Delete this project and its tasks?")) return;
  const related = state.tasks.filter(t=>t.projectId===id);
  for(const t of related) await dbDelete("tasks", t.id);
  await dbDelete("projects", id);
}


// ── RENDERING TIMETABLE ──
function renderTimetable(){
  const tabs = $("#day-tabs");
  tabs.innerHTML = DAY_NAMES.map((d,i)=> '<button class="day-tab '+(i===state.selectedDay?"active":"")+'" data-day="'+i+'">'+d+'</button>').join("");
  $$(".day-tab", tabs).forEach(b=> b.addEventListener("click", ()=>{ state.selectedDay = Number(b.dataset.day); renderTimetable(); }));

  const entries = state.timetable.filter(e=>e.day===state.selectedDay).sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));
  const list = $("#timetable-list");
  list.innerHTML = entries.length ? entries.map(e=>{
    return '<div class="tt-row"><div class="tt-time">'+e.start+'<span class="tt-end">'+e.end+'</span></div><div class="tt-info"><div class="tt-subject">'+esc(e.subject)+'</div>'+(e.room?'<div class="tt-room">Room '+esc(e.room)+'</div>':'')+'</div><span class="task-del" data-tt="'+e.id+'">✕</span></div>';
  }).join("") : '<div class="empty-state">No classes on '+DAY_LABELS[state.selectedDay]+'.</div>';
  $$('[data-tt]', list).forEach(el=> el.addEventListener("click", async ()=>{ if(confirm("Remove this class?")) await dbDelete("timetable", el.dataset.tt); }));

  renderUpcomingEvents("#events-list-2");
}


// ── RENDERING SETTINGS ──
let voicesLoaded = false;
function populateVoices(){
  if(!("speechSynthesis" in window)) return;
  const voices = speechSynthesis.getVoices();
  if(voices.length===0) return;
  voicesLoaded = true;
  const sel = $("#settings-voice");
  const preferred = voices.filter(v=>v.lang && v.lang.startsWith("en"));
  const list = preferred.length? preferred : voices;
  sel.innerHTML = list.map(v=>'<option value="'+esc(v.voiceURI)+'">'+esc(v.name)+' ('+v.lang+')</option>').join("");
  if(state.profile.voiceURI && list.some(v=>v.voiceURI===state.profile.voiceURI)){
    sel.value = state.profile.voiceURI;
  } else if(list[0]){
    sel.value = list[0].voiceURI;
  }
}
if("speechSynthesis" in window){
  speechSynthesis.onvoiceschanged = populateVoices;
  populateVoices();
}

export function renderSettingsFields(){
  $("#settings-name").value = state.profile.name || "";
  $("#settings-rate").value = state.profile.rate ?? 1;
  $("#settings-pitch").value = state.profile.pitch ?? 1;
  $("#settings-provider").value = state.profile.provider || "gemini";
  $("#settings-gemini-key").value = state.profile.geminiKey || "";
  $("#settings-gemini-model").value = state.profile.geminiModel || "gemini-flash-latest";
  $("#settings-apikey").value = state.profile.apiKey || "";
  $("#settings-model").value = state.profile.model || "claude-sonnet-5";
  const isGemini = (state.profile.provider||"gemini")==="gemini";
  $("#gemini-fields").classList.toggle("hidden", !isGemini);
  $("#anthropic-fields").classList.toggle("hidden", isGemini);
  $("#toggle-voice-out").classList.toggle("on", !!state.profile.voiceOut);
  $("#toggle-convo-mode").classList.toggle("on", !!state.profile.convoMode);
  $("#mute-btn").classList.toggle("muted", !state.profile.voiceOut);
  if(voicesLoaded) populateVoices();
}

export function refreshAiStatusDot(){
  const aiDot = $("#status-ai");
  if(!aiDot) return;
  aiDot.classList.remove("ok","warn");
  aiDot.classList.add(activeProviderHasKey() ? "ok" : "warn");
}


// ── CHAT TRANSCRIPT ──
function renderTranscript(){
  const box = $("#transcript");
  const recent = state.chatTurns.slice(-12);
  box.innerHTML = recent.map(t=>{
    if(t.role==="system") return '<div class="bubble system">'+esc(t.text)+'</div>';
    return '<div class="bubble '+(t.role==="user"?"user":"jagu")+'">'+esc(t.text)+'</div>';
  }).join("");
  box.scrollTop = box.scrollHeight;
}
export function addChatBubble(role, text){
  state.chatTurns.push({role, text, ts:new Date().toISOString()});
  state.chatTurns = state.chatTurns.slice(-30);
  renderTranscript();
  persist();
}


// ── REMINDER CHECKS ──
setInterval(()=>{
  if(!bootDone) return;
  renderHomeStatus();
  renderSuggestion();
  if($("#screen-dashboard").classList.contains("active")) renderDashboard();
}, 60000);

