import { $, showToast } from './helpers.js';
import { state } from './state.js';
import { LIVE, isLiveModel, liveConnect, liveDisconnect } from './live-api.js';
import { handleUserMessage } from './ai.js';

// ── VOICE ──
export const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const HAS_TTS = "speechSynthesis" in window;
export let recognition = null, recognizing = false, wantListening = false;
let orbState = "idle";

export function setOrb(s, captionOverride){
  orbState = s;
  const orb = $("#orb");
  orb.className = "orb state-"+s;
  $("#orb-caption").textContent = captionOverride || { idle:"TAP TO TALK", listening:"LISTENING…", thinking:"THINKING…", speaking:"SPEAKING…" }[s] || "";
}

export const IS_FRAMED = (function(){ try{ return window.self !== window.top; }catch(e){ return true; } })();
export let lastVoiceError = null;
function recordVoiceError(code, detail){
  lastVoiceError = { code: code, detail: detail||"", time: new Date() };
}

const SPEECH_ERROR_COPY = {
  "not-allowed": IS_FRAMED
    ? "Microphone blocked — this is running inside an embedded preview, which Edge/Chrome won't grant mic access to. Use the banner above to open JAGU in its own tab."
    : "Microphone access is blocked. Click the site-info icon next to the address bar, set Microphone to Allow, then reload.",
  "service-not-allowed": IS_FRAMED
    ? "Microphone blocked by the embedded preview — open JAGU in its own tab (banner above) and try again."
    : "Microphone access is blocked here — check your browser's site permissions for this page.",
  "audio-capture": "No microphone was found on this device.",
  "no-speech": "I didn't catch that — try again.",
  "network": "Voice recognition needs an internet connection.",
  "aborted": null,
};

if(SR){
  recognition = new SR();
  recognition.lang = "en-GB";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onstart = ()=>{ recognizing = true; setOrb("listening"); };
  recognition.onerror = (e)=>{
    console.warn("speech error", e.error);
    recognizing = false;
    if(orbState==="listening") setOrb("idle");
    const copy = SPEECH_ERROR_COPY.hasOwnProperty(e.error) ? SPEECH_ERROR_COPY[e.error] : "Voice input hit a problem ("+e.error+") — try typing instead.";
    recordVoiceError(e.error, copy||"");
    if(copy) showToast(copy, "error");
  };
  recognition.onend = ()=>{
    recognizing = false;
    if(orbState==="listening") setOrb("idle");
  };
  recognition.onresult = (e)=>{
    let finalText = "";
    for(let i=e.resultIndex;i<e.results.length;i++){
      if(e.results[i].isFinal) finalText += e.results[i][0].transcript;
    }
    if(finalText.trim()){
      handleUserMessage(finalText.trim());
    }
  };
}

function startListening(){
  unlockVoice();
  if(!recognition){ $("#text-input").focus(); recordVoiceError("unsupported","SpeechRecognition API not present in this browser"); showToast("Voice input needs Chrome or Edge — you can still type to JAGU."); return; }
  if(IS_FRAMED){ recordVoiceError("framed","running inside an embedded preview"); showToast("Voice needs its own tab — copy the link from the banner above into a new tab.", "error"); return; }
  if(HAS_TTS && speechSynthesis.speaking){ speechSynthesis.cancel(); }
  try{ recognition.start(); }
  catch(e){
    if(e && e.name==="InvalidStateError"){ try{ recognition.stop(); }catch(e2){} }
    else {
      console.warn("recognition.start failed", e);
      recordVoiceError((e&&e.name)||"start-failed", (e&&e.message)||"recognition.start() threw synchronously");
      showToast("Couldn't start the microphone ("+(e&&e.name||"unknown")+") — try again.", "error");
    }
  }
}
function stopListening(){ if(recognition && recognizing) recognition.stop(); }

$("#orb").addEventListener("click", ()=>{
  if(isLiveModel()){
    if(LIVE.connected || LIVE.connecting){ liveDisconnect(); } else { liveConnect(); }
    return;
  }
  if(orbState==="speaking"){ if(HAS_TTS) speechSynthesis.cancel(); setOrb("idle"); startListening(); return; }
  if(orbState==="listening"){ stopListening(); return; }
  if(orbState==="idle"){ startListening(); }
});

/* --- Autoplay-safe speech output ---
   Browsers refuse to play synthesized speech until the page has seen a
   genuine user gesture (click/touch/keydown). JAGU's own greeting fires
   on load, before that gesture exists, so it's queued and spoken as soon
   as the first interaction happens anywhere on the page. Chrome also has
   a long-standing bug where the speech engine silently pauses after
   ~15s idle, so a watchdog resumes it periodically. */
export let voiceUnlocked = false;
let pendingSpeech = null;
function unlockVoice(){
  if(voiceUnlocked) return;
  voiceUnlocked = true;
  if(HAS_TTS){
    try{
      speechSynthesis.resume();
      // "prime" the engine with a near-silent utterance so the first real
      // utterance isn't the one that has to establish audio output.
      const primer = new SpeechSynthesisUtterance(" ");
      primer.volume = 0;
      speechSynthesis.speak(primer);
    }catch(e){}
  }
  if(pendingSpeech){ const t = pendingSpeech; pendingSpeech = null; speakNow(t); }
}
["click","touchstart","keydown"].forEach(evt=> document.addEventListener(evt, unlockVoice, {passive:true}));
if(HAS_TTS){ setInterval(()=>{ try{ if(speechSynthesis.paused) speechSynthesis.resume(); }catch(e){} }, 4000); }

export function speak(text){
  if(!HAS_TTS || !state.profile.voiceOut){ setOrb("idle"); maybeContinueConversation(); return; }
  if(!voiceUnlocked){ pendingSpeech = text; return; } // wait for the page's first user gesture
  speakNow(text);
}
function speakNow(text){
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  const voices = speechSynthesis.getVoices();
  const chosen = voices.find(v=>v.voiceURI===state.profile.voiceURI);
  if(chosen) utt.voice = chosen;
  utt.rate = Number(state.profile.rate)||1;
  utt.pitch = Number(state.profile.pitch)||1;
  utt.onstart = ()=> setOrb("speaking");
  utt.onend = ()=>{ setOrb("idle"); maybeContinueConversation(); };
  utt.onerror = (e)=>{ console.warn("speech synth error", e.error); setOrb("idle"); };
  speechSynthesis.speak(utt);
}
function maybeContinueConversation(){
  if(state.profile.convoMode) setTimeout(()=>{ if(orbState==="idle") startListening(); }, 450);
}

