import { $, resizeImageToDataUrl, showToast } from './helpers.js';
import { LS_KEY, loadPersisted, saveProfile, state } from './state.js';
import { refreshAiStatusDot, renderAll, renderSettingsFields } from './render.js';
import { greet } from './ai.js';

// ── ONBOARDING ──
$("#onboarding-start").addEventListener("click", async ()=>{
  const name = $("#onboarding-name").value.trim() || "there";
  $("#onboarding").classList.add("hidden");
  await saveProfile({ name, onboarded:true });
  greet();
  renderAll();
});


// ── SETTINGS WIRING ──
$("#settings-name").addEventListener("change", (e)=> saveProfile({name:e.target.value.trim()}).then(renderAll));
$("#settings-role").addEventListener("change", (e)=> saveProfile({role:e.target.value.trim()}).then(renderAll));
$("#settings-about").addEventListener("change", (e)=> saveProfile({about:e.target.value.trim()}).then(renderAll));
$("#settings-avatar-input").addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  e.target.value = "";
  if(!file) return;
  try{
    const dataUrl = await resizeImageToDataUrl(file, 200);
    await saveProfile({avatar: dataUrl});
    renderAll();
  }catch(err){
    console.warn("avatar resize failed", err);
    showToast("Couldn't read that photo.", "error");
  }
});
$("#settings-avatar-remove").addEventListener("click", async ()=>{
  await saveProfile({avatar:null});
  renderAll();
});
$("#settings-voice").addEventListener("change", (e)=> saveProfile({voiceURI:e.target.value}));
$("#settings-rate").addEventListener("input", (e)=> saveProfile({rate:Number(e.target.value)}));
$("#settings-pitch").addEventListener("input", (e)=> saveProfile({pitch:Number(e.target.value)}));
$("#toggle-voice-out").addEventListener("click", ()=> saveProfile({voiceOut: !state.profile.voiceOut}).then(renderSettingsFields));
$("#toggle-convo-mode").addEventListener("click", ()=> saveProfile({convoMode: !state.profile.convoMode}).then(renderSettingsFields));
$("#toggle-notifications").addEventListener("click", async ()=>{
  if(state.profile.notifyEnabled){
    await saveProfile({notifyEnabled:false});
    renderSettingsFields();
    return;
  }
  if(!("Notification" in window)){ showToast("Notifications aren't supported in this browser.","error"); return; }
  let perm = Notification.permission;
  if(perm==="default") perm = await Notification.requestPermission();
  if(perm!=="granted"){ showToast("Notifications are blocked — allow them for this site in your browser's settings, then try again.","error"); return; }
  await saveProfile({notifyEnabled:true});
  renderSettingsFields();
  showToast("Notifications on — reminders will show even if this tab isn't focused.");
});
$("#mute-btn").addEventListener("click", ()=>{
  if(speechSynthesis.speaking) speechSynthesis.cancel();
  saveProfile({voiceOut: !state.profile.voiceOut}).then(renderSettingsFields);
});
$("#settings-provider").addEventListener("change", (e)=>{
  saveProfile({provider: e.target.value});
  renderSettingsFields();
  refreshAiStatusDot();
});
function saveGeminiKeyLive(){
  saveProfile({geminiKey: $("#settings-gemini-key").value.trim()});
  refreshAiStatusDot();
}
$("#settings-gemini-key").addEventListener("input", saveGeminiKeyLive);
$("#settings-gemini-key").addEventListener("change", ()=> showToast("Gemini API key saved to this browser."));
$("#settings-gemini-model").addEventListener("input", (e)=> saveProfile({geminiModel:e.target.value.trim()||"gemini-flash-latest"}));

function saveApiKeyLive(){
  saveProfile({apiKey: $("#settings-apikey").value.trim()});
  refreshAiStatusDot();
}
$("#settings-apikey").addEventListener("input", saveApiKeyLive);
$("#settings-apikey").addEventListener("change", ()=> showToast("API key saved to this browser."));
$("#settings-model").addEventListener("input", (e)=> saveProfile({model:e.target.value.trim()||"claude-sonnet-5"}));

$("#export-btn").addEventListener("click", async ()=>{
  const safeProfile = Object.assign({}, state.profile, {apiKey:undefined, geminiKey:undefined});
  const backup = {
    profile: safeProfile, projects:state.projects, tasks:state.tasks, timetable:state.timetable,
    events:state.events, memory:state.memory, updates:state.updates, marking:state.marking, termDates:state.termDates,
    learners:state.learners, enrollments:state.enrollments, classAssignments:state.classAssignments,
    learnerProgress:state.learnerProgress, learnerHighlights:state.learnerHighlights, classNotes:state.classNotes,
    exportedAt:new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "jagu-backup-"+new Date().toISOString().slice(0,10)+".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 4000);
  await saveProfile({lastBackupAt: new Date().toISOString()});
  renderAll();
  showToast("Backup downloaded (API keys excluded for safety).");
});

$("#import-btn").addEventListener("click", ()=> $("#import-file-input").click());
$("#import-file-input").addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  e.target.value = "";
  if(!file) return;
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    const knownKeys = ["projects","tasks","timetable","events","learners","classAssignments","marking","termDates"];
    if(!data || typeof data!=="object" || !knownKeys.some(k=> Array.isArray(data[k]))){
      throw new Error("not a recognisable JAGU backup");
    }
    if(!confirm("This replaces everything currently saved on this device with the contents of this backup file. This can't be undone. Continue?")) return;
    const current = JSON.parse(localStorage.getItem(LS_KEY)) || {};
    const merged = Object.assign({}, current, {
      profile: Object.assign({}, current.profile, data.profile||{}, {apiKey: (current.profile||{}).apiKey, geminiKey: (current.profile||{}).geminiKey}),
      projects: data.projects||[], tasks: data.tasks||[], timetable: data.timetable||[],
      events: data.events||[], memory: data.memory||[], updates: data.updates||[],
      marking: data.marking||[], termDates: data.termDates||[], chat: current.chat||[],
      learners: data.learners||[], enrollments: data.enrollments||[],
      classAssignments: data.classAssignments||[], learnerProgress: data.learnerProgress||[],
      learnerHighlights: data.learnerHighlights||[], classNotes: data.classNotes||[],
    });
    localStorage.setItem(LS_KEY, JSON.stringify(merged));
    loadPersisted();
    renderAll();
    showToast("Backup restored.");
  }catch(err){
    console.warn("backup import failed", err);
    showToast("Couldn't read that file — it may be corrupted or not a JAGU backup.", "error");
  }
});

$("#clear-btn").addEventListener("click", ()=>{
  if(!confirm("This deletes every project, task, timetable entry, event and memory JAGU has stored on this device. Continue?")) return;
  const keep = { apiKey: state.profile.apiKey, model: state.profile.model, geminiKey: state.profile.geminiKey, geminiModel: state.profile.geminiModel, provider: state.profile.provider };
  localStorage.removeItem(LS_KEY);
  loadPersisted();
  saveProfile(keep); // keep API keys/provider — losing them is more annoying than useful here
  renderAll();
  showToast("All data cleared.");
});


