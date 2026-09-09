import { createClient } from "@supabase/supabase-js";
import "./style.css";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const app = document.querySelector("#app");
const timeZone = "Asia/Jakarta";

if (!url || !key) {
  app.innerHTML = `<main class="setup"><div><div class="logo">nugas.</div><h1>Belum tersambung.</h1><p>Tambahkan variabel Supabase dulu untuk mulai pakai nugas.</p><code>VITE_SUPABASE_URL<br>VITE_SUPABASE_ANON_KEY</code></div></main>`;
  throw new Error("Missing Supabase environment variables");
}

const supabase = createClient(url, key);
let user = null;
let profile = null;
let tasks = [];
let archive = false;
let weekOnly = false;
let authMode = "signin";
let editingTask = null;
let viewToken = 0;
let route = { kind: "dashboard" };
let navDepth = 0;
const pageSnapshots = new Map();
let backMotion = null;
let dashboardState = { y: 0, archive: false, weekOnly: false, search: "", course: "" };
history.scrollRestoration = "manual";

function rememberDashboard() {
  if (route.kind !== "dashboard") return;
  dashboardState = { y: window.scrollY, archive, weekOnly,
    search: document.querySelector("#search")?.value || "",
    course: document.querySelector("#course-filter")?.value || "" };
}
function openRoute(next) {
  if (backMotion) return;
  rememberDashboard();
  pageSnapshots.set(navDepth, capturePage());
  route = next;
  history.pushState({ nugas: true, route, depth: ++navDepth }, "");
}
function goBack() {
  if (backMotion) return;
  if (!isReduced() && pageSnapshots.has(navDepth - 1)) {
    startBackMotion();
    settleBackMotion(true);
    return;
  }
  performHistoryBack();
}
function performHistoryBack() {
  if (navDepth > 0 && history.state?.nugas) history.back();
  else showDashboard();
}
window.addEventListener("popstate", event => {
  const motion = backMotion;
  try {
  if (!user || !document.querySelector("#view")) return;
  const state = event.state;
  navDepth = state?.nugas ? state.depth : 0;
  route = state?.nugas ? state.route : { kind: "dashboard" };
  if (route.kind === "detail") {
    const task = tasks.find(t => t.id === route.id);
    if (task) { swapView(() => renderDetail(task), "back"); return; }
  }
  if (route.kind === "form") {
    editingTask = tasks.find(t => t.id === route.id) || null;
    swapView(() => renderForm(editingTask), "back");
    return;
  }
  route = { kind: "dashboard" };
  swapView(renderDashboard, "back");
  } finally {
    // Signal after destination rendering, without removing the animation layers.
    requestAnimationFrame(() => requestAnimationFrame(() => motion?.destinationReady?.()));
  }
});
let sessionSyncToken = 0;
let sessionLoading = false;

const esc = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
const courseName = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
const courseCardLabel = (course, type) => {
  const name = courseName(course);
  const short = name.length > 22 ? `${name.slice(0, 21).trimEnd()}…` : name;
  return `${short} · ${type}`;
};
const localDate = (value) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value || new Date());
const today = () => localDate();
const dateLabel = (value) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00+07:00`));
const dateTimeLabel = (value) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(value))
    .replace(".", ":") + " WIB";
const timeLabel = (value) =>
  new Intl.DateTimeFormat("id-ID", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(new Date(value))
    .replace(".", ":") + " WIB";
const datetimeInput = (value) => {
  const d = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(d)
    .reduce((o, p) => ((o[p.type] = p.value), o), {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
};
const deadlineDate = (task) => localDate(new Date(task.deadline_at));
const daysUntil = (task) =>
  Math.round(
    (Date.parse(`${deadlineDate(task)}T00:00:00+07:00`) -
      Date.parse(`${today()}T00:00:00+07:00`)) /
      86400000,
  );
const urgency = (task) =>
  task.completed_at
    ? ""
    : daysUntil(task) < 0
      ? "late"
      : daysUntil(task) === 0
        ? "today"
        : daysUntil(task) === 1
          ? "tomorrow"
          : "";
const deadlineText = (task) => {
  const days = daysUntil(task);
  return days < 0
    ? "Terlambat"
    : days === 0
      ? "Hari ini"
      : days === 1
        ? "Besok"
        : dateLabel(deadlineDate(task));
};
const profileName = () =>
  profile?.display_name ||
  user?.user_metadata?.display_name ||
  user?.email?.split("@")[0] ||
  "kamu";
const isReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function linkify(value) {
  const source = String(value || "Belum ada catatan.");
  const matcher = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
  let last = 0,
    html = "";
  for (const m of source.matchAll(matcher)) {
    html += esc(source.slice(last, m.index));
    let label = m[0],
      suffix = "";
    while (/[.,!?;:]$/.test(label)) {
      suffix = label.slice(-1) + suffix;
      label = label.slice(0, -1);
    }
    try {
      const href = /^www\./i.test(label) ? `https://${label}` : label;
      const parsed = new URL(href);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
      html += `<a href="${esc(parsed.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>${esc(suffix)}`;
    } catch {
      html += esc(m[0]);
    }
    last = m.index + m[0].length;
  }
  return html + esc(source.slice(last)).replace(/\n/g, "<br>");
}

function showToast(message, actionText = "", action = null) {
  const el = document.querySelector("#toast");
  if (!el) return;
  clearTimeout(window.toastTimer);
  el.innerHTML = `<span>${esc(message)}</span>${actionText ? `<button id="toast-action">${esc(actionText)}</button>` : ""}`;
  el.classList.add("show");
  if (action) el.querySelector("#toast-action").onclick = action;
  window.toastTimer = setTimeout(() => el.classList.remove("show"), 3600);
}

function authView(message = "") {
  app.innerHTML = `<main class="auth-screen"><section class="auth-card"><div class="logo">nugas.</div><h1>${authMode === "signup" ? "Mulai atur tugasmu." : "Masuk, lanjut nugas."}</h1><p>${authMode === "signup" ? "Buat akun supaya tugasmu tersimpan dan sinkron di semua perangkat." : "Tugasmu, satu tempat yang lebih tenang."}</p>
  <form id="auth-form" novalidate>${authMode === "signup" ? `<label>Nama<input id="name" maxlength="60" autocomplete="name" placeholder="Nama kamu" required></label>` : ""}<label>Email<input id="email" type="email" autocomplete="email" placeholder="nama@email.com" required></label><label>Password<input id="password" type="password" autocomplete="${authMode === "signup" ? "new-password" : "current-password"}" minlength="6" placeholder="Minimal 6 karakter" required></label><button class="primary auth-submit" type="submit">${authMode === "signup" ? "Buat akun" : "Masuk"}</button></form>
  <p class="auth-switch">${authMode === "signup" ? "Sudah punya akun?" : "Belum punya akun?"} <button id="switch-auth">${authMode === "signup" ? "Masuk" : "Buat akun"}</button></p><p class="auth-note" id="auth-note">${esc(message)}</p></section></main>`;
  document.querySelector("#switch-auth").onclick = () => {
    authMode = authMode === "signup" ? "signin" : "signup";
    authView();
  };
  document.querySelector("#auth-form").onsubmit = handleAuth;
}

async function handleAuth(event) {
  event.preventDefault();
  const form = event.currentTarget,
    note = document.querySelector("#auth-note");
  const email = form.querySelector("#email").value.trim(),
    password = form.querySelector("#password").value;
  const name = form.querySelector("#name")?.value.trim() || "";
  if (!email || !password || (authMode === "signup" && !name)) {
    note.textContent = "Lengkapi dulu semua kolomnya.";
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  note.textContent = authMode === "signup" ? "Membuat akun…" : "Masuk…";
  const result =
    authMode === "signup"
      ? await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name } },
        })
      : await supabase.auth.signInWithPassword({ email, password });
  button.disabled = false;
  if (result.error) {
    note.textContent = result.error.message;
    return;
  }
  if (authMode === "signup" && !result.data.session) {
    note.textContent = "Akun dibuat. Cek email untuk konfirmasi, lalu masuk.";
    return;
  }
  user = result.data.user;
}

async function ensureProfile() {
  const fallback = String(
    user.user_metadata?.display_name || user.email?.split("@")[0] || "Pengguna",
  ).slice(0, 60);
  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (data) {
    profile = data;
    return;
  }
  const inserted = await supabase
    .from("profiles")
    .insert({ id: user.id, display_name: fallback })
    .select("id,display_name")
    .single();
  if (inserted.error) throw inserted.error;
  profile = inserted.data;
}

async function loadTasks() {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("user_id", user.id)
    .order("deadline_at", { ascending: true });
  if (error) throw error;
  tasks = data || [];
}

function renderApp() {
  app.innerHTML = `<main class="app"><header><button class="wordmark" id="home" aria-label="Beranda nugas.">nugas.</button><div class="profile-wrap"><button id="avatar" class="avatar" aria-expanded="false">${esc(profileName().slice(0, 1).toUpperCase())}</button><div class="profile-menu" id="profile-menu" hidden><strong>${esc(profileName())}</strong><span>${esc(user.email || "")}</span><button id="signout" class="logout">Logout</button></div></div></header><section id="view"></section></main><div id="toast" class="toast" role="status"></div>`;
  document.querySelector("#home").onclick = () => showDashboard();
  document.querySelector("#avatar").onclick = toggleProfile;
  document.querySelector("#signout").onclick = async () => {
    await supabase.auth.signOut();
  };
  showDashboard();
}

function toggleProfile() {
  const menu = document.querySelector("#profile-menu"),
    avatar = document.querySelector("#avatar");
  menu.hidden = !menu.hidden;
  avatar.setAttribute("aria-expanded", String(!menu.hidden));
}

function swapView(render, direction = "forward") {
  const view = document.querySelector("#view");
  const token = ++viewToken;
  view.getAnimations().forEach(a => a.cancel());
  view.style.transform = "";
  render();
  window.scrollTo({ top: route.kind === "dashboard" ? dashboardState.y : 0, behavior: "instant" });
  // History back already supplies the swipe transition on iOS.
  // Render its destination fully opaque, without a second entrance fade.
  if (direction !== "back" && !isReduced() && view.animate) {
    const animation = view.animate([
      { opacity: 0.6, transform: direction === "back" ? "translateX(-22px)" : "translateX(32px)" },
      { opacity: 1, transform: "translateX(0)" }
    ], { duration: 260, easing: "cubic-bezier(.16,1,.3,1)" });
    animation.finished.catch(() => {}).finally(() => {
      if (token === viewToken) animation.cancel();
    });
  }
}

function isThisWeek(task, now = new Date()) {
  const day = new Date(localDate(now) + "T00:00:00Z");
  const offset = (day.getUTCDay() + 6) % 7;
  const start = day.getTime() - offset * 86400000;
  const due = Date.parse(deadlineDate(task) + "T00:00:00Z");
  return due >= start && due < start + 7 * 86400000;
}
function statusClass(task) {
  if (task.completed_at) return "status-done";
  return (
    {
      "Belum mulai": "status-idle",
      Dikerjakan: "status-working",
      "Siap dikumpulkan": "status-ready",
    }[task.status] || ""
  );
}
function weekCount() {
  return tasks.filter((t) => !t.completed_at && isThisWeek(t)).length;
}
function courseList() {
  return [...new Set(tasks.map((t) => courseName(t.course)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function showDashboard() {
  if (route.kind === "dashboard") rememberDashboard();
  route = { kind: "dashboard" };
  history.replaceState({ nugas: true, route, depth: navDepth }, "");
  swapView(renderDashboard, "back");
}
function renderDashboard() {
  archive = dashboardState.archive;
  weekOnly = dashboardState.weekOnly;
  const active = tasks.filter((t) => !t.completed_at);
  const count = weekCount();
  const view = document.querySelector("#view");
  view.innerHTML = `<section class="dashboard"><div class="hero"><div><div class="date-line">${new Intl.DateTimeFormat("id-ID", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</div><div class="count">${active.length}</div><h1>Tugas belum dikumpulkan</h1></div><button class="primary add-button" id="add">+ Tambah tugas</button></div><button class="deadline-banner ${count === 0 ? "zero" : ""}" id="week-banner" ${count === 0 ? "disabled" : ""}>${count === 0 ? `<b>0 TUGAS DEADLINE MINGGU INI</b>` : `<span><b>${count} TUGAS DEADLINE MINGGU INI</b><small>Lihat yang perlu dikumpulkan</small></span><span>↗</span>`}</button><div class="tabs"><button id="active-tab" class="active">Tugas aktif</button><button id="archive-tab">Arsip · ${tasks.filter((t) => t.completed_at).length}</button></div><div id="tab-area"><div class="tools"><input id="search" type="search" placeholder="Cari tugas…" aria-label="Cari tugas"><select id="course-filter" aria-label="Filter mata kuliah"><option value="">Semua mata kuliah</option>${courseList()
    .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
    .join("")}</select></div><div id="list"></div></div></section>`;
  document.querySelector("#search").value = dashboardState.search;
  document.querySelector("#course-filter").value = dashboardState.course;
  document.querySelector("#active-tab").classList.toggle("active", !archive);
  document.querySelector("#archive-tab").classList.toggle("active", archive);
  if (weekOnly) {
    document.querySelector("#week-banner").innerHTML = '<b class="all-tasks">Tampilkan semua tugas</b><span>↗</span>';
    document.querySelector("#week-banner").classList.add("all");
  }
  document.querySelector("#add").onclick = () => showForm();
  document.querySelector("#week-banner").onclick = () => {
    weekOnly = !weekOnly;
    archive = false;
    rememberDashboard();
    renderDashboard();
  };
  document.querySelector("#active-tab").onclick = () => switchArchive(false);
  document.querySelector("#archive-tab").onclick = () => switchArchive(true);
  document.querySelector("#search").oninput = renderList;
  document.querySelector("#course-filter").onchange = renderList;
  renderList();
}

async function switchArchive(next) {
  if (archive === next) return;
  archive = next;
  weekOnly = false;
  const area = document.querySelector("#tab-area");
  document.querySelector("#active-tab").classList.toggle("active", !archive);
  document.querySelector("#archive-tab").classList.toggle("active", archive);
  if (!isReduced())
    await area.animate(
      [
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(4px)" },
      ],
      { duration: 100, fill: "forwards" },
    ).finished;
  renderList();
  if (!isReduced()) {
    area.getAnimations().forEach((a) => a.cancel());
    area.animate(
      [
        { opacity: 0, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 230, easing: "cubic-bezier(.16,1,.3,1)" },
    );
  }
}

function membersShort(value) {
  const all = String(value || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return all.length > 3
    ? `${all.slice(0, 3).join(", ")} + ${all.length - 3} lainnya`
    : all.join(", ");
}
function renderList() {
  const list = document.querySelector("#list");
  if (!list) return;
  const q = document.querySelector("#search").value.toLowerCase(),
    course = document.querySelector("#course-filter").value;
  const selected = tasks.filter(
    (t) =>
      Boolean(t.completed_at) === archive &&
      (!weekOnly || isThisWeek(t)) &&
      (!course || courseName(t.course) === course) &&
      `${t.title} ${t.course} ${t.notes}`.toLowerCase().includes(q),
  );
  list.innerHTML = selected.length
    ? selected
        .map(
          (t) =>
            `<button class="task-card ${urgency(t)}" data-id="${t.id}"><span class="task-main"><strong>${esc(t.title)}</strong><span class="course" title="${esc(courseName(t.course))}">${esc(courseCardLabel(t.course, t.task_type))}</span>${t.task_type === "Kelompok" && t.members ? `<span class="members">${esc(membersShort(t.members))}</span>` : ""}</span><span class="status ${statusClass(t)}">${t.completed_at ? "✓ Sudah dikumpulkan" : esc(t.status)}</span><span class="due"><b>${!t.completed_at && daysUntil(t) <= 4 ? "⚠️ " : ""}${deadlineText(t)}</b><small>${timeLabel(t.deadline_at)}</small></span></button>`,
        )
        .join("")
    : `<div class="empty">${archive ? "Belum ada tugas di arsip." : "Belum ada tugas di sini."}</div>`;
  list
    .querySelectorAll(".task-card")
    .forEach((el) => (el.onclick = () => showDetail(el.dataset.id)));
}

function showDetail(id) {
  const task = tasks.find((t) => t.id === id);
  if (task) {
    openRoute({ kind: "detail", id });
    swapView(() => renderDetail(task));
  }
}
function renderDetail(task) {
  const complete = Boolean(task.completed_at);
  const view = document.querySelector("#view");
  view.innerHTML = `<div class="detail-nav"><button class="back" id="back" aria-label="Kembali">‹</button><button id="edit">Edit</button></div><article class="detail-card"><div class="eyebrow">${esc(task.task_type)}</div><h1>${esc(task.title)}</h1><p class="course-full">${esc(courseName(task.course))}</p><div class="facts ${complete ? "archive-facts" : ""}"><div><span>Tanggal ditugaskan</span><b>${dateLabel(task.assigned_date)}</b></div><div><span>Deadline</span><b>${dateTimeLabel(task.deadline_at)}</b></div>${complete ? `<div><span>Ditandai selesai</span><b>${dateTimeLabel(task.completed_at)}</b></div>` : ""}</div>${task.task_type === "Kelompok" && task.members ? `<div class="detail-block"><span>Anggota kelompok</span><p>${esc(task.members)}</p></div>` : ""}${!complete ? `<label class="status-field">Status<select id="status"><option ${task.status === "Belum mulai" ? "selected" : ""}>Belum mulai</option><option ${task.status === "Dikerjakan" ? "selected" : ""}>Dikerjakan</option><option ${task.status === "Siap dikumpulkan" ? "selected" : ""}>Siap dikumpulkan</option></select></label>` : ""}<div class="detail-block"><span>Catatan</span><p class="note">${linkify(task.notes)}</p></div><div class="detail-actions">${complete ? `<button id="restore">Kembalikan ke tugas aktif</button>` : `<div><small>Tandai setelah submit di Binusmaya</small><button class="primary complete" id="complete">Tandai sudah dikumpulkan</button></div>`}</div>${complete ? `<div class="delete-area" id="delete-area"><button class="danger" id="delete">Hapus permanen</button></div>` : ""}</article>`;
  document.querySelector("#back").onclick = goBack;
  document.querySelector("#edit").onclick = () => showForm(task);
  if (!complete)
    document.querySelector("#status").onchange = (e) =>
      updateTask(task.id, { status: e.target.value }, false);
  if (complete) {
    document.querySelector("#restore").onclick = () =>
      updateTask(task.id, { status: "Dikerjakan", completed_at: null });
    document.querySelector("#delete").onclick = () => confirmDelete(task);
  } else document.querySelector("#complete").onclick = () => completeTask(task);
}

function showForm(task = null) {
  openRoute({ kind: "form", id: task?.id || null });
  editingTask = task;
  swapView(() => renderForm(task));
}
function draftKey() {
  return `nugas:task-draft:${user?.id || "guest"}`;
}
function readDraft() {
  try {
    return JSON.parse(localStorage.getItem(draftKey()) || "{}");
  } catch {
    return {};
  }
}
function writeDraft(data) {
  localStorage.setItem(draftKey(), JSON.stringify(data));
}
function clearDraft() {
  localStorage.removeItem(draftKey());
}
function renderForm(task) {
  const isEdit = Boolean(task),
    view = document.querySelector("#view");
  const draft = isEdit ? {} : readDraft();
  const value = (field, fallback = "") =>
    task?.[field] ?? draft[field] ?? fallback;
  const type = value("task_type", "Individual");
  view.innerHTML = `<div class="detail-nav"><button class="back" id="back" aria-label="Kembali">‹</button></div><article class="detail-card form-card"><h1>${isEdit ? "Edit tugas" : `Nugas apa lagi nih, ${esc(profileName())}?`}</h1><form id="task-form"><div class="form-grid"><label>Nama tugas<input name="title" maxlength="180" required value="${esc(value("title"))}" placeholder="Contoh: laporan observasi"></label><label>Mata kuliah<input name="course" maxlength="120" required value="${esc(value("course"))}" placeholder="Contoh: Algorithm and Programming"></label><label>Tanggal ditugaskan<input name="assigned_date" type="date" required value="${esc(value("assigned_date", today()))}"></label><label>Deadline (WIB)<input name="deadline_at" type="datetime-local" required value="${esc(task ? datetimeInput(task.deadline_at) : value("deadline_at"))}"></label><label>Jenis tugas<select name="task_type" id="type"><option ${type === "Individual" ? "selected" : ""}>Individual</option><option ${type === "Kelompok" ? "selected" : ""}>Kelompok</option></select></label><label id="members-wrap" ${type === "Kelompok" ? "" : "hidden"}>Anggota kelompok<input name="members" value="${esc(value("members"))}" placeholder="Pisahkan nama dengan koma"></label></div><label>Catatan<textarea name="notes" rows="4" placeholder="Catatan atau link, misalnya https://www.canva.com/…">${esc(value("notes"))}</textarea></label><button class="primary save" type="submit">${isEdit ? "Simpan perubahan" : "Simpan tugas"}</button></form></article>`;
  document.querySelector("#back").onclick = goBack;
  const form = document.querySelector("#task-form");
  const saveDraft = () =>
    !isEdit && writeDraft(Object.fromEntries(new FormData(form)));
  form.querySelector("#type").onchange = (e) => {
    form.querySelector("#members-wrap").hidden = e.target.value !== "Kelompok";
    saveDraft();
  };
  form.oninput = saveDraft;
  form.onchange = saveDraft;
  form.onsubmit = saveTask;
}

async function saveTask(event) {
  event.preventDefault();
  const form = event.currentTarget,
    raw = Object.fromEntries(new FormData(form));
  raw.title = raw.title.trim();
  raw.course = raw.course.trim().replace(/\s+/g, " ");
  raw.members = (raw.members || "").trim();
  raw.notes = raw.notes.trim();
  if (raw.task_type === "Individual") raw.members = "";
  const payload = {
    ...raw,
    deadline_at: new Date(`${raw.deadline_at}:00+07:00`).toISOString(),
  };
  const button = form.querySelector("button[type=submit]");
  if (button.disabled) return;
  button.disabled = true;
  const originalLabel = button.textContent;
  button.textContent = "Menyimpan…";
  try {
    let result;
    if (editingTask)
      result = await supabase
        .from("tasks")
        .update(payload)
        .eq("id", editingTask.id)
        .eq("user_id", user.id)
        .select()
        .single();
    else
      result = await supabase
        .from("tasks")
        .insert({ ...payload, user_id: user.id })
        .select()
        .single();
    if (result.error) throw result.error;
    if (editingTask)
      tasks = tasks.map((t) => (t.id === result.data.id ? result.data : t));
    else tasks.push(result.data);
    if (!editingTask) clearDraft();
    editingTask = null;
    button.textContent = "Tersimpan!";
    button.classList.add("saved");
    showDetail(result.data.id);
    showToast("Tugas tersimpan");
  } catch (error) {
    showToast(error.message || "Belum berhasil menyimpan. Coba lagi.");
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function updateTask(id, changes, goHome = true) {
  const { data, error } = await supabase
    .from("tasks")
    .update(changes)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();
  if (error) {
    showToast(error.message);
    return;
  }
  tasks = tasks.map((t) => (t.id === id ? data : t));
  if (goHome) showDashboard();
  else renderDetail(data);
}
async function completeTask(task) {
  const button = document.querySelector("#complete");
  button.disabled = true;
  const { data, error } = await supabase
    .from("tasks")
    .update({
      status: "Sudah dikumpulkan",
      completed_at: new Date().toISOString(),
    })
    .eq("id", task.id)
    .eq("user_id", user.id)
    .select()
    .single();
  if (error) {
    button.disabled = false;
    showToast(error.message);
    return;
  }
  tasks = tasks.map((t) => (t.id === data.id ? data : t));
  const overlay = document.createElement("div");
  overlay.className = "celebration";
  overlay.innerHTML = `<div class="bloom"></div><div><i>✓</i><strong>Sudah<br>dikumpulkan.</strong><span>Satu tugas beres.</span></div>`;
  document.body.append(overlay);
  setTimeout(() => {
    overlay.remove();
    showDashboard();
    showToast("Tugas dipindahkan ke arsip", "Urungkan", () =>
      updateTask(data.id, { status: "Dikerjakan", completed_at: null }),
    );
  }, 1900);
}
function confirmDelete(task) {
  const host = document.querySelector("#delete-area");
  host.innerHTML = `<div class="delete-confirm"><h2>Hapus tugas ini selamanya?</h2><p>“${esc(task.title)}” tidak bisa dikembalikan setelah dihapus.</p><div><button id="cancel-delete">Batal</button><button class="danger" id="confirm-delete">Ya, hapus permanen</button></div></div>`;
  document.querySelector("#cancel-delete").onclick = () => renderDetail(task);
  document.querySelector("#confirm-delete").onclick = async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "Menghapus…";
    try {
      const { error } = await supabase
        .from("tasks")
        .delete()
        .eq("id", task.id)
        .eq("user_id", user.id);
      if (error) throw error;
      tasks = tasks.filter((t) => t.id !== task.id);
      showDashboard();
      showToast("Tugas dihapus permanen");
    } catch (error) {
      showToast(error.message || "Belum berhasil menghapus. Coba lagi.");
    } finally {
      button.disabled = false;
      button.textContent = "Ya, hapus permanen";
    }
  };
}

async function syncSession(session) {
  const nextUser = session?.user || null;
  if (
    nextUser &&
    user?.id === nextUser.id &&
    (document.querySelector("#view") || sessionLoading)
  ) {
    user = nextUser;
    return;
  }
  const token = ++sessionSyncToken;
  user = nextUser;
  sessionLoading = Boolean(user);
  if (!user) {
    profile = null;
    tasks = [];
    if (token === sessionSyncToken) authView();
    return;
  }
  try {
    await ensureProfile();
    await loadTasks();
    if (token === sessionSyncToken) renderApp();
  } catch (error) {
    if (token === sessionSyncToken) authView(error.message);
  } finally {
    if (token === sessionSyncToken) sessionLoading = false;
  }
}

supabase.auth.onAuthStateChange((_event, session) => {
  window.setTimeout(() => syncSession(session), 0);
});
const {
  data: { session },
} = await supabase.auth.getSession();
syncSession(session);
if ("serviceWorker" in navigator)
  window.addEventListener("load", () =>
    navigator.serviceWorker.register("/sw.js"),
  );


function capturePage() {
  const node = document.querySelector(".app")?.cloneNode(true);
  if (!node) return null;
  // Visual copies must never intercept form queries or expose duplicate IDs.
  node.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
  node.querySelectorAll("input, textarea, select").forEach((el, i) => {
    el.value = document.querySelectorAll(".app input, .app textarea, .app select")[i]?.value || "";
  });
  return { node, y: scrollY };
}
function pageLayer(snapshot) {
  const layer = document.createElement("div");
  layer.className = "nav-motion-layer";
  layer.setAttribute("aria-hidden", "true");
  layer.inert = true;
  const content = document.createElement("div");
  content.style.transform = `translateY(-${snapshot.y}px)`;
  content.append(snapshot.node.cloneNode(true));
  layer.append(content);
  return layer;
}
function startBackMotion() {
  if (backMotion) return false;
  const target = pageSnapshots.get(navDepth - 1);
  const current = capturePage();
  if (!target || !current) return false;
  document.querySelector("#view")?.getAnimations().forEach(a => a.cancel());
  const host = document.createElement("div");
  host.className = "nav-motion";
  const under = pageLayer(target), over = pageLayer(current);
  over.classList.add("nav-motion-front");
  host.append(under, over);
  document.body.append(host);
  backMotion = { host, under, over, dx: 0, width: innerWidth, settling: false };
  moveBackMotion(0);
  return true;
}
function moveBackMotion(dx) {
  const m = backMotion;
  if (!m) return;
  m.dx = Math.max(0, Math.min(m.width, dx));
  m.over.style.transform = `translateX(${m.dx}px)`;
  m.under.style.transform = `translateX(${-m.width * .22 * (1 - m.dx / m.width)}px)`;
}
function cleanupBackMotion() {
  backMotion?.host.remove();
  backMotion = null;
}
async function settleBackMotion(commit) {
  const m = backMotion;
  if (!m || m.settling) return;
  m.settling = true;
  const end = commit ? m.width : 0;
  const duration = isReduced() ? 0 : Math.max(140, Math.min(320, Math.abs(end - m.dx) * .65));
  const options = { duration, easing: "cubic-bezier(.22,.8,.25,1)", fill: "forwards" };
  const animations = [
    m.over.animate([{ transform: `translateX(${m.dx}px)` }, { transform: `translateX(${end}px)` }], options),
    m.under.animate([{ transform: m.under.style.transform },
      { transform: `translateX(${commit ? 0 : -m.width * .22}px)` }], options)
  ];
  // Render and restore scroll underneath the opaque layers WHILE they settle.
  // Previously history.back ran after settling, leaving the compositor no time
  // to prepare the destination before the cover was removed.
  const destination = commit ? new Promise(resolve => {
    m.destinationReady = resolve;
    performHistoryBack();
  }) : Promise.resolve();
  await Promise.all([destination, ...animations.map(a => a.finished.catch(() => {}))]);
  if (backMotion !== m) return;
  cleanupBackMotion();
}

let edgeSwipe = null;
const standalone = () => navigator.standalone || matchMedia("(display-mode: standalone)").matches;
document.addEventListener("touchstart", e => {
  if (backMotion || !standalone() || route.kind === "dashboard" || e.touches.length !== 1) return;
  const t = e.touches[0];
  if (t.clientX > 28 || e.target.closest("input, textarea, select, button")) return;
  edgeSwipe = { x: t.clientX, y: t.clientY, dx: 0, lastX: t.clientX,
    time: performance.now(), velocity: 0, active: false };
}, { passive: true });
document.addEventListener("touchmove", e => {
  const g = edgeSwipe;
  if (!g) return;
  if (e.touches.length !== 1) { finishEdgeSwipe(true); return; }
  const t = e.touches[0], dx = t.clientX - g.x, dy = t.clientY - g.y;
  if (!g.active && Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { edgeSwipe = null; return; }
  if (!g.active && dx > 10 && dx > Math.abs(dy) * 1.4) {
    if (!startBackMotion()) { edgeSwipe = null; return; }
    g.active = true;
  }
  if (!g.active) return;
  if (!e.cancelable) { finishEdgeSwipe(true); return; }
  e.preventDefault();
  const now = performance.now();
  g.velocity = (t.clientX - g.lastX) / Math.max(1, now - g.time);
  g.lastX = t.clientX; g.time = now; g.dx = Math.max(0, dx);
  moveBackMotion(g.dx);
}, { passive: false });
function finishEdgeSwipe(cancelled = false) {
  const g = edgeSwipe;
  edgeSwipe = null;
  if (!g?.active) return;
  const velocity = performance.now() - g.time < 100 ? g.velocity : 0;
  const commit = !cancelled && (g.dx > innerWidth * .36 || (g.dx > 45 && velocity > .5));
  settleBackMotion(commit);
}
document.addEventListener("touchend", () => finishEdgeSwipe(), { passive: true });
document.addEventListener("touchcancel", () => finishEdgeSwipe(true), { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) finishEdgeSwipe(true);
});
window.addEventListener("resize", () => {
  finishEdgeSwipe(true);
});
