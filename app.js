// App mobile sin backend. Hash routing + LocalStorage.

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const STORAGE_KEYS = {
  PROFILE: "sp_profile",
  AUTH: "sp_auth",
  TASKS: "sp_tasks",
  HABITS: "sp_habits",
  COOLDOWN: "sp_cooldown"
};

const view = $("#view");
const lockBtn = $("#lockBtn");

/* utils */
const textToBuf = (t) => new TextEncoder().encode(t);
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", textToBuf(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
}
function randomSalt(len=8){ const a=new Uint8Array(len); crypto.getRandomValues(a); return [...a].map(b=>b.toString(16).padStart(2,"0")).join(""); }
function save(k,v){ localStorage.setItem(k, JSON.stringify(v)); }
function load(k, def=null){ const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; }
function now(){ return Date.now(); }

/* router */
const routes = { "#/setup": renderSetup, "#/login": renderLogin, "#/app": renderApp };
function go(hash){ location.hash = hash; }
window.addEventListener("hashchange", () => mount(location.hash));
function mount(hash){
  const fn = routes[hash] || (isConfigured()? "#/login" : "#/setup");
  (typeof fn === "string" ? routes[fn] : fn)();
}
function isConfigured(){ return !!load(STORAGE_KEYS.AUTH); }
function lock(){ go("#/login"); }

/* setup */
function renderSetup(){
  
  const tpl = $("#tpl-setup").content.cloneNode(true);
  const form = tpl.querySelector("#setupForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const name = (fd.get("name")||"").toString().trim();
    const pin  = (fd.get("pin")||"").toString().trim();
    const pin2 = (fd.get("pin2")||"").toString().trim();
    if(!name) return alert("Poné tu nombre");
    if(pin !== pin2) return alert("Los PIN no coinciden");
    const salt = randomSalt();
    const pinHash = await sha256Hex(pin + salt);
    save(STORAGE_KEYS.PROFILE, { name });
    save(STORAGE_KEYS.AUTH, { salt, pinHash });
    save(STORAGE_KEYS.TASKS, []);
    save(STORAGE_KEYS.HABITS, []);
    go("#/login");
  });
  view.replaceChildren(tpl);
  lockBtn.style.display = "none";
}

/* login */
function renderLogin(){
  const tpl = $("#tpl-login").content.cloneNode(true);
  const form = tpl.querySelector("#loginForm");
  const err = tpl.querySelector("#loginError");
  const cooldownMsg = tpl.querySelector("#cooldownMsg");
  const auth = load(STORAGE_KEYS.AUTH);
  if(!auth){ return go("#/setup"); }

  function setCooldown(sec){
    const until = now() + sec*1000;
    save(STORAGE_KEYS.COOLDOWN, { until }); tick();
  }
  function tick(){
    const cd = load(STORAGE_KEYS.COOLDOWN);
    if(!cd){ cooldownMsg.classList.add("hide"); return; }
    const remain = Math.ceil((cd.until - now())/1000);
    if(remain <= 0){ localStorage.removeItem(STORAGE_KEYS.COOLDOWN); cooldownMsg.classList.add("hide"); return; }
    cooldownMsg.textContent = `Demasiados intentos. Probá en ${remain}s`;
    cooldownMsg.classList.remove("hide");
    setTimeout(tick, 500);
  }
  tick();

  let fails = 0;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if(load(STORAGE_KEYS.COOLDOWN)) return;
    const pin = (new FormData(form).get("pin")||"").toString().trim();
    const ok = await sha256Hex(pin + auth.salt) === auth.pinHash;
    if(ok){ err.classList.add("hide"); go("#/app"); }
    else{
      err.classList.remove("hide"); fails++;
      if(fails >= 5){ setCooldown(30); fails = 0; }
    }
  });
  view.replaceChildren(tpl);
  lockBtn.style.display = isConfigured() ? "inline-flex" : "none";
}

/* app */
function renderApp(){
  if(!isConfigured()) return go("#/setup");
  const tpl = $("#tpl-app").content.cloneNode(true);
  view.replaceChildren(tpl);
  lockBtn.style.display = "inline-flex";

  // tabs
  $$(".tab", view).forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".tab").forEach(b => b.classList.remove("active"));
      $$(".tab-panel").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $("#tab-" + btn.dataset.tab).classList.add("active");
      if(btn.dataset.tab === "resumen") updateStats();
    });
  });

  // --------- TAREAS (lista única por estado) ----------
const taskList = $("#taskList");
const seg = $("#taskSeg");
let currentStatus = "todo"; // pestaña activa: 'todo' | 'doing' | 'done'

const tasks = load(STORAGE_KEYS.TASKS, []);

function paintTasks(){
  taskList.innerHTML = "";
  const filtered = tasks.filter(t => t.status === currentStatus);
  if(filtered.length === 0){
    const empty = document.createElement("div");
    empty.className = "card";
    empty.textContent = "Sin tareas en esta sección.";
    taskList.appendChild(empty);
  }else{
    for(const t of filtered){
      const el = document.createElement("div");
      el.className = "task";
      el.innerHTML = `
        <div class="title">${t.title}</div>
        <div class="actions">
          <button class="mini" data-act="move">Mover</button>
          <button class="mini" data-act="edit">Renombrar</button>
          <button class="mini" data-act="del">Eliminar</button>
        </div>
      `;
      // acciones
      el.querySelector('[data-act="move"]').addEventListener("click", () => {
        const opt = prompt("Mover a:\n1) Por hacer\n2) En curso\n3) Hecho");
        const map = { "1":"todo", "2":"doing", "3":"done" };
        if(map[opt]){
          t.status = map[opt];
          save(STORAGE_KEYS.TASKS, tasks);
          paintTasks();
          updateStats();
        }
      });
      el.querySelector('[data-act="edit"]').addEventListener("click", () => {
        const nt = prompt("Nuevo título:", t.title);
        if(nt && nt.trim()){
          t.title = nt.trim();
          save(STORAGE_KEYS.TASKS, tasks);
          paintTasks();
        }
      });
      el.querySelector('[data-act="del"]').addEventListener("click", () => {
        if(confirm("¿Eliminar tarea?")){
          const idx = tasks.findIndex(x => x.id === t.id);
          tasks.splice(idx,1);
          save(STORAGE_KEYS.TASKS, tasks);
          paintTasks();
          updateStats();
        }
      });
      taskList.appendChild(el);
    }
  }
  updateStats();
}
paintTasks();

// cambiar pestaña de estado
$$(".seg-btn", seg).forEach(btn => {
  btn.addEventListener("click", () => {
    $$(".seg-btn", seg).forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentStatus = btn.dataset.s; // 'todo' | 'doing' | 'done'
    paintTasks();
  });
});

// agregar tarea: cae por defecto en la pestaña activa
$("#addTaskBtn").addEventListener("click", () => {
  const title = prompt("Nueva tarea:");
  if(!title) return;
  tasks.push({ id: Date.now(), title: title.trim(), status: currentStatus });
  save(STORAGE_KEYS.TASKS, tasks);
  paintTasks();
});


  // HÁBITOS
  // === HÁBITOS (reemplazar bloque) ===
const habitsContainer = $("#habitsContainer");

// clave por usuario si existe uid(); sino, único
function HABITS_KEY(){
  const id = (typeof uid === "function" && uid()) ? uid() : "default";
  return `sp_habits_${id}`;
}

function paintHabits(){
  const daysLetters = ["L","M","M","J","V","S","D"];
  const habits = load(HABITS_KEY(), []);          // SIEMPRE fresco
  habitsContainer.innerHTML = "";

  habits.forEach((h) => {
    const card = document.createElement("div");
    card.className = "habit";

    // fila superior (nombre a la derecha como tu Figma)
    const row = document.createElement("div");
    row.className = "row";
    const spacer = document.createElement("div");
    const name = document.createElement("div");
    name.className = "name";
    name.textContent = h.name || "Hábito";
    row.append(spacer, name);

    // letras L M M J V S D
    const labels = document.createElement("div");
    labels.className = "labels";
    daysLetters.forEach(l => {
      const lab = document.createElement("div");
      lab.className = "label";
      lab.textContent = l;
      labels.appendChild(lab);
    });

    const divider = document.createElement("div");
    divider.className = "divider";

    // cajitas clickeables (vacío → ✓ → ✕ → vacío)
    const daysWrap = document.createElement("div");
    daysWrap.className = "days";
    h.week.forEach((val, i) => {
      const d = document.createElement("button");
      d.type = "button";
      d.className = "day" + (val === true ? " on" : val === false ? " off" : "");
      d.addEventListener("click", () => {
        const fresh = load(HABITS_KEY(), []);
        const idx = fresh.findIndex(x => x.id === h.id);
        const curr = fresh[idx].week[i];
        fresh[idx].week[i] = (curr === null) ? true : (curr === true ? false : null);
        save(HABITS_KEY(), fresh);
        paintHabits();
        if (typeof updateStats === "function") updateStats();
      });
      daysWrap.appendChild(d);
    });

    card.append(row, labels, divider, daysWrap);
    habitsContainer.appendChild(card);
  });
}

// agregar hábito
$("#addHabitBtn").addEventListener("click", () => {
  const name = prompt("Nombre del hábito:");
  if(!name) return;
  const fresh = load(HABITS_KEY(), []);
  fresh.push({ id: Date.now(), name: name.trim(), week: [null,null,null,null,null,null,null] });
  save(HABITS_KEY(), fresh);
  paintHabits();
  if (typeof updateStats === "function") updateStats();
});

// pintar al entrar al dashboard
paintHabits();


  // RESUMEN + EXPORT
  function updateStats(){
    const doneCount = load(STORAGE_KEYS.TASKS, []).filter(t => t.status === "done").length;
    $("#statTasks").textContent = doneCount;
    const h = load(STORAGE_KEYS.HABITS, []);
    const habitDays = h.reduce((acc, it) => acc + it.week.filter(v => v === true).length, 0);
    $("#statHabits").textContent = habitDays;
  }

  $("#exportBtn").addEventListener("click", async () => {
    try{
      const node = $(".screen");
      const canvas = await html2canvas(node, {useCORS:true, scale:2});
      const data = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = data; a.download = "semana.png"; a.click();
    }catch(e){ alert("No se pudo exportar. Probá en HTTPS/Render."); }
  });
}

lockBtn.addEventListener("click", lock);
mount(location.hash || (isConfigured() ? "#/login" : "#/setup"));
