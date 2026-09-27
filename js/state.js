/* ============================================================
   state.js — S, history, undo/redo, storage, selection
   Зависит от: utils
   ============================================================ */

window.App = window.App || {};

window.App.state = (() => {
"use strict";

const U = window.App.utils;
const {
  KEY, HISTORY_LIMIT, INPUT_DEBOUNCE, SAVE_DEBOUNCE,
  $, $$, normalizeState, toast
} = U;

/* ---------- State ---------- */

const S = {
  title: "",
  blocks: [],
  theme: "paper",
  fonts: {},
  selectedId: null,
  selectedRange: null   // {startId, endId} | null
};

const history = [];
const future  = [];

let active       = null;
let slashBlockId = null;
let draggedId    = null;

/* ---------- Setters ---------- */

function setActive(v){ active = v; }
function setSlashBlockId(v){ slashBlockId = v; }
function setDraggedId(v){ draggedId = v; }

/* ---------- Timers ---------- */

let saveTimer    = null;
let historyTimer = null;

/* ---------- Snapshot / history ---------- */

function snapshot(){ return JSON.stringify(S); }

function pushHistory(before){
  const now = snapshot();
  if (before === now) return;
  history.push(before);
  if (history.length > HISTORY_LIMIT) history.shift();
  future.length = 0;
  save();
}

function commit(before){ pushHistory(before); }

function commitDebounced(before){
  clearTimeout(historyTimer);
  historyTimer = setTimeout(() => pushHistory(before), INPUT_DEBOUNCE);
}

/* ---------- Storage ---------- */

function saveNow(){
  try {
    localStorage.setItem(KEY, JSON.stringify(S));
    $("#status").textContent = "Сохранено";
  } catch (e){
    console.error("save error:", e);
    if (e && /quota/i.test(e.name + " " + e.message)){
      $("#status").textContent = "Переполнено";
      toast("Хранилище переполнено. Удалите большие изображения.");
    } else {
      $("#status").textContent = "Ошибка сохранения";
    }
  }
}

function save(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE);
}

function load(){
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(KEY) || "null");
  } catch (e){
    console.warn("load error:", e);
  }

  const clean = normalizeState(raw);
  S.title  = clean.title;
  S.theme  = clean.theme;
  S.fonts  = clean.fonts;
  S.blocks = clean.blocks;
  S.selectedId = null;
  S.selectedRange = null;
}

/* ---------- Undo / Redo ---------- */

function undo(){
  if (!history.length) return;
  future.push(snapshot());
  const restored = normalizeState(JSON.parse(history.pop()));
  S.title  = restored.title;
  S.theme  = restored.theme;
  S.fonts  = restored.fonts;
  S.blocks = restored.blocks;
  if (!S.blocks.find(b => b.id === S.selectedId)) S.selectedId = null;
  S.selectedRange = null;

  window.App.render.render();
  window.App.render.applySavedFonts();
}

function redo(){
  if (!future.length) return;
  history.push(snapshot());
  const restored = normalizeState(JSON.parse(future.pop()));
  S.title  = restored.title;
  S.theme  = restored.theme;
  S.fonts  = restored.fonts;
  S.blocks = restored.blocks;
  if (!S.blocks.find(b => b.id === S.selectedId)) S.selectedId = null;
  S.selectedRange = null;

  window.App.render.render();
  window.App.render.applySavedFonts();
}

/* ---------- Selection ---------- */

function setSelectedBlock(id){
  if (S.selectedId === id) return;
  S.selectedId = id;

  $$("#editor .block.selected").forEach(w =>
    w.classList.remove("selected"));

  if (id){
    const w = $(`[data-id="${id}"]`);
    if (w) w.classList.add("selected");
  }
  /* клик по блоку сбрасывает диапазон — это разные модели */
  if (!id) S.selectedRange = null;
}

/* Диапазон блоков, задетых текстовым выделением. */
function setSelectedRange(startId, endId){
  if (!startId || !endId){
    S.selectedRange = null;
  } else {
    S.selectedRange = { startId, endId };
  }
  syncInSelectionClass();
}

function clearSelectedRange(){
  if (!S.selectedRange) return;
  S.selectedRange = null;
  syncInSelectionClass();
}

/* Навешивает .in-selection на блоки, входящие в диапазон. */
function syncInSelectionClass(){
  const all = $$("#editor .block");
  if (!S.selectedRange){
    all.forEach(w => w.classList.remove("in-selection"));
    return;
  }
  const ids = new Set(blockIdsInRange(S.selectedRange));
  all.forEach(w => {
    w.classList.toggle("in-selection", ids.has(w.dataset.id));
  });
}

/* Возвращает массив id блоков между startId и endId включительно
   (в порядке их нахождения в St().blocks). */
function blockIdsInRange(range){
  if (!range) return [];
  const blocks = S.blocks;
  const i = blocks.findIndex(b => b.id === range.startId);
  const j = blocks.findIndex(b => b.id === range.endId);
  if (i < 0 || j < 0) return [];
  const [a, b] = i <= j ? [i, j] : [j, i];
  return blocks.slice(a, b + 1).map(x => x.id);
}

function clearSelection(){
  setSelectedBlock(null);
  clearSelectedRange();
}

/* ---------- Public API ---------- */

return {
  S, history, future,

  get active(){ return active; },
  get slashBlockId(){ return slashBlockId; },
  get draggedId(){ return draggedId; },

  setActive, setSlashBlockId, setDraggedId,

  snapshot, pushHistory, commit, commitDebounced,
  save, saveNow, load,
  undo, redo,
  setSelectedBlock, clearSelection,
  setSelectedRange, clearSelectedRange,
  blockIdsInRange
};

})();