import { $, $$, addDaysISO, daysUntil, esc, fmtMinutes, minToClock, minToLabel, nowMin, pad2, showToast, timeToMin, todayIdx, todayISO } from './helpers.js';
import { DAY_LABELS, DAY_NAMES, activeProviderHasKey, bootDone, dbAdd, dbDelete, dbUpdate, persist, state } from './state.js';
import { deleteEvent, openClassNotesModal, openEditClassModal, openEditEventModal, openEditTaskModal, openFormModal, openTaskModal } from './modals.js';
import { openFocusSession } from './focus.js';
import { speak } from './voice.js';
import { activeTaskRemindersForClass, classKeyFor, openClassWorkspace, renderClassroom } from './classroom.js';

// ── NAVIGATION ──
function goScreen(name){
  $$(".screen").forEach(s=>s.classList.remove("active"));
  $("#screen-"+name).classList.add("active");
  $$(".nav-btn").forEach(b=>b.classList.toggle("active", b.dataset.screen===name));
  if(name==="timetable"){ state.selectedDay = todayIdx(); renderTimetable(); }
}
$$(".nav-btn").forEach(b=> b.addEventListener("click", ()=>goScreen(b.dataset.screen)));
$("#home-avatar").addEventListener("click", ()=> goScreen("settings"));


// ── TIME/STATUS LOGIC ──
function todaysEntries(){
  const idx = todayIdx(), iso = todayISO();
  // A cover session only counts on its actual date; a regular recurring
  // class (no date set) counts on its weekly weekday as before.
  return state.timetable.filter(e=> e.date ? e.date===iso : e.day===idx).sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));
}

// ── WORK-DAY / TEACHING-LOAD STATS (Dashboard) ──
export const WORK_START_MIN = 9*60, WORK_END_MIN = 17*60;
function overlapMinutes(startMin, endMin, winStart, winEnd){
  return Math.max(0, Math.min(endMin, winEnd) - Math.max(startMin, winStart));
}
function computeTeachingStats(){
  const today = todaysEntries();
  let teachingTodayMin = 0;
  today.forEach(e=> teachingTodayMin += overlapMinutes(timeToMin(e.start), timeToMin(e.end), WORK_START_MIN, WORK_END_MIN));
  // Regular recurring classes always count; a cover session only counts
  // toward this week's total while its date actually falls in this week --
  // otherwise a one-off cover from months ago would inflate it forever.
  const weekStart = addDaysISO(todayISO(), -todayIdx()), weekEnd = addDaysISO(weekStart, 6);
  let teachingWeekMin = 0;
  state.timetable.forEach(e=>{
    if(e.date && (e.date<weekStart || e.date>weekEnd)) return;
    teachingWeekMin += overlapMinutes(timeToMin(e.start), timeToMin(e.end), WORK_START_MIN, WORK_END_MIN);
  });
  const freeTodayMin = Math.max(0, (WORK_END_MIN-WORK_START_MIN) - teachingTodayMin);
  return {
    workDayMin: WORK_END_MIN-WORK_START_MIN,
    teachingTodayMin, teachingTodayCount: today.length,
    freeTodayMin, teachingWeekMin,
  };
}

function ttRowHtml(e){
  const hasNotes = !!(e.notes && e.notes.trim());
  const dateLabel = e.date ? new Date(e.date+"T00:00:00").toLocaleDateString("en-GB",{weekday:"short", day:"numeric", month:"short"}) : "";
  const coverLine = e.isCover ? '<div class="tt-cover-badge">COVER'+(dateLabel?" · "+dateLabel:"")+(e.coverFor?" · for "+esc(e.coverFor):"")+'</div>' : "";
  return '<div class="tt-row"><div class="tt-time">'+minToClock(timeToMin(e.start))+'<span class="tt-end">'+minToClock(timeToMin(e.end))+'</span></div><div class="tt-info">'+coverLine+'<div class="tt-subject">'+esc(e.subject)+'</div>'+(e.room?'<div class="tt-room">Room '+esc(e.room)+'</div>':'')
    + (hasNotes?'<div class="tt-note">'+esc(e.notes)+'</div>':'')
    + '<div class="row-gap" style="margin-top:6px;">'
      + '<a class="link-row" data-tt-class="'+esc(e.subject)+'" style="font-size:12px; margin:0; font-weight:700;">Open class →</a>'
      + '<a class="link-row" data-tt-edit="'+e.id+'" style="font-size:12px; margin:0;">Edit</a>'
      + '<a class="link-row" data-tt-note="'+e.id+'" style="font-size:12px; margin:0;">'+(hasNotes?"Edit note":"+ Add note")+'</a>'
    + '</div>'
    + '</div><span class="task-del" data-tt="'+e.id+'">✕</span></div>';
}
function wireTtRowDeletes(root){
  $$('[data-tt]', root).forEach(el=> el.addEventListener("click", async ()=>{ if(confirm("Remove this class?")) await dbDelete("timetable", el.dataset.tt); }));
  $$('[data-tt-note]', root).forEach(el=> el.addEventListener("click", ()=> openClassNotesModal(el.dataset.ttNote)));
  $$('[data-tt-edit]', root).forEach(el=> el.addEventListener("click", ()=> openEditClassModal(el.dataset.ttEdit)));
  $$('[data-tt-class]', root).forEach(el=> el.addEventListener("click", ()=> openClassWorkspace(classKeyFor(el.dataset.ttClass))));
}

// "Free" here always means free WITHIN the 9-5 working day -- outside
// that window is its own before-hours/after-hours state, never counted
// as free time to work through.
export function computeStatus(){
  const entries = todaysEntries();
  const nm = nowMin();
  const current = entries.find(e=> timeToMin(e.start)<=nm && nm<timeToMin(e.end));
  if(current){
    return { state:"class", current, freeMinutes:0 };
  }
  if(nm < WORK_START_MIN){
    return { state:"before-hours", next: entries.find(e=> timeToMin(e.start) > nm) || null, freeMinutes:0 };
  }
  if(nm >= WORK_END_MIN){
    return { state:"after-hours", next:null, freeMinutes:0 };
  }
  const next = entries.find(e=> timeToMin(e.start) > nm);
  if(next){
    return { state:"free", next, freeMinutes: timeToMin(next.start)-nm };
  }
  return { state:"free", next:null, freeMinutes: WORK_END_MIN-nm };
}

export function greetingWord(){
  const h = new Date().getHours();
  if(h<12) return "Good morning";
  if(h<17) return "Good afternoon";
  return "Good evening";
}

// Looks up which entry in state.termDates today falls inside (if any) and
// the next one coming up, so the app can say things like "12 days to half-term".
export function currentTermInfo(){
  const todayStr = todayISO();
  const sorted = state.termDates.slice().sort((a,b)=> a.start.localeCompare(b.start));
  const current = sorted.find(t=> t.start<=todayStr && todayStr<=t.end);
  const next = sorted.find(t=> t.start>todayStr);
  return { current, next };
}

function updateClock(){
  const d = new Date();
  $("#clock").textContent = minToClock(d.getHours()*60+d.getMinutes());
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
  renderClassroom();
}

function renderHomeStatus(){
  const name = state.profile.name || "there";
  $("#greeting-text").textContent = greetingWord()+", "+name.split(" ")[0]+".";

  const homeAvatar = $("#home-avatar");
  if(homeAvatar){
    const initial = (state.profile.name||"?").trim().charAt(0).toUpperCase() || "?";
    homeAvatar.style.backgroundImage = state.profile.avatar ? "url('"+state.profile.avatar+"')" : "";
    homeAvatar.textContent = state.profile.avatar ? "" : initial;
  }

  const st = computeStatus();
  let line = "";
  if(st.state==="class"){
    line = "In "+esc(st.current.subject)+(st.current.room? " · Room "+esc(st.current.room):"")+" until "+minToLabel(timeToMin(st.current.end))+".";
  } else if(st.state==="before-hours"){
    line = "Working day starts at "+minToLabel(WORK_START_MIN)+(st.next? " · first class: "+esc(st.next.subject)+" at "+minToLabel(timeToMin(st.next.start)):"")+".";
  } else if(st.state==="after-hours"){
    line = "Working day ended at "+minToLabel(WORK_END_MIN)+".";
  } else if(st.next){
    line = "Free for "+fmtMinutes(st.freeMinutes)+" · next: "+esc(st.next.subject)+" at "+minToLabel(timeToMin(st.next.start))+".";
  } else if(state.timetable.length===0){
    line = "No timetable added yet — add your classes so I can spot free time.";
  } else {
    line = "Free for the rest of the working day.";
  }
  $("#status-line").innerHTML = line;

  const term = currentTermInfo();
  const termLine = $("#term-line");
  if(termLine){
    if(term.current){
      let txt = term.current.name;
      if(term.next) txt += " · "+daysUntil(term.next.start)+" day(s) to "+term.next.name;
      termLine.textContent = txt;
      termLine.classList.remove("hidden");
    } else if(term.next){
      termLine.textContent = (term.next.type==="holiday"?"On teaching break":"Between terms")+" · "+term.next.name+" starts in "+daysUntil(term.next.start)+" day(s)";
      termLine.classList.remove("hidden");
    } else {
      termLine.classList.add("hidden");
    }
  }

  renderHomeHighlights();
}

// A quick glance at the next 1-2 upcoming events, each clearly tagged
// Work or Personal, so Tahira doesn't have to open the Dashboard to see
// what's coming.
function renderHomeHighlights(){
  const target = $("#home-highlights");
  if(!target) return;
  const upcoming = state.events.filter(e=>daysUntil(e.date)>=0).sort((a,b)=>daysUntil(a.date)-daysUntil(b.date)).slice(0,2);
  if(!upcoming.length){ target.classList.add("hidden"); target.innerHTML=""; return; }
  target.classList.remove("hidden");
  target.innerHTML = upcoming.map(e=>{
    const dleft = daysUntil(e.date);
    const when = dleft===0?"Today":dleft===1?"Tomorrow":"In "+dleft+" days";
    const cat = e.category==="personal" ? "personal" : "work";
    return '<div class="highlight-row '+cat+'"><span class="highlight-cat">'+(cat==="personal"?"Personal":"Work")+'</span><span class="highlight-title">'+esc(e.title)+'</span><span class="highlight-when">'+when+'</span></div>';
  }).join("");
}

function pendingTasksFor(projectId){
  return state.tasks.filter(t=>t.projectId===projectId && t.status!=="done");
}
export function allPendingTasks(){
  return state.tasks.filter(t=>t.status!=="done");
}
export function projectById(id){ return state.projects.find(p=>p.id===id); }

// A task's own category wins; otherwise it takes its parent project's
// category; otherwise (no category anywhere) it defaults to work.
export function taskCategory(t){
  if(t.category==="personal" || t.category==="work") return t.category;
  const p = projectById(t.projectId);
  return (p && p.category==="personal") ? "personal" : "work";
}

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
  if(st.state!=="free"){ box.classList.add("hidden"); return; }
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
  const profileCard = $("#dash-profile");
  const hasProfileInfo = state.profile.avatar || state.profile.role || state.profile.about;
  profileCard.classList.toggle("hidden", !hasProfileInfo);
  if(hasProfileInfo){
    const initial = (state.profile.name||"?").trim().charAt(0).toUpperCase() || "?";
    const avatarHtml = state.profile.avatar
      ? '<div class="avatar" style="background-image:url(\''+state.profile.avatar+'\')"></div>'
      : '<div class="avatar">'+esc(initial)+'</div>';
    profileCard.innerHTML = avatarHtml
      + '<div><div class="profile-name">'+esc(state.profile.name||"")+'</div>'
      + (state.profile.role?'<div class="profile-role">'+esc(state.profile.role)+'</div>':'')
      + (state.profile.about?'<div class="profile-about">'+esc(state.profile.about)+'</div>':'')
      + '</div>';
  }

  const stats = computeTeachingStats();
  const workHoursLabel = minToLabel(WORK_START_MIN)+" – "+minToLabel(WORK_END_MIN);
  const statTiles = [
    ["Work day", fmtMinutes(stats.workDayMin), workHoursLabel],
    ["Teaching today", stats.teachingTodayCount+(stats.teachingTodayCount===1?" class":" classes"), fmtMinutes(stats.teachingTodayMin)],
    ["Free today", fmtMinutes(stats.freeTodayMin), "within "+workHoursLabel],
    ["Teaching this week", fmtMinutes(stats.teachingWeekMin), "across all days"],
  ];
  const term = currentTermInfo();
  if(term.current) statTiles.push(["Current term", term.current.name, term.next? daysUntil(term.next.start)+" day(s) to "+term.next.name : "no upcoming break set"]);
  else if(term.next) statTiles.push(["Term status", "On break", term.next.name+" in "+daysUntil(term.next.start)+" day(s)"]);
  $("#dash-stats").innerHTML = statTiles.map(([label,val,sub])=> '<div class="stat-tile"><div class="stat-value">'+esc(val)+'</div><div class="stat-label">'+esc(label)+' · '+esc(sub)+'</div></div>').join("");

  const st = computeStatus();
  const entries = todaysEntries();
  let html = "";
  if(st.state==="class"){
    html += row("Now", esc(st.current.subject)+(st.current.room?" · Room "+esc(st.current.room):"")+" · until "+minToLabel(timeToMin(st.current.end)));
  } else if(st.state==="before-hours"){
    html += row("Today", "Working day starts at "+minToLabel(WORK_START_MIN));
  } else if(st.state==="after-hours"){
    html += row("Today", "Working day ended at "+minToLabel(WORK_END_MIN));
  } else {
    html += row("Free time", fmtMinutes(st.freeMinutes)+(st.next? " · until "+minToLabel(timeToMin(st.next.start)):""));
  }
  if(st.next) html += row("Next class", esc(st.next.subject)+" at "+minToLabel(timeToMin(st.next.start))+(st.next.room?" · Room "+esc(st.next.room):""));
  if(entries.length===0) html += row("Today", "No classes scheduled");
  const pick = pickFallbackTask(st.state==="free"?st.freeMinutes:null);
  if(pick) html += row("Recommended", pick.t.title+" · ~"+(pick.t.estMinutes||20)+" min");
  $("#today-card").innerHTML = html || row("Today","Nothing scheduled");

  function row(l,v){ return '<div class="today-row"><span class="label">'+esc(l)+'</span><span class="val">'+v+'</span></div>'; }

  const classesList = $("#today-classes-list");
  classesList.innerHTML = entries.length ? entries.map(ttRowHtml).join("") : '<div class="empty-state">No classes today.</div>';
  wireTtRowDeletes(classesList);

  renderMarking("#marking-list");

  const activeProjects = state.projects.filter(p=>!p.archived);
  $("#progress-list").innerHTML = activeProjects.length ? activeProjects.map(p=>{
    const pct = projectProgress(p);
    return '<div class="card"><div class="proj-top"><div><div class="proj-name">'+esc(p.name)+'</div><div class="proj-kind">'+esc(p.kind)+'</div></div><div class="proj-pct">'+pct+'%</div></div><div class="progress-track"><div class="progress-fill" style="width:'+pct+'%"></div></div></div>';
  }).join("") : '<div class="empty-state">No projects or courses yet. Add one from the Learning tab.</div>';

  renderCategoryPanel("work", "#work-todo-list", "#work-events-list");
  renderCategoryPanel("personal", "#personal-todo-list", "#personal-events-list");

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

function todoRowHtml(t){
  const p = projectById(t.projectId);
  const meta = (p?esc(p.name)+" · ":"")+(t.estMinutes||20)+" min";
  return '<div class="event-row">'
    + '<div style="display:flex; align-items:center; gap:11px; min-width:0;">'
      + '<button class="task-check" data-task-check="'+t.id+'" aria-label="Mark done"></button>'
      + '<div style="min-width:0; cursor:pointer;" data-task-edit="'+t.id+'"><div class="event-title">'+esc(t.title)+'</div><div class="event-when">'+meta+'</div></div>'
    + '</div>'
    + '<span class="task-del" data-task-del="'+t.id+'" title="Delete">✕</span>'
    + '</div>';
}
function wireTodoRowActions(root){
  $$('[data-task-check]', root).forEach(el=> el.addEventListener("click", ()=> toggleTask(el.dataset.taskCheck)));
  $$('[data-task-edit]', root).forEach(el=> el.addEventListener("click", ()=> openEditTaskModal(el.dataset.taskEdit)));
  $$('[data-task-del]', root).forEach(el=> el.addEventListener("click", ()=> deleteTask(el.dataset.taskDel)));
}

function eventRowHtml(e){
  const dleft = daysUntil(e.date);
  const when = dleft===0?"Today":dleft===1?"Tomorrow":"In "+dleft+" days";
  return '<div class="event-row"><div style="cursor:pointer;" data-event-edit="'+e.id+'"><div class="event-title">'+esc(e.title)+'</div><div class="event-when">'+when+'</div></div>'
    + '<div style="display:flex; flex-direction:column; align-items:flex-end; gap:6px;">'
      + '<div class="event-badge">'+esc(when)+'</div>'
      + '<span class="task-del" data-event-del="'+e.id+'" title="Delete">✕</span>'
    + '</div></div>';
}
function wireEventRowActions(root){
  $$('[data-event-edit]', root).forEach(el=> el.addEventListener("click", ()=> openEditEventModal(el.dataset.eventEdit)));
  $$('[data-event-del]', root).forEach(el=> el.addEventListener("click", ()=> deleteEvent(el.dataset.eventDel)));
}

// Renders one category's (work/personal) Tasks and Events panels on the
// Dashboard — a task or event's own category decides which side it's on.
function renderCategoryPanel(category, taskSel, eventSel){
  const taskTarget = $(taskSel);
  if(taskTarget){
    const pending = allPendingTasks().filter(t=> taskCategory(t)===category).sort((a,b)=> new Date(a.createdAt||0)-new Date(b.createdAt||0));
    taskTarget.innerHTML = pending.length ? pending.map(todoRowHtml).join("") : '<div class="empty-sub">Nothing to do.</div>';
    wireTodoRowActions(taskTarget);
  }
  const eventTarget = $(eventSel);
  if(eventTarget){
    const upcoming = state.events.filter(e=> daysUntil(e.date)>=0 && (e.category==="personal"?"personal":"work")===category).sort((a,b)=>daysUntil(a.date)-daysUntil(b.date));
    eventTarget.innerHTML = upcoming.length ? upcoming.map(eventRowHtml).join("") : '<div class="empty-sub">No upcoming events.</div>';
    wireEventRowActions(eventTarget);
  }
}

function markingRowHtml(m){
  const done = (m.marked||0) >= m.total;
  const pct = m.total>0 ? Math.round(Math.min(1, (m.marked||0)/m.total)*100) : 0;
  let due = "";
  if(m.dueDate){
    const d = daysUntil(m.dueDate);
    due = d===0 ? "Due today" : d<0 ? "Overdue" : "Due in "+d+" day(s)";
  }
  return '<div class="card marking-row">'
    + '<div class="proj-top"><div><div class="proj-name">'+esc(m.assignment)+'</div><div class="proj-kind">'+esc(m.className)+(due?" · "+due:"")+'</div></div><div class="proj-pct">'+(done?"Done":(m.marked||0)+"/"+m.total)+'</div></div>'
    + (!done ? '<div class="progress-track"><div class="progress-fill" style="width:'+pct+'%"></div></div>' : '')
    + '<div class="row-gap" style="justify-content:flex-start; margin-top:12px;">'
      + (!done ? '<button class="btn-small" data-mark-inc="'+m.id+'">+1 marked</button>' : '')
      + '<button class="btn-small ghost" data-mark-done="'+m.id+'">'+(done?"Reopen":"Mark all done")+'</button>'
      + '<button class="btn-small ghost" data-mark-del="'+m.id+'" style="color:var(--danger); border-color:var(--danger);">Delete</button>'
    + '</div></div>';
}
function renderMarking(sel){
  const target = $(sel);
  if(!target) return;
  const items = state.marking.slice().sort((a,b)=>{
    const aDone = (a.marked||0)>=a.total, bDone = (b.marked||0)>=b.total;
    if(aDone!==bDone) return aDone?1:-1;
    const ad = a.dueDate?daysUntil(a.dueDate):9999, bd = b.dueDate?daysUntil(b.dueDate):9999;
    return ad-bd;
  });
  if(!items.length){ target.innerHTML = '<div class="empty-state">Nothing to mark right now.</div>'; return; }
  target.innerHTML = items.map(markingRowHtml).join("");
  $$('[data-mark-inc]', target).forEach(el=> el.addEventListener("click", ()=> incMarking(el.dataset.markInc)));
  $$('[data-mark-done]', target).forEach(el=> el.addEventListener("click", ()=> toggleMarkingDone(el.dataset.markDone)));
  $$('[data-mark-del]', target).forEach(el=> el.addEventListener("click", ()=> deleteMarking(el.dataset.markDel)));
}
async function incMarking(id){
  const m = state.marking.find(x=>x.id===id); if(!m) return;
  await dbUpdate("marking", id, {marked: Math.min(m.total, (m.marked||0)+1)});
}
async function toggleMarkingDone(id){
  const m = state.marking.find(x=>x.id===id); if(!m) return;
  const done = (m.marked||0) >= m.total;
  await dbUpdate("marking", id, {marked: done?0:m.total});
}
async function deleteMarking(id){
  if(!confirm("Delete this marking batch?")) return;
  await dbDelete("marking", id);
}


// ── RENDERING LEARNING ──
function projectCardHtml(p){
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
}

function renderLearning(){
  const list = $("#projects-list");
  const projects = state.projects.filter(p=>!p.archived);
  if(projects.length===0){
    list.innerHTML = '<div class="empty-state">Nothing here yet. Add a project or course to start tracking progress.</div>';
    return;
  }
  const work = projects.filter(p=> p.category!=="personal");
  const personal = projects.filter(p=> p.category==="personal");
  const section = (label, ps)=> ps.length ? '<div class="event-group-label">'+label+'</div>'+ps.map(projectCardHtml).join("") : "";
  list.innerHTML = section("Work", work) + section("Personal", personal);

  $$('[data-add-task]', list).forEach(el=> el.addEventListener("click", ()=> openTaskModal(el.dataset.addTask)));
  $$('[data-add-note]', list).forEach(el=> el.addEventListener("click", ()=> openNoteModal(el.dataset.addNote)));
  $$('[data-del-project]', list).forEach(el=> el.addEventListener("click", ()=> confirmDeleteProject(el.dataset.delProject)));
  $$('.task-check', list).forEach(el=> el.addEventListener("click", ()=> toggleTask(el.dataset.task)));
  $$('.task-del', list).forEach(el=> el.addEventListener("click", ()=> deleteTask(el.dataset.task)));
  $$('[data-task-edit]', list).forEach(el=> el.addEventListener("click", ()=> openEditTaskModal(el.dataset.taskEdit)));
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
    + '<span class="task-title '+(done?"done":"")+'" data-task-edit="'+t.id+'" style="cursor:pointer;">'+esc(t.title)+'</span>'
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

  // A past cover session drops off the weekday view on its own once its
  // date has gone by, so old one-off cover slots don't linger forever.
  const entries = state.timetable.filter(e=> e.day===state.selectedDay && (!e.date || e.date>=todayISO())).sort((a,b)=>timeToMin(a.start)-timeToMin(b.start));
  const list = $("#timetable-list");
  list.innerHTML = entries.length ? entries.map(ttRowHtml).join("") : '<div class="empty-state">No classes on '+DAY_LABELS[state.selectedDay]+'.</div>';
  wireTtRowDeletes(list);
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
  $("#settings-role").value = state.profile.role || "";
  $("#settings-about").value = state.profile.about || "";
  const avatarPreview = $("#settings-avatar-preview");
  const initial = (state.profile.name||"?").trim().charAt(0).toUpperCase() || "?";
  avatarPreview.style.backgroundImage = state.profile.avatar ? "url('"+state.profile.avatar+"')" : "";
  avatarPreview.textContent = state.profile.avatar ? "" : initial;
  $("#settings-avatar-remove").classList.toggle("hidden", !state.profile.avatar);
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
  $("#toggle-notifications").classList.toggle("on", !!state.profile.notifyEnabled);
  $("#mute-btn").classList.toggle("muted", !state.profile.voiceOut);
  if(voicesLoaded) populateVoices();
  renderTermDatesList();
}

function termRowHtml(t){
  return '<div class="event-row"><div><div class="event-title">'+esc(t.name)+'</div><div class="event-when">'+esc(t.start)+' – '+esc(t.end)+' · '+(t.type==="holiday"?"Holiday":"Term")+'</div></div><span class="task-del" data-term-del="'+t.id+'">✕</span></div>';
}
function renderTermDatesList(){
  const target = $("#term-dates-list");
  if(!target) return;
  const sorted = state.termDates.slice().sort((a,b)=> a.start.localeCompare(b.start));
  target.innerHTML = sorted.length ? sorted.map(termRowHtml).join("") : '<div class="empty-state">No term dates added yet.</div>';
  $$('[data-term-del]', target).forEach(el=> el.addEventListener("click", async ()=>{ if(confirm("Remove this?")) await dbDelete("termDates", el.dataset.termDel); }));
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


// ── OS-LEVEL NOTIFICATIONS ──
// Posts to the active service worker (so the notification shows even when
// the JAGU tab isn't focused) when the browser supports it; falls back to
// a page-level Notification otherwise. Always requires both OS permission
// and the in-app toggle, and silently no-ops without either.
export function notifyUser(title, body){
  if(!state.profile.notifyEnabled) return;
  if(!("Notification" in window) || Notification.permission!=="granted") return;
  try{
    if(navigator.serviceWorker && navigator.serviceWorker.controller){
      navigator.serviceWorker.controller.postMessage({type:"notify", title, body});
    } else {
      new Notification(title, {body, icon:"icons/icon-192.png"});
    }
  }catch(e){ console.warn("notification failed", e); }
}

// ── REMINDER CHECKS ──
const CLASS_REMINDER_LEAD_MIN = 10;
const remindedClasses = new Set();
function checkClassReminders(){
  const nm = nowMin();
  const todayStr = todayISO();
  todaysEntries().forEach(c=>{
    const learnerReminders = activeTaskRemindersForClass(classKeyFor(c.subject));
    const hasNotes = !!(c.notes && c.notes.trim());
    if(!hasNotes && !learnerReminders.length) return;
    const minsUntil = timeToMin(c.start) - nm;
    if(minsUntil < 0 || minsUntil > CLASS_REMINDER_LEAD_MIN) return;
    const key = c.id+"_"+todayStr;
    if(remindedClasses.has(key)) return;
    remindedClasses.add(key);
    const parts = [];
    if(hasNotes) parts.push(c.notes);
    if(learnerReminders.length){
      const names = learnerReminders.slice(0,3).map(h=>{
        const l = state.learners.find(x=>x.id===h.learnerId);
        return l ? l.name : "a learner";
      });
      parts.push("For the class: "+names.join(", ")+(learnerReminders.length>3?" and "+(learnerReminders.length-3)+" more":"")+".");
    }
    const msg = "Reminder for "+c.subject+" in "+minsUntil+" minute"+(minsUntil===1?"":"s")+": "+parts.join(" ");
    showToast(msg);
    speak(msg);
    notifyUser("JAGU — "+c.subject, parts.join(" "));
  });
}

setInterval(()=>{
  if(!bootDone) return;
  renderHomeStatus();
  renderSuggestion();
  if($("#screen-dashboard").classList.contains("active")) renderDashboard();
  checkClassReminders();
}, 60000);

