/* ============================================================
   render.js
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
const getActiveDoc = () => window.App.state.getActiveDoc();

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

/* ============================================================
   Wikilinks helpers
   ============================================================ */

function wikilinkResolver(name){
  const r = window.App.state.resolveDocByName(name);
  if (r) return { id: r.doc.id };
  return { missing: true };
}

function toDisplayHTML(html){
  return U.renderWikilinks(html || "", wikilinkResolver);
}

/* ПАТЧ 2.2: toSourceHTML сохраняет анкор при обратном преобразовании */
function toSourceHTML(html){
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  tmp.querySelectorAll("a.wikilink").forEach(a => {
    const name   = a.getAttribute("data-wikilink") || a.textContent || "";
    const anchor = a.getAttribute("data-wikilink-anchor") || "";
    const full   = anchor ? `${name}#${anchor}` : name;
    a.replaceWith(document.createTextNode(`[[${full}]]`));
  });
  return tmp.innerHTML;
}

/* ============================================================
   Paste
   ============================================================ */

function makePasteHandler(target){
  return function(e){
    const html = e.clipboardData?.getData("text/html");
    const text = e.clipboardData?.getData("text/plain");
    if (!html && !text) return;
    e.preventDefault();

    let clean;
    if (html){
      clean = U.cleanPastedHTML(sanitize(html));
    } else {
      clean = escape(text).replace(/\n/g, "<br>");
    }

    document.execCommand("insertHTML", false, clean);

    try {
      const sel = getSelection();
      if (sel.rangeCount){
        const r = sel.getRangeAt(0);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    } catch(_){}
  };
}

/* ---------- Cleanup ---------- */

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

  /* ПАТЧ 2.2: data-anchor для кастомного ID */
  if (b.customId) w.dataset.anchor = b.customId;

  /* ПАТЧ 2.2: маркер блока (для любого типа) */
  if (b.blockMarker){
    w.dataset.blockMarker = b.blockMarker;
    if (b.blockMarkerColor){
      w.style.setProperty("--block-marker-color", b.blockMarkerColor);
    }
  }

  if (b.bg)     w.dataset.bg = b.bg;
  if (b.font)   w.dataset.font = b.font;
  if (b.indent) w.dataset.indent = b.indent;
  if (b.align && b.align !== "left") w.dataset.align = b.align;
  if (b.type === "ul") w.dataset.marker = b.marker || "disc";

  if (St().selectedId === b.id) w.classList.add("selected");

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
    t.dir = "auto";
    t.innerHTML = toDisplayHTML(b.content || "");
    t.style.flex = "1";
    t.style.minWidth = "0";
    t.style.outline = "0";
    t.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };
    t.oninput = () => {
      const wasEmpty = b.content === "";
      b.content = toSourceHTML(t.innerHTML);

      try { window.App.wikilinkPopover?.onInput(b, t); } catch(e){}

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

  body.innerHTML = toDisplayHTML(b.content || "");

  body.contentEditable = true;
  body.spellcheck = b.type !== "code";
  body.dir = "auto";
  body.dataset.placeholder =
    b.type === "code" ? "Код…" : "Пишите здесь…";

  body.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };
  body.oninput = () => {
    const before = snapshot();
    b.content = toSourceHTML(body.innerHTML);

    try { window.App.wikilinkPopover?.onInput(b, body); } catch(e){}

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
      c.dir = "auto";
      c.innerHTML = toDisplayHTML(v || "");
      c.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };
      c.oninput = () => {
        b.rows[ri][ci] = toSourceHTML(c.innerHTML);
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

/* ============================================================
   ПАТЧ 2.1: Columns — новые настройки (widths, gap, valign),
   панель управления сверху блока (A), drag-разделитель
   ============================================================ */

function buildColsTemplate(widths){
  return widths.map(w => `${w}fr`).join(" ");
}

function renderColumns(b){
  const box = el("div", "body");

  const g = el("div", "cols");
  g.dataset.n = b.cols;
  g.dataset.valign = b.valign || "top";

  if (!Array.isArray(b.content)) b.content = Array(b.cols).fill("");
  if (!Array.isArray(b.widths) || b.widths.length !== b.cols){
    b.widths = Array(b.cols).fill(1 / b.cols);
  }
  if (!Number.isFinite(b.gap)) b.gap = 14;

  /* CSS-переменные */
  g.style.setProperty("--cols-gap", b.gap + "px");
  g.style.setProperty("--cols-template", buildColsTemplate(b.widths));

  for (let i = 0; i < b.cols; i++){
    const c = el("div", "col");
    const q = el("div", "body");
    q.contentEditable = true;
    q.dir = "auto";
    q.dataset.col = i;
    q.dataset.placeholder = "Колонка…";
    q.innerHTML = toDisplayHTML(b.content[i] || "");
    q.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };
    q.oninput = () => {
      b.content[i] = toSourceHTML(q.innerHTML);
      save();
      commitDebounced(snapshot());
    };
    q.onpaste = makePasteHandler(q);
    c.append(q);
    g.append(c);
  }

  /* Resizer'ы между колонками */
  if (b.cols > 1){
    for (let i = 0; i < b.cols - 1; i++){
      const rz = el("div", "col-resizer");
      rz.dataset.col = i;
      rz.dataset.blockId = b.id;
      /* Позиция: граница между i и i+1 колонкой = сумма widths[0..i] */
      const pos = b.widths.slice(0, i + 1).reduce((a, w) => a + w, 0);
      rz.style.left = `calc(${pos * 100}% - 5px)`;
      g.append(rz);
    }
  }

  /* Панель управления (A: сверху блока) */
  const toolbar = buildColsToolbar(b);

  box.append(toolbar);
  box.append(g);

  return box;
}

/* Панель управления колонками */
function buildColsToolbar(b){
  const bar = el("div", "cols-toolbar");

  /* Кол-во колонок */
  [2, 3, 4].forEach(n => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = String(n);
    btn.title = n + " колонки";
    if (b.cols === n) btn.classList.add("on");
    btn.onmousedown = e => e.preventDefault();
    btn.onclick = () => {
      const old = snapshot();
      b.cols = n;
      const arr = Array.isArray(b.content) ? b.content.slice(0, n) : [];
      while (arr.length < n) arr.push("");
      b.content = arr;
      const w = Array.isArray(b.widths) ? b.widths.slice(0, n) : [];
      while (w.length < n) w.push(1);
      const sum = w.reduce((a, x) => a + x, 0) || 1;
      b.widths = w.map(x => x / sum);
      commit(old);
      render();
      setSelectedBlock(b.id);
    };
    bar.append(btn);
  });

  /* Разделитель */
  const sep1 = el("span", "ct-sep");
  bar.append(sep1);

  /* Пресеты пропорций для текущего числа колонок */
  const presets = {
    2: [
      { label: "1:1",  w: [1,1] },
      { label: "2:1",  w: [2,1] },
      { label: "1:2",  w: [1,2] },
      { label: "3:1",  w: [3,1] }
    ],
    3: [
      { label: "1:1:1", w: [1,1,1] },
      { label: "2:1:1", w: [2,1,1] },
      { label: "1:2:1", w: [1,2,1] },
      { label: "1:1:2", w: [1,1,2] }
    ],
    4: [
      { label: "1:1:1:1", w: [1,1,1,1] }
    ]
  };

  (presets[b.cols] || presets[2]).forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = "Пропорции " + p.label;

    /* Мини-превью */
    const ratio = el("span", "ct-ratio");
    p.w.forEach(w => {
      const seg = document.createElement("span");
      seg.style.width = (6 + w * 4) + "px";
      ratio.append(seg);
    });
    btn.append(ratio);

    if (isSameWidths(b.widths, p.w)) btn.classList.add("on");

    btn.onmousedown = e => e.preventDefault();
    btn.onclick = () => {
      const old = snapshot();
      const sum = p.w.reduce((a, x) => a + x, 0) || 1;
      b.widths = p.w.map(x => x / sum);
      commit(old);
      render();
      setSelectedBlock(b.id);
    };
    bar.append(btn);
  });

  /* Разделитель */
  const sep2 = el("span", "ct-sep");
  bar.append(sep2);

  /* Valign */
  const valigns = [
    ["top",    "По верху",   '<path d="M3 5h18"/><path d="M3 10h10"/><path d="M3 15h14"/>'],
    ["center", "По центру",  '<path d="M3 5h14"/><path d="M3 10h18"/><path d="M3 15h14"/>'],
    ["bottom", "По низу",    '<path d="M3 9h14"/><path d="M3 14h10"/><path d="M3 19h18"/>']
  ];
  valigns.forEach(([v, title, path]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = title;
    btn.innerHTML = `<svg class="lucide" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
    if ((b.valign || "top") === v) btn.classList.add("on");
    btn.onmousedown = e => e.preventDefault();
    btn.onclick = () => {
      const old = snapshot();
      b.valign = v;
      commit(old);
      render();
      setSelectedBlock(b.id);
    };
    bar.append(btn);
  });

  return bar;
}

function isSameWidths(a, b){
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const sa = a.reduce((x,y)=>x+y,0) || 1;
  const sb = b.reduce((x,y)=>x+y,0) || 1;
  return a.every((w, i) => Math.abs(w/sa - b[i]/sb) < 0.03);
}

/* ---------- ПАТЧ 2.1: drag-разделитель ---------- */

let _colsDrag = null;   /* { block, colsEl, index, startX, startWidths, sumPx, beforeSnap } */

function bindColumnResizer(){
  if (bindColumnResizer._bound) return;
  bindColumnResizer._bound = true;

  document.addEventListener("mousedown", e => {
    const rz = e.target.closest(".col-resizer");
    if (!rz) return;

    e.preventDefault();
    e.stopPropagation();

    const blockId = rz.dataset.blockId;
    const index   = parseInt(rz.dataset.col, 10);
    const g = rz.closest(".cols");
    if (!g) return;

    const b = St().blocks.find(x => x.id === blockId);
    if (!b || b.type !== "columns") return;

    const rect = g.getBoundingClientRect();
    const startX = e.clientX;
    const startWidths = [...b.widths];
    const beforeSnap = snapshot();

    _colsDrag = {
      block: b,
      colsEl: g,
      index,
      startX,
      startWidths,
      sumPx: rect.width,
      beforeSnap
    };

    rz.classList.add("dragging");
    document.body.classList.add("cols-dragging");

    const onMove = ev => {
      if (!_colsDrag) return;
      const dx = ev.clientX - _colsDrag.startX;
      const dRatio = dx / _colsDrag.sumPx;

      const w = [..._colsDrag.startWidths];
      const minRatio = 0.08;

      let left  = w[_colsDrag.index]     + dRatio;
      let right = w[_colsDrag.index + 1] - dRatio;

      if (left < minRatio){
        right -= (minRatio - left);
        left = minRatio;
      }
      if (right < minRatio){
        left -= (minRatio - right);
        right = minRatio;
      }

      w[_colsDrag.index]     = left;
      w[_colsDrag.index + 1] = right;

      const sum = w.reduce((a, x) => a + x, 0) || 1;
      _colsDrag.block.widths = w.map(x => x / sum);

      _colsDrag.colsEl.style.setProperty(
        "--cols-template",
        buildColsTemplate(_colsDrag.block.widths)
      );
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("cols-dragging");
      rz.classList.remove("dragging");

      if (_colsDrag){
        /* Правильный undo: коммитим состояние ДО drag */
        commit(_colsDrag.beforeSnap);
        save();
      }
      _colsDrag = null;
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

/* ---------- Main render ---------- */

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
  editor.replaceChildren(...(doc?.blocks || []).map(renderBlock));

  document.documentElement.dataset.theme =
    St().theme === "paper" ? "" : St().theme;

  /* Gap-зоны между блоками */
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

  /* Add-block-zone под последним */
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

  /* Bind drag-n-drop для блоков */
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

  /* ПАТЧ 2.2: нумерация строк документа */
  if (doc?.showLineNumbers){
    const fmt = doc.lineNumberFormat || "1.";
    const fmtNum = (n) => {
      if (fmt === "1)") return n + ")";
      if (fmt === "#1") return "#" + n;
      if (fmt === "L1") return "L" + n;
      return n + ".";
    };
    const blocks = window.App.state.getBlocks();
    editor.querySelectorAll(".block").forEach((w, i) => {
      const blk = blocks.find(x => x.id === w.dataset.id);
      const num = (blk && blk.lineNumber) ? blk.lineNumber : (i + 1);
      w.dataset.lineNumber = fmtNum(num);
      w.classList.add("numbered");
    });
  }

  /* ПАТЧ 2.1: bind drag-разделителей колонок (один раз) */
  bindColumnResizer();

  /* Панель backlinks */
  try { window.App.backlinks?.render(); } catch(e){}
}

/* ---------- Add / focus ---------- */

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
    w?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, 0);
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
  if (window.App.wikilinkPopover && window.App.wikilinkPopover.isOpen()){
    if (window.App.wikilinkPopover.handleKey(e, b, body)){
      return;
    }
  }

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
    b.content = toSourceHTML(body.innerHTML);
    save();
    commitDebounced(snapshot());
    return;
  }

  if (e.key === "Enter" && !e.shiftKey && (b.type === "ul" || b.type === "ol")){
    e.preventDefault();

    const li = getCurrentLi(body);
    const lis = body.querySelectorAll("li");

    if (li && li.innerText.trim() === "" && lis.length > 1){
      li.remove();
      cleanupEmptyLis(body);
      b.content = toSourceHTML(body.innerHTML);
      save();
      commitDebounced(snapshot());
      return;
    }
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

    let newLi;
    if (li){
      newLi = insertLiAfter(body, li);
    } else {
      newLi = document.createElement("li");
      newLi.innerHTML = "<br>";
      body.append(newLi);
    }
    cleanupEmptyLis(body);
    b.content = toSourceHTML(body.innerHTML);
    save();
    commitDebounced(snapshot());
    focusLi(newLi);
    return;
  }

  if (e.key === "Enter" && !e.shiftKey &&
      b.type !== "code" && b.type !== "ul" && b.type !== "ol"){
    e.preventDefault();
    const blocks = window.App.state.getBlocks();
    const i = blocks.findIndex(x => x.id === b.id);
    add("text", i + 1);
    return;
  }

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
          b.content = toSourceHTML(body.innerHTML);
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

    const blocks = window.App.state.getBlocks();
    if ((body.innerText === "" || body.innerHTML === "<br>") &&
        blocks.length > 1){
      e.preventDefault();
      const i = blocks.findIndex(x => x.id === b.id);
      const old = snapshot();
      blocks.splice(i, 1);
      const nextId = blocks[Math.max(0, i - 1)].id;
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

/* ============================================================
   ПАТЧ 2.2: глобальный обработчик клика по wikilink
   с поддержкой анкоров [[doc#id]]
   ============================================================ */

function bindWikilinkClicks(){
  document.addEventListener("click", e => {
    const link = e.target.closest(".wikilink");
    if (!link) return;

    e.preventDefault();
    e.stopPropagation();

    const name   = link.getAttribute("data-wikilink") || link.textContent;
    const id     = link.getAttribute("data-wikilink-id");
    /* ПАТЧ 2.2 */
    const anchor = link.getAttribute("data-wikilink-anchor") || "";
    const S      = window.App.state.S;

    /* Хелпер: открыть документ и (опционально) скроллить к анкору */
    const openDoc = (docId) => {
      /* setActiveDoc — async; дожидаемся рендера и только потом скроллим */
      Promise.resolve(window.App.state.setActiveDoc(docId)).then(() => {
        if (anchor){
          window.App.state.scrollToAnchor(docId, anchor);
        }
      });
    };

    if (id && S.documents[id] && !S.documents[id].trashed){
      openDoc(id);
      return;
    }

    const r = window.App.state.resolveDocByName(name);
    if (r){
      openDoc(r.doc.id);
      if (r.count > 1){
        U.toast(`Есть ещё ${r.count - 1} документов с таким именем`);
      }
      return;
    }

    if (confirm(`Документ «${name}» не найден. Создать?`)){
      window.App.state.createDocument({ title: name }).then(doc => {
        openDoc(doc.id);
        window.App.sidebar?.render();
        window.App.tabs?.render();
      });
    }
  });
}

/* ---------- Public API ---------- */

return {
  renderBlock, renderTable, renderColumns,
  render, add, focusActive,
  checkInputRules, keyBlock,
  applySavedFonts, makePasteHandler,
  cleanupEmptyLis,
  toDisplayHTML, toSourceHTML,
  bindWikilinkClicks,
  /* ПАТЧ 2.1 */
  bindColumnResizer
};

})();