/* ============================================================
   wikilink-popover.js — автодополнение [[Имя]] у каретки
   Зависит от: utils, state, render
   ============================================================ */

window.App = window.App || {};

window.App.wikilinkPopover = (() => {
"use strict";

const U = window.App.utils;
const { $, el, escape, toast } = U;

const St = () => window.App.state.S;

/* Состояние */
let popoverEl = null;
let isOpen    = false;
let query     = "";               /* что набрано после [[ */
let context   = null;             /* { blockId, body } */
let items     = [];               /* текущий список опций */
let selected  = 0;
let rafId     = null;

/* ---------- Открыть/закрыть ---------- */

function ensureEl(){
  if (popoverEl) return popoverEl;
  popoverEl = document.getElementById("wikilink-popover");
  return popoverEl;
}

function open(ctx, initialQuery){
  const host = ensureEl();
  if (!host) return;

  context = ctx;
  query   = initialQuery || "";
  isOpen  = true;
  selected = 0;

  host.style.display = "block";
  renderList();
  position();
}

function close(){
  const host = ensureEl();
  if (host) host.style.display = "none";
  isOpen = false;
  query = "";
  context = null;
  items = [];
  selected = 0;
}

/* ---------- Публичный вход из render.js на oninput ---------- */

/* Вызывается после каждой вставки в body. Проверяет:
   - стоит ли каретка сразу после [[ или внутри [[XXX без ]]
   - если да — открывает поповер с текстом XXX в качестве запроса */
function onInput(block, body){
  if (!body || !block) return;

  /* Позиционируем открытый поповер */
  if (isOpen){
    const q = extractQuery(body);
    if (q === null){
      close();
    } else {
      if (q !== query){
        query = q;
        selected = 0;
        renderList();
      }
      position();
    }
    return;
  }

  /* Проверяем — не надо ли открыть */
  const q = extractQuery(body);
  if (q === null) return;

  /* Открываем, только если реально вводится [[ */
  open({ blockId: block.id, body }, q);
}

/* Возвращает текст между [[ и кареткой, либо null, если каретка не внутри [[... */
function extractQuery(body){
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return null;

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  if (!body.contains(node)) return null;

  /* Текст от начала текстового узла до каретки */
  const textBefore = node.textContent.slice(0, range.startOffset);
  const lastOpen = textBefore.lastIndexOf("[[");
  if (lastOpen === -1) return null;

  const after = textBefore.slice(lastOpen + 2);
  /* Внутри [[ не должно быть ]] или переноса строки */
  if (after.includes("]]") || after.includes("\n")) return null;
  /* И не длиннее 60 символов — иначе явно не имя */
  if (after.length > 60) return null;

  return after;
}

/* ---------- Построение списка ---------- */

function buildItems(q){
  const docs = Object.values(St().documents)
    .filter(d => !d.trashed);

  const lower = q.toLowerCase().trim();
  const arr = [];

  /* Первая строка — «создать», если нет точного совпадения */
  const exact = docs.find(d => (d.title || "").trim().toLowerCase() === lower);
  if (lower && !exact){
    arr.push({ kind: "create", name: q.trim() });
  }

  /* Существующие документы */
  const filtered = lower
    ? docs.filter(d => (d.title || "").toLowerCase().includes(lower))
    : docs;

  /* Сортировка: название начинается с запроса — выше */
  filtered.sort((a, b) => {
    const at = (a.title || "").toLowerCase();
    const bt = (b.title || "").toLowerCase();
    const aStarts = lower && at.startsWith(lower) ? 0 : 1;
    const bStarts = lower && bt.startsWith(lower) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return at.localeCompare(bt);
  });

  filtered.slice(0, 12).forEach(d => arr.push({ kind: "doc", doc: d }));
  return arr;
}

function renderList(){
  const host = ensureEl();
  if (!host) return;

  items = buildItems(query);
  if (!items.length){
    host.innerHTML = `<div class="wlp-empty">Нет документов</div>`;
    return;
  }

  if (selected >= items.length) selected = items.length - 1;
  if (selected < 0) selected = 0;

  let html = "";

  items.forEach((it, i) => {
    const selCls = i === selected ? " sel" : "";

    if (it.kind === "create"){
      html += `<div class="wlp-item wlp-create${selCls}" data-idx="${i}">
        <span class="wlp-icon">＋</span>
        <span class="wlp-title">Создать «${escape(it.name)}»</span>
      </div>`;
    } else {
      const d = it.doc;
      const icon = d.icon ? escape(d.icon) : "📄";
      const title = escape(d.title || "Без названия");
      html += `<div class="wlp-item${selCls}" data-idx="${i}">
        <span class="wlp-icon">${icon}</span>
        <span class="wlp-title">${title}</span>
      </div>`;
    }
  });

  host.innerHTML = html;

  host.querySelectorAll(".wlp-item").forEach(elItem => {
    elItem.addEventListener("mousedown", e => {
      e.preventDefault();
      e.stopPropagation();
      selected = parseInt(elItem.dataset.idx, 10);
      commit();
    });
  });
}

/* ---------- Позиционирование ---------- */

function position(){
  const host = ensureEl();
  if (!host) return;

  const sel = getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);

  let rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)){
    /* Фолбэк — по body */
    const body = context?.body;
    if (body) rect = body.getBoundingClientRect();
  }
  if (!rect) return;

  const w = 260;
  const margin = 8;
  let left = rect.left;
  let top  = rect.bottom + 6;

  /* Не вылезать за экран */
  if (left + w + margin > window.innerWidth){
    left = window.innerWidth - w - margin;
  }
  if (left < margin) left = margin;

  const h = host.offsetHeight || 200;
  if (top + h + margin > window.innerHeight){
    /* Показать над кареткой */
    top = rect.top - h - 6;
    if (top < margin) top = margin;
  }

  host.style.left = left + "px";
  host.style.top  = top + "px";
}

/* ---------- Клавиатура ---------- */

/* Возвращает true, если клавиша обработана поповером */
function handleKey(e, block, body){
  if (!isOpen) return false;
  if (context?.blockId !== block.id) return false;

  if (e.key === "Escape"){
    e.preventDefault();
    close();
    return true;
  }

  if (e.key === "ArrowDown"){
    e.preventDefault();
    if (!items.length) return true;
    selected = (selected + 1) % items.length;
    renderList();
    position();
    return true;
  }

  if (e.key === "ArrowUp"){
    e.preventDefault();
    if (!items.length) return true;
    selected = (selected - 1 + items.length) % items.length;
    renderList();
    position();
    return true;
  }

  if (e.key === "Enter" || e.key === "Tab"){
    e.preventDefault();
    commit();
    return true;
  }

  return false;
}

/* ---------- Вставка выбранного ---------- */

function commit(){
  const body = context?.body;
  if (!body) { close(); return; }

  const item = items[selected];
  if (!item) { close(); return; }

  /* Определяем имя и, если надо, создаём документ */
  let name;
  let newDocId = null;

  if (item.kind === "create"){
    name = item.name;
  } else {
    name = item.doc.title || "Без названия";
  }

  /* Заменяем [[XXX на [[Имя]] */
  replaceQueryWith(body, name);

  /* Триггерим сохранение */
  const block = St().blocks.find(b => b.id === context.blockId);
  if (block){
    block.content = window.App.render.toSourceHTML(body.innerHTML);
    window.App.state.save();
    window.App.state.commitDebounced(window.App.state.snapshot());
  }

  /* Если создаём новый — создаём документ с таким именем */
  if (item.kind === "create"){
    window.App.state.createDocument({ title: name }).then(doc => {
      window.App.state.rebuildBacklinks(context.blockId ? context.blockId : doc.id);
      /* обновляем ссылку — добавляем data-wikilink-id */
      const links = body.querySelectorAll("a.wikilink");
      links.forEach(a => {
        if (a.getAttribute("data-wikilink") === name){
          a.setAttribute("data-wikilink-id", doc.id);
        }
      });
      window.App.sidebar?.render();
      window.App.tabs?.render();
    });
  }

  close();
}

/* Находит в body [[XXX без ]] и заменяет на [[Имя]] */
function replaceQueryWith(body, name){
  const sel = getSelection();
  if (!sel.rangeCount) return;

  const range = sel.getRangeAt(0);
  if (!range.collapsed) return;

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;

  const offset = range.startOffset;
  const before = node.textContent.slice(0, offset);
  const after  = node.textContent.slice(offset);

  const lastOpen = before.lastIndexOf("[[");
  if (lastOpen === -1) return;

  const head = before.slice(0, lastOpen);
  const tail = before.slice(lastOpen); /* "[[XXX" */

  /* Проверим, что tail начинается с [[ и не закрыт */
  if (!tail.startsWith("[[")) return;

  /* В tail не должно быть ]] */
  if (tail.includes("]]")) return;

  const newText = head + "[[" + name + "]]" + after;
  node.textContent = newText;

  /* Ставим каретку после закрывающих ]] */
  const newOffset = head.length + name.length + 4;
  const newRange = document.createRange();
  newRange.setStart(node, newOffset);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

/* ---------- Bind ---------- */

function bind(){
  /* Закрытие поповера при клике вне */
  document.addEventListener("mousedown", e => {
    if (!isOpen) return;
    if (e.target.closest("#wikilink-popover")) return;
    close();
  }, true);

  /* Закрытие при потере фокуса из блока */
  document.addEventListener("focusout", e => {
    if (!isOpen) return;
    if (!e.target.isContentEditable) return;
    /* Проверим, что фокус ушёл реально из активного body */
    setTimeout(() => {
      const body = context?.body;
      if (!body) { close(); return; }
      if (!body.contains(document.activeElement) && document.activeElement !== body){
        close();
      }
    }, 0);
  });

  /* Репозиционирование при скролле/ресайзе */
  window.addEventListener("resize", () => {
    if (isOpen) position();
  });
  document.addEventListener("scroll", () => {
    if (isOpen) position();
  }, true);
}

return {
  bind,
  open,
  close,
  onInput,
  handleKey,
  isOpen: () => isOpen
};
})();