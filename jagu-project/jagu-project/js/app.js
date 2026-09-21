import { $ } from './helpers.js';
import { initStandalone } from './state.js';
import { LIVE, isLiveModel, liveSendUserText } from './live-api.js';
import { handleUserMessage } from './ai.js';
import { initField } from './field.js';
import { initFrameBanner, runDiagnostics } from './diagnostics.js';

// ── TEXT INPUT ──
$("#text-form").addEventListener("submit", (e)=>{
  e.preventDefault();
  const val = $("#text-input").value.trim();
  if(!val) return;
  $("#text-input").value = "";
  if(isLiveModel() && LIVE.connected){ liveSendUserText(val); }
  else { handleUserMessage(val); }
});


// ── BOOT ──
(function boot(){
  initField();
  initFrameBanner();
  runDiagnostics();
  initStandalone();
})();
