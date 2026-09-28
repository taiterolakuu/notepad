/* ============================================================
   menus/floatbar.js — floatbar, списки, strike, marker menu

   [Пакет 5]  listItemsHTML через parseHTMLFragment.
   [Пакет 12] createLink только http(s):/mailto:; floatbarDragging
              сбрасывается на document.mouseup; blockToOneLi
              через getBlockHTML; syncContentFromSelection —
              не трогает колонки и ячейки таблиц.
   [Пакет 15] aria-pressed на кнопках.

   Зависит от: menus/_shared
   ============================================================ */

window.App = window.App || {};

window.App.menusFloatbar = (() => {
"use strict";

const S = window.App.menusShared;
const {
  $, $$, toast, escape,
  St, setActive, setSelectedBlock,
  snapshot, commit, commitDebounced, save,
  render, focusActive,
  ALIGN_CMDS,
  U
} = S;

/* ---------- Множество блоков по выделению ---------- */

function getSelectedBlockRange(){
  const sel = getSelection();
  if (!sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const blockEls = $$("#editor .block");
  return blockEls.filter(w => {
    try { return range.intersectsNode(w); } catch(e){ return false; }
  });
}

function getBlockUnderCaret(){
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const node = sel.anchorNode;
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const wrap = el?.closest(".block");
  return St().blocks.find(x => x.id === wrap?.dataset.id) || null;
}

function getBlockFromLastRange(){
  const lr = S.lastRange;
  if (!lr) return null;
  const node = lr.startContainer;
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  const wrap = el?.closest(".block");
  return St().blocks.find(x => x.id === wrap?.dataset.id) || null;
}

function getActiveBlockForToolbar(){
  return getBlockUnderCaret()
      || getBlockFromLastRange()
      || (St().selectedId
            ? St().blocks.find(b => b.id === St().selectedId) || null
            : null);
}

/* ---------- Списки (ul/ol) ---------- */

/* [Пакет 5] через template, не div.innerHTML */
function listItemsHTML(content){
  const frag = U.parseHTMLFragment(content || "");
  const lis = [...frag.querySelectorAll("li")];
  return lis.map(li => li.innerHTML || "<br>");
}

/* [Пакет 12] blockToOneLi через getBlockHTML — учитывает lines */
function blockToOneLi(b){
  if (b.type === "ul" || b.type === "ol"){
    return listItemsHTML(b.content);
  }
  if (Array.isArray(b.lines) && b.lines.length){
    return b.lines.map(l => l.text || "<br>");
  }
  const html = U.getBlockHTML(b);
  return [html || "<br>"];
}

function mergeBlocksIntoList(ids, kind, marker){
  const blocks = St().blocks;
  const indices = ids
    .map(id => blocks.findIndex(b => b.id === id))
    .filter(i => i >= 0)
    .sort((a, b) => a - b);
  if (!indices.length) return;

  const firstIdx = indices[0];
  const lastIdx  = indices[indices.length - 1];

  const items = [];
  for (let i = firstIdx; i <= lastIdx; i++){
    const b = blocks[i];
    if (!b) continue;
    blockToOneLi(b).forEach(html => items.push(html));
  }

  const newBlock = U.block(kind, "");
  newBlock.content = items.map(h => `<li>${h}</li>`).join("");
  newBlock.lines = [];
  if (kind === "ul") newBlock.marker = marker || "disc";

  const src = blocks[firstIdx];
  newBlock.bg     = src.bg     || "";
  newBlock.font   = src.font   || "";
  newBlock.indent = src.indent || 0;
  newBlock.align  = src.align  || "left";

  blocks.splice(firstIdx, lastIdx - firstIdx + 1, newBlock);
  return newBlock;
}

function splitListBlock(block){
  const blocks = St().blocks;
  const i = blocks.findIndex(b => b.id === block.id);
  if (i < 0) return null;

  const items = listItemsHTML(block.content);
  if (!items.length){
    const text = U.block("text", "");
    text.bg     = block.bg     || "";
    text.font   = block.font   || "";
    text.indent = block.indent || 0;
    text.align  = block.align  || "left";
    blocks.splice(i, 1, text);
    return text;
  }

  const replacements = items.map(html => {
    const t = U.block("text", html === "<br>" ? "" : html);
    t.bg     = block.bg     || "";
    t.font   = block.font   || "";
    t.indent = block.indent || 0;
    t.align  = block.align  || "left";
    return t;
  });
  blocks.splice(i, 1, ...replacements);
  return replacements[0];
}

function classifySelection(blocks){
  const allUl = blocks.length && blocks.every(b =>
    b.type === "ul" &&
    (b.marker || "disc") === (blocks[0].marker || "disc"));
  const allOl = blocks.length && blocks.every(b => b.type === "ol");
  return { allUl, allOl };
}

function toggleListForSelection(kind, marker){
  const els = getSelectedBlockRange();
  let blocks;

  if (els.length){
    const ids = els.map(w => w.dataset.id);
    blocks = St().blocks.filter(b => ids.includes(b.id));
  } else {
    const b = getBlockUnderCaret();
    if (!b) return;
    blocks = [b];
  }

  if (!blocks.length) return;

  const { allUl, allOl } = classifySelection(blocks);
  const old = snapshot();

  if (kind === "ul" && allUl && (blocks[0].marker || "disc") === (marker || "disc")){
    const first = blocks[0];
    splitListBlock(first);
    for (let k = 1; k < blocks.length; k++){
      const b = blocks[k];
      if (b.type === "ul") splitListBlock(b);
    }
  } else if (kind === "ol" && allOl){
    blocks.forEach(b => splitListBlock(b));
  } else {
    const ids = blocks.map(b => b.id);
    const nb = mergeBlocksIntoList(ids, kind, marker);
    if (nb) setActive(nb.id);
  }

  commit(old);
  render();
  if (blocks[0]?.id) setSelectedBlock(blocks[0].id);
  setTimeout(() => focusActive(), 0);
}

function applyMarkerToSelection(marker){
  toggleListForSelection("ul", marker || "disc");
}
function applyOlToSelection(){
  toggleListForSelection("ol");
}

/* ---------- Strike ---------- */

const STRIKE_TAGS = ["S","STRIKE","DEL"];

function selectionHasStrike(){
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const frag = range.cloneContents();
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node){
    if (STRIKE_TAGS.includes(node.tagName)) return true;
    node = walker.nextNode();
  }
  const anchor = sel.anchorNode?.parentElement;
  if (anchor?.closest?.("s, strike, del")) return true;
  return false;
}

function unwrapTagsInRange(range, tags){
  const container = range.commonAncestorContainer;
  const root = container.nodeType === 1 ? container : container.parentElement;
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toUnwrap = [];
  let n = walker.nextNode();
  while (n){
    if (tags.includes(n.tagName)) toUnwrap.push(n);
    n = walker.nextNode();
  }
  toUnwrap.forEach(el => {
    const parent = el.parentNode;
    while (el.firstChild) parent.insertBefore(el.firstChild, el);
    parent.removeChild(el);
  });
}

function applyStrike(){
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;

  if (selectionHasStrike()){
    document.execCommand("strikeThrough", false, null);
    const range = sel.getRangeAt(0);
    unwrapTagsInRange(range, STRIKE_TAGS);
  } else {
    document.execCommand("strikeThrough", false, null);
  }
}

/* ============================================================
   [Пакет 12] syncContentFromSelection
   Колонки и ячейки таблиц не трогаем — модель уже обновлена
   через oninput в render/block.js.
   ============================================================ */

function _isColBody(node){
  /* .col > .body с data-col */
  const body = node?.closest?.(".body");
  if (!body) return false;
  if (body.dataset && body.dataset.col !== undefined) return true;
  /* .col-resizer → ближайший .col */
  if (node?.closest?.(".col")) return true;
  return false;
}

function _isTableCell(node){
  const cell = node?.closest?.("td, th");
  return !!cell;
}

function syncContentFromSelection(){
  const blk = getActiveBlockForToolbar();
  if (!blk) return;
  const sel = getSelection();
  const node = sel.anchorNode?.parentElement;

  /* [Пакет 12] строка LINE_TYPES — пишем в lines[idx].text */
  const lineEl = node?.closest?.(".line");
  if (lineEl && blk.lines){
    const idx = parseInt(lineEl.dataset.lineIndex, 10);
    if (blk.lines[idx]){
      const before = snapshot();
      blk.lines[idx].text = window.App.render.toSourceHTML(lineEl.innerHTML);
      blk.content = blk.lines.map(l => l.text).join("<br>");
      save();
      commitDebounced(before);
      return;
    }
  }

  /* [Пакет 12] колонки и ячейки таблицы — НЕ трогаем */
  if (_isColBody(node) || _isTableCell(node)){
    /* Ничего не пишем в blk.content.
       oninput в render/block.js уже обновил b.content[i] / b.rows[ri][ci]. */
    save();
    return;
  }

  /* Обычный .body (ul/ol/text/quote/code) — как было */
  const body = node?.closest(".body")
    || S.lastRange?.startContainer?.parentElement?.closest?.(".body");
  if (body){
    const before = snapshot();
    window.App.render.cleanupEmptyLis(body);
    blk.content = window.App.render.toSourceHTML(body.innerHTML);
    save();
    commitDebounced(before);
  }
}

/* ---------- Восстановление range ---------- */

function restoreLastRange(){
  if (!S.lastRange) return;
  try {
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(S.lastRange);
  } catch(e){}
}

/* ---------- Состояние кнопок floatbar ---------- */

function updateFloatbarState(){
  const checks = {
    bold:      document.queryCommandState("bold"),
    italic:    document.queryCommandState("italic"),
    underline: document.queryCommandState("underline")
  };

  const blk = getActiveBlockForToolbar();
  const strikeOn = selectionHasStrike();

  $$(".floatbar button").forEach(b => {
    const cmd = b.dataset.cmd;
    let on = false;

    if (cmd in checks){
      on = !!checks[cmd];
    } else if (cmd === "strike")       on = strikeOn;
    else if (cmd === "align-left")   on = !blk || blk.align === "left" || !blk.align;
    else if (cmd === "align-center") on = blk?.align === "center";
    else if (cmd === "align-right")  on = blk?.align === "right";
    else if (cmd === "numbered")     on = blk?.type === "ol";
    else if (cmd === "bullets")      on = blk?.type === "ul";

    b.classList.toggle("on", on);
    if (cmd === "bullets" || cmd === "font"){
      b.setAttribute("aria-haspopup", "menu");
    }
    b.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

/* ---------- Marker menu ---------- */

function toggleMarkerMenu(anchor){
  const menu = $("#markermenu");
  if (!menu) return;

  if (S.markerMenuOpen){
    closeMarkerMenu();
    return;
  }

  menu.dataset.display = "flex";
  menu.style.display = "flex";
  menu.setAttribute("role", "menu");

  const r = anchor.getBoundingClientRect();
  U.positionFloating(menu, r, { preferBelow: true, gap: 6, margin: 8 });

  menu.querySelectorAll("button").forEach(btn => {
    btn.classList.remove("on");
    btn.onmousedown = e => e.preventDefault();
    btn.onclick = () => {
      const m = btn.dataset.marker;
      applyMarkerToSelection(m === "none" ? "" : m);
      closeMarkerMenu();
    };
  });

  S.markerMenuOpen = true;
}

function closeMarkerMenu(){
  const menu = $("#markermenu");
  if (menu) menu.style.display = "none";
  S.markerMenuOpen = false;
}

/* ---------- createLink — только http(s): и mailto: ---------- */

function _safeUrl(url){
  const s = String(url || "").trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^mailto:/i.test(s)) return s;
  return "";
}

/* ---------- Привязка обработчиков ---------- */

function bindFloatbar(){
  $$(".floatbar button").forEach(b => {
    b.onmousedown = e => {
      S.floatbarDragging = true;
      const s = getSelection();
      if (s.rangeCount && !s.isCollapsed){
        S.lastRange = s.getRangeAt(0).cloneRange();
      }
      e.preventDefault();
    };

    b.addEventListener("mouseup", () => {
      setTimeout(() => { S.floatbarDragging = false; }, 0);
    });

    b.onclick = () => {
      try {
        restoreLastRange();

        const cmd = b.dataset.cmd;

        if (cmd === "font"){
          window.App.menusHandleMenu.openFontMenu(b);
          return;
        }

        if (ALIGN_CMDS.has(cmd)){
          const els = getSelectedBlockRange();
          const ids = els.length
            ? els.map(w => w.dataset.id)
            : (() => {
                const blk = getActiveBlockForToolbar();
                return blk ? [blk.id] : [];
              })();
          if (ids.length){
            const old = snapshot();
            ids.forEach(id => {
              const blk = St().blocks.find(x => x.id === id);
              if (blk) blk.align =
                cmd === "align-left"   ? "left"   :
                cmd === "align-center" ? "center" : "right";
            });
            commit(old);
            render();
          }
          restoreLastRange();
          updateFloatbarState();
          return;
        }

        if (cmd === "bullets"){
          toggleMarkerMenu(b);
          return;
        }
        if (cmd === "numbered"){
          applyOlToSelection();
          updateFloatbarState();
          return;
        }

        if (cmd === "strike"){
          applyStrike();
          syncContentFromSelection();
          updateFloatbarState();
          return;
        }

        if (cmd === "link"){
          const raw = prompt("URL:", "https://");
          const url = _safeUrl(raw);
          if (url){
            document.execCommand("createLink", false, url);
            try {
              const sel = getSelection();
              const node = sel.anchorNode?.parentElement;
              const a = node?.closest?.("a");
              if (a && !a.classList.contains("wikilink")){
                a.setAttribute("target", "_blank");
                a.setAttribute("rel", "noopener noreferrer");
              }
            } catch(e){}
          } else if (raw !== null){
            toast("Разрешены только http(s) и mailto");
          }
        }
        else if (cmd === "highlight"){
          document.execCommand("hiliteColor", false, "#f3e4a6");
        }
        else if (cmd === "clear"){
          document.execCommand("removeFormat", false, null);
          document.execCommand("unlink", false, null);
        }
        else if (cmd === "h1"){
          const blk = getActiveBlockForToolbar();
          if (blk){
            const old = snapshot();
            /* [Пакет 12] конвертим тип с сохранением содержимого */
            if (typeof U.convertBlockType === "function" && blk.type !== "h1"){
              U.convertBlockType(blk, "h1");
            } else {
              blk.type = "h1";
            }
            commit(old);
            render();
            setSelectedBlock(blk.id);
            setTimeout(() => {
              focusActive();
              updateFloatbarState();
            }, 0);
          }
          return;
        }
        else {
          document.execCommand(cmd, false, null);
        }

        restoreLastRange();
        syncContentFromSelection();
        updateFloatbarState();
      } finally {
        S.floatbarDragging = false;
      }
    };
  });

  document.addEventListener("mouseup", () => {
    if (S.floatbarDragging){
      setTimeout(() => { S.floatbarDragging = false; }, 0);
    }
  });
}

return {
  bindFloatbar,
  toggleListForSelection,
  applyMarkerToSelection,
  applyOlToSelection,
  applyStrike,
  selectionHasStrike,
  syncContentFromSelection,
  updateFloatbarState,
  getSelectedBlockRange,
  getBlockUnderCaret,
  getBlockFromLastRange,
  getActiveBlockForToolbar,
  restoreLastRange,
  toggleMarkerMenu,
  closeMarkerMenu,
  mergeBlocksIntoList,
  splitListBlock,
  listItemsHTML,
  blockToOneLi,
  classifySelection
};
})();