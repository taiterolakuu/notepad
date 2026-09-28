/* ============================================================
   render/block.js — рендер блока, таблицы, колонки, resizer

   [Пакет 5]  image src через escape; ячейки/колонки через
              toDisplayHTML (безопасно).
   [Пакет 8]  checkInputRules — только для text.
   [Пакет 9]  slash-меню: maybeOpen в oninput, slashKeydown в keyBlock.
   [Пакет 12] keyBlock: e.isComposing guard; toSourceHTML
              при Tab-вставке; c.onpaste для ячеек таблицы;
              конвертер типов через U.convertBlockType.

   Зависит от: render/_shared, render/wikilinks, render/line, render/paste
   ============================================================ */

window.App = window.App || {};

window.App.renderBlock = (() => {
"use strict";

const S = window.App.renderShared;
const {
  el, escape, LINE_TYPES, syncBlockLines, getBlockHTML,
  St, setActive, setSelectedBlock, setDraggedId, getDraggedId,
  snapshot, commit, commitDebounced, save,
  U
} = S;

const render = () => window.App.render.render();

const Wikilinks = () => window.App.renderWikilinks;
const Paste     = () => window.App.renderPaste;
const LineMod   = () => window.App.renderLine;

/* ============================================================
   renderBlock
   ============================================================ */

function renderBlock(b){
  const w = el("div", "block");
  w.dataset.id = b.id;
  w.dataset.type = b.type;

  if (b.customId) w.dataset.anchor = b.customId;

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
    if (b.content){
      body.innerHTML = `<img class="noteimg" src="${escape(b.content)}" alt=""><div class="caption">Изображение</div>`;
    } else {
      body.textContent = "Перетащите изображение сюда";
    }
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

  /* LINE_TYPES */
  if (LINE_TYPES.has(b.type)){
    if (!Array.isArray(b.lines) || !b.lines.length){
      syncBlockLines(b);
    }

    const tagName =
      b.type === "h1" ? "h1" :
      b.type === "h2" ? "h2" :
      b.type === "h3" ? "h3" : "div";

    body = el(tagName,
      "body " +
      (b.type === "quote" ? "quote " : "") +
      (b.type === "code"  ? "code "  : "") +
      (b.type === "todo"  ? "todo "  : "") +
      (b.type === "todo" && b.checked ? "done" : "")
    );
    body.dataset.linesBlock = "1";

    if (b.type === "todo"){
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
    }

    const linesWrap = el("div", "lines");
    linesWrap.style.flex = "1";
    linesWrap.style.minWidth = "0";

    b.lines.forEach((ln, i) => {
      linesWrap.append(LineMod().renderLine(b, ln, i));
    });

    body.append(linesWrap);
    w.append(body);
    return w;
  }

  /* ul/ol/text без lines */
  const tag =
    b.type === "ul" ? "ul" :
    b.type === "ol" ? "ol" : "div";

  body = el(tag, "body");

  body.innerHTML = Wikilinks().toDisplayHTML(getBlockHTML(b));

  body.contentEditable = true;
  body.spellcheck = b.type !== "code";
  body.dir = "auto";
  body.dataset.placeholder = "Пишите здесь…";

  body.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };

  /* [Пакет 12] IME composition guard */
  body.addEventListener("compositionstart", () => {
    body.dataset.composing = "1";
  });
  body.addEventListener("compositionend", () => {
    body.dataset.composing = "0";
    body.dispatchEvent(new Event("input", { bubbles: true }));
  });

  body.oninput = () => {
    if (body.dataset.composing === "1") return;

    const before = snapshot();
    b.content = Wikilinks().toSourceHTML(body.innerHTML);

    try { window.App.wikilinkPopover?.onInput(b, body); } catch(e){}

    /* [Пакет 9] детект "/" в начале — открыть слэш-меню */
    try { window.App.menusSlash?.maybeOpen?.(body, b.id); } catch(e){}

    if ((b.type === "ul" || b.type === "ol") && listIsEmpty(body)){
      b.type = "text";
      b.content = "";
      b.lines = [];
      commit(before);
      render();
      setSelectedBlock(b.id);
      setTimeout(() => window.App.render.focusActive(), 0);
      return;
    }

    save();
    if (checkInputRules(b, body)) return;
    commitDebounced(before);
  };
  body.onkeydown = e => keyBlock(e, b, body);
  body.onpaste = Paste().makePasteHandler(body);

  w.append(body);
  return w;
}

/* ============================================================
   Table
   ============================================================ */

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
      c.innerHTML = Wikilinks().toDisplayHTML(v || "");
      c.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };

      c.addEventListener("compositionstart", () => {
        c.dataset.composing = "1";
      });
      c.addEventListener("compositionend", () => {
        c.dataset.composing = "0";
        c.dispatchEvent(new Event("input", { bubbles: true }));
      });

      c.oninput = () => {
        if (c.dataset.composing === "1") return;
        const before = snapshot();
        b.rows[ri][ci] = Wikilinks().toSourceHTML(c.innerHTML);
        save();
        commitDebounced(before);
      };

      /* [Пакет 12] paste в ячейку таблицы */
      c.onpaste = Paste().makePasteHandler(c);

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
  const wrap = document.querySelector(`[data-id="${b.id}"]`);
  if (!wrap) return;
  const cells = wrap.querySelectorAll("td,th");
  if (!cells.length) return;
  const width = b.rows[0]?.length || 1;
  const idx = Math.min(Math.max(r, 0), b.rows.length - 1) * width +
              Math.min(Math.max(c, 0), width - 1);
  cells[idx]?.focus();
}

/* ============================================================
   Columns
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

  g.style.setProperty("--cols-gap", b.gap + "px");
  g.style.setProperty("--cols-template", buildColsTemplate(b.widths));

  for (let i = 0; i < b.cols; i++){
    const c = el("div", "col");
    const q = el("div", "body");
    q.contentEditable = true;
    q.dir = "auto";
    q.dataset.col = i;
    q.dataset.placeholder = "Колонка…";
    q.innerHTML = Wikilinks().toDisplayHTML(b.content[i] || "");
    q.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };

    q.addEventListener("compositionstart", () => {
      q.dataset.composing = "1";
    });
    q.addEventListener("compositionend", () => {
      q.dataset.composing = "0";
      q.dispatchEvent(new Event("input", { bubbles: true }));
    });

    q.oninput = () => {
      if (q.dataset.composing === "1") return;
      const before = snapshot();
      b.content[i] = Wikilinks().toSourceHTML(q.innerHTML);
      save();
      commitDebounced(before);
    };
    q.onpaste = Paste().makePasteHandler(q);
    c.append(q);
    g.append(c);
  }

  if (b.cols > 1){
    for (let i = 0; i < b.cols - 1; i++){
      const rz = el("div", "col-resizer");
      rz.dataset.col = i;
      rz.dataset.blockId = b.id;
      const pos = b.widths.slice(0, i + 1).reduce((a, w) => a + w, 0);
      rz.style.left = `calc(${pos * 100}% - 5px)`;
      g.append(rz);
    }
  }

  const toolbar = buildColsToolbar(b);
  box.append(toolbar);
  box.append(g);

  return box;
}

function buildColsToolbar(b){
  const bar = el("div", "cols-toolbar");

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

  const sep1 = el("span", "ct-sep");
  bar.append(sep1);

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

  const sep2 = el("span", "ct-sep");
  bar.append(sep2);

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

/* ============================================================
   Column resizer
   ============================================================ */

function bindColumnResizer(){
  if (S.resizerBound) return;
  S.resizerBound = true;

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

    S.colsDrag = {
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
      const drag = S.colsDrag;
      if (!drag) return;
      const dx = ev.clientX - drag.startX;
      const dRatio = dx / drag.sumPx;

      const w = [...drag.startWidths];
      const minRatio = 0.08;

      let left  = w[drag.index]     + dRatio;
      let right = w[drag.index + 1] - dRatio;

      if (left < minRatio){
        right -= (minRatio - left);
        left = minRatio;
      }
      if (right < minRatio){
        left -= (minRatio - right);
        right = minRatio;
      }

      w[drag.index]     = left;
      w[drag.index + 1] = right;

      const sum = w.reduce((a, x) => a + x, 0) || 1;
      drag.block.widths = w.map(x => x / sum);

      drag.colsEl.style.setProperty(
        "--cols-template",
        buildColsTemplate(drag.block.widths)
      );
    };

    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.classList.remove("cols-dragging");
      rz.classList.remove("dragging");

      const drag = S.colsDrag;
      if (drag){
        commit(drag.beforeSnap);
        save();
      }
      S.colsDrag = null;
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

/* ============================================================
   Input rules + keyBlock + list helpers
   ============================================================ */

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

/* [Пакет 8, 9, 12] checkInputRules: только для text;
   используется U.convertBlockType для смены типа с сохранением содержимого. */
function checkInputRules(b, body){
  if (b.type !== "text") return false;
  if (LINE_TYPES.has(b.type)) return false;

  let t = "";
  if (Array.isArray(b.lines) && b.lines.length){
    const tmp = document.createElement("div");
    tmp.innerHTML = b.lines[0].text || "";
    t = tmp.innerText;
  } else {
    t = body.innerText;
  }

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

      /* [Пакет 12] содержимое = trigger-строка без последнего символа */
      /* Для правила вида "# " — берём весь остальной текст после триггера */
      let contentHTML = "";
      if (Array.isArray(b.lines) && b.lines.length){
        /* Оставляем содержимое, но без самого триггера */
        const firstLine = b.lines[0]?.text || "";
        /* Убираем начальный "# " / "- " / "1. " / "> " / "---" */
        contentHTML = firstLine.replace(/^(#{1,3}\s+|[-*]\s+|>\s+|\d+\.\s+|---+)/, "");
      }

      /* Используем convertBlockType — он перенесёт строку корректно */
      if (typeof U.convertBlockType === "function"){
        /* Перед конвертацией: заменяем содержимое на остаток */
        if (contentHTML && contentHTML !== t){
          if (LINE_TYPES.has(b.type)){
            b.lines = [ U.line(contentHTML) ];
            b.content = contentHTML;
          } else {
            b.content = contentHTML;
          }
        }
        U.convertBlockType(b, type);
      } else {
        /* Fallback — старое поведение */
        b.type = type;
        if (type === "ul" || type === "ol"){
          b.content = "<li><br></li>";
          b.lines = [];
          if (type === "ul" && !b.marker) b.marker = "disc";
        } else if (LINE_TYPES.has(type)){
          b.lines = [ U.line("") ];
          b.content = "";
        } else {
          b.content = "";
          b.lines = [];
        }
      }

      commit(old);
      render();
      setSelectedBlock(b.id);
      setTimeout(() => window.App.render.focusActive(), 0);
      return true;
    }
  }

  if (/^\|.+\|$/.test(t) && t.includes("|")){
    const cells = t.split("|").slice(1, -1).map(x => x.trim());
    if (cells.length){
      const old = snapshot();
      b.type = "table";
      b.rows = [cells, Array(cells.length).fill("")];
      b.lines = [];
      commit(old);
      render();
      setSelectedBlock(b.id);
      return true;
    }
  }
  return false;
}

function caretAtBlockStart(node){
  const sel = getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0).cloneRange();
  try { r.setStart(node, 0); } catch(e){ return false; }
  return r.toString().length === 0;
}

function keyBlock(e, b, body){
  /* [Пакет 12] IME composition guard */
  if (e.isComposing || e.keyCode === 229) return;

  /* [Пакет 9] слэш-меню имеет приоритет */
  if (window.App.menusSlash?.slashKeydown?.(e)) return;

  if (window.App.wikilinkPopover && window.App.wikilinkPopover.isOpen()){
    if (window.App.wikilinkPopover.handleKey(e, b, body)) return;
  }

  if (e.key === "Tab"){
    e.preventDefault();
    const before = snapshot();
    if (!e.shiftKey){
      document.execCommand(
        "insertHTML", false,
        '<span class="indent-tab" contenteditable="false"></span>'
      );
    } else {
      removeInlineTabLeft(body);
    }
    b.content = Wikilinks().toSourceHTML(body.innerHTML);
    save();
    commitDebounced(before);
    return;
  }

  if (e.key === "Enter" && !e.shiftKey && (b.type === "ul" || b.type === "ol")){
    e.preventDefault();

    const li = getCurrentLi(body);
    const lis = body.querySelectorAll("li");

    if (li && li.innerText.trim() === "" && lis.length > 1){
      const before = snapshot();
      li.remove();
      Paste().cleanupEmptyLis(body);
      b.content = Wikilinks().toSourceHTML(body.innerHTML);
      save();
      commitDebounced(before);
      return;
    }
    if (li && li.innerText.trim() === "" && lis.length <= 1){
      const old = snapshot();
      b.type = "text";
      b.content = "";
      b.lines = [];
      commit(old);
      render();
      setSelectedBlock(b.id);
      setTimeout(() => window.App.render.focusActive(), 0);
      return;
    }

    const before = snapshot();
    let newLi;
    if (li){
      newLi = insertLiAfter(body, li);
    } else {
      newLi = document.createElement("li");
      newLi.innerHTML = "<br>";
      body.append(newLi);
    }
    Paste().cleanupEmptyLis(body);
    b.content = Wikilinks().toSourceHTML(body.innerHTML);
    save();
    commitDebounced(before);
    focusLi(newLi);
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
          const before = snapshot();
          li.remove();
          Paste().cleanupEmptyLis(body);
          b.content = Wikilinks().toSourceHTML(body.innerHTML);
          save();
          commitDebounced(before);
        } else {
          const old = snapshot();
          b.type = "text";
          b.content = "";
          b.lines = [];
          commit(old);
          render();
          setSelectedBlock(b.id);
          setTimeout(() => window.App.render.focusActive(), 0);
        }
        return;
      }
    }
  }
}

return {
  renderBlock, renderTable, renderColumns, focusCell,
  buildColsToolbar, buildColsTemplate, isSameWidths,
  bindColumnResizer,
  checkInputRules, keyBlock,
  removeInlineTabLeft, getCurrentLi, listIsEmpty,
  insertLiAfter, focusLi, caretAtBlockStart
};
})();