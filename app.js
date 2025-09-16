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

  // TAREAS
  const lists = { todo: $("#todo"), doing: $("#doing"), done: $("#done") };
  const tasks = load(STORAGE_KEYS.TASKS, []);
  function paintTasks(){
    Object.values(lists).forEach(el => el.innerHTML = "");
    for(const t of tasks){
      const el = document.createElement("div");
      el.className = "task";
      el.innerHTML = `
        <div class="title">${t.title}</div>
        <div class="actions">
          <button class="mini" data-act="move">Mover</button>
          <button class="mini" data-act="edit">Renombrar</button>
          <button class="mini" data-act="del">Eliminar</button>
        </div>`;
      el.querySelector('[data-act="move"]').addEventListener("click", () => {
        const opt = prompt("Mover a:\n1) Por hacer\n2) En curso\n3) Hecho");
        const map = { "1":"todo", "2":"doing", "3":"done" };
        if(map[opt]){ t.status = map[opt]; save(STORAGE_KEYS.TASKS, tasks); paintTasks(); }
      });
      el.querySelector('[data-act="edit"]').addEventListener("click", () => {
        const nt = prompt("Nuevo título:", t.title);
        if(nt && nt.trim()){ t.title = nt.trim(); save(STORAGE_KEYS.TASKS, tasks); paintTasks(); }
      });
      el.querySelector('[data-act="del"]').addEventListener("click", () => {
        if(confirm("¿Eliminar tarea?")){
          const idx = tasks.findIndex(x => x.id === t.id);
          tasks.splice(idx,1); save(STORAGE_KEYS.TASKS, tasks); paintTasks();
        }
      });
      lists[t.status].appendChild(el);
    }
    updateStats();
  }
  paintTasks();
  $("#addTaskBtn").addEventListener("click", () => {
    const title = prompt("Nueva tarea:");
    if(!title) return;
    tasks.push({ id: Date.now(), title: title.trim(), status: "todo" });
    save(STORAGE_KEYS.TASKS, tasks); paintTasks();
  });

  // HÁBITOS
  const habitsContainer = $("#habitsContainer");
  const habits = load(STORAGE_KEYS.HABITS, []);
  const days = ["L","M","M","J","V","S","D"];

  function paintHabits(){
    habitsContainer.innerHTML = "";
    habits.forEach((h) => {
      const card = document.createElement("div");
      card.className = "habit";
      const row = document.createElement("div");
      row.className = "row";
      const name = document.createElement("div");
      name.className = "name"; name.textContent = h.name;
      const daysWrap = document.createElement("div");
      daysWrap.className = "days";
      h.week.forEach((val, i) => {
        const d = document.createElement("button");
        d.type="button";
        d.className = "day" + (val === true ? " on" : val === false ? " off" : "");
        d.textContent = days[i];
        d.addEventListener("click", () => {
          // vacío -> ✅ -> ❌ -> vacío
          h.week[i] = (h.week[i] === null) ? true : (h.week[i] === true ? false : null);
          save(STORAGE_KEYS.HABITS, habits); paintHabits(); updateStats();
        });
        daysWrap.appendChild(d);
      });
      row.append(name, daysWrap);
      card.append(row);
      habitsContainer.appendChild(card);
    });
  }
  paintHabits();

  $("#addHabitBtn").addEventListener("click", () => {
    const name = prompt("Nombre del hábito:");
    if(!name) return;
    habits.push({ id: Date.now(), name: name.trim(), week: [null,null,null,null,null,null,null] });
    save(STORAGE_KEYS.HABITS, habits); paintHabits();
  });

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
