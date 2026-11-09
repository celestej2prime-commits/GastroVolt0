"use strict";
const $ = id => document.getElementById(id);
const STORAGE_KEYS = ["gastroEquipos","gastroCuenta","gastroConfig","gastroSesiones","gastroSesionActiva"];
const readStore = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (error) {
    console.error("No se pudo leer "+key, error);
    return fallback;
  }
};
let equipos = readStore("gastroEquipos", []);
let cuenta = readStore("gastroCuenta", null);
let configuracion = readStore("gastroConfig", { restaurante: "" });
const tarifaAnterior = Number(configuracion?.tarifa ?? 2);
let sesionActiva = readStore("gastroSesionActiva", false);
let sesiones = readStore("gastroSesiones", []);
if (!Array.isArray(equipos)) equipos = [];
if (!Array.isArray(sesiones)) sesiones = [];
if (!configuracion || typeof configuracion !== "object") configuracion = { restaurante: "" };
configuracion = { restaurante: String(configuracion.restaurante || "") };
equipos = equipos.map((e, i) => ({
  ...e,
  id: Number(e.id) || Date.now()+i,
  nombre: String(e.nombre || "Equipo"),
  potencia: Math.max(0, Number(e.potencia) || 0),
  tarifa: Math.max(0, e.tarifa == null ? (Number.isFinite(tarifaAnterior)?tarifaAnterior:0) : (Number(e.tarifa)||0)),
  tiempoMs: Math.max(0, Number(e.tiempoMs) || 0),
  inicioActivo: e.inicioActivo ? Number(e.inicioActivo) : null
}));
sesiones = sesiones.map(s => ({
  ...s,
  equipoId: s.equipoId == null ? null : Number(s.equipoId),
  potencia: Math.max(0, Number(s.potencia) || 0),
  tarifa: s.tarifa == null ? null : Math.max(0, Number(s.tarifa) || 0),
  consumoKwh: Math.max(0, Number(s.consumoKwh) || 0),
  duracionMs: Math.max(0, Number(s.duracionMs) || 0)
}));
let timers = {};

function persist() {
  try {
    localStorage.setItem("gastroEquipos", JSON.stringify(equipos));
    localStorage.setItem("gastroCuenta", JSON.stringify(cuenta));
    localStorage.setItem("gastroConfig", JSON.stringify(configuracion));
    localStorage.setItem("gastroSesiones", JSON.stringify(sesiones));
    localStorage.setItem("gastroSesionActiva", JSON.stringify(sesionActiva));
    return true;
  } catch (error) {
    console.error("Error al guardar datos:", error);
    alert("No se pudieron guardar los datos. Comprueba el espacio disponible y los permisos de almacenamiento del navegador.");
    return false;
  }
}
function money(value) {
  const n = Number(value);
  return "Bs " + (Number.isFinite(n) ? n : 0).toLocaleString("es-BO",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function num(value, digits=4) {
  const n=Number(value);
  return (Number.isFinite(n)?n:0).toLocaleString("es-BO",{minimumFractionDigits:digits,maximumFractionDigits:digits});
}
function elapsedMs(e) {
  const stored=Math.max(0,Number(e.tiempoMs)||0);
  return stored+(e.inicioActivo?Math.max(0,Date.now()-Number(e.inicioActivo)):0);
}
function calcKwh(potenciaW, milliseconds) {
  return Math.max(0,Number(potenciaW)||0)*Math.max(0,Number(milliseconds)||0)/3600000000;
}
function calcEquipo(e) { return calcKwh(e.potencia, elapsedMs(e)); }
function fmtTime(ms) {
  const seconds=Math.floor(Math.max(0,ms)/1000);
  const h=Math.floor(seconds/3600), m=Math.floor((seconds%3600)/60), s=seconds%60;
  return [h,m,s].map(v=>String(v).padStart(2,"0")).join(":");
}
function escapeHtml(value) {
  return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function monthBounds(offset=0) {
  const now=new Date();
  const start=new Date(now.getFullYear(),now.getMonth()+offset,1);
  const end=new Date(now.getFullYear(),now.getMonth()+offset+1,1);
  return {start,end,label:start.toLocaleDateString("es-BO",{month:"long",year:"numeric"})};
}
function sessionDate(s) {
  const d=s.finISO ? new Date(s.finISO) : (s.fechaISO ? new Date(s.fechaISO) : new Date(s.fecha||""));
  return Number.isNaN(d.getTime()) ? null : d;
}
function sessionPeriodKwh(s,start,end) {
  const startAt=s.inicioISO?new Date(s.inicioISO).getTime():NaN;
  const endAt=s.finISO?new Date(s.finISO).getTime():NaN;
  const duration=Number(s.duracionMs)||0;
  if(Number.isFinite(startAt)&&Number.isFinite(endAt)&&endAt>startAt&&duration>0) {
    const overlap=Math.max(0,Math.min(endAt,end.getTime())-Math.max(startAt,start.getTime()));
    return sessionKwh(s)*(overlap/(endAt-startAt));
  }
  const d=sessionDate(s);
  return d&&d>=start&&d<end?sessionKwh(s):0;
}
function sessionPeriodCost(s,start,end,fallbackTarifa=0) {
  const kwh=sessionPeriodKwh(s,start,end);
  const rate=s.tarifa==null?fallbackTarifa:Number(s.tarifa);
  return kwh*Math.max(0,Number(rate)||0);
}
function sessionMatchesEquipment(s,e) {
  return s.equipoId != null ? Number(s.equipoId)===Number(e.id) : String(s.equipo)===String(e.nombre);
}
function sessionKwh(s) {
  return Number.isFinite(Number(s.consumoKwh)) ? Math.max(0,Number(s.consumoKwh)) : calcKwh(s.potencia,s.duracionMs);
}
function monthlyEquipmentKwh(e, offset=0) {
  const {start,end}=monthBounds(offset);
  let total=0;
  sesiones.forEach(s=>{
    if(sessionMatchesEquipment(s,e)) total+=sessionPeriodKwh(s,start,end);
  });
  if(offset===0 && e.inicioActivo) {
    const from=Math.max(Number(e.inicioActivo),start.getTime());
    const to=Math.min(Date.now(),end.getTime());
    if(to>from) total+=calcKwh(e.potencia,to-from);
  }
  return total;
}
function monthlyTotalKwh(offset=0) {
  const {start,end}=monthBounds(offset);
  let total=0;
  sesiones.forEach(s=>{ total+=sessionPeriodKwh(s,start,end); });
  if(offset===0) equipos.forEach(e=>{
    if(e.inicioActivo) {
      const from=Math.max(Number(e.inicioActivo),start.getTime());
      const to=Math.min(Date.now(),end.getTime());
      if(to>from) total+=calcKwh(e.potencia,to-from);
    }
  });
  return total;
}
function monthlyCost(offset=0) {
  const {start,end}=monthBounds(offset);
  let total=0;
  sesiones.forEach(s=>{
    const equipment=equipos.find(e=>sessionMatchesEquipment(s,e));
    total+=sessionPeriodCost(s,start,end,Number(equipment?.tarifa)||0);
  });
  if(offset===0) equipos.forEach(e=>{
    if(e.inicioActivo) {
      const from=Math.max(Number(e.inicioActivo),start.getTime());
      const to=Math.min(Date.now(),end.getTime());
      if(to>from) total+=calcKwh(e.potencia,to-from)*Number(e.tarifa||0);
    }
  });
  return total;
}
function monthlyEquipmentCost(e,offset=0) {
  const {start,end}=monthBounds(offset);
  let total=0;
  sesiones.forEach(s=>{
    if(sessionMatchesEquipment(s,e)) total+=sessionPeriodCost(s,start,end,Number(e.tarifa)||0);
  });
  if(offset===0 && e.inicioActivo) {
    const from=Math.max(Number(e.inicioActivo),start.getTime()),to=Math.min(Date.now(),end.getTime());
    if(to>from) total+=calcKwh(e.potencia,to-from)*Number(e.tarifa||0);
  }
  return total;
}
function totalCurrentEquipmentKwh() {
  return equipos.reduce((sum,e)=>sum+calcEquipo(e),0);
}
function totalCurrentEquipmentCost() {
  return equipos.reduce((sum,e)=>sum+calcEquipo(e)*Number(e.tarifa||0),0);
}
function totalTimeMs() { return equipos.reduce((sum,e)=>sum+elapsedMs(e),0); }

function showSection(id) {
  document.querySelectorAll(".section").forEach(s=>s.classList.toggle("active",s.id===id));
  document.querySelectorAll(".nav-btn[data-section]").forEach(b=>b.classList.toggle("active",b.dataset.section===id));
  window.scrollTo({top:0,behavior:"smooth"});
}
document.querySelectorAll(".nav-btn[data-section]").forEach(btn=>btn.addEventListener("click",()=>showSection(btn.dataset.section)));

function openRegister() {
  $("loginScreen").classList.remove("hidden");
  setAuthMode("register");
}
function backToPreview() {
  sesionActiva=false; persist();
  $("loginScreen").classList.add("hidden");
  $("publicScreen").classList.remove("hidden");
  $("dashboard").classList.add("hidden");
}
$("heroRegisterBtn").addEventListener("click",openRegister);
$("cancelRegisterBtn").addEventListener("click",backToPreview);
$("logoutBtn").addEventListener("click",backToPreview);

function togglePassword(inputId,buttonId) {
  const input=$(inputId), icon=$(buttonId).querySelector("i");
  input.type=input.type==="password"?"text":"password";
  icon.className=input.type==="password"?"fa-solid fa-eye":"fa-solid fa-eye-slash";
}
$("togglePassword").addEventListener("click",()=>togglePassword("regPassword","togglePassword"));
$("toggleLoginPassword").addEventListener("click",()=>togglePassword("loginPassword","toggleLoginPassword"));

function setAuthMode(mode) {
  const login=mode==="login";
  $("authTitle").textContent=login?"Iniciar sesión":"Crear cuenta";
  ["regNombre","regRestaurante","regEmail","regPassword"].forEach(id=>{
    const field=$(id);
    field.closest(".form-group").classList.toggle("hidden",login);
    field.required=!login;
  });
  $("registerForm").querySelector('button[type="submit"]').classList.toggle("hidden",login);
  $("loginFields").classList.toggle("hidden",!login);
  $("showLoginBtn").textContent=login?"No tengo cuenta: crear cuenta":"Ya tengo cuenta: iniciar sesión";
  if(login) {
    $("loginEmail").value=$("loginEmail").value||$("regEmail").value||cuenta?.email||"";
    $("loginEmail").focus();
  } else $("regNombre").focus();
}
$("showLoginBtn").addEventListener("click",()=>setAuthMode($("loginFields").classList.contains("hidden")?"login":"register"));
$("registerForm").addEventListener("submit",event=>{
  event.preventDefault();
  const nombre=$("regNombre").value.trim(), restaurante=$("regRestaurante").value.trim();
  const email=$("regEmail").value.trim().toLowerCase(), password=$("regPassword").value;
  if(!nombre||!restaurante||!email||password.length<4) { alert("Completa todos los campos. La contraseña debe tener al menos 4 caracteres."); return; }
  if(cuenta && String(cuenta.email).toLowerCase()!==email && !confirm("Ya existe una cuenta guardada en este navegador. ¿Deseas reemplazarla?")) return;
  cuenta={nombre,restaurante,email,password};
  configuracion.restaurante=restaurante;
  sesionActiva=true;
  if(!persist()) return;
  $("loginScreen").classList.add("hidden"); $("publicScreen").classList.add("hidden"); $("dashboard").classList.remove("hidden");
  loadApp();
});
$("loginBtn").addEventListener("click",()=>{
  const email=$("loginEmail").value.trim().toLowerCase(), password=$("loginPassword").value;
  if(!cuenta||email!==String(cuenta.email||"").toLowerCase()||password!==String(cuenta.password||"")) {
    alert("Correo o contraseña incorrectos. Comprueba tus datos.");
    return;
  }
  sesionActiva=true;
  if(!persist()) return;
  $("loginScreen").classList.add("hidden"); $("publicScreen").classList.add("hidden"); $("dashboard").classList.remove("hidden");
  loadApp();
});
function loadApp() {
  $("welcomeName").textContent=cuenta?.nombre||"usuario";
  $("userInfoNombre").textContent=cuenta?.nombre||"";
  $("userInfoEmail").textContent=cuenta?.email||"";
  $("userInfoRestaurante").textContent=configuracion.restaurante||cuenta?.restaurante||"";
  $("userInfoPassword").textContent=cuenta?.password?"••••••••":"No registrada";
  $("configRestaurante").value=configuracion.restaurante||cuenta?.restaurante||"";
  renderAll();
  renderStorageInfo();
}
if(cuenta&&sesionActiva) {
  $("publicScreen").classList.add("hidden"); $("loginScreen").classList.add("hidden"); $("dashboard").classList.remove("hidden"); loadApp();
} else {
  $("publicScreen").classList.remove("hidden");
  if(cuenta) {
    $("regNombre").value=cuenta.nombre||"";
    $("regRestaurante").value=cuenta.restaurante||"";
    $("regEmail").value=cuenta.email||"";
    $("loginEmail").value=cuenta.email||"";
    setAuthMode("login");
  }
}

$("addEquipoBtn").addEventListener("click",()=>$("equipoModal").classList.add("show"));
$("closeModal").addEventListener("click",()=>$("equipoModal").classList.remove("show"));
$("equipoModal").addEventListener("click",event=>{if(event.target===$("equipoModal"))$("equipoModal").classList.remove("show")});
$("equipoForm").addEventListener("submit",event=>{
  event.preventDefault();
  const nombre=$("eqNombre").value.trim(), potencia=Number($("eqPotencia").value), tarifa=Number($("eqTarifa").value);
  if(!nombre||!Number.isFinite(potencia)||potencia<=0||!Number.isFinite(tarifa)||tarifa<0) {
    alert("Introduce un nombre, una potencia mayor que cero y una tarifa válida de cero o más Bs/kWh.");
    return;
  }
  equipos.push({id:Date.now()+Math.floor(Math.random()*1000),nombre,potencia,tarifa,tiempoMs:0,inicioActivo:null});
  if(!persist()) { equipos.pop(); return; }
  $("equipoForm").reset(); $("equipoModal").classList.remove("show"); renderAll();
});
function pushSession(e,duration,start,end) {
  if(duration<=0) return;
  sesiones.push({
    equipoId:e.id,equipo:e.nombre,potencia:Number(e.potencia),tarifa:Number(e.tarifa||0),
    duracionMs:duration,consumoKwh:calcKwh(e.potencia,duration),
    inicioISO:new Date(start).toISOString(),finISO:new Date(end).toISOString(),
    fecha:new Date(end).toLocaleString("es-BO"),fechaISO:new Date(end).toISOString()
  });
}
function timerAction(id,action) {
  const e=equipos.find(item=>item.id===Number(id));
  if(!e) return;
  if(action==="start"||action==="resume") {
    if(!e.inicioActivo) e.inicioActivo=Date.now();
  } else if(action==="pause") {
    if(e.inicioActivo) {
      const start=Number(e.inicioActivo), now=Date.now(), duration=Math.max(0,now-start);
      e.tiempoMs=Number(e.tiempoMs||0)+duration;
      pushSession(e,duration,start,now);
      e.inicioActivo=null;
    }
  } else if(action==="reset") {
    if(!confirm("¿Reiniciar el cronómetro de "+e.nombre+"? El tiempo ya registrado se conservará en los reportes.")) return;
    if(e.inicioActivo) {
      const start=Number(e.inicioActivo), now=Date.now(), duration=Math.max(0,now-start);
      e.tiempoMs=Number(e.tiempoMs||0)+duration;
      pushSession(e,duration,start,now);
      e.inicioActivo=null;
    }
    e.tiempoMs=0;
  }
  persist(); renderAll();
}
function statusFor(kwh) {
  if(kwh>=150) return {label:"Alto",cls:"red"};
  if(kwh>=50) return {label:"Moderado",cls:"yellow"};
  return {label:"Normal",cls:"green"};
}
function renderEquipos() {
  const tbody=$("equiposTable");
  if(!equipos.length) {
    tbody.innerHTML='<tr><td colspan="7">No hay equipos registrados. Presiona “Agregar equipo” para comenzar.</td></tr>';
    return;
  }
  tbody.innerHTML=equipos.map(e=>{
    const ms=elapsedMs(e), kwh=calcKwh(e.potencia,ms), costo=kwh*Number(e.tarifa||0);
    const status=statusFor(monthlyEquipmentKwh(e));
    const action=e.inicioActivo?"pause":(ms>0?"resume":"start");
    const actionText=e.inicioActivo?'<i class="fa-solid fa-pause"></i> Parar':(ms>0?'<i class="fa-solid fa-play"></i> Reanudar':'<i class="fa-solid fa-play"></i> Iniciar');
    return `<tr data-equipo-row="${e.id}">
      <td data-label="Equipo"><strong>${escapeHtml(e.nombre)}</strong></td>
      <td data-label="Potencia">${num(e.potencia,2)} W</td>
      <td class="timer-cell" data-label="Cronómetro de uso"><span class="timer-display" id="timer-${e.id}">${fmtTime(ms)}</span><div class="timer-actions"><button class="timer-btn ${e.inicioActivo?"pause":""}" data-timer="${e.id}" data-action="${action}">${actionText}</button><button class="timer-btn reset" data-timer="${e.id}" data-action="reset"><i class="fa-solid fa-rotate-left"></i> Reiniciar</button></div></td>
      <td data-label="Consumo acumulado" id="kwh-${e.id}">${num(kwh)} kWh</td>
      <td data-label="Costo acumulado" id="cost-${e.id}">${money(costo)}</td>
      <td data-label="Estado"><span id="status-${e.id}" class="badge ${status.cls}">${status.label}</span></td>
      <td data-label="Acción"><button class="action-btn" data-delete="${e.id}">Eliminar</button></td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("[data-timer]").forEach(button=>button.addEventListener("click",()=>timerAction(button.dataset.timer,button.dataset.action)));
  tbody.querySelectorAll("[data-delete]").forEach(button=>button.addEventListener("click",()=>{
    const e=equipos.find(item=>item.id===Number(button.dataset.delete));
    if(!e||!confirm("¿Eliminar el equipo "+e.nombre+"? Los registros de sesiones ya guardados se conservarán.")) return;
    if(e.inicioActivo) {
      const start=Number(e.inicioActivo),now=Date.now(),duration=Math.max(0,now-start);
      e.tiempoMs=Number(e.tiempoMs||0)+duration; pushSession(e,duration,start,now);
    }
    equipos=equipos.filter(item=>item.id!==e.id);
    persist();renderAll();
  }));
}
function renderDashboard() {
  const total=totalCurrentEquipmentKwh(), cost=totalCurrentEquipmentCost();
  $("totalConsumo").textContent=num(total)+" kWh";
  $("cantidadEquipos").textContent=equipos.length;
  $("costoTotal").textContent=money(cost);
  $("tiempoTotal").textContent=fmtTime(totalTimeMs());
  $("consumoTotalSection").textContent=num(total)+" kWh";
  const top=[...equipos].sort((a,b)=>calcEquipo(b)-calcEquipo(a))[0];
  $("mayorEquipo").textContent=top?top.nombre:"Sin datos";
  $("mayorEquipoDetalle").textContent=top?num(calcEquipo(top))+" kWh acumulados":"Registra equipos para consultar este dato.";
  const box=$("resumenInicio");
  box.className=top?"notice success":"notice info";
  box.textContent=top?`Hay ${equipos.length} equipo(s) registrado(s). El mayor consumo acumulado corresponde a ${top.nombre}.`:"Registra tus equipos para comenzar a obtener información.";
}
function renderParticipation() {
  const box=$("participacion"), total=totalCurrentEquipmentKwh();
  if(!equipos.length) {box.innerHTML='<p class="muted">No hay equipos registrados.</p>';return;}
  box.innerHTML=[...equipos].sort((a,b)=>calcEquipo(b)-calcEquipo(a)).map(e=>{
    const kwh=calcEquipo(e), pct=total>0?kwh/total*100:0;
    return `<div style="margin:14px 0"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><strong>${escapeHtml(e.nombre)}</strong><span>${num(pct,1)} % · ${num(kwh)} kWh</span></div><div class="progress"><span style="width:${Math.min(100,Math.max(0,pct))}%"></span></div></div>`;
  }).join("");
}
function renderConsumption() {
  const bounds=monthBounds(0);
  $("consumoMesSection").textContent=num(monthlyTotalKwh(0))+" kWh";
  $("consumoMesEtiqueta").textContent="Periodo: "+bounds.label+" (del día 1 hasta hoy).";
}
function renderReport() {
  const current=monthBounds(0), previous=monthBounds(-1);
  const actual=monthlyTotalKwh(0), anterior=monthlyTotalKwh(-1);
  $("reportePeriodo").textContent="Reporte mensual · "+current.label;
  $("reportePeriodoDetalle").textContent="Periodo actual: del 1 al "+new Date().getDate()+" de "+current.label+". Comparación: "+previous.label+".";
  $("repEquipos").textContent=equipos.length;
  $("repActual").textContent=num(actual)+" kWh";
  $("repCosto").textContent=money(monthlyCost(0));
  const max=Math.max(actual,anterior);
  const height=value=>max>0?(value/max)*155:0;
  $("comparacionMensual").innerHTML=[
    {label:previous.label,value:anterior,cls:"prev"},
    {label:current.label,value:actual,cls:"curr"}
  ].map(item=>`<div class="bar-wrap"><span class="bar-label">${num(item.value,3)} kWh</span><div class="bar ${item.cls}" style="height:${height(item.value)}px" title="${escapeHtml(item.label)}: ${num(item.value)} kWh"></div><span class="legend">${escapeHtml(item.label)}</span></div>`).join("");
  const sorted=[...equipos].sort((a,b)=>monthlyEquipmentKwh(b)-monthlyEquipmentKwh(a));
  $("detalleReporte").innerHTML=sorted.length?`<table><thead><tr><th>Equipo</th><th>Potencia (W)</th><th>Tiempo del cronómetro</th><th>Consumo del mes (kWh)</th><th>Costo del mes</th><th>Estado</th></tr></thead><tbody>${sorted.map(e=>{
    const kwh=monthlyEquipmentKwh(e), state=e.inicioActivo?"En marcha":"Detenido";
    return `<tr><td>${escapeHtml(e.nombre)}</td><td>${num(e.potencia,2)}</td><td>${fmtTime(elapsedMs(e))}</td><td>${num(kwh)}</td><td>${money(monthlyEquipmentCost(e,0))}</td><td>${state}</td></tr>`;
  }).join("")}</tbody></table>`:'<p class="muted">No hay equipos registrados.</p>';
}
function renderAlerts() {
  const box=$("alertasBox"), period=monthBounds(0).label;
  if(!equipos.length) {box.innerHTML='<div class="notice info">No hay alertas porque todavía no se registraron equipos.</div>';return;}
  box.innerHTML=`<div class="panel"><h2>Indicador semáforo · ${escapeHtml(period)}</h2><p class="muted">Los límites son referencias internas de GastroVolt, no límites oficiales de consumo: verde menos de 50 kWh; amarillo desde 50 y menos de 150 kWh; rojo desde 150 kWh por equipo en el mes.</p><div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:12px"><span class="badge green">● Normal: menos de 50 kWh</span><span class="badge yellow">● Moderado: 50 a menos de 150 kWh</span><span class="badge red">● Alto: 150 kWh o más</span></div></div>`+equipos.map(e=>{
    const kwh=monthlyEquipmentKwh(e), state=statusFor(kwh);
    const message=state.label==="Alto"?"El consumo mensual alcanzó el nivel alto. Revisa el tiempo de funcionamiento.":state.label==="Moderado"?"El consumo mensual es moderado. Conviene revisar el uso del equipo.":"El consumo mensual se encuentra dentro del nivel normal.";
    const icon=state.label==="Alto"?"🔴":state.label==="Moderado"?"🟡":"🟢";
    return `<div class="notice ${state.cls==="red"?"danger":state.cls==="yellow"?"warning":"success"}">${icon} <strong>${escapeHtml(e.nombre)} · ${state.label}</strong><br>${num(kwh)} kWh este mes. ${message}</div>`;
  }).join("");
}
function renderStorageInfo() {
  const info=$("storageInfo");
  if(!info)return;
  const details=STORAGE_KEYS.map(key=>{
    const raw=localStorage.getItem(key);
    let count="guardado";
    if(raw!==null) {
      try {const value=JSON.parse(raw);count=Array.isArray(value)?value.length+" registro(s)":(value===null?"sin datos":"disponible");}
      catch {count="dato no legible";}
    } else count="sin crear";
    return `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(count)}</li>`;
  }).join("");
  info.innerHTML=`<p><strong>Ubicación:</strong> almacenamiento local de este navegador (localStorage).</p><p><strong>Equipos:</strong> ${equipos.length} · <strong>Sesiones:</strong> ${sesiones.length} · <strong>Cuenta:</strong> ${cuenta?"registrada":"no registrada"}</p><ul style="margin:8px 0 0 20px">${details}</ul>`;
  const data=$("storageData");
  if(data) {
    const savedData={};
    STORAGE_KEYS.forEach(key=>{
      const raw=localStorage.getItem(key);
      if(raw===null) {
        savedData[key]=null;
        return;
      }
      try {
        const value=JSON.parse(raw);
        if(key==="gastroCuenta" && value && typeof value==="object") {
          savedData[key]={...value,password:value.password?"••••••••":""};
        } else {
          savedData[key]=value;
        }
      } catch {
        savedData[key]=raw;
      }
    });
    data.textContent=JSON.stringify(savedData,null,2);
  }
}
function renderAll() {
  renderEquipos();renderDashboard();renderParticipation();renderConsumption();renderReport();renderAlerts();renderStorageInfo();
}
$("saveConfig").addEventListener("click",()=>{
  const name=$("configRestaurante").value.trim();
  if(!name) { $("configMsg").innerHTML='<div class="notice warning">Escribe el nombre del restaurante.</div>';return; }
  configuracion.restaurante=name;
  if(cuenta) cuenta.restaurante=name;
  if(!persist())return;
  $("userInfoRestaurante").textContent=name;
  $("configMsg").innerHTML='<div class="notice success">Los datos del restaurante se guardaron correctamente.</div>';
  renderStorageInfo();
});
$("refreshStorageBtn").addEventListener("click",renderStorageInfo);
$("backupBtn").addEventListener("click",()=>{
  const backup={aplicacion:"GastroVolt",fechaExportacion:new Date().toISOString(),equipos,cuenta:cuenta?{nombre:cuenta.nombre,restaurante:cuenta.restaurante,email:cuenta.email}:null,configuracion,sesiones};
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="GastroVolt_copia_seguridad.json";document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
});
$("exportExcelBtn").addEventListener("click",()=>{
  if(typeof XLSX==="undefined"){alert("No se pudo cargar Excel. Comprueba tu conexión a internet.");return;}
  const data=equipos.map(e=>({Restaurante:configuracion.restaurante,Equipo:e.nombre,Potencia_W:e.potencia,Tiempo_cronometro:fmtTime(elapsedMs(e)),Consumo_acumulado_kWh:calcEquipo(e),Tarifa_Bs_kWh:e.tarifa,Costo_acumulado_Bs:calcEquipo(e)*e.tarifa,Estado:e.inicioActivo?"En marcha":"Detenido"}));
  const monthly=sesiones.map(s=>({Equipo:s.equipo,Potencia_W:s.potencia,Fecha:s.fecha,Duracion:fmtTime(s.duracionMs),Consumo_kWh:sessionKwh(s),Tarifa_Bs_kWh:s.tarifa??"",Costo_Bs:sessionKwh(s)*Number(s.tarifa||0)}));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.length?data:[{Aviso:"No hay equipos registrados"}]),"Equipos");
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(monthly.length?monthly:[{Aviso:"No hay sesiones registradas"}]),"Sesiones");
  XLSX.writeFile(wb,"GastroVolt_datos.xlsx");
});
$("downloadPdfBtn").addEventListener("click",()=>{showSection("reportes");window.print();});
function tickTimers() {
  if($("dashboard").classList.contains("hidden"))return;
  equipos.forEach(e=>{
    if(!e.inicioActivo)return;
    const ms=elapsedMs(e),kwh=calcKwh(e.potencia,ms),cost=kwh*Number(e.tarifa||0);
    const timer=$("timer-"+e.id),energy=$("kwh-"+e.id),price=$("cost-"+e.id);
    if(timer)timer.textContent=fmtTime(ms);
    if(energy)energy.textContent=num(kwh)+" kWh";
    if(price)price.textContent=money(cost);
    const status=$("status-"+e.id),state=statusFor(monthlyEquipmentKwh(e));
    if(status){status.textContent=state.label;status.className="badge "+state.cls;}
  });
  const active=equipos.some(e=>e.inicioActivo);
  if(active) {
    renderDashboard();renderConsumption();renderParticipation();renderReport();renderAlerts();
  }
}
setInterval(tickTimers,1000);
document.addEventListener("visibilitychange",()=>{if(!document.hidden)tickTimers();});