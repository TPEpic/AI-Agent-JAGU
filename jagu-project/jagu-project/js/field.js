import { $ } from './helpers.js';

// ── AMBIENT FIELD ──
function hexToRgb(hex){
  const h = (hex||"").trim().replace("#","");
  const full = h.length===3 ? h.split("").map(c=>c+c).join("") : h;
  const n = parseInt(full,16);
  if(isNaN(n) || full.length!==6) return [111,180,255];
  return [(n>>16)&255,(n>>8)&255,n&255];
}

export function initField(){
  const canvas = $("#field-canvas");
  if(!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rgb = hexToRgb(getComputedStyle(document.documentElement).getPropertyValue("--rain") || "#6FB4FF");
  const rc = (a)=> "rgba("+rgb[0]+","+rgb[1]+","+rgb[2]+","+a+")";
  const COL_W = 16;
  let w,h,dpr,columns=[],readouts=[];

  function makeReadout(i){
    const bottomHalf = i%2===0;
    const leftSide = i%4<2;
    return {
      x: leftSide ? 0.05+Math.random()*0.16 : 0.80+Math.random()*0.15,
      y: bottomHalf ? 0.87+Math.random()*0.08 : 0.05+Math.random()*0.06,
      val: (Math.random()*900+10).toFixed(2),
      tick: Math.floor(Math.random()*140),
    };
  }

  function setup(){
    dpr = Math.min(window.devicePixelRatio||1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w*dpr)); canvas.height = Math.max(1, Math.round(h*dpr));
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,w,h);
    const count = Math.max(8, Math.round(w/COL_W));
    columns = Array.from({length:count}, (_,i)=>({
      x: i*COL_W + COL_W/2,
      y: Math.random()*-h,
      speed: 1.0 + Math.random()*2.2,
      glyphMode: Math.random()<0.42,
      char: Math.random()<0.5?"0":"1",
      flipAt: Math.random()*40,
    }));
    readouts = Array.from({length:6}, (_,i)=> makeReadout(i));
  }
  setup();
  window.addEventListener("resize", setup);

  function frame(){
    ctx.fillStyle = "rgba(2,4,12,0.15)";
    ctx.fillRect(0,0,w,h);
    ctx.textAlign = "center";

    for(const c of columns){
      c.y += c.speed*2;
      if(c.y > h+24){ c.y = Math.random()*-160; c.speed = 1.0+Math.random()*2.2; c.glyphMode = Math.random()<0.42; }
      c.flipAt--;
      if(c.flipAt<=0){ c.char = Math.random()<0.5?"0":"1"; c.flipAt = 12+Math.random()*30; }

      if(c.glyphMode){
        ctx.font = "12px 'Space Mono', monospace";
        ctx.fillStyle = rc((0.45+Math.random()*0.4).toFixed(2));
        ctx.fillText(c.char, c.x, c.y);
      } else {
        const len = 16+Math.random()*12;
        const grad = ctx.createLinearGradient(c.x, c.y-len, c.x, c.y);
        grad.addColorStop(0, rc(0));
        grad.addColorStop(1, rc((0.3+Math.random()*0.25).toFixed(2)));
        ctx.strokeStyle = grad; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(c.x,c.y-len); ctx.lineTo(c.x,c.y); ctx.stroke();
      }
    }

    ctx.textAlign = "left"; ctx.font = "10px 'Space Mono', monospace";
    readouts.forEach(r=>{
      r.tick++;
      if(r.tick%140===0) r.val = (Math.random()*900+10).toFixed(2);
      ctx.fillStyle = rc(0.32);
      ctx.fillText(r.val, r.x*w, r.y*h);
    });

    if(!reduceMotion) requestAnimationFrame(frame);
  }

  if(reduceMotion){ for(let i=0;i<60;i++) frame(); }
  else frame();
}

