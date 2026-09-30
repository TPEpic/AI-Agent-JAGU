import { $, esc, showToast } from './helpers.js';
import { activeProviderHasKey, state } from './state.js';
import { HAS_TTS, IS_FRAMED, SR, lastVoiceError, recognition } from './voice.js';

// ── DIAGNOSTICS ──
export function initFrameBanner(){
  const banner = $("#frame-banner");
  if(!banner) return;
  if(IS_FRAMED && SR){
    banner.classList.remove("hidden");
    const urlBox = $("#frame-banner-url");
    urlBox.value = location.href;
    urlBox.addEventListener("click", ()=> urlBox.select());
    urlBox.addEventListener("focus", ()=> urlBox.select());
    $("#frame-banner-copy").addEventListener("click", async ()=>{
      urlBox.select();
      try{
        await navigator.clipboard.writeText(location.href);
        showToast("Link copied — paste it into a new browser tab.");
      }catch(e){
        try{ document.execCommand("copy"); showToast("Link copied — paste it into a new browser tab."); }
        catch(e2){ showToast("Couldn't copy automatically — the link is selected, copy it manually (Ctrl/Cmd+C)."); }
      }
    });
  }
}

function browserGuess(){
  const ua = navigator.userAgent || "";
  if(/EdgiOS|EdgA|Edg\//.test(ua)) return "Edge";
  if(/CriOS|Chrome\//.test(ua) && !/Edg/.test(ua)) return "Chrome";
  if(/FxiOS|Firefox\//.test(ua)) return "Firefox";
  if(/Safari\//.test(ua) && !/Chrome|CriOS|Edg/.test(ua)) return "Safari";
  return "Unknown";
}
function deviceGuess(){
  const ua = navigator.userAgent || "";
  if(/iPhone|iPad|iPod/.test(ua)) return "iOS (uses Apple's engine — Web Speech API is often unavailable, even in Edge/Chrome for iOS)";
  if(/Android/.test(ua)) return "Android";
  if(/Windows/.test(ua)) return "Windows desktop";
  if(/Mac OS X/.test(ua)) return "macOS desktop";
  return "Unknown";
}

async function collectDiagnostics(){
  const rows = [];
  rows.push(["Device", deviceGuess()]);
  rows.push(["Browser", browserGuess()]);
  rows.push(["Speech recognition", SR ? "Supported ✓" : "Not supported ✗"]);
  rows.push(["Speech output (TTS)", HAS_TTS ? "Supported ✓" : "Not supported ✗"]);
  rows.push(["Secure connection", window.isSecureContext ? "Yes ✓" : "No ✗ (voice needs https)"]);
  rows.push(["Embedded preview", IS_FRAMED ? "Yes — this blocks the mic ✗" : "No — running as its own page ✓"]);

  let micState = "Unknown (browser can't report this)";
  try{
    if(navigator.permissions && navigator.permissions.query){
      const status = await navigator.permissions.query({name:"microphone"});
      micState = { granted:"Granted ✓", denied:"Denied ✗", prompt:"Not asked yet" }[status.state] || status.state;
    }
  }catch(e){ /* not supported in this browser, leave as Unknown */ }
  rows.push(["Microphone permission", micState]);

  rows.push(["Last voice error", lastVoiceError
    ? lastVoiceError.code+" at "+lastVoiceError.time.toLocaleTimeString()
    : "None yet this session"]);
  rows.push(["AI provider", (state.profile.provider||"gemini")==="gemini" ? "Google Gemini" : "Anthropic Claude"]);
  rows.push(["AI key", activeProviderHasKey() ? "Set ✓" : "Not set — JAGU's AI brain is off until you add one"]);

  return rows;
}

export async function runDiagnostics(){
  const card = $("#diag-card");
  if(!card) return;
  card.innerHTML = '<div class="today-row"><span class="label">Checking</span><span class="val">…</span></div>';
  const rows = await collectDiagnostics();
  card.innerHTML = rows.map(([l,v])=>'<div class="today-row"><span class="label">'+esc(l)+'</span><span class="val">'+esc(v)+'</span></div>').join("");
}
$("#diag-refresh") && $("#diag-refresh").addEventListener("click", runDiagnostics);

$("#diag-copy") && $("#diag-copy").addEventListener("click", async ()=>{
  const rows = await collectDiagnostics();
  let text = "JAGU voice diagnostics — "+new Date().toString()+"\n";
  rows.forEach(([l,v])=> text += l+": "+v+"\n");
  if(lastVoiceError && lastVoiceError.detail) text += "Last error detail: "+lastVoiceError.detail+"\n";
  text += "User agent: "+navigator.userAgent+"\n";
  text += "Page URL: "+location.href+"\n";
  try{
    await navigator.clipboard.writeText(text);
    showToast("Diagnostics copied — paste them here in chat.");
  }catch(e){
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand("copy"); showToast("Diagnostics copied — paste them here in chat."); }
    catch(e2){ showToast("Couldn't copy automatically — check the browser console (F12) instead."); }
    ta.remove();
  }
});

