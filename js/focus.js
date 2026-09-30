import { $, pad2 } from './helpers.js';
import { dbAdd } from './state.js';
import { addChatBubble, toggleTask } from './render.js';

// ── FOCUS SESSIONS ──
let focusTimer = null, focusState = null;
export function openFocusSession(task, minutes){
  focusState = { task, totalSec: Math.max(1,Math.round(minutes))*60, remainingSec: Math.max(1,Math.round(minutes))*60, paused:false, startedAt:new Date().toISOString() };
  $("#focus-task").textContent = task ? task.title : "Focus session";
  $("#focus-label").textContent = "Focus session";
  $("#focus-pause").textContent = "Pause";
  updateFocusClock();
  $("#focus-overlay").classList.remove("hidden");
  clearInterval(focusTimer);
  focusTimer = setInterval(tickFocus, 1000);
}
function tickFocus(){
  if(!focusState || focusState.paused) return;
  focusState.remainingSec--;
  updateFocusClock();
  if(focusState.remainingSec<=0){ finishFocus(true); }
}
function updateFocusClock(){
  const s = Math.max(0, focusState.remainingSec);
  $("#focus-clock").textContent = pad2(Math.floor(s/60))+":"+pad2(s%60);
}
$("#focus-pause").addEventListener("click", ()=>{
  if(!focusState) return;
  focusState.paused = !focusState.paused;
  $("#focus-pause").textContent = focusState.paused ? "Resume" : "Pause";
});
$("#focus-stop").addEventListener("click", ()=> finishFocus(false));

async function finishFocus(completed){
  clearInterval(focusTimer);
  $("#focus-overlay").classList.add("hidden");
  if(!focusState) return;
  const elapsedMin = Math.round((focusState.totalSec - Math.max(0,focusState.remainingSec))/60) || Math.round(focusState.totalSec/60);
  await dbAdd("sessions", { taskId: focusState.task? focusState.task.id: null, minutes: elapsedMin, endedAt:new Date().toISOString(), completed });
  if(focusState.task && completed){
    const mark = confirm('Session done. Mark "'+focusState.task.title+'" as complete?');
    if(mark) await toggleTask(focusState.task.id);
  }
  addChatBubble("system", completed ? "Focus session complete — "+elapsedMin+" min." : "Focus session ended — "+elapsedMin+" min.");
  focusState = null;
}

