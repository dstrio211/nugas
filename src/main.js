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
let todayOnly = false;
let authMode = "signin";
let editingTask = null;
let viewToken = 0;
let sessionSyncToken = 0;

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

async function swapView(render, direction = "forward") {
  const view = document.querySelector("#view");
  const token = ++viewToken;
  view.getAnimations().forEach((animation) => animation.cancel());
  try {
    if (view.innerHTML && !isReduced())
      await view.animate(
        [
          { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
          {
            opacity: 0,
            transform:
              direction === "back" ? "translateY(6px)" : "translateY(-6px)",
            filter: "blur(2px)",
          },
        ],
        { duration: 130, easing: "ease-in", fill: "forwards" },
      ).finished;
    if (token !== viewToken) return;
    render();
    if (!isReduced())
      await view.animate(
        [
          {
            opacity: 0,
            transform:
              direction === "back" ? "translateY(-9px)" : "translateY(12px)",
            filter: "blur(3px)",
          },
          { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
        ],
        { duration: 360, easing: "cubic-bezier(.16,1,.3,1)" },
      ).finished;
  } finally {
    view.getAnimations().forEach((a) => a.cancel());
  }
}

function todayCount() {
  return tasks.filter((t) => !t.completed_at && deadlineDate(t) === today())
    .length;
}
function courseList() {
  return [...new Set(tasks.map((t) => courseName(t.course)))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function showDashboard() {
  archive = false;
  todayOnly = false;
  swapView(renderDashboard, "back");
}
function renderDashboard() {
  const active = tasks.filter((t) => !t.completed_at);
  const count = todayCount();
  const view = document.querySelector("#view");
  view.innerHTML = `<section class="dashboard"><div class="hero"><div><div class="date-line">${new Intl.DateTimeFormat("id-ID", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}</div><div class="count">${active.length}</div><h1>Tugas belum dikumpulkan</h1></div><button class="primary add-button" id="add">+ Tambah tugas</button></div><button class="deadline-banner ${count === 0 ? "zero" : ""}" id="today-banner" ${count === 0 ? "disabled" : ""}>${count === 0 ? `<b>0 TUGAS DEADLINE HARI INI</b>` : `<span><b>${count} TUGAS DEADLINE HARI INI</b><small>Lihat yang perlu dikumpulkan</small></span><span>↗</span>`}</button><div class="tabs"><button id="active-tab" class="active">Tugas aktif</button><button id="archive-tab">Arsip · ${tasks.filter((t) => t.completed_at).length}</button></div><div id="tab-area"><div class="tools"><input id="search" type="search" placeholder="Cari tugas…" aria-label="Cari tugas"><select id="course-filter" aria-label="Filter mata kuliah"><option value="">Semua mata kuliah</option>${courseList()
    .map((c) => `<option value="${esc(c)}">${esc(c)}</option>`)
    .join("")}</select></div><div id="list"></div></div></section>`;
  document.querySelector("#add").onclick = () => showForm();
  document.querySelector("#today-banner").onclick = () => {
    todayOnly = !todayOnly;
    document.querySelector("#today-banner").innerHTML =
      `<b class="all-tasks">Tampilkan semua tugas</b><span>↗</span>`;
    document.querySelector("#today-banner").classList.add("all");
    renderList();
    document.querySelector("#today-banner").onclick = () => {
      todayOnly = false;
      renderDashboard();
    };
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
  todayOnly = false;
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
      (!todayOnly || deadlineDate(t) === today()) &&
      (!course || courseName(t.course) === course) &&
      `${t.title} ${t.course} ${t.notes}`.toLowerCase().includes(q),
  );
  list.innerHTML = selected.length
    ? selected
        .map(
          (t) =>
            `<button class="task-card ${urgency(t)}" data-id="${t.id}"><span class="task-main"><strong>${esc(t.title)}</strong><span class="course">${esc(courseName(t.course))} · ${esc(t.task_type)}</span>${t.task_type === "Kelompok" && t.members ? `<span class="members">${esc(membersShort(t.members))}</span>` : ""}</span><span class="status">${t.completed_at ? "✓ Sudah dikumpulkan" : esc(t.status)}</span><span class="due"><b>${!t.completed_at && daysUntil(t) <= 4 ? "⚠️ " : ""}${deadlineText(t)}</b><small>${timeLabel(t.deadline_at)}</small></span></button>`,
        )
        .join("")
    : `<div class="empty">${archive ? "Belum ada tugas di arsip." : "Belum ada tugas di sini."}</div>`;
  list
    .querySelectorAll(".task-card")
    .forEach((el) => (el.onclick = () => showDetail(el.dataset.id)));
}

function showDetail(id) {
  const task = tasks.find((t) => t.id === id);
  if (task) swapView(() => renderDetail(task));
}
function renderDetail(task) {
  const complete = Boolean(task.completed_at);
  const view = document.querySelector("#view");
  view.innerHTML = `<div class="detail-nav"><button class="back" id="back" aria-label="Kembali">‹</button><button id="edit">Edit</button></div><article class="detail-card"><div class="eyebrow">${esc(task.task_type)}</div><h1>${esc(task.title)}</h1><p class="course-full">${esc(courseName(task.course))}</p><div class="facts ${complete ? "archive-facts" : ""}"><div><span>Tanggal ditugaskan</span><b>${dateLabel(task.assigned_date)}</b></div><div><span>Deadline</span><b>${dateTimeLabel(task.deadline_at)}</b></div>${complete ? `<div><span>Ditandai selesai</span><b>${dateTimeLabel(task.completed_at)}</b></div>` : ""}</div>${task.task_type === "Kelompok" && task.members ? `<div class="detail-block"><span>Anggota kelompok</span><p>${esc(task.members)}</p></div>` : ""}${!complete ? `<label class="status-field">Status<select id="status"><option ${task.status === "Belum mulai" ? "selected" : ""}>Belum mulai</option><option ${task.status === "Dikerjakan" ? "selected" : ""}>Dikerjakan</option><option ${task.status === "Siap dikumpulkan" ? "selected" : ""}>Siap dikumpulkan</option></select></label>` : ""}<div class="detail-block"><span>Catatan</span><p class="note">${linkify(task.notes)}</p></div><div class="detail-actions">${complete ? `<button id="restore">Kembalikan ke tugas aktif</button>` : `<div><small>Tandai setelah submit di Binusmaya</small><button class="primary complete" id="complete">Tandai sudah dikumpulkan</button></div>`}</div>${complete ? `<div class="delete-area" id="delete-area"><button class="danger" id="delete">Hapus permanen</button></div>` : ""}</article>`;
  document.querySelector("#back").onclick = showDashboard;
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
  document.querySelector("#back").onclick = () =>
    isEdit ? showDetail(task.id) : showDashboard;
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
  button.disabled = true;
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
  button.disabled = false;
  if (result.error) {
    showToast(result.error.message);
    return;
  }
  if (editingTask)
    tasks = tasks.map((t) => (t.id === result.data.id ? result.data : t));
  else tasks.push(result.data);
  if (!editingTask) clearDraft();
  editingTask = null;
  button.textContent = "Tersimpan!";
  button.classList.add("saved");
  setTimeout(() => showDetail(result.data.id), 550);
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
  document.querySelector("#confirm-delete").onclick = async () => {
    const { error } = await supabase
      .from("tasks")
      .delete()
      .eq("id", task.id)
      .eq("user_id", user.id);
    if (error) {
      showToast(error.message);
      return;
    }
    tasks = tasks.filter((t) => t.id !== task.id);
    showDashboard();
    showToast("Tugas dihapus permanen");
  };
}

async function syncSession(session) {
  const token = ++sessionSyncToken;
  user = session?.user || null;
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
