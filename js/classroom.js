import { $, $$, esc, minToClock, showToast, timeToMin, todayIdx, uid } from './helpers.js';
import { DAY_LABELS, dbAdd, dbDelete, dbUpdate, state } from './state.js';
import { openFormModal, closeModal } from './modals.js';

// A "class" has no id of its own — it's identified by its classKey (the
// normalised subject text), so any timetable/cover session taught under
// the same subject shares one roster, one set of assignments, and one
// set of learner notes, even if it's taught more than once a week.
export function classKeyFor(subject){ return String(subject||"").trim().toLowerCase().replace(/\s+/g," "); }

const PROGRESS_CYCLE = ["not_started","in_progress","needs_checking","done"];
const PROGRESS_ICON = { not_started:"○", in_progress:"→", needs_checking:"🔍", done:"✓" };
const PROGRESS_LABEL = { not_started:"Not started", in_progress:"In progress", needs_checking:"Needs checking", done:"Done" };
const HIGHLIGHT_ICON = { warning:"⚠️", performance:"📈", appreciation:"⭐", task:"📋" };
const HIGHLIGHT_LABEL = { warning:"Warning", performance:"Performance", appreciation:"Appreciation", task:"Individual task" };

// Red/amber/green at-a-glance status for a learner's overall assignment
// progress -- green 80%+, amber 40-79%, red under 40%.
function ragStatus(pct){
  if(pct>=80) return {color:"var(--rag-green)", label:"On track ("+pct+"% complete)"};
  if(pct>=40) return {color:"var(--rag-amber)", label:"Behind ("+pct+"% complete)"};
  return {color:"var(--rag-red)", label:"Well behind ("+pct+"% complete)"};
}

function subjectDisplay(classKey){
  const row = state.timetable.find(t=> classKeyFor(t.subject)===classKey);
  return row ? row.subject : classKey;
}
function sessionsForClass(classKey){
  return state.timetable.filter(t=> classKeyFor(t.subject)===classKey).sort((a,b)=> a.day-b.day || timeToMin(a.start)-timeToMin(b.start));
}
export function learnersForClass(classKey){
  const ids = state.enrollments.filter(e=>e.classKey===classKey).map(e=>e.learnerId);
  return state.learners.filter(l=> !l.archived && ids.includes(l.id));
}
function assignmentsForClass(classKey){
  return state.classAssignments.filter(a=>a.classKey===classKey);
}
function progressFor(assignmentId, learnerId, taskId){
  return state.learnerProgress.find(p=> p.assignmentId===assignmentId && p.learnerId===learnerId && p.taskId===taskId);
}
function assignmentProgressPct(a){
  const learners = learnersForClass(a.classKey);
  const total = learners.length * a.tasks.length;
  if(!total) return 0;
  let done = 0;
  learners.forEach(l=> a.tasks.forEach(t=>{ const p = progressFor(a.id,l.id,t.id); if(p && p.status==="done") done++; }));
  return Math.round(done/total*100);
}
function learnerAssignmentPct(a, learnerId){
  if(!a.tasks.length) return 0;
  const done = a.tasks.filter(t=>{ const p = progressFor(a.id,learnerId,t.id); return p && p.status==="done"; }).length;
  return Math.round(done/a.tasks.length*100);
}
// Active (unresolved) items for one learner, across every class or scoped to one.
export function activeHighlightsFor(learnerId, classKey){
  return state.learnerHighlights.filter(h=> h.learnerId===learnerId && (!classKey || h.classKey===classKey)
    && (h.type!=="task" || h.status!=="done"));
}
function needsCheckingCountFor(learnerId, classKey){
  let n = 0;
  assignmentsForClass(classKey).forEach(a=> a.tasks.forEach(t=>{
    const p = progressFor(a.id, learnerId, t.id);
    if(p && p.status==="needs_checking") n++;
  }));
  return n;
}
export function activeTaskRemindersForClass(classKey){
  const ids = learnersForClass(classKey).map(l=>l.id);
  return state.learnerHighlights.filter(h=> h.type==="task" && h.status!=="done" && h.classKey===classKey && ids.includes(h.learnerId));
}

// A compact, ready-to-inject summary of every class's learners who are
// behind (amber/red) and any active learner reminders, so JAGU can answer
// things like "who's behind in Unit 4" or "what do I need to follow up on"
// by voice/chat without a dedicated action.
export function classroomSummaryForAI(){
  const lines = [];
  allClassKeys().forEach(classKey=>{
    const learners = learnersForClass(classKey);
    const assignments = assignmentsForClass(classKey);
    if(!learners.length) return;
    const behind = [];
    learners.forEach(l=>{
      const avgPct = assignments.length ? Math.round(assignments.reduce((s,a)=>s+learnerAssignmentPct(a,l.id),0)/assignments.length) : null;
      if(avgPct!=null && avgPct<80) behind.push(l.name+" ("+avgPct+"%, "+(avgPct<40?"well behind":"behind")+")");
    });
    const reminders = activeTaskRemindersForClass(classKey).map(h=>{
      const l = state.learners.find(x=>x.id===h.learnerId);
      return (l?l.name+": ":"")+h.text;
    });
    if(behind.length || reminders.length){
      lines.push("- "+subjectDisplay(classKey)+(behind.length?" — behind: "+behind.join(", "):"")+(reminders.length?(behind.length?"; ":" — ")+"reminders: "+reminders.join("; "):""));
    }
  });
  return lines;
}

// ── LIST OF CLASSES (derived from the timetable) ──
export function allClassKeys(){
  const seen = new Set();
  state.timetable.forEach(t=> seen.add(classKeyFor(t.subject)));
  return Array.from(seen).sort((a,b)=> subjectDisplay(a).localeCompare(subjectDisplay(b)));
}

// ── NAVIGATION ──
export function openClassWorkspace(classKey){
  state.selectedClassKey = classKey;
  $$(".screen").forEach(s=>s.classList.remove("active"));
  $("#screen-classroom").classList.add("active");
  renderClassroom();
}
function backToTimetable(){
  $$(".screen").forEach(s=>s.classList.remove("active"));
  $("#screen-timetable").classList.add("active");
}

// ── RENDER: CLASS WORKSPACE ──
export function renderClassroom(){
  const screen = $("#screen-classroom");
  if(!screen || !screen.classList.contains("active")) return;
  const classKey = state.selectedClassKey;
  if(!classKey) return;
  const subject = subjectDisplay(classKey);
  const sessions = sessionsForClass(classKey);
  const learners = learnersForClass(classKey);
  const assignments = assignmentsForClass(classKey);

  $("#classroom-title").textContent = subject;
  $("#classroom-sessions").textContent = sessions.length
    ? sessions.map(s=> DAY_LABELS[s.day].slice(0,3)+" "+minToClock(timeToMin(s.start))).join(" · ")
    : "No timetable session linked";
  $("#classroom-learner-count").textContent = learners.length+" learner"+(learners.length===1?"":"s");

  // Important summary
  let checking=0, warnings=0, tasks=0, appreciations=0;
  learners.forEach(l=>{
    checking += needsCheckingCountFor(l.id, classKey);
    const active = activeHighlightsFor(l.id, classKey);
    warnings += active.filter(h=>h.type==="warning").length;
    tasks += active.filter(h=>h.type==="task").length;
    appreciations += state.learnerHighlights.filter(h=>h.learnerId===l.id && h.classKey===classKey && h.type==="appreciation").length;
  });
  const important = [];
  if(checking) important.push('<span class="important-chip">🔍 '+checking+' need'+(checking===1?"s":"")+' checking</span>');
  if(warnings) important.push('<span class="important-chip">⚠️ '+warnings+' warning'+(warnings===1?"":"s")+'</span>');
  if(tasks) important.push('<span class="important-chip">📋 '+tasks+' individual task'+(tasks===1?"":"s")+'</span>');
  if(appreciations) important.push('<span class="important-chip">⭐ '+appreciations+' appreciation'+(appreciations===1?"":"s")+'</span>');
  $("#classroom-important").innerHTML = important.length ? important.join("") : '<span class="empty-sub">Nothing outstanding right now.</span>';

  // Assignments
  $("#classroom-assignments").innerHTML = assignments.length ? assignments.map(a=>{
    const pct = assignmentProgressPct(a);
    return '<div class="card" data-assignment="'+a.id+'" style="cursor:pointer;">'
      + '<div class="proj-top"><div><div class="proj-name">'+esc(a.title)+'</div><div class="proj-kind">'+a.tasks.length+' task'+(a.tasks.length===1?"":"s")+(a.dueDate?" · due "+esc(a.dueDate):"")+'</div></div><div class="proj-pct">'+pct+'%</div></div>'
      + '<div class="progress-track"><div class="progress-fill" style="width:'+pct+'%"></div></div>'
      + '</div>';
  }).join("") : '<div class="empty-state">No assignments yet.</div>';
  $$('[data-assignment]', $("#classroom-assignments")).forEach(el=> el.addEventListener("click", ()=> openAssignmentDetail(el.dataset.assignment)));

  // Learner roster
  $("#classroom-learners").innerHTML = learners.length ? learners.map(l=>{
    const avgPct = assignments.length ? Math.round(assignments.reduce((s,a)=>s+learnerAssignmentPct(a,l.id),0)/assignments.length) : 0;
    const active = activeHighlightsFor(l.id, classKey);
    const icons = []
      .concat(needsCheckingCountFor(l.id,classKey) ? "🔍" : [])
      .concat(active.some(h=>h.type==="warning") ? "⚠️" : [])
      .concat(active.some(h=>h.type==="task") ? "📋" : [])
      .concat(state.learnerHighlights.some(h=>h.learnerId===l.id && h.classKey===classKey && h.type==="appreciation") ? "⭐" : []);
    const rag = assignments.length ? ragStatus(avgPct) : null;
    const dot = rag ? '<span class="rag-dot" style="background:'+rag.color+'; color:'+rag.color+';" title="'+esc(rag.label)+'"></span>' : '';
    return '<div class="event-row" data-learner="'+l.id+'" style="cursor:pointer;">'
      + '<div style="display:flex; align-items:center; gap:9px; min-width:0;">'+dot+'<div><div class="event-title">'+esc(l.name)+'</div><div class="event-when">'+(assignments.length? avgPct+"% avg progress" : "No assignments yet")+'</div></div></div>'
      + '<div style="display:flex; align-items:center; gap:10px;"><span style="font-size:15px;">'+icons.join(" ")+'</span>'
      + '<span class="task-del" data-unenroll="'+l.id+'" title="Remove from class">✕</span></div>'
      + '</div>';
  }).join("") : '<div class="empty-state">No learners yet. Add one to get started.</div>';
  $$('[data-learner]', $("#classroom-learners")).forEach(el=> el.addEventListener("click", (e)=>{ if(e.target.closest("[data-unenroll]")) return; openLearnerDetail(el.dataset.learner); }));
  $$('[data-unenroll]', $("#classroom-learners")).forEach(el=> el.addEventListener("click", async (e)=>{
    e.stopPropagation();
    if(!confirm("Remove this learner from the class? (their record and history are kept)")) return;
    const enr = state.enrollments.find(x=>x.learnerId===el.dataset.unenroll && x.classKey===classKey);
    if(enr) await dbDelete("enrollments", enr.id);
  }));

  // Class notes
  const notes = state.classNotes.filter(n=>n.classKey===classKey).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
  $("#classroom-notes").innerHTML = notes.length ? notes.map(n=>{
    const when = new Date(n.createdAt).toLocaleDateString("en-GB",{day:"numeric",month:"short"});
    return '<div class="note-row"><span class="note-dot"></span><div class="note-body"><div class="note-text">'+esc(n.text)+'</div><div class="note-when">'+when+'</div></div><span class="task-del" data-note-del="'+n.id+'">✕</span></div>';
  }).join("") : '<div class="empty-sub">No session notes yet.</div>';
  $$('[data-note-del]', $("#classroom-notes")).forEach(el=> el.addEventListener("click", ()=> dbDelete("classNotes", el.dataset.noteDel)));
}

// ── ASSIGNMENTS ──
function openAssignmentModal(classKey){
  openFormModal("New assignment", [
    {name:"title", label:"Title", placeholder:"e.g. Unit 4 Programming Assignment"},
    {name:"dueDate", label:"Due date (optional)", type:"date"},
    {name:"tasksText", label:"Tasks (one per line)", type:"textarea", rows:5, placeholder:"Research the topic\nComplete worksheet\nWrite the program\nUpload evidence\nReview and correct work"},
  ], async (data)=>{
    if(!data.title) return;
    const tasks = data.tasksText.split("\n").map(s=>s.trim()).filter(Boolean).map(title=>({id: uid(), title}));
    if(!tasks.length){ showToast("Add at least one task.","error"); return; }
    await dbAdd("classAssignments", {classKey, title:data.title, dueDate:data.dueDate||null, tasks});
    showToast("Assignment added");
  }, "Add assignment");
}

// Editing re-uses task ids for lines whose title is unchanged, so a learner's
// existing progress against that task is kept; a new/renamed line gets a
// fresh id (starting at "not started").
function openEditAssignmentModal(assignmentId){
  const a = state.classAssignments.find(x=>x.id===assignmentId);
  if(!a) return;
  openFormModal("Edit assignment", [
    {name:"title", label:"Title", value:a.title},
    {name:"dueDate", label:"Due date (optional)", type:"date", value:a.dueDate||""},
    {name:"tasksText", label:"Tasks (one per line)", type:"textarea", rows:6, value:a.tasks.map(t=>t.title).join("\n")},
  ], async (data)=>{
    if(!data.title) return;
    const lines = data.tasksText.split("\n").map(s=>s.trim()).filter(Boolean);
    if(!lines.length){ showToast("Add at least one task.","error"); return; }
    const remaining = a.tasks.slice();
    const tasks = lines.map(title=>{
      const idx = remaining.findIndex(t=>t.title===title);
      if(idx>=0) return remaining.splice(idx,1)[0];
      return {id: uid(), title};
    });
    await dbUpdate("classAssignments", assignmentId, {title:data.title, dueDate:data.dueDate||null, tasks});
    showToast("Assignment updated");
    openAssignmentDetail(assignmentId);
  }, "Save");
}

function openAssignmentDetail(assignmentId){
  const a = state.classAssignments.find(x=>x.id===assignmentId);
  if(!a) return;
  const learners = learnersForClass(a.classKey);
  const root = $("#modal-root");
  const rows = learners.map(l=>{
    const cells = a.tasks.map(t=>{
      const p = progressFor(a.id, l.id, t.id);
      const status = p ? p.status : "not_started";
      return '<button class="progress-cell" data-cycle="'+l.id+'|'+t.id+'" title="'+esc(t.title)+' — '+PROGRESS_LABEL[status]+'">'+PROGRESS_ICON[status]+'</button>';
    }).join("");
    const pct = learnerAssignmentPct(a, l.id);
    return '<div class="progress-row"><div class="progress-row-name">'+esc(l.name)+' <span class="progress-row-pct">'+pct+'%</span></div><div class="progress-row-cells">'+cells+'</div></div>';
  }).join("");
  const header = a.tasks.map(t=>'<div class="progress-task-label" title="'+esc(t.title)+'">'+esc(t.title.length>14?t.title.slice(0,13)+"…":t.title)+'</div>').join("");
  root.innerHTML = '<div class="sheet" style="max-height:92%;">'
    + '<div class="sheet-handle"></div>'
    + '<div class="screen-title-row" style="margin:0 0 4px;"><p class="sheet-title" style="margin:0;">'+esc(a.title)+'</p><a class="link-row" id="assignment-edit-tasks" style="margin:0; font-size:12.5px;">Edit tasks</a></div>'
    + (a.dueDate ? '<p style="color:var(--text-faint); font-size:12.5px; margin:0 0 14px;">Due '+esc(a.dueDate)+'</p>' : '<div style="margin-bottom:10px;"></div>')
    + '<div style="margin-bottom:12px;">'+a.tasks.map((t,i)=>'<div style="font-size:12px; color:var(--text-dim); padding:2px 0;">'+(i+1)+'. '+esc(t.title)+'</div>').join("")+'</div>'
    + (learners.length ? '<div class="progress-grid"><div class="progress-row"><div class="progress-row-name"></div><div class="progress-row-cells">'+header+'</div></div>'+rows+'</div>'
       : '<div class="empty-state">Add learners to this class to track progress.</div>')
    + '<div class="progress-legend">'
      + '<span>'+PROGRESS_ICON.not_started+' Not started</span>'
      + '<span>'+PROGRESS_ICON.in_progress+' In progress</span>'
      + '<span>'+PROGRESS_ICON.needs_checking+' Needs checking</span>'
      + '<span>'+PROGRESS_ICON.done+' Done</span>'
    + '</div>'
    + '<p style="color:var(--text-faint); font-size:11px; margin:6px 0 0;">Tap a cell to cycle through these.</p>'
    + '<div class="modal-actions"><button type="button" id="assignment-delete" class="btn-full ghost" style="color:var(--danger); border-color:var(--danger);">Delete assignment</button><button type="button" id="assignment-close" class="btn-full">Close</button></div>'
    + '</div>';
  root.classList.remove("hidden");
  root.onclick = (e)=>{ if(e.target===root) closeModal(); };
  $("#assignment-close").onclick = closeModal;
  $("#assignment-edit-tasks").onclick = ()=> openEditAssignmentModal(assignmentId);
  $("#assignment-delete").onclick = async ()=>{
    if(!confirm("Delete this assignment and all learner progress against it?")) return;
    state.learnerProgress = state.learnerProgress.filter(p=>p.assignmentId!==a.id);
    await dbDelete("classAssignments", a.id);
    closeModal();
  };
  $$('[data-cycle]', root).forEach(el=> el.addEventListener("click", async ()=>{
    const [learnerId, taskId] = el.dataset.cycle.split("|");
    const existing = progressFor(a.id, learnerId, taskId);
    const idx = existing ? PROGRESS_CYCLE.indexOf(existing.status) : 0;
    const next = PROGRESS_CYCLE[(idx+1)%PROGRESS_CYCLE.length];
    if(existing) await dbUpdate("learnerProgress", existing.id, {status:next});
    else await dbAdd("learnerProgress", {assignmentId:a.id, learnerId, taskId, status:next});
    openAssignmentDetail(assignmentId);
  }));
}

// ── LEARNERS ──
function openAddLearnerModal(classKey){
  openFormModal("Add learners", [
    {name:"names", label:"Learner names — one per line", type:"textarea", rows:6, placeholder:"Oliver Thompson\nAmelia Robinson\nNoah Mitchell\n..."},
  ], async (data)=>{
    const names = data.names.split("\n").map(s=>s.trim()).filter(Boolean);
    if(!names.length) return;
    let added = 0, skipped = 0;
    for(const name of names){
      let learner = state.learners.find(l=> !l.archived && l.name.trim().toLowerCase()===name.toLowerCase());
      let learnerId = learner ? learner.id : null;
      if(!learnerId) learnerId = await dbAdd("learners", {name, archived:false});
      const already = state.enrollments.some(e=>e.learnerId===learnerId && e.classKey===classKey);
      if(already){ skipped++; continue; }
      await dbAdd("enrollments", {learnerId, classKey});
      added++;
    }
    showToast(added+" learner"+(added===1?"":"s")+" added"+(skipped?" ("+skipped+" already in this class)":""));
  }, "Add");
}

function openLearnerDetail(learnerId){
  const l = state.learners.find(x=>x.id===learnerId);
  const classKey = state.selectedClassKey;
  if(!l || !classKey) return;
  const root = $("#modal-root");

  function html(){
    const highlights = state.learnerHighlights.filter(h=>h.learnerId===learnerId && h.classKey===classKey)
      .sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    const highlightsHtml = highlights.length ? highlights.map(h=>{
      const done = h.type==="task" && h.status==="done";
      return '<div class="highlight-row'+(done?" done":"")+'"><span class="highlight-icon">'+HIGHLIGHT_ICON[h.type]+'</span>'
        + '<div class="highlight-body"><div class="highlight-type">'+HIGHLIGHT_LABEL[h.type]+(h.dueDate?" · due "+esc(h.dueDate):"")+'</div><div class="highlight-text'+(done?" done":"")+'">'+esc(h.text)+'</div></div>'
        + (h.type==="task" ? '<button class="btn-tiny" data-toggle-task="'+h.id+'">'+(done?"Reopen":"Done")+'</button>' : '')
        + '<span class="task-del" data-highlight-del="'+h.id+'">✕</span></div>';
    }).join("") : '<div class="empty-sub">No highlights yet.</div>';

    const assignments = assignmentsForClass(classKey);
    const progressHtml = assignments.length ? assignments.map(a=>{
      const pct = learnerAssignmentPct(a, learnerId);
      const taskRows = a.tasks.map(t=>{
        const p = progressFor(a.id, learnerId, t.id);
        const status = p ? p.status : "not_started";
        return '<div class="today-row" style="padding:8px 0;"><span class="label">'+PROGRESS_ICON[status]+' '+esc(t.title)+'</span><span class="val" style="font-weight:400; color:var(--text-faint);">'+PROGRESS_LABEL[status]+'</span></div>';
      }).join("");
      return '<div class="card" style="margin-bottom:10px;"><div class="proj-top"><div class="proj-name">'+esc(a.title)+'</div><div class="proj-pct">'+pct+'%</div></div>'+taskRows+'</div>';
    }).join("") : '<div class="empty-sub">No assignments yet.</div>';

    const avgPct = assignments.length ? Math.round(assignments.reduce((s,a)=>s+learnerAssignmentPct(a,learnerId),0)/assignments.length) : null;
    const rag = avgPct!=null ? ragStatus(avgPct) : null;
    const dot = rag ? '<span class="rag-dot" style="background:'+rag.color+'; color:'+rag.color+';" title="'+esc(rag.label)+'"></span>' : '';

    return '<div class="sheet" style="max-height:92%;">'
      + '<div class="sheet-handle"></div>'
      + '<div style="display:flex; align-items:center; gap:9px;">'+dot+'<p class="sheet-title" style="margin:0;">'+esc(l.name)+'</p></div>'
      + '<p style="color:var(--text-faint); font-size:12.5px; margin:6px 0 16px;">'+esc(subjectDisplay(classKey))+'</p>'
      + '<div class="row-gap" style="justify-content:flex-start; flex-wrap:wrap; margin-bottom:16px;">'
        + '<button class="btn-small ghost" data-quick="warning">+ Warning</button>'
        + '<button class="btn-small ghost" data-quick="performance">+ Performance</button>'
        + '<button class="btn-small ghost" data-quick="appreciation">+ Appreciation</button>'
        + '<button class="btn-small ghost" data-quick="task">+ Task / reminder</button>'
      + '</div>'
      + '<h2 class="section-heading" style="margin-top:0;">Highlights</h2>'
      + highlightsHtml
      + '<h2 class="section-heading">Assignment progress</h2>'
      + progressHtml
      + '<div class="modal-actions"><button type="button" id="learner-close" class="btn-full">Close</button></div>'
      + '</div>';
  }

  function wire(){
    root.onclick = (e)=>{ if(e.target===root) closeModal(); };
    $("#learner-close").onclick = closeModal;
    $$('[data-quick]', root).forEach(el=> el.addEventListener("click", ()=> openQuickHighlightModal(learnerId, classKey, el.dataset.quick, refresh)));
    $$('[data-toggle-task]', root).forEach(el=> el.addEventListener("click", async ()=>{
      const h = state.learnerHighlights.find(x=>x.id===el.dataset.toggleTask);
      if(h) await dbUpdate("learnerHighlights", h.id, {status: h.status==="done"?"active":"done"});
      refresh();
    }));
    $$('[data-highlight-del]', root).forEach(el=> el.addEventListener("click", async ()=>{
      await dbDelete("learnerHighlights", el.dataset.highlightDel);
      refresh();
    }));
  }
  function refresh(){ root.innerHTML = html(); root.classList.remove("hidden"); wire(); }

  root.innerHTML = html();
  root.classList.remove("hidden");
  wire();
}

function openQuickHighlightModal(learnerId, classKey, type, onDone){
  const fields = [{name:"text", label:HIGHLIGHT_LABEL[type]+" note", type:"textarea", rows:3}];
  if(type==="task") fields.push({name:"dueDate", label:"Due date (optional)", type:"date"});
  openFormModal("Add "+HIGHLIGHT_LABEL[type].toLowerCase(), fields, async (data)=>{
    if(!data.text) return;
    await dbAdd("learnerHighlights", {learnerId, classKey, type, text:data.text, dueDate:data.dueDate||null, status:"active"});
    showToast("Added");
    onDone();
  }, "Add");
}

// ── CLASS NOTES ──
function openClassNoteModal(classKey){
  openFormModal("Add session note", [
    {name:"text", label:"Note", type:"textarea", rows:3, placeholder:"e.g. Most learners struggled with Task 3 — revisit next session."},
  ], async (data)=>{
    if(!data.text) return;
    await dbAdd("classNotes", {classKey, text:data.text});
  }, "Save");
}

// ── SAMPLE DATA (for trying the feature out) ──
const DEMO_SUBJECT = "Demo — Level 3 Computing — Unit 4 Programming";
async function seedDemoClass(){
  const classKey = classKeyFor(DEMO_SUBJECT);
  const alreadySeeded = state.timetable.some(t=> classKeyFor(t.subject)===classKey);
  if(alreadySeeded){ openClassWorkspace(classKey); return; }

  await dbAdd("timetable", {day: todayIdx(), start:"09:00", end:"10:00", subject:DEMO_SUBJECT, room:"Demo Room"});

  const names = ["Oliver Thompson","Amelia Robinson","Noah Mitchell","Sophie Walker","George Turner"];
  const learnerIds = {};
  for(const name of names){
    const id = await dbAdd("learners", {name, archived:false});
    learnerIds[name] = id;
    await dbAdd("enrollments", {learnerId:id, classKey});
  }

  const taskTitles = ["Research the topic","Complete worksheet","Write the program","Upload evidence","Review and correct work"];
  const tasks = taskTitles.map(title=>({id:uid(), title}));
  const assignmentId = await dbAdd("classAssignments", {classKey, title:"Unit 4 Programming Assignment", dueDate:null, tasks});

  async function setProgress(name, taskIdx, status){
    await dbAdd("learnerProgress", {assignmentId, learnerId:learnerIds[name], taskId:tasks[taskIdx].id, status});
  }
  await setProgress("Oliver Thompson", 0, "done");
  await setProgress("Oliver Thompson", 1, "done");
  await setProgress("Oliver Thompson", 2, "done");
  await setProgress("Oliver Thompson", 3, "needs_checking");
  for(let i=0;i<5;i++) await setProgress("Amelia Robinson", i, "done");
  await setProgress("Noah Mitchell", 0, "done");
  await setProgress("Noah Mitchell", 1, "in_progress");
  for(let i=0;i<4;i++) await setProgress("Sophie Walker", i, "done");
  await setProgress("Sophie Walker", 4, "needs_checking");
  // George Turner: nothing started yet — no progress rows needed.

  async function addHighlight(name, type, text, status){
    await dbAdd("learnerHighlights", {learnerId:learnerIds[name], classKey, type, text, dueDate:null, status:status||"active"});
  }
  await addHighlight("Oliver Thompson", "warning", "Needs additional support with the programming section.");
  await addHighlight("Oliver Thompson", "performance", "Improving significantly.");
  await addHighlight("Oliver Thompson", "task", "Complete Task 3 and resubmit by Friday.");
  await addHighlight("Amelia Robinson", "appreciation", "Excellent understanding and very strong submission.");
  await addHighlight("Amelia Robinson", "task", "Review Unit 4 submission.", "done");
  await addHighlight("Noah Mitchell", "warning", "Needs to complete the worksheet before moving to the programming task.");
  await addHighlight("Noah Mitchell", "task", "Complete the worksheet before the next session.");
  await addHighlight("Sophie Walker", "performance", "Good improvement compared with the previous session.");
  await addHighlight("George Turner", "warning", "Assignment has not been started.");
  await addHighlight("George Turner", "task", "Complete Task 1 before the next lesson.");

  showToast("Sample class loaded — 5 learners, one assignment, a mix of highlights.");
  openClassWorkspace(classKey);
}

// ── WIRING (static buttons that always exist in the DOM) ──
$("#classroom-back").addEventListener("click", backToTimetable);
$("#classroom-add-assignment").addEventListener("click", ()=> openAssignmentModal(state.selectedClassKey));
$("#classroom-add-learner").addEventListener("click", ()=> openAddLearnerModal(state.selectedClassKey));
$("#classroom-add-note").addEventListener("click", ()=> openClassNoteModal(state.selectedClassKey));
const seedBtn = $("#seed-demo-class-btn");
if(seedBtn) seedBtn.addEventListener("click", ()=>{
  if(confirm("Add a sample class (5 fictional learners, an assignment and some highlights) so you can try out the Class Workspace?")) seedDemoClass();
});
