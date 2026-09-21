import { $, showToast } from './helpers.js';
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
$("#settings-name").addEventListener("change", (e)=> saveProfile({name:e.target.value.trim()}));
$("#settings-voice").addEventListener("change", (e)=> saveProfile({voiceURI:e.target.value}));
$("#settings-rate").addEventListener("input", (e)=> saveProfile({rate:Number(e.target.value)}));
$("#settings-pitch").addEventListener("input", (e)=> saveProfile({pitch:Number(e.target.value)}));
$("#toggle-voice-out").addEventListener("click", ()=> saveProfile({voiceOut: !state.profile.voiceOut}).then(renderSettingsFields));
$("#toggle-convo-mode").addEventListener("click", ()=> saveProfile({convoMode: !state.profile.convoMode}).then(renderSettingsFields));
$("#toggle-theme").addEventListener("click", ()=> saveProfile({theme: state.profile.theme==="light"?"dark":"light"}).then(renderSettingsFields));
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

$("#export-btn").addEventListener("click", ()=>{
  const safeProfile = Object.assign({}, state.profile, {apiKey:undefined, geminiKey:undefined});
  const backup = { profile: safeProfile, projects:state.projects, tasks:state.tasks, timetable:state.timetable, events:state.events, memory:state.memory, updates:state.updates, exportedAt:new Date().toISOString() };
  const blob = new Blob([JSON.stringify(backup, null, 2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "jagu-backup.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 4000);
  showToast("Backup downloaded (API keys excluded for safety).");
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


