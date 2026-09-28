/* ============================================================
   render.js — рендер блоков, строк, keyLine
   Зависит от: utils, state
   ============================================================ */

window.App = window.App || {};

window.App.render = (() => {
"use strict";

const U = window.App.utils;
const {
  $, $$, el, escape, sanitize,
  block: newBlock,
  line: newLine,
  LINE_TYPES,
  syncBlockLines,
  getBlockHTML
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

function toSourceHTML(html){
  if (!html) return "";
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  tmp.querySelectorAll("a.wikilink").forEach(a => {
    const name     = a.getAttribute("data-wikilink") || a.textContent || "";
    const bAnchor  = a.getAttribute("data-wikilink-block-anchor") || "";
    const lAnchor  = a.getAttribute("data-wikilink-line-anchor") || "";
    const fAnchor  = a.getAttribute("data-wikilink-fragment-anchor") || "";
    const anchors  = [bAnchor, lAnchor, fAnchor].filter(Boolean).join("#");
    const full     = anchors ? `${name}#${anchors}` : name;
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

/* ============================================================
   ПАТЧ 2.3.1 + 2.3.2: рендер строк внутри блока (LINE_TYPES)
   ============================================================ */

/* Рендерит одну строку как <div class="line" contenteditable>
   - b    — блок-родитель
   - ln   — объект строки (line)
   - i    — индекс строки в b.lines
   ПАТЧ 2.3.2:
     - setAttribute("contenteditable","true") для надёжности
     - пустые строки рендерятся как "<br>" (для каретки) */
function renderLine(b, ln, i){
  const lineEl = el("div", "line");
  lineEl.dataset.lineId = ln.id;
  lineEl.dataset.lineIndex = i;
  if (ln.customId) lineEl.dataset.lineAnchor = ln.customId;

  lineEl.setAttribute("contenteditable", "true");
  lineEl.spellcheck = (b.type !== "code");
  lineEl.dir = "auto";
  lineEl.dataset.placeholder = i === 0
    ? (b.type === "code" ? "Код…" : "Пишите здесь…")
    : "";

  /* ПАТЧ 2.3.2: пустая строка → <br> для каретки */
  const text = ln.text || "";
  if (text && text.trim()){
    lineEl.innerHTML = toDisplayHTML(text);
  } else {
    lineEl.innerHTML = "<br>";
  }

  lineEl.onfocus = () => {
    setActive(b.id);
    setSelectedBlock(b.id);
  };

  lineEl.oninput = () => {
    const wasEmpty = !ln.text;

    /* ПАТЧ 2.3.2: <br> как единственный child → пустая строка */
    let html = lineEl.innerHTML;
    if (html === "<br>" || html === "<br/>" || html === "<br />"){
      html = "";
    }
    ln.text = toSourceHTML(html);
    b.content = b.lines.map(l => l.text).join("<br>");

    try { window.App.wikilinkPopover?.onInput(b, lineEl); } catch(e){}

    save();
    if (wasEmpty) commit(snapshot());
    else          commitDebounced(snapshot());
  };

  lineEl.onkeydown = (e) => keyLine(e, b, ln, i, lineEl);
  lineEl.onpaste = makePasteHandler(lineEl);

  return lineEl;
}

/* ---------- Ключевые хелперы для строк ---------- */

function caretAtStart(el){
  const sel = getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return false;
  if (!el.contains(r.startContainer)) return false;

  const test = r.cloneRange();
  try { test.setStart(el, 0); } catch(e){ return false; }
  return test.toString().length === 0;
}

function caretAtEnd(el){
  const sel = getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  if (!r.collapsed) return false;
  if (!el.contains(r.startContainer)) return false;

  const test = r.cloneRange();
  try { test.setEnd(el, el.childNodes.length); } catch(e){ return false; }
  return test.toString().length === el.innerText.length;
}

function placeCaretStart(el){
  const r = document.createRange();
  r.setStart(el, 0);
  r.collapse(true);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function placeCaretEnd(el){
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

/* ---------- keyLine — обработчик клавиш внутри строки ---------- */

function keyLine(e, b, ln, i, lineEl){
  /* Поповер [[ перехватывает ввод */
  if (window.App.wikilinkPopover && window.App.wikilinkPopover.isOpen()){
    if (window.App.wikilinkPopover.handleKey(e, b, lineEl)) return;
  }

  const isMod = e.ctrlKey || e.metaKey;

  /* Ctrl+Enter (без Shift) → новый блок после текущего */
  if (isMod && !e.shiftKey && e.key === "Enter"){
    e.preventDefault();
    const blocks = window.App.state.getBlocks();
    const idx = blocks.findIndex(x => x.id === b.id);
    add("text", idx + 1);
    return;
  }

  /* Ctrl+Shift+Enter → пропускаем, обрабатывается в hotkeys.js (line:new) */

  /* Ctrl+Backspace → удалить текущую строку (не блок) */
  if (isMod && e.key === "Backspace"){
    e.preventDefault();
    if (b.lines.length > 1){
      const old = snapshot();
      b.lines.splice(i, 1);
      b.content = b.lines.map(l => l.text).join("<br>");
      commit(old);
      render();

      const prevI = Math.max(0, i - 1);
      setTimeout(() => {
        const prevEl = document.querySelector(
          `#editor .block[data-id="${b.id}"] .line[data-line-index="${prevI}"]`
        );
        if (prevEl){
          placeCaretEnd(prevEl);
          prevEl.focus();
        }
      }, 0);
    } else {
      const old = snapshot();
      ln.text = "";
      b.content = "";
      commit(old);
      render();
    }
    return;
  }

  /* Enter (без модификаторов) → split строки на две.
     Два независимых Range с cloneContents — корректный HTML. */
  if (e.key === "Enter" && !e.shiftKey){
    e.preventDefault();
    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!lineEl.contains(r.startContainer)) return;

    /* Левая часть — от начала строки до caret */
    const leftRange = document.createRange();
    leftRange.setStart(lineEl, 0);
    leftRange.setEnd(r.startContainer, r.startOffset);
    const leftFrag = leftRange.cloneContents();
    const leftDiv = document.createElement("div");
    leftDiv.appendChild(leftFrag);
    const beforeHTML = leftDiv.innerHTML;

    /* Правая часть — от caret до конца строки */
    const rightRange = document.createRange();
    rightRange.setStart(r.startContainer, r.startOffset);
    rightRange.setEnd(lineEl, lineEl.childNodes.length);
    const rightFrag = rightRange.cloneContents();
    const rightDiv = document.createElement("div");
    rightDiv.appendChild(rightFrag);
    const afterHTML = rightDiv.innerHTML;

    const old = snapshot();

    ln.text = beforeHTML;

    const newLn = newLine(afterHTML);
    b.lines.splice(i + 1, 0, newLn);
    b.content = b.lines.map(l => l.text).join("<br>");

    commit(old);
    render();

    setTimeout(() => {
      const newEl = document.querySelector(
        `#editor .block[data-id="${b.id}"] .line[data-line-id="${newLn.id}"]`
      );
      if (newEl){
        const rr = document.createRange();
        rr.setStart(newEl, 0);
        rr.collapse(true);
        const s = getSelection();
        s.removeAllRanges();
        s.addRange(rr);
        newEl.focus();
      }
    }, 0);
    return;
  }

  /* Backspace в начале строки → merge с предыдущей */
  if (e.key === "Backspace" && caretAtStart(lineEl)){
    if (i === 0){
      const blocks = window.App.state.getBlocks();
      const bIdx = blocks.findIndex(x => x.id === b.id);
      if (bIdx > 0){
        e.preventDefault();
        const prevBlock = blocks[bIdx - 1];
        if (LINE_TYPES.has(prevBlock.type) && Array.isArray(prevBlock.lines)){
          const old = snapshot();
          const movedLines = b.lines.map(l => ({ ...l }));
          prevBlock.lines.push(...movedLines);
          prevBlock.content = prevBlock.lines.map(l => l.text).join("<br>");
          blocks.splice(bIdx, 1);
          commit(old);
          render();
          setTimeout(() => {
            const el2 = document.querySelector(
              `#editor .block[data-id="${prevBlock.id}"] .line[data-line-id="${movedLines[0].id}"]`
            );
            if (el2){ placeCaretStart(el2); el2.focus(); }
          }, 0);
        } else {
          const el2 = document.querySelector(
            `#editor .block[data-id="${prevBlock.id}"] [contenteditable]`
          );
          if (el2){
            placeCaretEnd(el2);
            el2.focus();
          }
        }
        return;
      } else {
        return;
      }
    }
    /* Merge с предыдущей строкой */
    e.preventDefault();
    const prevLn = b.lines[i - 1];
    const curText = ln.text || "";

    const old = snapshot();
    const oldPrevText = prevLn.text || "";
    prevLn.text = oldPrevText + curText;
    b.lines.splice(i, 1);
    b.content = b.lines.map(l => l.text).join("<br>");
    commit(old);
    render();

    setTimeout(() => {
      const prevEl2 = document.querySelector(
        `#editor .block[data-id="${b.id}"] .line[data-line-id="${prevLn.id}"]`
      );
      if (prevEl2){
        const tmp = document.createElement("div");
        tmp.innerHTML = oldPrevText;
        const oldLen = tmp.innerText.length;
        try {
          const r = document.createRange();
          const walker = document.createTreeWalker(prevEl2, NodeFilter.SHOW_TEXT);
          let acc = 0;
          let targetNode = null;
          let targetOffset = 0;
          let node;
          while ((node = walker.nextNode())){
            if (acc + node.textContent.length >= oldLen){
              targetNode = node;
              targetOffset = oldLen - acc;
              break;
            }
            acc += node.textContent.length;
          }
          if (targetNode){
            r.setStart(targetNode, targetOffset);
            r.collapse(true);
            const s = getSelection();
            s.removeAllRanges();
            s.addRange(r);
          } else {
            placeCaretEnd(prevEl2);
          }
        } catch(_){
          placeCaretEnd(prevEl2);
        }
        prevEl2.focus();
      }
    }, 0);
    return;
  }

  /* Delete в конце строки → merge со следующей */
  if (e.key === "Delete" && caretAtEnd(lineEl)){
    if (i >= b.lines.length - 1){
      const blocks = window.App.state.getBlocks();
      const bIdx = blocks.findIndex(x => x.id === b.id);
      const nextBlock = blocks[bIdx + 1];
      if (nextBlock && LINE_TYPES.has(nextBlock.type) && Array.isArray(nextBlock.lines)){
        e.preventDefault();
        const old = snapshot();
        const movedLines = nextBlock.lines.map(l => ({ ...l }));
        b.lines.push(...movedLines);
        b.content = b.lines.map(l => l.text).join("<br>");
        blocks.splice(bIdx + 1, 1);
        commit(old);
        render();
      }
      return;
    }
    e.preventDefault();
    const nextLn = b.lines[i + 1];
    const old = snapshot();
    ln.text = (ln.text || "") + (nextLn.text || "");
    b.lines.splice(i + 1, 1);
    b.content = b.lines.map(l => l.text).join("<br>");
    commit(old);
    render();
    setTimeout(() => {
      const el2 = document.querySelector(
        `#editor .block[data-id="${b.id}"] .line[data-line-id="${ln.id}"]`
      );
      if (el2){ placeCaretEnd(el2); el2.focus(); }
    }, 0);
    return;
  }

  /* ↑ в начале строки → на предыдущую строку */
  if (e.key === "ArrowUp" && caretAtStart(lineEl)){
    if (i > 0){
      e.preventDefault();
      const prevEl = document.querySelector(
        `#editor .block[data-id="${b.id}"] .line[data-line-id="${b.lines[i-1].id}"]`
      );
      if (prevEl){ placeCaretEnd(prevEl); prevEl.focus(); }
      return;
    }
    const blocks = window.App.state.getBlocks();
    const bIdx = blocks.findIndex(x => x.id === b.id);
    if (bIdx > 0){
      const prevBlock = blocks[bIdx - 1];
      const prevEditable = document.querySelector(
        `#editor .block[data-id="${prevBlock.id}"] [contenteditable]`
      );
      if (prevEditable){
        e.preventDefault();
        const prevLines = prevBlock.lines || [];
        if (prevLines.length){
          const lastLineEl = document.querySelector(
            `#editor .block[data-id="${prevBlock.id}"] .line[data-line-id="${prevLines[prevLines.length-1].id}"]`
          );
          if (lastLineEl){ placeCaretEnd(lastLineEl); lastLineEl.focus(); return; }
        }
        placeCaretEnd(prevEditable);
        prevEditable.focus();
      }
    }
    return;
  }

  /* ↓ в конце строки → на следующую строку */
  if (e.key === "ArrowDown" && caretAtEnd(lineEl)){
    if (i < b.lines.length - 1){
      e.preventDefault();
      const nextEl = document.querySelector(
        `#editor .block[data-id="${b.id}"] .line[data-line-id="${b.lines[i+1].id}"]`
      );
      if (nextEl){ placeCaretStart(nextEl); nextEl.focus(); }
      return;
    }
    const blocks = window.App.state.getBlocks();
    const bIdx = blocks.findIndex(x => x.id === b.id);
    const nextBlock = blocks[bIdx + 1];
    if (nextBlock){
      const nextEditable = document.querySelector(
        `#editor .block[data-id="${nextBlock.id}"] [contenteditable]`
      );
      if (nextEditable){
        e.preventDefault();
        const nextLines = nextBlock.lines || [];
        if (nextLines.length){
          const firstLineEl = document.querySelector(
            `#editor .block[data-id="${nextBlock.id}"] .line[data-line-id="${nextLines[0].id}"]`
          );
          if (firstLineEl){ placeCaretStart(firstLineEl); firstLineEl.focus(); return; }
        }
        placeCaretStart(nextEditable);
        nextEditable.focus();
      }
    }
    return;
  }
}

/* ============================================================
   Блоки
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

  /* ============================================================
     ПАТЧ 2.3.1: LINE_TYPES — рендерим через .line
     ============================================================ */

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

    /* todo — чекбокс перед строками */
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

    /* Контейнер для строк */
    const linesWrap = el("div", "lines");
    linesWrap.style.flex = "1";
    linesWrap.style.minWidth = "0";

    b.lines.forEach((ln, i) => {
      linesWrap.append(renderLine(b, ln, i));
    });

    body.append(linesWrap);
    w.append(body);
    return w;
  }

  /* ============================================================
     Остальные типы (ul, ol, text без lines)
     ============================================================ */

  const tag =
    b.type === "ul" ? "ul" :
    b.type === "ol" ? "ol" : "div";

  body = el(tag, "body");

  body.innerHTML = toDisplayHTML(getBlockHTML(b));

  body.contentEditable = true;
  body.spellcheck = b.type !== "code";
  body.dir = "auto";
  body.dataset.placeholder = "Пишите здесь…";

  body.onfocus = () => { setActive(b.id); setSelectedBlock(b.id); };
  body.oninput = () => {
    const before = snapshot();
    b.content = toSourceHTML(body.innerHTML);

    try { window.App.wikilinkPopover?.onInput(b, body); } catch(e){}

    if ((b.type === "ul" || b.type === "ol") && listIsEmpty(body)){
      const old = snapshot();
      b.type = "text";
      b.content = "";
      b.lines = [];
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
   ПАТЧ 2.1: Columns
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

let _colsDrag = null;

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

  bindColumnResizer();

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
  if (!w) return;

  const firstLine = w.querySelector(".line");
  if (firstLine){ firstLine.focus(); return; }

  w.querySelector("[contenteditable]")?.focus();
}

/* ---------- Tab helpers (для ul/ol) ---------- */

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
      b.type = type;
      if (type === "ul" || type === "ol"){
        b.content = "<li><br></li>";
        b.lines = [];
        if (type === "ul" && !b.marker) b.marker = "disc";
      } else if (LINE_TYPES.has(type)){
        b.lines = [newLine("")];
        b.content = "";
      } else {
        b.content = "";
        b.lines = [];
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
      b.lines = [];
      commit(old);
      render();
      setSelectedBlock(b.id);
      return true;
    }
  }
  return false;
}

/* ---------- keyBlock — для ul/ol (не для LINE_TYPES) ---------- */

function keyBlock(e, b, body){
  if (window.App.wikilinkPopover && window.App.wikilinkPopover.isOpen()){
    if (window.App.wikilinkPopover.handleKey(e, b, body)) return;
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
      b.lines = [];
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
          b.lines = [];
          commit(old);
          render();
          setSelectedBlock(b.id);
          setTimeout(focusActive, 0);
        }
        return;
      }
    }
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
   Глобальный обработчик клика по wikilink
   ============================================================ */

function bindWikilinkClicks(){
  document.addEventListener("click", e => {
    const link = e.target.closest(".wikilink");
    if (!link) return;

    e.preventDefault();
    e.stopPropagation();

    const name       = link.getAttribute("data-wikilink") || link.textContent;
    const id         = link.getAttribute("data-wikilink-id");
    const bAnchor    = link.getAttribute("data-wikilink-block-anchor") || "";
    const lAnchor    = link.getAttribute("data-wikilink-line-anchor") || "";
    const fAnchor    = link.getAttribute("data-wikilink-fragment-anchor") || "";
    const S          = window.App.state.S;

    const openDoc = (docId) => {
      Promise.resolve(window.App.state.setActiveDoc(docId)).then(() => {
        if (bAnchor || lAnchor){
          window.App.state.scrollToAnchorPath(docId, bAnchor, lAnchor, fAnchor);
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
  checkInputRules, keyBlock, keyLine,
  applySavedFonts, makePasteHandler,
  cleanupEmptyLis,
  toDisplayHTML, toSourceHTML,
  bindWikilinkClicks,
  bindColumnResizer
};

})();