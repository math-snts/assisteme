// =======================
// Estado global + persistência
// =======================
let tasks = JSON.parse(localStorage.getItem("tasks") || "[]");
let settings = JSON.parse(localStorage.getItem("settings") || "{}");
let pomTimer, pomInterval;
let pomCount = parseInt(localStorage.getItem("pomCount") || "0");
let zIndexCounter = parseInt(localStorage.getItem("zIndexCounter") || "100");
settings.gridSize = settings.gridSize || 16; // snap da grade

// Salvar estado (debounce)
const save = (() => {
  let t;
  return () => {
    clearTimeout(t);
    t = setTimeout(() => {
      localStorage.setItem("tasks", JSON.stringify(tasks));
      localStorage.setItem("settings", JSON.stringify(settings));
      localStorage.setItem("pomCount", String(pomCount));
      localStorage.setItem("zIndexCounter", String(zIndexCounter));
    }, 120);
  };
})();

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"), 1400);
}

// =======================
// IndexedDB para anexos
// =======================
function openDB() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open("assistente-files", 1);
    rq.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files", { keyPath: "id" });
      }
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbPutFile(id, file) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    const obj = { id, name: file.name, type: file.type, blob: file };
    const rq = store.put(obj);
    rq.onsuccess = () => res(true);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbGetFile(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("files", "readonly");
    const store = tx.objectStore("files");
    const rq = store.get(id);
    rq.onsuccess = () => res(rq.result || null);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbDeleteFile(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    const rq = store.delete(id);
    rq.onsuccess = () => res(true);
    rq.onerror = () => rej(rq.error);
  });
}

// =======================
// Inicialização
// =======================
window.addEventListener("DOMContentLoaded", () => {
  restoreWindows();      // posição inicial igual à imagem (se não houver salvo)
  initInteract();        // habilita drag & resize
  wireUI();              // listeners gerais
  restoreSettings();     // switches + tema + pomodoro + data
  renderTasks();
  renderCalendar();
  highlightNowSlot();
  scheduleNowTicker();
  toast("Pronto — janelas organizadas e livres.");
});

// =======================
// Janela: restaurar/aplicar posições iniciais
// =======================
function restoreWindows(){
  const defaults = {
    winTasks:    { x: 20,  y: 20,  w: 420, h: 520, z: 101 },  // Tarefas (esquerda)
    winCalendar: { x: 460, y: 20,  w: 520, h: 520, z: 100 },  // Agenda (ao lado)
    winNotes:    { x: 20,  y: 560, w: 520, h: 340, z: 100 },  // Resumo (abaixo tarefas)
    winPomodoro: { x: 560, y: 560, w: 420, h: 340, z: 100 }   // Pomodoro (abaixo agenda)
  };
  const saved = settings.windows || {};
  for(const id of ["winTasks","winCalendar","winNotes","winPomodoro"]){
    const el = document.getElementById(id);
    if(!el) continue;
    const s = saved[id] || defaults[id];
    el.style.left   = (s.x ?? 20) + "px";
    el.style.top    = (s.y ?? 20) + "px";
    el.style.width  = (s.w ?? 360) + "px";
    el.style.height = (s.h ?? 420) + "px";
    el.style.zIndex = (s.z ?? 100);
  }
}
function saveWindowState(el){
  settings.windows = settings.windows || {};
  const id = el.id;
  const x = Math.round(parseFloat(el.style.left) || 0);
  const y = Math.round(parseFloat(el.style.top) || 0);
  const w = Math.round(parseFloat(el.style.width) || el.getBoundingClientRect().width);
  const h = Math.round(parseFloat(el.style.height) || el.getBoundingClientRect().height);
  const z = parseInt(el.style.zIndex || 100, 10);
  settings.windows[id] = {x,y,w,h,z};
  save();
}

// =======================
// Interact.js: drag + resize
// =======================
function initInteract(){
  const grid = settings.gridSize || 16;

  // elevar z-index ao focar
  $$(".window").forEach(w => {
    w.addEventListener("mousedown", () => {
      zIndexCounter++;
      w.style.zIndex = zIndexCounter;
      save();
    });
  });

  // Drag
  interact('.window').draggable({
    allowFrom: '.win-header',
    inertia: true,
    modifiers: [
      interact.modifiers.restrictRect({ restriction: '#stage', endOnly: true }),
      interact.modifiers.snap({
        targets: [ interact.createSnapGrid({ x: grid, y: grid }) ],
        range: Infinity,
        relativePoints: [{ x: 0, y: 0 }]
      })
    ],
    listeners: {
      move (event) {
        const target = event.target;
        const left = (parseFloat(target.style.left || 0) + event.dx);
        const top  = (parseFloat(target.style.top  || 0) + event.dy);
        target.style.left = Math.round(left) + "px";
        target.style.top  = Math.round(top)  + "px";
      },
      end (ev) {
        saveWindowState(ev.target);
      }
    }
  });

  // Resize
  interact('.window').resizable({
    edges: { left:true, right:true, bottom:true, top:true },
    inertia: true,
    modifiers: [
      interact.modifiers.restrictEdges({ outer: '#stage' }),
      interact.modifiers.restrictSize({ min:{width:260,height:160}, max:{width:1400,height:1200} }),
      interact.modifiers.snapSize({
        targets: [ interact.createSnapGrid({ x: grid, y: grid }) ]
      })
    ],
    listeners: {
      move (event) {
        const target = event.target;
        const { width, height } = event.rect;
        const left = parseFloat(target.style.left || 0) + event.deltaRect.left;
        const top  = parseFloat(target.style.top  || 0) + event.deltaRect.top;
        target.style.width  = Math.round(width)  + 'px';
        target.style.height = Math.round(height) + 'px';
        target.style.left   = Math.round(left)   + 'px';
        target.style.top    = Math.round(top)    + 'px';
      },
      end (ev) {
        saveWindowState(ev.target);
      }
    }
  });
}

// =======================
// UI e Configurações
// =======================
function restoreSettings() {
  // Tema
  const themeToggle = $("#toggleTheme");
  if (settings.theme === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    themeToggle.checked = true;
  } else {
    document.documentElement.setAttribute("data-theme", "dark");
    themeToggle.checked = false;
  }
  themeToggle.addEventListener("change", e => {
    const light = e.target.checked;
    document.documentElement.setAttribute("data-theme", light ? "light" : "dark");
    settings.theme = light ? "light" : "dark";
    save();
  });

  // Notificações
  const notifToggle = $("#toggleNotif");
  notifToggle.checked = settings.notifGranted || false;
  notifToggle.addEventListener("change", async e => {
    if (e.target.checked) {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast("Permissão negada.");
        e.target.checked = false;
      } else {
        settings.notifGranted = true;
        toast("Notificações ativadas");
        save();
      }
    } else {
      settings.notifGranted = false;
      save();
      toast("Notificações desativadas");
    }
  });

  // Pomodoro
  $("#pomCount").textContent = pomCount;
  if (settings.pom) {
    $("#pomWork").value = settings.pom.work ?? 25;
    $("#pomShort").value = settings.pom.short ?? 5;
    $("#pomLong").value = settings.pom.long ?? 15;
  }

  // Data do calendário
  const todayStr = new Date().toISOString().slice(0, 10);
  $("#currentDay").value = settings.currentDay || todayStr;
}

function wireUI() {
  bindTaskForm();
  bindTaskControls();
  bindCalendarControls();
  bindICS();

  $("#btnSummarize").addEventListener("click", () => {
    const text = $("#meetingNotes").value || "";
    if (!text.trim()) { toast("Cole as notas para resumir."); return; }
    const bullets = summarizeText(text);
    const actions = detectActions(text);
    renderSummary(bullets, actions);
    toast("Resumo gerado");
  });
  $("#btnClearNotes").addEventListener("click", () => {
    $("#meetingNotes").value = "";
    $("#summaryBullets").innerHTML = "";
    $("#actionItems").innerHTML = "";
  });

  $("#modalClose").addEventListener("click", closeModal);
  $("#modalOverlay").addEventListener("click", (e) => { if (e.target === $("#modalOverlay")) closeModal(); });
}

// =======================
// Tarefas
// =======================
function renderTasks() {
  const list = $("#taskList");
  list.innerHTML = "";
  const q = ($("#searchTask").value || "").trim().toLowerCase();
  const status = $("#filterStatus").value || "open";
  const sort = $("#sortTasks").value || "priority";

  let items = tasks.slice();
  if (status !== "all") items = items.filter(t => status === "done" ? t.done : !t.done);
  if (q) items = items.filter(t => (t.title || "").toLowerCase().includes(q) || (t.category || "").toLowerCase().includes(q));

  if (sort === "priority") items.sort((a, b) => (b.importance || 0) - (a.importance || 0) || (a.created || 0) - (b.created || 0));
  else if (sort === "due") items.sort((a, b) => new Date(a.due || 0) - new Date(b.due || 0));
  else if (sort === "created") items.sort((a, b) => (a.created || 0) - (b.created || 0));

  items.forEach(task => {
    const li = document.createElement("li");
    li.className = "task";
    if (task.done) li.classList.add("done");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.done || false;
    checkbox.addEventListener("change", () => {
      task.done = checkbox.checked;
      save();
      renderTasks();
      renderCalendar();
      toast("Tarefa atualizada");
    });

    const title = document.createElement("span");
    title.className = "title";
    title.textContent = task.title;

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.alignItems = "center";
    right.style.gap = "8px";

    if (task.due) {
      const due = document.createElement("span");
      due.className = "due";
      const dd = new Date(task.due);
      due.textContent = dd.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      if (dd < new Date() && !task.done) due.classList.add("warn");
      else due.classList.add("ok");
      right.appendChild(due);
    }

    if (task.file && task.file.id) {
      const att = document.createElement("button");
      att.className = "attach-mini";
      att.textContent = "📎";
      att.title = task.file.name || "Anexo";
      att.style.background = "transparent";
      att.style.border = "none";
      att.style.cursor = "pointer";
      att.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const rec = await idbGetFile(task.file.id);
        if (rec) openFileModal({ name: rec.name, type: rec.type, blob: rec.blob });
        else toast("Anexo não encontrado.");
      });
      right.appendChild(att);
    }

    const btnEdit = document.createElement("button");
    btnEdit.textContent = "✏️";
    btnEdit.title = "Editar";
    btnEdit.addEventListener("click", () => {
      const nt = prompt("Novo título:", task.title || "");
      if (nt && nt.trim()) { task.title = nt.trim(); save(); renderTasks(); renderCalendar(); }
    });

    const btnDel = document.createElement("button");
    btnDel.textContent = "🗑️";
    btnDel.title = "Remover";
    btnDel.addEventListener("click", async () => {
      if (task.file && task.file.id) { try { await idbDeleteFile(task.file.id); } catch (e) { } }
      tasks = tasks.filter(t => t !== task);
      save();
      renderTasks();
      renderCalendar();
    });

    right.appendChild(btnEdit);
    right.appendChild(btnDel);

    li.appendChild(checkbox);
    li.appendChild(title);
    li.appendChild(right);
    list.appendChild(li);
  });
}

function bindTaskForm() {
  $("#formTask").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#taskTitle").value.trim();
    if (!title) return;

    const fileInput = $("#taskFile");
    const file = fileInput.files && fileInput.files[0];
    let fileMeta = null;
    if (file) {
      const id = "file-" + Date.now() + "-" + Math.floor(Math.random() * 9999);
      try {
        await idbPutFile(id, file);
        fileMeta = { id, name: file.name, type: file.type };
      } catch (err) {
        console.error("IDB put error", err);
        toast("Erro ao salvar anexo");
      }
    }

    const task = {
      id: crypto?.randomUUID?.() || String(Date.now()) + Math.random(),
      title,
      due: $("#taskDue").value || null,
      duration: parseInt($("#taskDuration").value) || 30,
      importance: parseInt($("#taskImportance").value) || 3,
      category: $("#taskCategory").value.trim() || "",
      created: Date.now(),
      done: false,
      file: fileMeta
    };
    tasks.push(task);
    save();
    renderTasks();
    renderCalendar();
    e.target.reset();
    toast("Tarefa criada");
  });
}
function bindTaskControls() {
  $("#searchTask").addEventListener("input", renderTasks);
  $("#filterStatus").addEventListener("change", renderTasks);
  $("#sortTasks").addEventListener("change", renderTasks);
  $("#btnAutoPlan").addEventListener("click", () => { autoPlanDay(); toast("Plano do dia criado"); });
}

// =======================
// Agenda
// =======================
function renderCalendar() {
  const grid = $("#calendarGrid");
  grid.innerHTML = "";
  for (let h = 8; h <= 20; h++) {
    const label1 = document.createElement("div");
    label1.className = "slot-label";
    label1.textContent = `${String(h).padStart(2, "0")}:00`;
    const slot1 = document.createElement("div");
    slot1.className = "slot";
    slot1.dataset.time = `${String(h).padStart(2, "0")}:00`;
    grid.appendChild(label1);
    grid.appendChild(slot1);
    if (h < 20) {
      const label2 = document.createElement("div");
      label2.className = "slot-label";
      label2.textContent = `${String(h).padStart(2, "0")}:30`;
      const slot2 = document.createElement("div");
      slot2.className = "slot";
      slot2.dataset.time = `${String(h).padStart(2, "0")}:30`;
      grid.appendChild(label2);
      grid.appendChild(slot2);
    }
  }
  tasks.forEach(t => {
    if (t.due) addEventToCalendar({ title: t.title, start: new Date(t.due), duration: t.duration || 30, taskId: t.id });
  });
}
function addEventToCalendar({ title, start, duration, taskId }) {
  const dateStr = $("#currentDay").value;
  if (!dateStr) return;
  const s = new Date(start);
  const selectedDay = new Date(dateStr + "T00:00");
  if (s.toDateString() !== selectedDay.toDateString()) return;

  const hour = s.getHours();
  const minute = s.getMinutes();
  const index = ((hour - 8) * 2) + (minute >= 30 ? 1 : 0);
  const slots = $$("#calendarGrid .slot");
  if (!slots[index]) return;

  const ev = document.createElement("div");
  ev.className = "event";
  ev.textContent = `${title} - ${s.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${duration}m)`;
  if (taskId) ev.dataset.taskId = taskId;

  const linked = taskId ? tasks.find(t => t.id === taskId) : null;
  if (linked && linked.file && linked.file.id) {
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = " 📎";
    a.title = linked.file.name;
    a.style.marginLeft = "8px";
    a.addEventListener("click", async (evClick) => {
      evClick.preventDefault();
      const rec = await idbGetFile(linked.file.id);
      if (rec) openFileModal({ name: rec.name, type: rec.type, blob: rec.blob });
      else toast("Arquivo não encontrado.");
    });
    ev.appendChild(a);
  }

  ev.addEventListener("dblclick", () => {
    if (linked) {
      linked.done = true;
      save();
      renderTasks();
      renderCalendar();
      toast("Tarefa marcada como feita");
    }
  });

  if (linked && linked.done) ev.classList.add("done");
  slots[index].appendChild(ev);
}
function bindCalendarControls() {
  const inputDay = $("#currentDay");
  $("#prevDay").addEventListener("click", () => shiftDay(-1));
  $("#nextDay").addEventListener("click", () => shiftDay(1));
  inputDay.addEventListener("change", () => { settings.currentDay = inputDay.value; save(); renderCalendar(); highlightNowSlot(); });
}
function shiftDay(delta) {
  const d = new Date($("#currentDay").value || new Date());
  d.setDate(d.getDate() + delta);
  const s = d.toISOString().slice(0, 10);
  $("#currentDay").value = s; settings.currentDay = s; save(); renderCalendar(); highlightNowSlot();
}
function highlightNowSlot() {
  $$(".slot").forEach(s => s.classList.remove("now"));
  const sel = $("#currentDay").value;
  const today = new Date().toISOString().slice(0, 10);
  if (sel !== today) return;
  const now = new Date(); const hh = now.getHours(); const mm = now.getMinutes();
  if (hh < 8 || hh > 20) return;
  const key = mm < 30 ? `${String(hh).padStart(2, "0")}:00` : `${String(hh).padStart(2, "0")}:30`;
  const slot = document.querySelector(`.slot[data-time="${key}"]`);
  if (slot) slot.classList.add("now");
}
function scheduleNowTicker() { setInterval(highlightNowSlot, 60 * 1000); }

// =======================
// Plano automático do dia
// =======================
function autoPlanDay() {
  const day = $("#currentDay").value; if (!day) return; renderCalendar();
  const open = tasks.filter(t => !t.done).sort((a, b) => (b.importance || 0) - (a.importance || 0) || (a.created || 0) - (b.created || 0));
  const base = new Date(day + "T08:00"); const now = new Date();
  let cursor = (new Date(day).toDateString() === now.toDateString()) ? new Date(Math.max(now.getTime(), base.getTime())) : base;
  const end = new Date(day + "T20:00");
  for (const t of open) {
    const dur = Math.max(5, t.duration || 30);
    if (cursor >= end) break;
    // alinhar à grade de 30 min
    cursor.setMinutes(cursor.getMinutes() + (cursor.getMinutes() % 30 ? (30 - (cursor.getMinutes() % 30)) : 0));
    if (cursor >= end) break;
    const start = new Date(cursor);
    addEventToCalendar({ title: t.title, start, duration: dur, taskId: t.id });
    if (settings.notifGranted) new Notification("Plano do dia", { body: `${t.title} às ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` });
    cursor.setMinutes(cursor.getMinutes() + dur);
  }
}

// =======================
// Pomodoro
// =======================
function startPomodoro() {
  let work = parseInt($("#pomWork").value) * 60;
  let shortBreak = parseInt($("#pomShort").value) * 60;
  let longBreak = parseInt($("#pomLong").value) * 60;
  settings.pom = { work: work / 60, short: shortBreak / 60, long: longBreak / 60 };
  save();
  pomTimer = work; updatePomDisplay();
  clearInterval(pomInterval);
  pomInterval = setInterval(() => {
    pomTimer--; updatePomDisplay();
    if (pomTimer <= 0) {
      clearInterval(pomInterval);
      pomCount++; $("#pomCount").textContent = pomCount; localStorage.setItem("pomCount", String(pomCount));
      pomTimer = (pomCount % 4 === 0) ? longBreak : shortBreak;
      if (settings.notifGranted) new Notification("Pomodoro", { body: "Hora de pausa/voltar" });
      startPomodoro();
    }
  }, 1000);
}
function updatePomDisplay() {
  const min = String(Math.floor(pomTimer / 60)).padStart(2, "0");
  const sec = String(pomTimer % 60).padStart(2, "0");
  $("#pomTimer").textContent = `${min}:${sec}`;
}
$("#pomStart").addEventListener("click", () => { clearInterval(pomInterval); startPomodoro(); });
$("#pomPause").addEventListener("click", () => clearInterval(pomInterval));
$("#pomReset").addEventListener("click", () => { clearInterval(pomInterval); pomCount = 0; localStorage.setItem("pomCount", "0"); $("#pomCount").textContent = 0; $("#pomTimer").textContent = "25:00"; });

// =======================
// ICS export/import
// =======================
function bindICS() {
  $("#btnExportICS").addEventListener("click", exportICS);
  $("#inputICS").addEventListener("change", importICS);
}
function exportICS() {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Assistente//PT-BR"];
  tasks.forEach((t, i) => {
    if (!t.due) return;
    const start = new Date(t.due); const end = new Date(start.getTime() + (t.duration || 30) * 60000);
    const fmt = d => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}00`;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${t.id || (Date.now() + "-" + i)}@assistente`);
    lines.push(`SUMMARY:${escapeICS(t.title)}`);
    lines.push(`DTSTART:${fmt(start)}`); lines.push(`DTEND:${fmt(end)}`);
    if (t.category) lines.push(`CATEGORIES:${escapeICS(t.category)}`);
    lines.push("END:VEVENT");
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "agenda-tarefas.ics"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); toast(".ics exportado!");
}
function escapeICS(s) { return String(s || "").replace(/[,;\\]/g, m => "\\" + m); }
async function importICS(e) {
  const file = e.target.files?.[0]; if (!file) return; const text = await file.text();
  const events = []; const blocks = text.split(/BEGIN:VEVENT/).slice(1).map(b => "BEGIN:VEVENT" + b);
  for (const b of blocks) {
    const mSum = b.match(/SUMMARY:(.+)/); const mDtStart = b.match(/DTSTART(?:;[^:]+)?:([0-9TzZ]+)/i); const mDtEnd = b.match(/DTEND(?:;[^:]+)?:([0-9TzZ]+)?/i);
    const title = mSum ? mSum[1].trim() : "Evento importado"; const ds = mDtStart ? parseICSDate(mDtStart[1]) : null; const de = mDtEnd ? parseICSDate(mDtEnd[1]) : null;
    if (ds) events.push({ title, start: ds, duration: de ? Math.max(5, Math.round((de - ds) / 60000)) : 30 });
  }
  for (const ev of events) {
    tasks.push({ id: crypto?.randomUUID?.() || String(Date.now() + Math.random()), title: ev.title, due: toLocalDatetimeValue(ev.start), duration: ev.duration, importance: 3, category: "Importado", created: Date.now(), done: false, file: null });
  }
  save(); renderTasks(); renderCalendar(); toast(`Importado(s) ${events.length} evento(s).`); e.target.value = "";
}
function parseICSDate(s) { const m = s.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?/); if (!m) return null; const [_, Y, M, D, h = "08", mn = "00", sec = "00"] = m; return new Date(Number(Y), Number(M) - 1, Number(D), Number(h), Number(mn), Number(sec)); }
function toLocalDatetimeValue(d) { const pad = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }

// =======================
// Notas: resumo & ações
// =======================
function summarizeText(t) {
  const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const keys = ["decid", "defin", "problema", "prazo", "respons", "entrega", "bloqueio", "próxim", "next"];
  const scored = lines.map(l => ({ l, score: l.split(/\s+/).length + (keys.some(k => l.toLowerCase().includes(k)) ? 5 : 0) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.min(6, scored.length)).map(x => x.l);
}
function detectActions(t) {
  const lines = t.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const verbs = /(fazer|entregar|revisar|implementar|corrigir|enviar|agendar|contatar|criar|finalizar|priorizar|testar)/i;
  const res = [];
  for (const l of lines) { if (verbs.test(l) || l.match(/^\s*[-*]\s+/)) res.push(l.replace(/^\s*[-*]\s+/, "")); }
  return res.slice(0, 10);
}
function renderSummary(bullets, actions) {
  const ulB = $("#summaryBullets");
  const ulA = $("#actionItems");
  ulB.innerHTML = "";
  ulA.innerHTML = "";
  bullets.forEach(b => { const li = document.createElement("li"); li.textContent = b; ulB.appendChild(li); });
  actions.forEach(a => { const li = document.createElement("li"); li.textContent = a; ulA.appendChild(li); });
}

// =======================
// Modal preview
// =======================
function openFileModal(fileRec) {
  const overlay = $("#modalOverlay"), content = $("#modalContent");
  content.innerHTML = "";
  if (!fileRec) return;
  const blob = fileRec.blob;
  const type = fileRec.type || "";
  const name = fileRec.name || "arquivo";

  if (blob instanceof Blob) {
    const url = URL.createObjectURL(blob);
    if (type.startsWith("image/")) {
      const img = document.createElement("img"); img.src = url; img.alt = name; content.appendChild(img);
    } else if (type === "application/pdf") {
      const iframe = document.createElement("iframe"); iframe.src = url; content.appendChild(iframe);
    } else {
      const p = document.createElement("p"); p.textContent = `Arquivo: ${name}`;
      const a = document.createElement("a"); a.href = url; a.download = name; a.textContent = "Baixar/abrir";
      p.appendChild(document.createElement("br")); p.appendChild(a); content.appendChild(p);
    }
    overlay.dataset.blobUrl = url;
  } else {
    const p = document.createElement("p"); p.textContent = `Arquivo: ${name} (preview indisponível)`;
    content.appendChild(p);
  }

  overlay.classList.add("show"); overlay.setAttribute("aria-hidden", "false");
}
function closeModal() {
  const overlay = $("#modalOverlay");
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden", "true");
  const url = overlay.dataset.blobUrl;
  if (url) { URL.revokeObjectURL(url); delete overlay.dataset.blobUrl; }
}

// =======================
// Bindings finais
// =======================
bindCalendarControls();
