import { $, esc, showToast } from './helpers.js';
import { state } from './state.js';
import { addChatBubble } from './render.js';
import { lastVoiceError, setOrb } from './voice.js';
import { applyActions, buildContext } from './ai.js';

// ── GEMINI LIVE API ──
export function isLiveModel(){
  return (state.profile.provider||"gemini")==="gemini" && /live/i.test(state.profile.geminiModel||"");
}

export const LIVE = {
  ws:null, connected:false, connecting:false,
  captureCtx:null, micStream:null, processor:null, silentGain:null,
  playCtx:null, playHead:0, activeSources:[],
};
let liveStreamBuf = { user:"", assistant:"" };

function liveWsUrl(){
  const key = (state.profile.geminiKey||"").trim();
  return "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key="+encodeURIComponent(key);
}

function liveBuildTools(){
  return [{
    functionDeclarations: [
      { name:"add_task", description:"Add a new task, optionally linked to a project or course by id.",
        parameters:{ type:"OBJECT", properties:{
          title:{type:"STRING"}, projectId:{type:"STRING", description:"id of an existing project — omit for a standalone task"}, estMinutes:{type:"NUMBER"}
        }, required:["title"] } },
      { name:"complete_task", description:"Mark an existing task as done, by its id.",
        parameters:{ type:"OBJECT", properties:{ taskId:{type:"STRING"} }, required:["taskId"] } },
      { name:"start_focus", description:"Start a focus timer session, optionally for a specific task.",
        parameters:{ type:"OBJECT", properties:{ taskId:{type:"STRING"}, minutes:{type:"NUMBER"} } } },
      { name:"add_project", description:"Add a new project or course.",
        parameters:{ type:"OBJECT", properties:{ name:{type:"STRING"}, kind:{type:"STRING", description:"'project' or 'course'"} }, required:["name"] } },
      { name:"add_event", description:"Add a dated event or important date, such as an inspection or deadline.",
        parameters:{ type:"OBJECT", properties:{ title:{type:"STRING"}, date:{type:"STRING", description:"ISO date YYYY-MM-DD — resolve relative dates from the date reference table, never calculate it yourself"} }, required:["title","date"] } },
      { name:"delete_event", description:"Remove an existing event, by its id.",
        parameters:{ type:"OBJECT", properties:{ eventId:{type:"STRING"} }, required:["eventId"] } },
      { name:"update_event", description:"Change an existing event's title and/or date, by its id. Only include fields that changed.",
        parameters:{ type:"OBJECT", properties:{ eventId:{type:"STRING"}, title:{type:"STRING"}, date:{type:"STRING", description:"ISO date YYYY-MM-DD"} }, required:["eventId"] } },
      { name:"delete_class", description:"Remove an existing class from the timetable, by its id.",
        parameters:{ type:"OBJECT", properties:{ classId:{type:"STRING"} }, required:["classId"] } },
      { name:"update_class", description:"Change an existing timetable class's day, time, subject or room, by its id. Only include fields that changed.",
        parameters:{ type:"OBJECT", properties:{
          classId:{type:"STRING"}, day:{type:"NUMBER", description:"0=Monday ... 6=Sunday"}, start:{type:"STRING", description:"HH:MM"}, end:{type:"STRING", description:"HH:MM"}, subject:{type:"STRING"}, room:{type:"STRING"}
        }, required:["classId"] } },
      { name:"log_update", description:"Log a free-text progress update or note, optionally linked to a project by id.",
        parameters:{ type:"OBJECT", properties:{ projectId:{type:"STRING"}, text:{type:"STRING"} }, required:["text"] } },
    ]
  }];
}

function liveBuildSystemInstruction(){
  return `You are JAGU, Tahira's personal AI learning, growth and time-management companion, talking with her live by voice.
Voice personality: natural, intelligent, warm, calm, professional, slightly futuristic, conversational. Never robotic, never over-enthusiastic, no motivational filler, no long speeches. Keep spoken replies short — 1 to 4 sentences unless she clearly wants more detail.
Be context-aware: use the state given below rather than asking her to repeat things she has already told you.
When she asks you to complete a task, start a focus session, or log/note a progress update, actually call the matching function right away — don't just say you will.
IMPORTANT — confirm before acting: for add_task, add_project, add_event, delete_event, update_event, delete_class and update_class, do NOT call the function the first time it comes up. Say back exactly what you're about to do as a short question (e.g. "Add a Game Development session tomorrow afternoon — shall I add that?") and wait — call nothing yet. Only call the function once she has clearly said yes / go ahead / do it / correct in reply to that question. If she says no or changes her mind, don't call anything. This matters a lot for voice: a brief pause while she's still talking can look like she's finished, so never create, delete or change something without her explicit spoken "yes" first, and never ask the same thing twice in a row.
When she mentions a date or event, resolve it using the date reference table below, propose it, and once confirmed call add_event with the exact ISO date.
When she asks to remove or change an existing event or timetable class, use its id from the state below and, once confirmed, call delete_event/update_event or delete_class/update_class. Copy each id exactly as shown between the square brackets, without the brackets themselves.

CURRENT STATE:
` + buildContext();
}

export async function liveConnect(){
  if(LIVE.connected || LIVE.connecting) return;
  const key = (state.profile.geminiKey||"").trim();
  if(!key){ showToast("Add your Gemini API key in Settings first.","error"); return; }
  LIVE.connecting = true;
  setOrb("thinking", "CONNECTING…");

  try{
    if(!LIVE.playCtx) LIVE.playCtx = new (window.AudioContext||window.webkitAudioContext)({sampleRate:24000});
    if(LIVE.playCtx.state==="suspended") await LIVE.playCtx.resume();
  }catch(e){ console.warn("playback context init failed", e); }

  let ws;
  let didOpen = false;
  try{ ws = new WebSocket(liveWsUrl()); }
  catch(e){ LIVE.connecting=false; setOrb("idle"); showToast("Couldn't open a live connection.","error"); return; }
  LIVE.ws = ws;

  ws.onopen = ()=>{
    didOpen = true;
    const model = (state.profile.geminiModel||"").trim() || "gemini-3.8-live";
    const setupMsg = { setup:{
      model: "models/"+model,
      generationConfig: { responseModalities: ["AUDIO"] },
      systemInstruction: { parts:[{ text: liveBuildSystemInstruction() }] },
      tools: liveBuildTools(),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    }};
    try{ ws.send(JSON.stringify(setupMsg)); }
    catch(e){ console.warn("setup send failed", e); }
  };

  ws.onmessage = async (evt)=>{
    let msg;
    try{
      const raw = evt.data instanceof Blob ? await evt.data.text() : evt.data;
      msg = JSON.parse(raw);
      if(msg.error) console.warn("live server reported an error:", msg.error);
    }catch(e){ console.warn("unreadable live message", e); return; }
    liveHandleServerMessage(msg);
  };

  ws.onerror = (e)=>{ console.warn("live websocket error event (browsers hide detail here — check the Network tab, WS filter)", e); };

  ws.onclose = (e)=>{
    const wasConnecting = LIVE.connecting;
    LIVE.connected = false; LIVE.connecting = false;
    liveStopCapture();
    liveFinalizeStreamingBubbles();
    setOrb("idle");
    lastVoiceError = { code:"live_close_"+e.code, detail:(e.reason||"no reason given by server")+(didOpen?" [handshake succeeded, setup rejected]":" [handshake never completed]"), time:new Date() };
    console.warn("live websocket closed", {code:e.code, reason:e.reason, wasClean:e.wasClean, didOpen});
    if(wasConnecting) showToast("Couldn't connect to Gemini Live [code "+e.code+(e.reason?": "+e.reason:"")+"] — check console (F12) → Network → WS for detail.","error");
    else if(e && e.code && e.code!==1000) showToast("Live session ended unexpectedly (code "+e.code+").","error");
  };
}

export function liveDisconnect(){
  liveStopCapture();
  liveStopPlayback();
  if(LIVE.ws){ try{ LIVE.ws.close(1000); }catch(e){} }
  LIVE.ws = null; LIVE.connected = false; LIVE.connecting = false;
  liveFinalizeStreamingBubbles();
  setOrb("idle");
}

function liveHandleServerMessage(msg){
  if(msg.setupComplete){
    LIVE.connecting = false; LIVE.connected = true;
    liveStartCapture();
    setOrb("listening", "LIVE · LISTENING…");
    addChatBubble("system", "Live voice connected.");
    return;
  }
  if(msg.serverContent){
    const sc = msg.serverContent;
    if(sc.interrupted) liveStopPlayback();
    if(sc.modelTurn && Array.isArray(sc.modelTurn.parts)){
      sc.modelTurn.parts.forEach(part=>{
        if(part.inlineData && part.inlineData.data){
          if(state.profile.voiceOut){ setOrb("speaking", "LIVE · SPEAKING…"); livePlayChunk(part.inlineData.data); }
        }
      });
    }
    if(sc.outputTranscription && sc.outputTranscription.text){ liveStreamBuf.assistant += sc.outputTranscription.text; liveRenderStreamingPreview(); }
    if(sc.inputTranscription && sc.inputTranscription.text){ liveStreamBuf.user += sc.inputTranscription.text; liveRenderStreamingPreview(); }
    if(sc.turnComplete){
      liveFinalizeStreamingBubbles();
      if(LIVE.connected) setOrb("listening", "LIVE · LISTENING…");
    }
    return;
  }
  if(msg.toolCall && Array.isArray(msg.toolCall.functionCalls)){
    liveHandleToolCall(msg.toolCall.functionCalls);
    return;
  }
}

async function liveHandleToolCall(functionCalls){
  const responses = [];
  for(const fc of functionCalls){
    try{
      const results = await applyActions([ Object.assign({type: fc.name}, fc.args||{}) ]);
      const r = results[0];
      if(r && r.ok===false){
        responses.push({ id: fc.id, name: fc.name, response:{ result:"error", message: r.reason||"that id didn't match anything" } });
      } else {
        responses.push({ id: fc.id, name: fc.name, response:{ result:"ok" } });
      }
    }catch(e){
      responses.push({ id: fc.id, name: fc.name, response:{ result:"error", message:String(e) } });
    }
  }
  if(LIVE.ws && LIVE.connected){
    try{ LIVE.ws.send(JSON.stringify({ toolResponse:{ functionResponses: responses } })); }catch(e){}
  }
}

export function liveSendUserText(text){
  addChatBubble("user", text);
  if(LIVE.ws && LIVE.connected){
    try{
      LIVE.ws.send(JSON.stringify({ clientContent:{ turns:[{role:"user", parts:[{text}]}], turnComplete:true } }));
      setOrb("thinking", "LIVE · THINKING…");
    }catch(e){}
  }
}

function liveRenderStreamingPreview(){
  const box = $("#transcript");
  const recent = state.chatTurns.slice(-12);
  let html = recent.map(t=>{
    if(t.role==="system") return '<div class="bubble system">'+esc(t.text)+'</div>';
    return '<div class="bubble '+(t.role==="user"?"user":"jagu")+'">'+esc(t.text)+'</div>';
  }).join("");
  if(liveStreamBuf.user) html += '<div class="bubble user" style="opacity:.6;">'+esc(liveStreamBuf.user)+'</div>';
  if(liveStreamBuf.assistant) html += '<div class="bubble jagu" style="opacity:.6;">'+esc(liveStreamBuf.assistant)+'</div>';
  box.innerHTML = html;
  box.scrollTop = box.scrollHeight;
}
function liveFinalizeStreamingBubbles(){
  if(liveStreamBuf.user.trim()) addChatBubble("user", liveStreamBuf.user.trim());
  if(liveStreamBuf.assistant.trim()) addChatBubble("assistant", liveStreamBuf.assistant.trim());
  liveStreamBuf = { user:"", assistant:"" };
}

/* --- mic capture: raw PCM16 16kHz mono, streamed continuously --- */
async function liveStartCapture(){
  try{
    LIVE.micStream = await navigator.mediaDevices.getUserMedia({ audio:{ channelCount:1, echoCancellation:true, noiseSuppression:true } });
  }catch(e){
    console.warn("mic error", e);
    showToast("Microphone access is needed for live voice.","error");
    liveDisconnect();
    return;
  }
  LIVE.captureCtx = new (window.AudioContext||window.webkitAudioContext)({sampleRate:16000});
  const source = LIVE.captureCtx.createMediaStreamSource(LIVE.micStream);
  const processor = LIVE.captureCtx.createScriptProcessor(4096, 1, 1);
  LIVE.processor = processor;
  LIVE.silentGain = LIVE.captureCtx.createGain();
  LIVE.silentGain.gain.value = 0; // route through the graph without audible playback (avoids echo)
  processor.onaudioprocess = (e)=>{
    if(!LIVE.connected || !LIVE.ws) return;
    const input = e.inputBuffer.getChannelData(0);
    const pcm = floatTo16BitPCM(input);
    const b64 = arrayBufferToBase64(pcm.buffer);
    try{ LIVE.ws.send(JSON.stringify({ realtimeInput:{ audio:{ data:b64, mimeType:"audio/pcm;rate=16000" } } })); }catch(err){}
  };
  source.connect(processor);
  processor.connect(LIVE.silentGain);
  LIVE.silentGain.connect(LIVE.captureCtx.destination);
}
function liveStopCapture(){
  if(LIVE.processor){ try{ LIVE.processor.disconnect(); }catch(e){} LIVE.processor=null; }
  if(LIVE.silentGain){ try{ LIVE.silentGain.disconnect(); }catch(e){} LIVE.silentGain=null; }
  if(LIVE.captureCtx){ try{ LIVE.captureCtx.close(); }catch(e){} LIVE.captureCtx=null; }
  if(LIVE.micStream){ LIVE.micStream.getTracks().forEach(t=>t.stop()); LIVE.micStream=null; }
}

/* --- playback: raw PCM16 24kHz mono, scheduled gapless --- */
function livePlayChunk(base64Data){
  if(!LIVE.playCtx) return;
  let bytes;
  try{
    const binary = atob(base64Data);
    bytes = new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  }catch(e){ return; }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for(let i=0;i<int16.length;i++) float32[i] = int16[i]/0x8000;
  const buffer = LIVE.playCtx.createBuffer(1, float32.length, 24000);
  buffer.copyToChannel(float32, 0);
  const src = LIVE.playCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(LIVE.playCtx.destination);
  const now = LIVE.playCtx.currentTime;
  const startAt = Math.max(now, LIVE.playHead);
  src.start(startAt);
  LIVE.playHead = startAt + buffer.duration;
  LIVE.activeSources.push(src);
  src.onended = ()=>{ LIVE.activeSources = LIVE.activeSources.filter(s=>s!==src); };
}
function liveStopPlayback(){
  LIVE.activeSources.forEach(s=>{ try{ s.stop(); }catch(e){} });
  LIVE.activeSources = [];
  if(LIVE.playCtx) LIVE.playHead = LIVE.playCtx.currentTime;
}

/* --- PCM/base64 helpers --- */
function floatTo16BitPCM(float32Array){
  const buf = new ArrayBuffer(float32Array.length*2);
  const view = new DataView(buf);
  for(let i=0, offset=0; i<float32Array.length; i++, offset+=2){
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s<0 ? s*0x8000 : s*0x7FFF, true);
  }
  return new Int16Array(buf);
}
function arrayBufferToBase64(buf){
  let binary=""; const bytes = new Uint8Array(buf); const chunkSize = 0x8000;
  for(let i=0;i<bytes.length;i+=chunkSize){
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i+chunkSize));
  }
  return btoa(binary);
}

