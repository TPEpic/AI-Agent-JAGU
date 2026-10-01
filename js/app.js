import { $ } from './helpers.js';
import { initStandalone } from './state.js';
import { LIVE, isLiveModel, liveSendUserText } from './live-api.js';
import { handleUserMessage } from './ai.js';
import { initFrameBanner, runDiagnostics } from './diagnostics.js';
import './settings.js';

// ── TEXT INPUT ──
$("#text-form").addEventListener("submit", (e)=>{
  e.preventDefault();
  const val = $("#text-input").value.trim();
  if(!val) return;
  $("#text-input").value = "";
  if(isLiveModel() && LIVE.connected){ liveSendUserText(val); }
  else { handleUserMessage(val); }
});


// ── SERVICE WORKER (installability + offline + background notifications) ──
if("serviceWorker" in navigator){
  window.addEventListener("load", ()=>{
    navigator.serviceWorker.register("./sw.js").catch(e=> console.warn("service worker registration failed", e));
  });
}

// ── BOOT ──
(function boot(){
  initFrameBanner();
  runDiagnostics();
  initStandalone();
})();
