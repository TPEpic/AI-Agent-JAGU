import { $, esc, showToast } from './helpers.js';
import { DAY_LABELS, dbAdd, dbDelete, state } from './state.js';

// ── GENERIC FORM MODAL ──
export function openFormModal(title, fields, onSubmit, submitLabel){
  const root = $("#modal-root");
  const fieldsHtml = fields.map(f=>{
    if(f.type==="select"){
      return '<div class="field-group"><label class="field-label">'+esc(f.label)+'</label><select class="text-field" name="'+f.name+'">'+f.options.map(o=>'<option value="'+esc(o[0])+'">'+esc(o[1])+'</option>').join("")+'</select></div>';
    }
    return '<div class="field-group"><label class="field-label">'+esc(f.label)+'</label><input class="text-field" name="'+f.name+'" type="'+(f.type||"text")+'" '+(f.value!=null?'value="'+esc(f.value)+'"':'')+' '+(f.placeholder?'placeholder="'+esc(f.placeholder)+'"':'')+'></div>';
  }).join("");
  root.innerHTML = '<div class="sheet"><div class="sheet-handle"></div><p class="sheet-title">'+esc(title)+'</p><form id="dyn-form">'+fieldsHtml+'<div class="modal-actions"><button type="button" id="dyn-cancel" class="btn-full ghost">Cancel</button><button type="submit" class="btn-full">'+(submitLabel||"Save")+'</button></div></form></div>';
  root.classList.remove("hidden");
  $("#dyn-cancel").onclick = closeModal;
  root.onclick = (e)=>{ if(e.target===root) closeModal(); };
  $("#dyn-form").onsubmit = (e)=>{
    e.preventDefault();
    const data = {};
    fields.forEach(f=>{ data[f.name] = $('[name="'+f.name+'"]', root).value.trim(); });
    closeModal();
    onSubmit(data);
  };
  setTimeout(()=>{ const first = $('input,select', root); if(first) first.focus(); }, 50);
}
export function closeModal(){ $("#modal-root").classList.add("hidden"); $("#modal-root").innerHTML=""; }

function openProjectModal(){
  openFormModal("New project or course", [
    {name:"name", label:"Name", placeholder:"e.g. Machine Learning"},
    {name:"kind", label:"Type", type:"select", options:[["course","Course"],["project","Project"]]},
    {name:"deadline", label:"Deadline (optional)", type:"date"},
  ], async (data)=>{
    if(!data.name) return;
    await dbAdd("projects", {name:data.name, kind:data.kind||"course", deadline:data.deadline||null, progress:0, archived:false});
    showToast("Added "+data.name);
  }, "Add");
}

export function openTaskModal(projectId){
  openFormModal("New task", [
    {name:"title", label:"Task", placeholder:"e.g. Neural network exercise"},
    {name:"estMinutes", label:"Estimated minutes", type:"number", value:25},
  ], async (data)=>{
    if(!data.title) return;
    await dbAdd("tasks", {projectId, title:data.title, estMinutes:Number(data.estMinutes)||20, status:"pending", completedAt:null});
  }, "Add task");
}

function openTimetableModal(){
  openFormModal("Add class", [
    {name:"day", label:"Day", type:"select", options: DAY_LABELS.map((d,i)=>[String(i),d])},
    {name:"start", label:"Start time", type:"time"},
    {name:"end", label:"End time", type:"time"},
    {name:"subject", label:"Subject", placeholder:"e.g. T Level Computing"},
    {name:"room", label:"Room (optional)", placeholder:"e.g. B105"},
  ], async (data)=>{
    if(!data.subject || !data.start || !data.end) return;
    await dbAdd("timetable", {day:Number(data.day), start:data.start, end:data.end, subject:data.subject, room:data.room||null});
    showToast("Class added");
  }, "Add");
}

const TIMETABLE_IMPORT_PLACEHOLDER = [
  {day:0, start:"09:00", end:"10:30", subject:"L2 ICT GB — Digital Portfolio", room:"CH225"},
  {day:0, start:"10:45", end:"12:00", subject:"T Level DSS Year 2 — Programming Concepts", room:"SR409"},
  {day:0, start:"13:00", end:"14:30", subject:"L2 ICT GA — Maths", room:"CH224"},
  {day:0, start:"14:45", end:"16:15", subject:"T Level DSS Year 1 — Employer Set Project, Part 01", room:"CH212"},
  {day:1, start:"09:00", end:"10:30", subject:"L2 ICT GA — Digital Portfolio", room:"CH224"},
  {day:1, start:"10:45", end:"12:15", subject:"L2 ICT GB — Digital Portfolio", room:"CH225"},
  {day:1, start:"14:45", end:"16:15", subject:"Access HE - DS — Machine Learning Models", room:"CH226"},
  {day:2, start:"09:00", end:"10:30", subject:"T Level DA Year 2 — Programming Concepts", room:"CH214"},
  {day:2, start:"09:00", end:"10:30", subject:"T Level Prg Year 2 — Occupational Specialism Advanced, Part 02 Coding", room:"CH214"},
  {day:2, start:"10:45", end:"12:15", subject:"T Level DA Year 2 — Hardware & Networking", room:"CH214"},
  {day:2, start:"10:45", end:"12:15", subject:"T Level Prg Year 2 — Technology Concepts", room:"CH214"},
  {day:3, start:"09:00", end:"10:30", subject:"L3 Year 1 GB — Principles of Computer Science", room:"CH211"},
  {day:3, start:"13:00", end:"14:30", subject:"L2 ICT GB — Digital Employability Skills", room:"CH202"},
  {day:3, start:"14:45", end:"16:15", subject:"L2 ICT GA — Digital Employability Skills", room:"CH201"},
  {day:4, start:"09:00", end:"10:30", subject:"L3 Year 1 GB — Fundamentals of Computer Science", room:"CH212"},
];

function openImportModal(){
  const root = $("#modal-root");
  const json = JSON.stringify(TIMETABLE_IMPORT_PLACEHOLDER, null, 2);
  root.innerHTML = '<div class="sheet">'
    + '<div class="sheet-handle"></div>'
    + '<p class="sheet-title">Import timetable</p>'
    + '<p style="color:var(--text-dim); font-size:13px; margin-bottom:14px; line-height:1.5;">Your corrected timetable is already filled in below — just hit Import. To bring in a different set later, paste your own JSON here in the same shape (day: 0=Mon…6=Sun).</p>'
    + '<textarea id="import-json" class="text-field" style="height:220px; font-family:var(--font-m); font-size:11.5px; resize:vertical;">'+esc(json)+'</textarea>'
    + '<label class="settings-row" style="padding:12px 0 4px; border:none;"><span style="font-size:13px;">Clear existing timetable first</span><input type="checkbox" id="import-clear-first"></label>'
    + '<div class="modal-actions"><button type="button" id="import-cancel" class="btn-full ghost">Cancel</button><button type="button" id="import-confirm" class="btn-full">Import all</button></div>'
    + '</div>';
  root.classList.remove("hidden");
  root.onclick = (e)=>{ if(e.target===root) closeModal(); };
  $("#import-cancel").onclick = closeModal;
  $("#import-confirm").onclick = async ()=>{
    let entries;
    try{ entries = JSON.parse($("#import-json").value); }
    catch(e){ showToast("That doesn't look like valid JSON — check for a stray comma or bracket.","error"); return; }
    if(!Array.isArray(entries) || entries.length===0){ showToast("Expected a JSON array of class entries.","error"); return; }
    const clean = entries.filter(x=> x && x.subject && x.start && x.end && Number.isInteger(x.day) && x.day>=0 && x.day<=6);
    if(clean.length===0){ showToast("No valid entries found — check day/start/end/subject on each one.","error"); return; }
    closeModal();
    if($("#import-clear-first") && $("#import-clear-first").checked){
      for(const t of state.timetable.slice()){ await dbDelete("timetable", t.id); }
    }
    for(const t of clean){ await dbAdd("timetable", {day:t.day, start:t.start, end:t.end, subject:t.subject, room:t.room||null}); }
    showToast("Imported "+clean.length+" class"+(clean.length===1?"":"es")+".");
  };
}

function openEventModal(){
  openFormModal("Add event", [
    {name:"title", label:"Event", placeholder:"e.g. Presentation"},
    {name:"date", label:"Date", type:"date"},
    {name:"category", label:"Category", type:"select", options:[["work","Work"],["personal","Personal"]]},
  ], async (data)=>{
    if(!data.title || !data.date) return;
    await dbAdd("events", {title:data.title, date:data.date, category:data.category==="personal"?"personal":"work", prepped:false});
    showToast("Event added");
  }, "Add");
}

$("#add-project-btn").addEventListener("click", openProjectModal);
$("#add-timetable-btn").addEventListener("click", openTimetableModal);
$("#import-timetable-btn").addEventListener("click", openImportModal);
$("#add-event-btn").addEventListener("click", openEventModal);

