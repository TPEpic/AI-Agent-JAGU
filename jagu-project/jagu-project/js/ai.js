import { $, daysUntil, esc, fmtMinutes, minToLabel, pad2, showToast, timeToMin, todayIdx } from './helpers.js';
import { DAY_LABELS, DAY_NAMES, activeProviderHasKey, dbAdd, dbUpdate, state } from './state.js';
import { addChatBubble, allPendingTasks, computeStatus, greetingWord, pickFallbackTask, projectById, projectProgress } from './render.js';
import { closeModal } from './modals.js';
import { openFocusSession } from './focus.js';
import { HAS_TTS, setOrb, speak, voiceUnlocked } from './voice.js';
import { isLiveModel } from './live-api.js';

// ── CLAUDE API ──
async function callAI(promptText, opts){
  const provider = state.profile.provider||"gemini";
  const fn = provider==="gemini" ? callGeminiAPI : callClaudeAPI;
  const maxRetries = 2; // total up to 3 attempts
  let lastErr;
  for(let attempt=0; attempt<=maxRetries; attempt++){
    try{
      return await fn(promptText, opts);
    }catch(err){
      lastErr = err;
      const retryable = err && (err.code==="http_503" || err.code==="http_429" || err.code==="network");
      if(!retryable || attempt===maxRetries) throw err;
      await new Promise(r=> setTimeout(r, 1200 * Math.pow(2, attempt))); // 1.2s, then 2.4s
    }
  }
  throw lastErr;
}

async function callClaudeAPI(promptText, opts){
  opts = opts || {};
  const apiKey = (state.profile.apiKey||"").trim();
  if(!apiKey){ const err = new Error("no_key"); err.code="no_key"; throw err; }
  const model = (state.profile.model||"").trim() || "claude-sonnet-5";
  const content = opts.imageBase64
    ? [ {type:"image", source:{type:"base64", media_type: opts.imageMimeType||"image/jpeg", data: opts.imageBase64}}, {type:"text", text: promptText} ]
    : promptText;
  const body = {
    model: model,
    max_tokens: opts.maxTokens || 800,
    messages: [{ role:"user", content: content }],
  };
  let res;
  try{
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "x-api-key": apiKey,
        "anthropic-version":"2023-06-01",
        "anthropic-dangerous-direct-browser-access":"true",
      },
      body: JSON.stringify(body),
    });
  }catch(networkErr){
    const err = new Error("network"); err.code="network"; throw err;
  }
  if(!res.ok){
    let message = "API error "+res.status;
    try{ const j = await res.json(); if(j && j.error && j.error.message) message = j.error.message; }catch(e){}
    const err = new Error(message); err.code = "http_"+res.status; throw err;
  }
  const data = await res.json();
  const text = (data.content||[]).filter(b=>b.type==="text").map(b=>b.text).join("\n");
  if(!text) { const err = new Error("empty_completion"); err.code="empty_completion"; throw err; }
  return text;
}

async function callGeminiAPI(promptText, opts){
  opts = opts || {};
  const apiKey = (state.profile.geminiKey||"").trim();
  if(!apiKey){ const err = new Error("no_key"); err.code="no_key"; throw err; }
  const configuredModel = (state.profile.geminiModel||"").trim() || "gemini-flash-latest";
  // Live models only support bidiGenerateContent over WebSocket — this is a
  // one-shot REST call (photo scan, etc.), so fall back to a REST-capable model.
  const model = isLiveModel() ? "gemini-flash-latest" : configuredModel;
  const parts = [];
  if(opts.imageBase64) parts.push({ inline_data: { mime_type: opts.imageMimeType||"image/jpeg", data: opts.imageBase64 } });
  parts.push({ text: promptText });
  const body = {
    contents: [{ role:"user", parts: parts }],
    generationConfig: { maxOutputTokens: opts.maxTokens || 800, responseMimeType: "application/json" },
  };
  let res;
  try{
    res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(model)+":generateContent", {
      method:"POST",
      headers:{ "Content-Type":"application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
  }catch(networkErr){
    const err = new Error("network"); err.code="network"; throw err;
  }
  if(!res.ok){
    let message = "API error "+res.status;
    try{ const j = await res.json(); if(j && j.error && j.error.message) message = j.error.message; }catch(e){}
    const err = new Error(message); err.code = "http_"+res.status; throw err;
  }
  const data = await res.json();
  const cand = (data.candidates||[])[0];
  const text = cand && cand.content && cand.content.parts ? cand.content.parts.filter(p=>p.text).map(p=>p.text).join("\n") : "";
  if(!text) { const err = new Error("empty_completion"); err.code="empty_completion"; throw err; }
  return text;
}

function parseJsonLoose(text){
  try{ return JSON.parse(text); }catch(e){}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fence){ try{ return JSON.parse(fence[1]); }catch(e){} }
  const startObj = text.indexOf("{"), startArr = text.indexOf("[");
  const start = (startObj>=0 && (startArr<0 || startObj<startArr)) ? startObj : startArr;
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if(start>=0 && end>start){
    try{ return JSON.parse(text.slice(start, end+1)); }catch(e){}
  }
  throw new Error("invalid_json");
}

function apiErrorCopy(err){
  const code = err && err.code;
  const providerName = (state.profile.provider||"gemini")==="gemini" ? "Gemini" : "Anthropic";
  const raw = (err && err.message) ? String(err.message).slice(0,180) : "";
  const detail = raw ? " ["+code+": "+raw+"]" : (code ? " ["+code+"]" : "");
  if(code==="no_key") return "Add your "+providerName+" API key in Settings first.";
  if(code==="network") return "Couldn't reach "+providerName+"'s API — check your internet connection."+detail;
  if(code==="http_401" || code==="http_403") return "That API key was rejected — check it's correct in Settings."+detail;
  if(code==="http_429") return "Rate limited — give it a moment and try again."+detail;
  if(code && code.indexOf("http_4")===0) return "The request was rejected."+detail;
  if(code && code.indexOf("http_5")===0) return providerName+"'s API had a hiccup — try again in a moment."+detail;
  if(code==="invalid_json") return "I got a bit tangled up there — could you say that again?"+detail;
  if(code==="empty_completion") return "I didn't get a reply back that time — try again."+detail;
  return "Something went wrong reaching "+providerName+" — try again."+detail;
}

function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = ()=> resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}


// ── TIMETABLE PHOTO SCAN ──
$("#scan-timetable-btn").addEventListener("click", ()=> $("#timetable-photo-input").click());
$("#timetable-photo-input").addEventListener("change", async (e)=>{
  const file = e.target.files[0];
  e.target.value = "";
  if(!file) return;
  if(!activeProviderHasKey()){ showToast("Add your API key in Settings to use photo scanning.","error"); return; }

  const url = URL.createObjectURL(file);
  const root = $("#modal-root");
  root.innerHTML = '<div class="sheet"><div class="sheet-handle"></div><p class="sheet-title">Reading your timetable…</p><img class="scan-preview" src="'+url+'"><p style="color:var(--text-faint); font-size:13px;">This can take up to a minute.</p></div>';
  root.classList.remove("hidden");

  try{
    const prompt = 'This image shows a class or lesson timetable. Read every entry you can clearly identify and reply with ONLY a JSON array (no other text), each item shaped exactly as: {"day":"Mon|Tue|Wed|Thu|Fri|Sat|Sun","start":"HH:MM","end":"HH:MM","subject":"string","room":"string or null"}. Use 24-hour time. Skip anything you cannot read confidently.';
    const b64 = await fileToBase64(file);
    const text = await callAI(prompt, { imageBase64: b64, imageMimeType: file.type||"image/jpeg" });
    const result = parseJsonLoose(text);
    const arr = Array.isArray(result) ? result : [];
    const clean = arr.filter(x=>x && x.day && x.start && x.end && x.subject).map(x=>({
      day: DAY_NAMES.findIndex(d=>d.toLowerCase()===String(x.day).slice(0,3).toLowerCase()),
      start:x.start, end:x.end, subject:x.subject, room:x.room||null,
    })).filter(x=>x.day>=0);

    if(clean.length===0){
      root.innerHTML = '<div class="sheet"><div class="sheet-handle"></div><p class="sheet-title">No classes found</p><p style="color:var(--text-dim); font-size:13.5px; margin-bottom:16px;">I couldn\'t read a timetable clearly in that photo. Try a clearer, well-lit photo, or add classes manually.</p><button class="btn-full" id="scan-close">Close</button></div>';
      $("#scan-close").onclick = closeModal;
      return;
    }

    root.innerHTML = '<div class="sheet"><div class="sheet-handle"></div><p class="sheet-title">Found '+clean.length+' class'+(clean.length===1?"":"es")+'</p>'
      + '<div style="max-height:240px; overflow-y:auto; margin-bottom:16px;">'
      + clean.map(c=>'<div class="extract-row"><span>'+DAY_NAMES[c.day]+' '+c.start+'–'+c.end+'</span><span>'+esc(c.subject)+'</span></div>').join("")
      + '</div><div class="modal-actions"><button id="scan-cancel" class="btn-full ghost">Cancel</button><button id="scan-confirm" class="btn-full">Add all</button></div></div>';
    $("#scan-cancel").onclick = closeModal;
    $("#scan-confirm").onclick = async ()=>{
      closeModal();
      for(const c of clean){ await dbAdd("timetable", c); }
      showToast("Added "+clean.length+" classes to your timetable.");
    };
  }catch(err){
    console.warn(err);
    root.innerHTML = '<div class="sheet"><div class="sheet-handle"></div><p class="sheet-title">Couldn\'t read that photo</p><p style="color:var(--text-dim); font-size:13.5px; margin-bottom:16px;">'+esc(apiErrorCopy(err))+'</p><button class="btn-full" id="scan-close2">Close</button></div>';
    $("#scan-close2").onclick = closeModal;
  }
});


// ── JAGU BRAIN ──
function buildDateReference(days){
  const out = [];
  const todayI = todayIdx(); // 0=Mon..6=Sun
  const now = new Date(); now.setHours(0,0,0,0);
  for(let i=0;i<days;i++){
    const d = new Date(now); d.setDate(d.getDate()+i);
    const iso = d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate());
    const wd = DAY_NAMES[(todayI+i)%7];
    let tag;
    if(i===0) tag = "today";
    else if(i===1) tag = "tomorrow";
    else if(i <= 6-todayI) tag = "this "+DAY_LABELS[(todayI+i)%7];
    else if(i <= 13-todayI) tag = "next "+DAY_LABELS[(todayI+i)%7];
    else tag = DAY_LABELS[(todayI+i)%7]+" the week after next";
    out.push(wd+" "+iso+" — "+tag);
  }
  return out.join("\n");
}

export function buildContext(){
  const st = computeStatus();
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-GB", {weekday:"long", day:"numeric", month:"long"});
  const timeStr = pad2(now.getHours())+":"+pad2(now.getMinutes());

  let lines = [];
  lines.push("Today is "+dateStr+", current time "+timeStr+".");
  if(st.state==="class") lines.push("Tahira is currently in "+st.current.subject+(st.current.room?" (Room "+st.current.room+")":"")+", until "+st.current.end+".");
  else lines.push("Tahira is currently free for "+fmtMinutes(st.freeMinutes)+(st.next?", until "+st.next.subject+" at "+st.next.start:", for the rest of the day")+".");

  const projects = state.projects.filter(p=>!p.archived);
  if(projects.length){
    lines.push("Projects and courses:");
    projects.forEach(p=>{
      const pct = projectProgress(p);
      lines.push("- ["+p.id+"] "+p.name+" ("+p.kind+"), "+pct+"% complete"+(p.deadline?", deadline "+p.deadline:""));
    });
  } else lines.push("No projects or courses added yet.");

  const pending = allPendingTasks().slice(0,10);
  if(pending.length){
    lines.push("Pending tasks:");
    pending.forEach(t=>{
      const p = projectById(t.projectId);
      lines.push("- ["+t.id+"] "+t.title+" (~"+(t.estMinutes||20)+" min"+(p?", "+p.name:"")+")");
    });
  } else lines.push("No pending tasks.");

  const upcomingEvents = state.events.filter(e=>daysUntil(e.date)>=0).sort((a,b)=>daysUntil(a.date)-daysUntil(b.date)).slice(0,5);
  if(upcomingEvents.length){
    lines.push("Upcoming events:");
    upcomingEvents.forEach(e=> lines.push("- ["+e.id+"] "+e.title+" in "+daysUntil(e.date)+" day(s) ("+e.date+")"));
  }

  if(state.memory.length){
    lines.push("Things Tahira has told JAGU to remember:");
    state.memory.slice(0,8).forEach(m=> lines.push("- "+m.text));
  }

  const recentUpdates = state.updates.slice(0,6);
  if(recentUpdates.length){
    lines.push("Recent project/course updates Tahira has logged:");
    recentUpdates.forEach(u=>{
      const p = projectById(u.projectId);
      lines.push("- "+(p?"["+p.name+"] ":"")+u.text);
    });
  }

  lines.push("");
  lines.push("DATE REFERENCE — use these exact ISO dates for anything relative (\"next Tuesday\", \"tomorrow\", \"in two weeks\"). Never calculate a date yourself; look it up here:");
  lines.push(buildDateReference(21));

  const recentChat = state.chatTurns.slice(-8).filter(t=>t.role!=="system");
  if(recentChat.length){
    lines.push("Recent conversation:");
    recentChat.forEach(t=> lines.push((t.role==="user"?"Tahira":"JAGU")+": "+t.text));
  }

  return lines.join("\n");
}

const SYSTEM_RULES = `You are JAGU, Tahira's personal AI learning, growth and time-management companion, speaking to her in a voice-first app.
Voice personality: natural, intelligent, warm, calm, professional, slightly futuristic, conversational. Never robotic, never over-enthusiastic, no motivational filler, no long speeches.
Replies must be 1 to 4 short sentences unless she explicitly asks for more detail.
Be context-aware: use the state given below rather than asking her to repeat things she has already told you.
You may propose actions the app should take, using ONLY the ids given in the context above (never invent an id).
When Tahira mentions a date or event (an inspection, deadline, trip, appointment, "please note X is happening on Y") — including with relative wording like "next week Tuesday" — use add_event, and take the ISO date ONLY from the DATE REFERENCE table below; never compute it yourself.
When Tahira shares a status update, progress, or something that happened on a specific project or course ("I finished the literature review", "the Y11 mock is done", "struggled with the API today") — use log_update with that project's id from the Projects list above. If it clearly isn't tied to any listed project, use log_update with projectId null, or memory if it's more of a standing fact/preference than a one-off update.
Reply with ONLY a JSON object, no other text, shaped exactly as:
{"reply": "what JAGU says out loud", "actions": [ {"type":"add_task","title":"...","projectId":"<id or null>","estMinutes":20} | {"type":"complete_task","taskId":"<id>"} | {"type":"start_focus","taskId":"<id or null>","minutes":25} | {"type":"add_project","name":"...","kind":"project|course"} | {"type":"add_event","title":"...","date":"YYYY-MM-DD"} | {"type":"log_update","projectId":"<id or null>","text":"..."} ], "memory": "a short standing fact worth remembering long-term, or null"}
Use an empty actions array when no action is needed. Only include a memory fact for standing facts/preferences (not one-off updates, which belong in log_update, and not dated events, which belong in add_event).`;

async function callJagu(userText){
  if(!activeProviderHasKey()){
    return { reply: "I don't have an API key yet — add one in Settings (Google Gemini is free) so I can think. You can still track things manually meanwhile.", actions:[], memory:null };
  }
  const context = buildContext();
  const prompt = SYSTEM_RULES + "\n\nCURRENT STATE:\n" + context + "\n\nTahira just said: \"" + userText + "\"\n\nRespond now as JAGU, following the JSON format exactly.";
  try{
    const text = await callAI(prompt);
    const result = parseJsonLoose(text);
    if(result && typeof result.reply === "string"){
      return { reply: result.reply, actions: Array.isArray(result.actions)?result.actions:[], memory: result.memory||null };
    }
    return { reply:"I heard you, but I'm not sure how to respond to that yet.", actions:[], memory:null };
  }catch(err){
    console.warn("AI call error", err);
    return { reply: apiErrorCopy(err), actions:[], memory:null };
  }
}

export async function applyActions(actions){
  for(const a of actions){
    try{
      if(a.type==="add_task" && a.title){
        await dbAdd("tasks", {projectId:a.projectId||null, title:a.title, estMinutes:Number(a.estMinutes)||20, status:"pending", completedAt:null});
      } else if(a.type==="complete_task" && a.taskId){
        await dbUpdate("tasks", a.taskId, {status:"done", completedAt:new Date().toISOString()});
      } else if(a.type==="start_focus"){
        const task = a.taskId ? state.tasks.find(t=>t.id===a.taskId) : null;
        openFocusSession(task, Number(a.minutes)||25);
      } else if(a.type==="add_project" && a.name){
        await dbAdd("projects", {name:a.name, kind:a.kind||"course", deadline:null, progress:0, archived:false});
      } else if(a.type==="add_event" && a.title && a.date){
        if(/^\d{4}-\d{2}-\d{2}$/.test(a.date)){
          await dbAdd("events", {title:a.title, date:a.date, prepped:false});
        } else {
          console.warn("skipped add_event — bad date format", a);
        }
      } else if(a.type==="log_update" && a.text){
        await dbAdd("updates", {projectId:a.projectId||null, text:a.text});
      }
    }catch(e){ console.warn("action failed", a, e); }
  }
}

export async function handleUserMessage(text){
  addChatBubble("user", text);
  setOrb("thinking");
  const res = await callJagu(text);
  addChatBubble("assistant", res.reply);
  if(res.memory){ dbAdd("memory", {text:res.memory}); }
  if(res.actions && res.actions.length){ await applyActions(res.actions); }
  speak(res.reply);
}


// ── GREET ON LAUNCH ──
export function greet(){
  const st = computeStatus();
  let msg;
  if(st.state==="class"){
    msg = greetingWord()+", "+((state.profile.name||"").split(" ")[0]||"")+". You're in "+st.current.subject+" until "+minToLabel(timeToMin(st.current.end))+".";
  } else {
    const pick = pickFallbackTask(st.freeMinutes);
    msg = greetingWord()+", "+((state.profile.name||"").split(" ")[0]||"")+". You've got "+fmtMinutes(st.freeMinutes)+" free"+(pick? " — I'd suggest "+pick.t.title+".":".");
  }
  addChatBubble("assistant", msg);
  speak(msg);
  if(!voiceUnlocked && HAS_TTS && state.profile.voiceOut){
    showToast("Tap anywhere to hear JAGU — browsers block audio until you interact.");
  }
}

