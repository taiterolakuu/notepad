/* ============================================================
   render.js — рендер блоков, таблиц, колонок, основной render
   Зависит от: utils, state
   ============================================================ */

window.App = window.App || {};

window.App.render = (() => {
"use strict";

const U = window.App.utils;
const {
  $, $$, el, escape, sanitize,
  block: newBlock
} = U;

const St = () => window.App.state.S;
const setActive = v => window.App.state.setActive(v);
const setSelectedBlock = v => window.App.state.setSelectedBlock(v);
const setSelectedRange = (a, b) => window.App.state.setSelectedRange(a, b);
const clearSelectedRange = () => window.App.state.clearSelectedRange();
const setDraggedId = v => window.App.state.setDraggedId(v);
const getDraggedId = () => window.App.state.draggedId;
const getActiveId = () => window.App.state.active;

const snapshot = () => window.App.state.snapshot();
const commit = b => window.App.state.commit(b);
const commitDebounced = b => window.App.state.commitDebounced(b);
const save = () => window.App.state.save();

function makePasteHandler(target){
  return function(e){
    const html = e.clipboardData?.getData("text/html");
    const text = e.clipboardData?.getData("text/plain");
    if (!html && !text) return;
    e.preventDefault();
    const clean = html ? sanitize(html) : escape(text).replace(/\n/g, "<br>");
    document.execCommand("insertHTML", false, clean);
  };
}

/* ---------- Cleanup ---------- */

/* Убирает пустые <li>, оставшиеся после правок. Если список становится
   пустым полностью — удаляет сам список. */
function cleanupEmptyLis(body){
  [...body.querySelectorAll("ul, ol")].forEach(list => {
    const items = [...list.children].filter(c => c.tagName === "LI");
    items.forEach(li => {
      const isEmpty =
        li.innerText.trim() === "" &&
        !li.querySelector("img, .todo-inline, .indent-tab");
      if (isEmpty && items.length > 1) li.remove();
    });
    if (!list.querySelector("li")) list.remove();
  });
}

/* ---------- Blocks ---------- */

function renderBlock(b){
  const w = el("div", "block");
  w.dataset.id = b.id;
  w.dataset.type = b.type;

  if (b.bg)     w.dataset.bg = b.bg;
  if (b.font)   w.dataset.font = b.font;
  if (b.indent) w.dataset.indent = b.indent;
  if (b.align && b.align !== "left") w.dataset.align = b.align;
  if (b.type === "ul") w.dataset.marker = b.marker || "disc";

  if (St().selectedId === b.id) w.classList.add("selected");

  /* диапазон выделения — визуальная подсветка нескольких блоков */
  if (St().selectedRange){
    const ids = new Set(window.App.state.blockIdsInRange(St().selectedRange));
    if (ids.has(b.id)) w.classList.add("in-selection");
  }

  const h = el("div", "handle");
  h.innerHTML = `
    <svg class="lucide" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <circle cx="9" cy="6" r="1"/>
      <circle cx="9" cy="12" r="1"/>
      <circle cx="9" cy="18" r="1"/>
      <circle cx="15" cy="6" r="1"/>
      <circle cx="15" cy="12" r="1"/>
      <circle cx="15" cy="18" r="1"/>
    </svg>`;
  w.append(h);

  w.addEventListener("mousedown", () => {
    setActive(b.id);
    setSelectedBlock(b.id);
  });

  let body;

  if (b.type === "divider"){
    body = el("div", "body divider");
    w.append(body);
    return w;
  }

  if (b.type === "image"){
    body = el("div", "body");
    body.innerHTML = b.content
      ? `<img class="noteimg" src="${escape(b.content)}"><div class="caption">Изображение</div>`
      : "Перетащите изображение сюда";
    w.append(body);
    return w;
  }

  if (b.type === "table"){
    body = renderTable(b);
    w.append(body);
    return w;
  }

  if (b.type === "columns"){
    body = renderColumns(b);
    w.append(body);
    return w;
  }

  if (b.type === "todo"){
    body = el("div", "body todo " + (b.checked ? "done" : ""));

    const label = el("label", "todo-box");
    const c = document.createElement("input");
    c.type = "checkbox";
    c.checked = !!b.checked;
    c.onchange = () => {
      const old = snapshot();
      b.checked = c.checked;
      commit(old);
      render();
    };
    label.append(c);
    body.append(label);

    const t = el("div", "todo-text");
    t.contentEditable = true;
    t.spellcheck = true;
    t.innerHTML = b.content || "";
    t.style.flex = "1";
    t.style.minWidth = "0";
    t.style.outline = "0";
    t.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };
    t.oninput = () => {
      const wasEmpty = b.content === "";
      b.content = t.innerHTML;
      if (wasEmpty) commit(snapshot());
      else          commitDebounced(snapshot());
      save();
    };
    t.onpaste = makePasteHandler(t);
    body.append(t);

    w.append(body);
    return w;
  }

  const tag =
    b.type === "h1" ? "h1" :
    b.type === "h2" ? "h2" :
    b.type === "h3" ? "h3" :
    b.type === "ul" ? "ul" :
    b.type === "ol" ? "ol" : "div";

  body = el(tag,
    "body " +
    (b.type === "quote" ? "quote" : "") +
    (b.type === "code"  ? " code"  : "")
  );

  body.innerHTML = b.content || "";

  body.contentEditable = true;
  body.spellcheck = b.type !== "code";
  body.dataset.placeholder =
    b.type === "code" ? "Код…" : "Пишите здесь…";

  body.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };
  body.oninput = () => {
    const before = snapshot();
    b.content = body.innerHTML;

    /* список стал пустым — превращаем блок обратно в text */
    if ((b.type === "ul" || b.type === "ol") && listIsEmpty(body)){
      const old = snapshot();
      b.type = "text";
      b.content = "";
      commit(old);
      render();
      setSelectedBlock(b.id);
      setTimeout(focusActive, 0);
      return;
    }

    save();
    if (checkInputRules(b, body)) return;
    commitDebounced(before);
  };
  body.onkeydown = e => keyBlock(e, b, body);
  body.onpaste = makePasteHandler(body);

  w.append(body);
  return w;
}

/* ---------- Table ---------- */

function renderTable(b){
  const box = el("div", "body");
  const t = document.createElement("table");

  const width = b.rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
  b.rows.forEach(r => {
    while (r.length < width) r.push("");
  });

  b.rows.forEach((row, ri) => {
    const tr = document.createElement("tr");
    row.forEach((v, ci) => {
      const c = document.createElement(ri === 0 ? "th" : "td");
      c.contentEditable = true;
      c.innerHTML = v || "";
      c.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };
      c.oninput = () => {
        b.rows[ri][ci] = c.innerHTML;
        save();
        commitDebounced(snapshot());
      };
      c.onkeydown = e => {
        if (e.key === "Tab"){
          e.preventDefault();
          const lastRow = ri === b.rows.length - 1;
          const lastCol = ci === row.length - 1;
          const needNew = lastRow && lastCol;
          if (needNew) b.rows.push(Array(width).fill(""));
          render();
          setTimeout(() => {
            focusCell(b, ri + (needNew ? 1 : 0), needNew ? 0 : ci + 1);
          }, 0);
        } else if (e.key === "Backspace" && c.innerText === ""){
          e.stopPropagation();
        }
      };
      tr.append(c);
    });
    t.append(tr);
  });

  box.append(t);

  const bar = el("div", "tablebar");
  [
    ["＋ строка", () => b.rows.push(Array(width).fill(""))],
    ["＋ колонка", () => b.rows.forEach(r => r.push(""))],
    ["− строка", () => { if (b.rows.length > 1) b.rows.pop(); }],
    ["− колонка", () => {
      if (width > 1) b.rows.forEach(r => r.pop());
    }]
  ].forEach(([label, fn]) => {
    const q = document.createElement("button");
    q.textContent = label;
    q.onclick = () => {
      const old = snapshot();
      fn();
      commit(old);
      render();
      setSelectedBlock(b.id);
    };
    bar.append(q);
  });
  box.append(bar);

  return box;
}

function focusCell(b, r, c){
  const wrap = $(`[data-id="${b.id}"]`);
  if (!wrap) return;
  const cells = wrap.querySelectorAll("td,th");
  if (!cells.length) return;
  const width = b.rows[0]?.length || 1;
  const idx = Math.min(Math.max(r, 0), b.rows.length - 1) * width +
              Math.min(Math.max(c, 0), width - 1);
  cells[idx]?.focus();
}

/* ---------- Columns ---------- */

function renderColumns(b){
  const box = el("div", "body");
  const g = el("div", "cols");
  g.dataset.n = b.cols;

  if (!Array.isArray(b.content)){
    b.content = Array(b.cols).fill("");
  }

  for (let i = 0; i < b.cols; i++){
    const c = el("div", "col");
    const q = el("div", "body");
    q.contentEditable = true;
    q.dataset.col = i;
    q.dataset.placeholder = "Колонка…";
    q.innerHTML = b.content[i] || "";
    q.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };
    q.oninput = () => {
      b.content[i] = q.innerHTML;
      save();
      commitDebounced(snapshot());
    };
    q.onpaste = makePasteHandler(q);
    c.append(q);
    g.append(c);
  }
  box.append(g);

  const bar = el("div", "tablebar");
  [2, 3, 4].forEach(n => {
    const q = document.createElement("button");
    q.textContent = n + " кол.";
    q.onclick = () => {
      const old = snapshot();
      b.cols = n;
      b.content = Array.from({ length: n }, (_, i) => b.content[i] || "");
      commit(old);
      render();
      setSelectedBlock(b.id);
    };
    bar.append(q);
  });
  box.append(bar);

  return box;
}

/* ---------- Main render ---------- */

function render(){
  $("#title").textContent = St().title || "";
  $("#editor").replaceChildren(...St().blocks.map(renderBlock));
  document.documentElement.dataset.theme =
    St().theme === "paper" ? "" : St().theme;

  [...$("#editor").querySelectorAll(".block")].forEach(w => {
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

      const from = St().blocks.findIndex(x => x.id === fromId);
      const to   = St().blocks.findIndex(x => x.id === toId);
      if (from < 0 || to < 0 || from === to) return;

      const old = snapshot();
      const [x] = St().blocks.splice(from, 1);
      St().blocks.splice(to, 0, x);
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
}

/* ---------- Add / focus ---------- */

function add(type = "text", at = St().blocks.length){
  const b = newBlock(type);
  St().blocks.splice(at, 0, b);
  setActive(b.id);
  render();
  setSelectedBlock(b.id);
  setTimeout(() => focusActive(), 0);
  save();
}

function focusActive(){
  const id = getActiveId();
  const w = $(`[data-id="${id}"]`);
  w?.querySelector("[contenteditable]")?.focus();
}

/* ---------- Tab helpers ---------- */

function removeInlineTabLeft(body){
  const sel = getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0).cloneRange();
  try { r.setStart(body, 0); } catch(e){ return; }
  const frag = r.cloneContents();
  const idx = [...frag.querySelectorAll(".indent-tab")].length - 1;
  if (idx < 0) return;
  const realTabs = body.querySelectorAll(".indent-tab");
  realTabs[idx]?.remove();
}

function getCurrentLi(body){
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const node = sel.anchorNode;
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const li = el?.closest("li");
  return li && body.contains(li) ? li : null;
}

function listIsEmpty(body){
  const lis = [...body.querySelectorAll("li")];
  if (!lis.length) return true;
  return lis.every(li =>
    li.innerText.trim() === "" && !li.querySelector("br")
  );
}

function insertLiAfter(body, currentLi){
  const newLi = document.createElement("li");
  newLi.innerHTML = "<br>";
  currentLi.parentNode.insertBefore(newLi, currentLi.nextSibling);
  return newLi;
}

function focusLi(li){
  const r = document.createRange();
  r.setStart(li, 0);
  r.collapse(true);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

/* ---------- Input rules ---------- */

function checkInputRules(b, body){
  if (b.type !== "text") return false;

  const onlyText =
    [...body.childNodes].every(n =>
      n.nodeType === Node.TEXT_NODE ||
      (n.nodeType === Node.ELEMENT_NODE && n.tagName === "BR")
    );
  if (!onlyText) return false;

  const t = body.innerText;

  const rules = [
    [/^# $/,         "h1"],
    [/^## $/,        "h2"],
    [/^### $/,       "h3"],
    [/^- $/,         "ul"],
    [/^\* $/,        "ul"],
    [/^1\. $/,       "ol"],
    [/^> $/,         "quote"],
    [/^---$/,        "divider"],
    [/^- \[ \] $/,   "todo"]
  ];

  for (const [re, type] of rules){
    if (re.test(t)){
      const old = snapshot();
      b.type = type;
      if (type === "ul" || type === "ol"){
        b.content = "<li><br></li>";
        if (type === "ul" && !b.marker) b.marker = "disc";
      } else {
        b.content = "";
      }
      commit(old);
      render();
      setSelectedBlock(b.id);
      setTimeout(focusActive, 0);
      return true;
    }
  }

  if (/^\|.+\|$/.test(t) && t.includes("|")){
    const cells = t.split("|").slice(1, -1).map(x => x.trim());
    if (cells.length){
      const old = snapshot();
      b.type = "table";
      b.rows = [cells, Array(cells.length).fill("")];
      commit(old);
      render();
      setSelectedBlock(b.id);
      return true;
    }
  }
  return false;
}

/* ---------- Keyboard ---------- */

function keyBlock(e, b, body){
  /* Tab / Shift+Tab — инлайн-таб */
  if (e.key === "Tab"){
    e.preventDefault();
    if (!e.shiftKey){
      document.execCommand(
        "insertHTML", false,
        '<span class="indent-tab" contenteditable="false"></span>'
      );
    } else {
      removeInlineTabLeft(body);
    }
    b.content = body.innerHTML;
    save();
    commitDebounced(snapshot());
    return;
  }

  /* ul/ol: Enter — вставить новый <li> после текущего */
  if (e.key === "Enter" && !e.shiftKey && (b.type === "ul" || b.type === "ol")){
    e.preventDefault();

    const li = getCurrentLi(body);
    const lis = body.querySelectorAll("li");

    /* пустой <li> и в списке больше одного — выходим из списка */
    if (li && li.innerText.trim() === "" && lis.length > 1){
      li.remove();
      cleanupEmptyLis(body);
      b.content = body.innerHTML;
      save();
      commitDebounced(snapshot());
      return;
    }
    /* единственный пустой — превращаем в text */
    if (li && li.innerText.trim() === "" && lis.length <= 1){
      const old = snapshot();
      b.type = "text";
      b.content = "";
      commit(old);
      render();
      setSelectedBlock(b.id);
      setTimeout(focusActive, 0);
      return;
    }

    /* обычный Enter — вставляем новый <li> и ставим каретку */
    let newLi;
    if (li){
      newLi = insertLiAfter(body, li);
    } else {
      newLi = document.createElement("li");
      newLi.innerHTML = "<br>";
      body.append(newLi);
    }
    cleanupEmptyLis(body);
    b.content = body.innerHTML;
    save();
    commitDebounced(snapshot());
    focusLi(newLi);
    return;
  }

  /* Enter в обычном блоке — новый абзац */
  if (e.key === "Enter" && !e.shiftKey &&
      b.type !== "code" && b.type !== "ul" && b.type !== "ol"){
    e.preventDefault();
    const i = St().blocks.findIndex(x => x.id === b.id);
    add("text", i + 1);
    return;
  }

  /* Backspace */
  if (e.key === "Backspace"){
    if (b.type === "ul" || b.type === "ol"){
      const li = getCurrentLi(body);
      const lis = body.querySelectorAll("li");
      const atStart = caretAtBlockStart(li || body);
      if (li && atStart){
        e.preventDefault();
        if (lis.length > 1){
          li.remove();
          cleanupEmptyLis(body);
          b.content = body.innerHTML;
          save();
          commitDebounced(snapshot());
        } else {
          const old = snapshot();
          b.type = "text";
          b.content = "";
          commit(old);
          render();
          setSelectedBlock(b.id);
          setTimeout(focusActive, 0);
        }
        return;
      }
    }

    if ((body.innerText === "" || body.innerHTML === "<br>") &&
        St().blocks.length > 1){
      e.preventDefault();
      const i = St().blocks.findIndex(x => x.id === b.id);
      const old = snapshot();
      St().blocks.splice(i, 1);
      const nextId = St().blocks[Math.max(0, i - 1)].id;
      setActive(nextId);
      commit(old);
      render();
      setSelectedBlock(nextId);
      focusActive();
      return;
    }
  }

  if (e.key === "/" && body.innerText === ""){
    setTimeout(() => {
      window.App.menus.openSlash(body, b.id);
    }, 0);
  }
}

function caretAtBlockStart(node){
  const sel = getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0).cloneRange();
  try { r.setStart(node, 0); } catch(e){ return false; }
  return r.toString().length === 0;
}

/* ---------- Apply fonts ---------- */

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
  for (const role of Object.keys(St().fonts || {})){
    const name = St().fonts[role];
    if (varMap[role] && name){
      document.documentElement.style.setProperty(
        varMap[role], `'${name}', ${fallbacks[role]}`
      );
    }
  }
}

/* ---------- Public API ---------- */

return {
  renderBlock, renderTable, renderColumns,
  render, add, focusActive,
  checkInputRules, keyBlock,
  applySavedFonts, makePasteHandler,
  cleanupEmptyLis
};

})();