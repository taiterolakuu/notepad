/* ============================================================
   render/main.js — главный render(), add(), focusActive(), fonts

   [Пакет 12] scrollIntoView с prefers-reduced-motion.
   [Пакет 13] backlinks.render — через rAF; точечные проверки
              (быстрая проверка на пустой документ).
   [Пакет 15] focusActive — уважает reduced-motion.

   Зависит от: render/_shared, render/block, render/line
   ============================================================ */

window.App = window.App || {};

window.App.renderMain = (() => {
"use strict";

const S = window.App.renderShared;
const {
  $, el, LINE_TYPES, newBlock, syncBlockLines,
  St, getActiveDoc, getActiveId,
  setActive, setSelectedBlock, setDraggedId, getDraggedId,
  snapshot, commit, save
} = S;

const BlockMod = () => window.App.renderBlock;

/* [Пакет 12, 15] reduced motion */
function _prefersReducedMotion(){
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch(e){
    return false;
  }
}

/* [Пакет 13] Запланированный backlinks.render через rAF */
let _blRafId = null;
function _scheduleBacklinksRender(){
  if (_blRafId) return;
  _blRafId = requestAnimationFrame(() => {
    _blRafId = null;
    try { window.App.backlinks?.render(); } catch(e){}
  });
}

/* ============================================================
   Главный render
   ============================================================ */

function render(){
  const doc = getActiveDoc();

  const titleEl = $("#title");
  if (titleEl){
    const displayTitle = doc?.title || "";
    const isEditing = document.activeElement === titleEl;
    if (!isEditing && titleEl.textContent !== displayTitle){
      titleEl.textContent = displayTitle;
    }
    titleEl.dir = "auto";
    if (doc?.color) titleEl.dataset.color = doc.color;
    else delete titleEl.dataset.color;
    if (doc?.icon) titleEl.dataset.icon = doc.icon;
    else delete titleEl.dataset.icon;
  }

  const editor = $("#editor");
  editor.replaceChildren(...(doc?.blocks || []).map(BlockMod().renderBlock));

  document.documentElement.dataset.theme =
    St().theme === "paper" ? "" : St().theme;

  const blockEls = [...editor.querySelectorAll(".block")];
  blockEls.forEach((w, i) => {
    if (i > 0){
      const gap = document.createElement("div");
      gap.className = "block-gap";
      gap.dataset.beforeId = w.dataset.id;
      gap.innerHTML = `<button class="gap-plus" type="button" title="Вставить блок здесь">+</button>`;
      editor.insertBefore(gap, w);
    }
  });

  const last = blockEls[blockEls.length - 1];
  const lastId = last?.dataset.id || null;
  const addZone = document.createElement("div");
  addZone.className = "add-block-zone";
  addZone.dataset.afterId = lastId || "";
  addZone.innerHTML = `
    <span class="ab-plus">
      <svg class="lucide" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <path d="M8 12h8"/>
        <path d="M12 8v8"/>
      </svg>
    </span>
    <span>Добавить блок</span>`;
  editor.append(addZone);

  editor.querySelectorAll(".block-gap").forEach(gap => {
    const plus = gap.querySelector(".gap-plus");
    if (!plus) return;
    plus.addEventListener("mousedown", e => e.preventDefault());
    plus.addEventListener("click", e => {
      e.stopPropagation();
      const beforeId = gap.dataset.beforeId;
      const blocks = window.App.state.getBlocks();
      const idx = blocks.findIndex(b => b.id === beforeId);
      add("text", idx >= 0 ? idx : blocks.length);
    });
    gap.addEventListener("mouseenter", () => gap.classList.add("hot"));
    gap.addEventListener("mouseleave", () => gap.classList.remove("hot"));
  });

  addZone.addEventListener("click", () => {
    add("text");
  });

  blockEls.forEach(w => {
    const handle = w.querySelector(".handle");

    handle?.addEventListener("mousedown", () => {
      setDraggedId(w.dataset.id);
      w.draggable = true;
    });

    w.addEventListener("dragstart", e => {
      const startedFromHandle =
        e.target === handle || handle?.contains(e.target);
      if (!startedFromHandle){
        e.preventDefault();
        w.draggable = false;
        setDraggedId(null);
        return;
      }
      setDraggedId(w.dataset.id);
      e.dataTransfer.setData("text/plain", w.dataset.id);
      e.dataTransfer.effectAllowed = "move";
      w.classList.add("dragging");
    });

    w.addEventListener("dragend", () => {
      w.draggable = false;
      w.classList.remove("dragging");
      setDraggedId(null);
    });

    w.addEventListener("dragover", e => {
      if (getDraggedId()) e.preventDefault();
    });

    w.addEventListener("drop", e => {
      e.preventDefault();
      const fromId = getDraggedId() || e.dataTransfer.getData("text/plain");
      const toId = w.dataset.id;
      setDraggedId(null);
      w.draggable = false;
      w.classList.remove("dragging");

      const blocks = window.App.state.getBlocks();
      const from = blocks.findIndex(x => x.id === fromId);
      const to   = blocks.findIndex(x => x.id === toId);
      if (from < 0 || to < 0 || from === to) return;

      const old = snapshot();
      const [x] = blocks.splice(from, 1);
      blocks.splice(to, 0, x);
      commit(old);
      render();
      setSelectedBlock(x.id);
    });

    w.addEventListener("mouseup", () => {
      setTimeout(() => {
        if (!w.classList.contains("dragging")){
          w.draggable = false;
          setDraggedId(null);
        }
      }, 0);
    });
  });

  BlockMod().bindColumnResizer();

  /* [Пакет 13] backlinks — через rAF, не блокирует рендер */
  _scheduleBacklinksRender();
}

/* ============================================================
   add / focusActive
   ============================================================ */

function add(type = "text", at){
  const blocks = window.App.state.getBlocks();
  const idx = (typeof at === "number") ? at : blocks.length;
  const b = newBlock(type);
  blocks.splice(idx, 0, b);
  setActive(b.id);
  render();
  setSelectedBlock(b.id);
  setTimeout(() => {
    focusActive();
    const w = $(`[data-id="${b.id}"]`);
    if (w){
      /* [Пакет 12] reduced motion */
      try {
        w.scrollIntoView({
          block: "nearest",
          behavior: _prefersReducedMotion() ? "auto" : "smooth"
        });
      } catch(_){
        w.scrollIntoView();
      }
    }
  }, 0);
  save();
}

function focusActive(){
  const id = getActiveId();
  const w = $(`[data-id="${id}"]`);
  if (!w) return;

  const firstLine = w.querySelector(".line");
  if (firstLine){ firstLine.focus(); return; }

  w.querySelector("[contenteditable]")?.focus();
}

/* ============================================================
   applySavedFonts
   ============================================================ */

function applySavedFonts(){
  const varMap = {
    body:  "--font-current",
    head:  "--font-heading-current",
    serif: "--font-serif",
    mono:  "--font-mono-current"
  };
  const fallbacks = {
    body:  "system-ui, sans-serif",
    head:  "system-ui, sans-serif",
    serif: "Georgia, serif",
    mono:  "ui-monospace, Consolas, monospace"
  };
  const fonts = St().fonts || {};
  for (const role of Object.keys(fonts)){
    const name = fonts[role];
    if (varMap[role] && name){
      document.documentElement.style.setProperty(
        varMap[role], `'${name}', ${fallbacks[role]}`
      );
    }
  }
}

return {
  render, add, focusActive, applySavedFonts
};
})();