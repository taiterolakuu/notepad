/* ============================================================
   wikilink-popover.js — автодополнение [[Имя]] у каретки

   [Пакет 4]  blockId сохраняется до close(); rebuildBacklinks
              вызывается с activeDocId; для LINE_TYPES пишем
              в block.lines[idx].text; rAF для позиции.
   [Пакет 5]  escape имён; name обрезается.
   [Пакет 9]  # в запросе — часть до первого #.
   [Пакет 12] защита от двойного Enter.

   Зависит от: utils, state, render
   ============================================================ */

window.App = window.App || {};

window.App.wikilinkPopover = (() => {
"use strict";

const U = window.App.utils;
const { $, el, escape, toast, LINE_TYPES } = U;

const St = () => window.App.state.S;
const getActiveDoc = () => window.App.state.getActiveDoc();

/* Состояние */
let popoverEl = null;
let isOpen    = false;
let query     = "";
let context   = null;   /* { blockId, body, lineIndex } */
let items     = [];
let selected  = 0;
let rafId     = null;
let _committing = false;

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
  _committing = false;

  host.style.display = "block";
  renderList();
  schedulePosition();
}

function close(){
  const host = ensureEl();
  if (host) host.style.display = "none";
  isOpen = false;
  query = "";
  context = null;
  items = [];
  selected = 0;
  _committing = false;
  if (rafId){
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/* ---------- Публичный вход из render.js на oninput ---------- */

function onInput(block, body){
  if (!body || !block) return;

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
      schedulePosition();
    }
    return;
  }

  const q = extractQuery(body);
  if (q === null) return;

  /* Запоминаем lineIndex, если body — это .line */
  const lineIndex = body.dataset && body.dataset.lineIndex != null
    ? parseInt(body.dataset.lineIndex, 10)
    : -1;

  open({ blockId: block.id, body, lineIndex }, q);
}

/* Возвращает текст между [[ и кареткой, либо null */
function extractQuery(body){
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return null;

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  if (!body.contains(node)) return null;

  const textBefore = node.textContent.slice(0, range.startOffset);
  const lastOpen = textBefore.lastIndexOf("[[");
  if (lastOpen === -1) return null;

  const after = textBefore.slice(lastOpen + 2);
  if (after.includes("]]") || after.includes("\n")) return null;
  if (after.length > 60) return null;

  return after;
}

/* [Пакет 9] Разбор запроса: часть до # — имя, остальное — анкор */
function _splitQuery(q){
  const raw = String(q || "").trim();
  const hashIdx = raw.indexOf("#");
  if (hashIdx < 0) return { name: raw, anchor: "" };
  return {
    name:   raw.slice(0, hashIdx).trim(),
    anchor: raw.slice(hashIdx + 1).trim()
  };
}

/* ---------- Построение списка ---------- */

function buildItems(q){
  const docs = Object.values(St().documents).filter(d => !d.trashed);
  const { name } = _splitQuery(q);
  const lower = name.toLowerCase();
  const arr = [];

  const exact = docs.find(d => (d.title || "").trim().toLowerCase() === lower);
  if (name && !exact){
    arr.push({ kind: "create", name });
  }

  const filtered = lower
    ? docs.filter(d => (d.title || "").toLowerCase().includes(lower))
    : docs;

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

  const { anchor } = _splitQuery(query);
  const anchorHTML = anchor ? `<span class="wl-anchor">#${escape(anchor)}</span>` : "";

  let html = "";
  items.forEach((it, i) => {
    const selCls = i === selected ? " sel" : "";
    if (it.kind === "create"){
      const safeName = escape(it.name);
      html += `<div class="wlp-item wlp-create${selCls}" data-idx="${i}">
        <span class="wlp-icon">＋</span>
        <span class="wlp-title">Создать «${safeName}»${anchorHTML}</span>
      </div>`;
    } else {
      const d = it.doc;
      const icon = d.icon ? escape(d.icon) : "📄";
      const title = escape(d.title || "Без названия");
      html += `<div class="wlp-item${selCls}" data-idx="${i}">
        <span class="wlp-icon">${icon}</span>
        <span class="wlp-title">${title}${anchorHTML}</span>
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

/* ---------- Позиционирование (rAF) ---------- */

function schedulePosition(){
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    position();
  });
}

function position(){
  const host = ensureEl();
  if (!host) return;

  const sel = getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);

  let rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)){
    const body = context?.body;
    if (body) rect = body.getBoundingClientRect();
  }
  if (!rect) return;

  const w = 260;
  const margin = 8;
  let left = rect.left;
  let top  = rect.bottom + 6;

  if (left + w + margin > window.innerWidth){
    left = window.innerWidth - w - margin;
  }
  if (left < margin) left = margin;

  const h = host.offsetHeight || 200;
  if (top + h + margin > window.innerHeight){
    top = rect.top - h - 6;
    if (top < margin) top = margin;
  }

  host.style.left = left + "px";
  host.style.top  = top + "px";
}

/* ---------- Клавиатура ---------- */

function handleKey(e, block, body){
  if (!isOpen) return false;
  if (!block) return false;
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
    schedulePosition();
    return true;
  }

  if (e.key === "ArrowUp"){
    e.preventDefault();
    if (!items.length) return true;
    selected = (selected - 1 + items.length) % items.length;
    renderList();
    schedulePosition();
    return true;
  }

  if (e.key === "Enter" || e.key === "Tab"){
    e.preventDefault();
    commit();
    return true;
  }

  return false;
}

/* ============================================================
   [Пакет 4] commit — корректная работа с LINE_TYPES,
   blockId сохраняется до close, rebuildBacklinks(activeDocId)
   ============================================================ */

function commit(){
  if (_committing) return;
  _committing = true;

  const body = context?.body;
  const blockId = context?.blockId;
  const lineIndex = context?.lineIndex;
  if (!body || !blockId){ close(); return; }

  const item = items[selected];
  if (!item){ close(); return; }

  /* Определяем имя и анкор */
  const { anchor } = _splitQuery(query);

  let name;
  if (item.kind === "create"){
    name = item.name;
  } else {
    name = item.doc.title || "Без названия";
  }

  /* Обрезаем и очищаем name от [] */
  name = String(name).replace(/[\[\]]/g, "").trim();
  if (!name){ close(); return; }

  /* Заменяем [[XXX на [[Имя]] (с анкором) */
  replaceQueryWith(body, name, anchor);

  /* Сохраняем в правильном месте */
  const block = St().blocks.find(b => b.id === blockId);
  const activeDocId = St().activeDocId;

  if (block){
    if (LINE_TYPES.has(block.type) && Array.isArray(block.lines) && lineIndex >= 0){
      const ln = block.lines[lineIndex];
      if (ln){
        ln.text = window.App.render.toSourceHTML(body.innerHTML);
        block.content = block.lines.map(l => l.text).join("<br>");
      }
    } else {
      block.content = window.App.render.toSourceHTML(body.innerHTML);
    }
    window.App.state.save();
    window.App.state.commitDebounced(window.App.state.snapshot());
  }

  /* Создаём новый документ, если это «create» */
  if (item.kind === "create"){
    window.App.state.createDocument({ title: name }).then(doc => {
      /* Пересобираем backlinks активного документа, откуда шла ссылка */
      try {
        if (activeDocId) window.App.state.rebuildBacklinks(activeDocId);
      } catch(e){}

      /* Обновляем data-wikilink-id в DOM */
      const links = body.querySelectorAll("a.wikilink");
      links.forEach(a => {
        if (a.getAttribute("data-wikilink") === name){
          a.setAttribute("data-wikilink-id", doc.id);
        }
      });

      /* Сохраняем ещё раз — теперь с обновлённым id */
      const blk2 = St().blocks.find(b => b.id === blockId);
      if (blk2){
        if (LINE_TYPES.has(blk2.type) && Array.isArray(blk2.lines) && lineIndex >= 0){
          const ln2 = blk2.lines[lineIndex];
          if (ln2) ln2.text = window.App.render.toSourceHTML(body.innerHTML);
        } else {
          blk2.content = window.App.render.toSourceHTML(body.innerHTML);
        }
      }
      window.App.state.save();

      window.App.sidebar?.render();
      window.App.tabs?.render();
    }).catch(() => {});
  }

  close();
}

/* [Пакет 9] Заменяет [[XXX на [[Имя#анкор]] или [[Имя]] */
function replaceQueryWith(body, name, anchor){
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
  const tail = before.slice(lastOpen);
  if (!tail.startsWith("[[")) return;
  if (tail.includes("]]")) return;

  /* [Пакет 4] Если после каретки уже стоит ]], не удваиваем */
  let tailAfter = after;
  if (tailAfter.startsWith("]]")){
    tailAfter = tailAfter.slice(2);
  }

  const anchorStr = anchor ? "#" + anchor : "";
  const inserted = "[[" + name + anchorStr + "]]";
  const newText = head + inserted + tailAfter;
  node.textContent = newText;

  const newOffset = head.length + inserted.length;
  const newRange = document.createRange();
  newRange.setStart(node, newOffset);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
}

/* ---------- Bind ---------- */

function bind(){
  document.addEventListener("mousedown", e => {
    if (!isOpen) return;
    if (e.target.closest("#wikilink-popover")) return;
    close();
  }, true);

  document.addEventListener("focusout", e => {
    if (!isOpen) return;
    if (!e.target.isContentEditable) return;
    setTimeout(() => {
      const body = context?.body;
      if (!body) { close(); return; }
      if (!body.contains(document.activeElement) && document.activeElement !== body){
        close();
      }
    }, 0);
  });

  window.addEventListener("resize", () => {
    if (isOpen) schedulePosition();
  });
  document.addEventListener("scroll", () => {
    if (isOpen) schedulePosition();
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