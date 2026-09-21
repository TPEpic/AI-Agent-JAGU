// ── SMALL HELPERS ──
export const $ = (sel,root)=> (root||document).querySelector(sel);
export const $$ = (sel,root)=> Array.from((root||document).querySelectorAll(sel));
export function pad2(n){ return String(n).padStart(2,"0"); }
export function timeToMin(t){ if(!t) return null; const [h,m]=t.split(":").map(Number); return h*60+(m||0); }
export function minToLabel(mins){ mins=((mins%1440)+1440)%1440; const h=Math.floor(mins/60), m=mins%60; const ap = h<12?"AM":"PM"; let h12=h%12; if(h12===0) h12=12; return h12+(m? ":"+pad2(m):"")+" "+ap; }
export function fmtMinutes(mins){ if(mins<60) return mins+" min"; const h=Math.floor(mins/60), m=mins%60; return h+"h"+(m? " "+m+"m":""); }
export function todayIdx(){ return (new Date().getDay()+6)%7; }
export function nowMin(){ const d=new Date(); return d.getHours()*60+d.getMinutes(); }
export function uid(){ return Math.random().toString(36).slice(2,10); }
export function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
export function daysUntil(dateStr){ const d=new Date(dateStr+"T00:00:00"); const t=new Date(); t.setHours(0,0,0,0); return Math.round((d-t)/86400000); }

export function showToast(msg, type){
  const root = $("#toast-root");
  const el = document.createElement("div");
  el.className="toast"; el.textContent = msg;
  if(type==="error"){ el.style.borderColor="var(--danger)"; }
  root.appendChild(el);
  setTimeout(()=>{ el.style.transition="opacity .3s"; el.style.opacity="0"; setTimeout(()=>el.remove(),320); }, 3200);
}

