/* ============================================================
   render/line.js — рендер строки + keyLine

   [Пакет 5]  toDisplayHTML/toSourceHTML — через renderWikilinks.
   [Пакет 9]  slash-меню: maybeOpen в oninput, slashKeydown в keyLine.
   [Пакет 12] keyLine: Enter split через toSourceHTML;
              e.isComposing guard для IME.
   [Фикс]     keyLine ищет строку по lineId в актуальном b.lines,
              не полагается на замыкание `ln` — защита от
              пересоздания b.lines через syncBlockLines.
              oninput использует e.isComposing (InputEvent),
              не ручной dataset.composing.

   Зависит от: render/_shared, render/wikilinks, render/paste
   ============================================================ */

window.App = window.App || {};

window.App.renderLine = (() => {
"use strict";

const S = window.App.renderShared;
const {
  el, LINE_TYPES, newLine,
  St, setActive, setSelectedBlock,
  snapshot, commit, commitDebounced, save
} = S;

const render = () => window.App.render.render();

const Wikilinks = () => window.App.renderWikilinks;
const Paste     = () => window.App.renderPaste;

/* ---------- Хелпер: найти актуальную строку в b.lines по id ---------- */

function findLnById(b, lineId){
  if (!b || !Array.isArray(b.lines) || !lineId) return null;
  return b.lines.find(l => l.id === lineId) || null;
}

function findLnIndexById(b, lineId){
  if (!b || !Array.isArray(b.lines) || !lineId) return -1;
  return b.lines.findIndex(l => l.id === lineId);
}

/* ---------- Рендер строки ---------- */

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

  const text = ln.text || "";
  if (text && text.trim()){
    lineEl.innerHTML = Wikilinks().toDisplayHTML(text);
  } else {
    lineEl.innerHTML = "<br>";
  }

  lineEl.onfocus = () => {
    setActive(b.id);
    setSelectedBlock(b.id);
  };

  lineEl.oninput = (e) => {
    /* [Пакет 12] InputEvent.isComposing — надёжнее ручного флага.
       Ручной dataset.composing убран — он «залипал» в Chrome. */
    if (e && e.isComposing) return;

    const before = snapshot();

    /* Работаем с актуальной строкой по id, не с замыканием `ln` */
    const currentLn = findLnById(b, lineEl.dataset.lineId);
    if (!currentLn) return;

    let html = lineEl.innerHTML;
    if (html === "<br>" || html === "<br/>" || html === "<br />"){
      html = "";
    }
    currentLn.text = Wikilinks().toSourceHTML(html);
    b.content = b.lines.map(l => l.text).join("<br>");

    try { window.App.wikilinkPopover?.onInput(b, lineEl); } catch(e){}
    try { window.App.menusSlash?.maybeOpen?.(lineEl, b.id); } catch(e){}

    save();
    commitDebounced(before);
  };

  lineEl.onkeydown = (e) => keyLine(e, b, lineEl);
  lineEl.onpaste = Paste().makePasteHandler(lineEl);

  return lineEl;
}

/* ---------- Caret helpers ---------- */

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

/* ---------- keyLine ---------- */

function keyLine(e, b, lineEl){
  /* [Пакет 12] IME — не вмешиваемся */
  if (e.isComposing || e.keyCode === 229) return;

  /* [Пакет 9] слэш-меню имеет приоритет */
  if (window.App.menusSlash?.slashKeydown?.(e)) return;

  if (window.App.wikilinkPopover && window.App.wikilinkPopover.isOpen()){
    if (window.App.wikilinkPopover.handleKey(e, b, lineEl)) return;
  }

  /* Актуальные индексы/объект строки — на момент нажатия */
  const lineId = lineEl.dataset.lineId;
  let i = findLnIndexById(b, lineId);
  if (i < 0) return;
  let ln = b.lines[i];

  const isMod = e.ctrlKey || e.metaKey;

  /* ---------- Ctrl+Enter → новый блок ---------- */
  if (isMod && !e.shiftKey && e.key === "Enter"){
    e.preventDefault();
    const blocks = window.App.state.getBlocks();
    const idx = blocks.findIndex(x => x.id === b.id);
    window.App.render.add("text", idx + 1);
    return;
  }

  /* ---------- Ctrl+Backspace → удалить строку ---------- */
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
      b.lines[0].text = "";
      b.content = "";
      commit(old);
      render();
    }
    return;
  }

  /* ---------- Enter → split ---------- */
  if (e.key === "Enter" && !e.shiftKey){
    e.preventDefault();

    const sel = getSelection();
    if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0);
    if (!lineEl.contains(r.startContainer)) return;

    /* BEFORE */
    const beforeRange = document.createRange();
    beforeRange.setStart(lineEl, 0);
    beforeRange.setEnd(r.startContainer, r.startOffset);
    const beforeFrag = beforeRange.cloneContents();
    const beforeDiv = document.createElement("div");
    beforeDiv.appendChild(beforeFrag);
    let beforeHTML = beforeDiv.innerHTML;
    if (!beforeHTML && r.startContainer.nodeType === Node.TEXT_NODE){
      beforeHTML = r.startContainer.textContent.slice(0, r.startOffset);
    }

    /* AFTER */
    const afterRange = document.createRange();
    afterRange.setStart(r.startContainer, r.startOffset);
    afterRange.setEnd(lineEl, lineEl.childNodes.length);
    const afterFrag = afterRange.cloneContents();
    const afterDiv = document.createElement("div");
    afterDiv.appendChild(afterFrag);
    let afterHTML = afterDiv.innerHTML;
    if (!afterHTML && r.startContainer.nodeType === Node.TEXT_NODE){
      afterHTML = r.startContainer.textContent.slice(r.startOffset);
    }

    const beforeSrc = Wikilinks().toSourceHTML(beforeHTML);
    const afterSrc  = Wikilinks().toSourceHTML(afterHTML);

    const old = snapshot();

    /* Берём актуальную строку по id, не замыкание */
    const cur = findLnById(b, lineId);
    if (!cur) return;
    cur.text = beforeSrc;

    const newLn = newLine(afterSrc);

    /* Индекс пересчитываем на момент вставки */
    const idxNow = findLnIndexById(b, lineId);
    if (idxNow < 0) return;

    b.lines.splice(idxNow + 1, 0, newLn);
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

  /* ---------- Backspace в начале строки → merge ---------- */
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
    e.preventDefault();

    /* Актуальные строки */
    const cur  = findLnById(b, lineId);
    if (!cur) return;
    const prevLn = b.lines[i - 1];
    if (!prevLn) return;

    const curText = cur.text || "";
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
          const rr = document.createRange();
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
            rr.setStart(targetNode, targetOffset);
            rr.collapse(true);
            const s = getSelection();
            s.removeAllRanges();
            s.addRange(rr);
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

  /* ---------- Delete в конце → merge со следующей ---------- */
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

    const cur = findLnById(b, lineId);
    if (!cur) return;
    const nextLn = b.lines[i + 1];
    if (!nextLn) return;

    const old = snapshot();
    cur.text = (cur.text || "") + (nextLn.text || "");
    b.lines.splice(i + 1, 1);
    b.content = b.lines.map(l => l.text).join("<br>");
    commit(old);
    render();

    setTimeout(() => {
      const el2 = document.querySelector(
        `#editor .block[data-id="${b.id}"] .line[data-line-id="${cur.id}"]`
      );
      if (el2){ placeCaretEnd(el2); el2.focus(); }
    }, 0);
    return;
  }

  /* ---------- ArrowUp ---------- */
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

  /* ---------- ArrowDown ---------- */
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

return {
  renderLine, keyLine,
  caretAtStart, caretAtEnd, placeCaretStart, placeCaretEnd
};
})();