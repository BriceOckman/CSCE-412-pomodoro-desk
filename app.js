"use strict";

/* ---------------- Storage ---------------- */

const LS_SETTINGS = "pomodoro-desk:settings";
const LS_TASKS = "pomodoro-desk:tasks";
const LS_STATS = "pomodoro-desk:stats";

const DEFAULTS = { work: 25, short: 5, long: 15 };

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: keep running in memory */
  }
}

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/* ---------------- State ---------------- */

const settings = Object.assign({}, DEFAULTS, load(LS_SETTINGS, {}));
const stats = load(LS_STATS, { total: 0, days: {} });
if (typeof stats.total !== "number") stats.total = 0;
if (!stats.days || typeof stats.days !== "object") stats.days = {};

let tasks = load(LS_TASKS, []);
if (!Array.isArray(tasks)) tasks = [];

let phase = "work"; // "work" | "short" | "long"
let running = false;
let endAt = 0; // timestamp the current phase ends at
let remaining = settings.work * 60; // seconds left, authoritative when paused
let workInCycle = 0; // completed work sessions in the current 4-session cycle (0..4)

const PHASE_LABELS = { work: "Work", short: "Short break", long: "Long break" };

/* ---------------- DOM ---------------- */

const $ = (id) => document.getElementById(id);

const phaseLabel = $("phaseLabel");
const timeDisplay = $("timeDisplay");
const cycleDots = $("cycleDots");
const startPauseBtn = $("startPauseBtn");
const resetBtn = $("resetBtn");
const statsLine = $("statsLine");
const workInput = $("workInput");
const shortInput = $("shortInput");
const longInput = $("longInput");
const taskForm = $("taskForm");
const taskInput = $("taskInput");
const taskList = $("taskList");
const taskEmpty = $("taskEmpty");

/* ---------------- Audio (WebAudio beep) ---------------- */

let audioCtx = null;

function ensureAudio() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

/** Short triple-beep on phase change. Only called from user-gesture-initiated flow. */
function beep() {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = t0 + i * 0.22;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch {
    /* audio failed: timer keeps working */
  }
}

/* ---------------- Timer core ---------------- */

function phaseSeconds(p) {
  return Math.max(1, Math.round(Number(settings[p]) || DEFAULTS[p])) * 60;
}

function fmt(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Advance to the next phase after one finishes. Updates cycle + stats. */
function advancePhase() {
  if (phase === "work") {
    workInCycle += 1;
    stats.total += 1;
    const key = todayKey();
    stats.days[key] = (stats.days[key] || 0) + 1;
    save(LS_STATS, stats);
    if (workInCycle >= 4) {
      phase = "long";
      workInCycle = 0; // cycle completes after the long break starts
    } else {
      phase = "short";
    }
  } else {
    phase = "work";
  }
  remaining = phaseSeconds(phase);
}

/** Stop the timer and reset the current phase to its full duration. */
function resetPhase() {
  running = false;
  remaining = phaseSeconds(phase);
  render();
}

/** Pause without resetting. */
function pause() {
  if (!running) return;
  running = false;
  remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
  render();
}

function start() {
  ensureAudio(); // user gesture: safe to create/resume AudioContext
  if (remaining <= 0) remaining = phaseSeconds(phase);
  running = true;
  endAt = Date.now() + remaining * 1000;
  render();
}

function toggleStartPause() {
  if (running) pause();
  else start();
}

/** 250ms heartbeat; remaining time is derived from the wall clock to avoid drift. */
function tick() {
  if (!running) return;
  remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
  if (remaining <= 0) {
    beep();
    advancePhase();
    endAt = Date.now() + remaining * 1000; // next phase starts immediately
  }
  render();
}

setInterval(tick, 250);

/* ---------------- Settings ---------------- */

function clampMinutes(input, fallback) {
  const v = Math.round(Number(input.value));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(180, Math.max(1, v));
}

function onSettingsChange() {
  settings.work = clampMinutes(workInput, DEFAULTS.work);
  settings.short = clampMinutes(shortInput, DEFAULTS.short);
  settings.long = clampMinutes(longInput, DEFAULTS.long);
  workInput.value = settings.work;
  shortInput.value = settings.short;
  longInput.value = settings.long;
  save(LS_SETTINGS, settings);
  resetPhase(); // changing durations resets the current phase
}

[workInput, shortInput, longInput].forEach((el) => {
  el.addEventListener("change", onSettingsChange);
});

/* ---------------- Tasks ---------------- */

function renderTasks() {
  taskList.innerHTML = "";
  const visible = tasks.slice().sort((a, b) => Number(a.done) - Number(b.done) || a.created - b.created);
  for (const task of visible) {
    const li = document.createElement("li");
    li.className = "task" + (task.done ? " done" : "");

    const check = document.createElement("button");
    check.className = "check";
    check.type = "button";
    check.setAttribute("aria-label", task.done ? `Mark "${task.text}" as not done` : `Mark "${task.text}" as done`);
    check.addEventListener("click", () => toggleTask(task.id));

    const span = document.createElement("span");
    span.className = "text";
    span.textContent = task.text;

    const del = document.createElement("button");
    del.className = "delete";
    del.type = "button";
    del.innerHTML = "&times;";
    del.setAttribute("aria-label", `Delete "${task.text}"`);
    del.addEventListener("click", () => deleteTask(task.id));

    li.append(check, span, del);
    taskList.appendChild(li);
  }
  taskEmpty.classList.toggle("hidden", tasks.length > 0);
}

function addTask(text) {
  const clean = text.trim();
  if (!clean) return;
  tasks.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), text: clean.slice(0, 200), done: false, created: Date.now() });
  save(LS_TASKS, tasks);
  renderTasks();
}

function toggleTask(id) {
  const t = tasks.find((x) => x.id === id);
  if (!t) return;
  t.done = !t.done;
  save(LS_TASKS, tasks);
  renderTasks();
}

function deleteTask(id) {
  tasks = tasks.filter((x) => x.id !== id);
  save(LS_TASKS, tasks);
  renderTasks();
}

taskForm.addEventListener("submit", (e) => {
  e.preventDefault();
  addTask(taskInput.value);
  taskInput.value = "";
  taskInput.focus();
});

/* ---------------- Render ---------------- */

function renderDots() {
  cycleDots.innerHTML = "";
  const done = workInCycle; // 0..4 completed work sessions this cycle
  for (let i = 0; i < 4; i++) {
    const d = document.createElement("span");
    d.className = "dot" + (i < done ? " done" : "");
    cycleDots.appendChild(d);
  }
  cycleDots.setAttribute("aria-label", `Cycle progress: ${done} of 4 work sessions done`);
}

function render() {
  const secs = running ? Math.max(0, Math.round((endAt - Date.now()) / 1000)) : remaining;
  timeDisplay.textContent = fmt(secs);
  phaseLabel.textContent = PHASE_LABELS[phase];
  renderDots();
  startPauseBtn.textContent = running ? "Pause" : "Start";
  startPauseBtn.setAttribute("aria-label", running ? "Pause the timer" : "Start the timer");

  const todayCount = stats.days[todayKey()] || 0;
  statsLine.textContent = `Today: ${todayCount} · Total: ${stats.total}`;

  // Tab title always shows remaining time + phase.
  document.title = `${fmt(secs)} · ${PHASE_LABELS[phase]} — Pomodoro Desk`;
}

/* ---------------- Init ---------------- */

workInput.value = settings.work;
shortInput.value = settings.short;
longInput.value = settings.long;
remaining = phaseSeconds("work");

startPauseBtn.addEventListener("click", toggleStartPause);
resetBtn.addEventListener("click", resetPhase);

// Also unlock audio on the very first interaction anywhere (harmless no-op later).
document.addEventListener("pointerdown", ensureAudio, { once: true });

renderTasks();
render();
