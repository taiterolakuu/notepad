/* ============================================================
   menus/slash.js — слэш-меню "/тип"

   [Пакет 9]  полноценная реализация: openSlash вызывается из
              render/* при вводе "/" в начале строки; конвертация
              типа с сохранением содержимого.

   Зависит от: menus/_shared
   ============================================================ */

window.App = window.App || {};

window.App.menusSlash = (() => {
"use strict";

const S = window.App.menusShared;
const {
  $, $$, types, toast, escape,
  LINE_TYPES, newLineFn,
  St, setSlashBlockId, getSlashBlockId,
  setActive, setSelectedBlock,
  snapshot, commit,
  render, focusActive,
  U
} = S;

/* Текущий контекст: { blockId, lineEl|null } */
let _ctx = null;
let _selectedIndex = 0;

/* ---------- Открытие ---------- */

function openSlash(body, blockId){
  if (!body || !blockId) return;

  S.slashBody = body;
  setSlashBlockId(blockId);
  _ctx = { blockId, body };
  _selectedIndex = 0;

  const r = body.getBoundingClientRect();
  const m = $("#slash");
  if (!m) return;

  m.style.left = Math.min(r.left, window.innerWidth - 315) + "px";
  m.style.top  = (r.bottom + 4) + "px";
  m.style.display = "block";

  const inp = $("#slashinput");
  if (inp){
    inp.value = "";
    inp.focus();
  }

  slashRender();
}

function closeSlash(){
  const m = $("#slash");
  if (m) m.style.display = "none";
  setSlashBlockId(null);
  S.slashBody = null;
  _ctx = null;
  _selectedIndex = 0;
}

function isSlashOpen(){
  const m = $("#slash");
  return !!m && m.style.display === "block";
}

/* ---------- Рендер списка ---------- */

function slashRender(){
  const inp = $("#slashinput");
  if (!inp) return;

  const q = inp.value.toLowerCase().trim();
  const arr = types.filter(x =>
    !q || (x[0] + x[1] + x[2]).toLowerCase().includes(q));

  if (_selectedIndex >= arr.length) _selectedIndex = arr.length - 1;
  if (_selectedIndex < 0) _selectedIndex = 0;

  const res = $("#slashresults");
  if (!res) return;

  if (!arr.length){
    res.innerHTML = `<div class="results-empty">Ничего не найдено</div>`;
    return;
  }

  res.innerHTML = arr.map((x, i) =>
    `<div class="result ${i === _selectedIndex ? "sel" : ""}" data-type="${escape(x[0])}">
        <b>${escape(x[1])}</b><small>${escape(x[2])}</small>
     </div>`
  ).join("");

  $$(".slash .result").forEach((x, i) => {
    x.onmousedown = e => e.preventDefault();
    x.onclick = () => slashChoose(x.dataset.type);
    x.onmouseenter = () => { _selectedIndex = i; };
  });
}

/* ---------- Клавиатура (вызывается из render/line.js и render/block.js) ---------- */

function slashKeydown(e){
  if (!isSlashOpen()) return false;

  const inp = $("#slashinput");
  const res = $("#slashresults");
  const items = res ? $$(".slash .result", res) : [];
  const n = items.length;

  if (e.key === "Escape"){
    e.preventDefault();
    closeSlash();
    return true;
  }

  if (e.key === "ArrowDown"){
    e.preventDefault();
    if (!n) return true;
    _selectedIndex = (_selectedIndex + 1) % n;
    slashRender();
    return true;
  }

  if (e.key === "ArrowUp"){
    e.preventDefault();
    if (!n) return true;
    _selectedIndex = (_selectedIndex - 1 + n) % n;
    slashRender();
    return true;
  }

  if (e.key === "Enter"){
    e.preventDefault();
    if (!n) return true;
    const sel = items[_selectedIndex];
    if (sel) slashChoose(sel.dataset.type);
    return true;
  }

  if (e.key === "Backspace"){
    /* Если поле пустое — закрыть меню, дать браузеру удалить символ */
    if (inp && inp.value === ""){
      closeSlash();
      return false;
    }
  }

  return false;
}

/* ---------- Выбор типа ---------- */

function slashChoose(type){
  const blockId = getSlashBlockId();
  const b = St().blocks.find(x => x.id === blockId);

  if (b){
    const old = snapshot();

    /* [Пакет 9] используем U.convertBlockType для сохранения содержимого */
    const isFreshText = (b.type === "text")
      && (!b.lines || !b.lines.length || b.lines.every(l => !(l.text || "").trim()))
      && !(b.content || "").trim();

    if (isFreshText){
      /* Пустой text-блок — просто меняем тип */
      b.type = type;
      if (type === "columns"){
        b.cols = 2;
        b.content = ["", ""];
        b.widths = [0.5, 0.5];
        b.gap = 14;
        b.valign = "top";
        b.lines = [];
        b.rows = null;
      }
      else if (type === "table"){
        b.rows = [["",""],["",""]];
        b.content = "";
        b.lines = [];
      }
      else if (type === "ul" || type === "ol"){
        b.content = "<li><br></li>";
        b.lines = [];
        if (type === "ul" && !b.marker) b.marker = "disc";
      }
      else if (LINE_TYPES.has(type)){
        b.content = "";
        b.lines = [ newLineFn("") ];
      }
      else {
        b.content = "";
        b.lines = [];
      }
    } else {
      /* Есть содержимое — конвертируем через U.convertBlockType */
      if (typeof U.convertBlockType === "function"){
        U.convertBlockType(b, type);
      } else {
        /* Fallback */
        b.type = type;
      }
    }

    commit(old);
    render();
    setActive(b.id);
    setSelectedBlock(b.id);
    focusActive();
  }

  closeSlash();
}

/* ============================================================
   Автодетект "/" при вводе в contenteditable
   Вызывается из render/line.js и render/block.js в oninput.
   ============================================================ */

/* Проверяет, что:
   - каретка в начале строки/блока
   - первый символ — "/"
   - нет закрывающих разделителей
   Если да — открывает слэш-меню. */
function maybeOpen(body, blockId){
  if (!body || !blockId) return false;

  /* Уже открыт — не трогаем */
  if (isSlashOpen()) return true;

  const sel = getSelection();
  if (!sel.rangeCount) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return false;

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return false;
  if (!body.contains(node)) return false;

  /* Проверяем, что каретка в начале текстового узла или после "/" */
  const offset = range.startOffset;
  const text = node.textContent || "";

  /* Первый символ всей строки должен быть "/" */
  const prefix = text.slice(0, offset);
  if (!prefix.startsWith("/")) return false;

  /* В prefix не должно быть пробелов до "/" и других символов */
  if (prefix.length !== 1 && prefix[0] !== "/") return false;

  /* И это начало всей строки (нет текста до "/") */
  const blockEl = body.closest?.(".block");
  if (blockEl){
    const bodyEl = blockEl.querySelector?.(".body");
    if (bodyEl && bodyEl !== body){
      /* Для LINE_TYPES — проверяем через lineIndex */
      const lineEl = body;
      if (lineEl.classList && lineEl.classList.contains("line")){
        const lineIdx = parseInt(lineEl.dataset.lineIndex, 10);
        const b = St().blocks.find(x => x.id === blockId);
        if (b && Array.isArray(b.lines)){
          /* Всё, что до этой строки, должно быть пустым */
          for (let i = 0; i < lineIdx; i++){
            if ((b.lines[i]?.text || "").trim()) return false;
          }
        }
      }
    }
  }

  openSlash(body, blockId);
  return true;
}

return {
  openSlash,
  closeSlash,
  isSlashOpen,
  slashRender,
  slashChoose,
  slashKeydown,
  maybeOpen
};
})();