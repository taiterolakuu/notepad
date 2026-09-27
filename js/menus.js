/* ============================================================
   menus.js
   ============================================================ */

window.App = window.App || {};

window.App.menus = (() => {
"use strict";

const U = window.App.utils;
const {
  $,$$, types, htmlToText, uid, toast, escape
} = U;

const St = () => window.App.state.S;
const setActive = v => window.App.state.setActive(v);
const setSlashBlockId = v => window.App.state.setSlashBlockId(v);
const getSlashBlockId = () => window.App.state.slashBlockId;
const setSelectedBlock = v => window.App.state.setSelectedBlock(v);
const setSelectedRange = (a, b) => window.App.state.setSelectedRange(a, b);
const clearSelectedRange = () => window.App.state.clearSelectedRange();
const clearSelection = () => window.App.state.clearSelection();

const snapshot = () => window.App.state.snapshot();
const commit = b => window.App.state.commit(b);
const commitDebounced = b => window.App.state.commitDebounced(b);
const save = () => window.App.state.save();
const saveNow = () => window.App.state.saveNow();
const undo = () => window.App.state.undo();
const redo = () => window.App.state.redo();

const render = () => window.App.render.render();
const add = (...a) => window.App.render.add(...a);
const focusActive = () => window.App.render.focusActive();

let lastRange         = null;
let fontMenuOpen      = false;
let handleMenuOpen    = false;
let handleMenuBlock   = null;
let markerMenuOpen    = false;
let floatbarDragging  = false;
let cmdIndex          = 0;
let lastCmdLen        = -1;
let slashBody         = null;

const ALIGN_CMDS = new Set(["align-left","align-center","align-right"]);

/* ---------- Slash ---------- */

function openSlash(body, blockId){
  slashBody = body;
  setSlashBlockId(blockId);
  const r = body.getBoundingClientRect();
  const m = $("#slash");
  m.style.left = Math.min(r.left, innerWidth - 315) + "px";
  m.style.top  = (r.bottom + 4) + "px";
  m.style.display = "block";
  $("#slashinput").value = "";
  slashRender();
}

function slashRender(){
  const q = $("#slashinput").value.toLowerCase();
  const arr = types.filter(x =>
    (x[0] + x[1] + x[2]).toLowerCase().includes(q));

  $("#slashresults").innerHTML = arr.map((x, i) =>
    `<div class="result ${i === 0 ? "sel" : ""}" data-type="${x[0]}">
        <b>${x[1]}</b><small>${x[2]}</small>
     </div>`
  ).join("");

  $$(".slash .result").forEach(x =>
    x.onclick = () => slashChoose(x.dataset.type));
}

function slashChoose(type){
  const b = St().blocks.find(x => x.id === getSlashBlockId());
  if (b && b.type === "text"){
    const old = snapshot();
    b.type = type;
    if (type === "columns"){ b.cols = 2; b.content = ["", ""]; }
    else if (type === "table"){ b.rows = [["",""],["",""]]; b.content = ""; }
    else if (type === "ul" || type === "ol"){
      b.content = "<li><br></li>";
      if (type === "ul" && !b.marker) b.marker = "disc";
    }
    else b.content = "";
    commit(old);
    render();
    setActive(b.id);
    setSelectedBlock(b.id);
    focusActive();
  }
  setSlashBlockId(null);
  slashBody = null;
  $("#slash").style.display = "none";
}

/* ---------- Command palette ---------- */

const commands = [
  ["Новый документ",   "Создать чистую страницу",   "new"],
  ["Текст",            "Добавить абзац",            "text"],
  ["Заголовок 1",      "Добавить H1",               "h1"],
  ["Заголовок 2",      "Добавить H2",               "h2"],
  ["Чек-лист",         "Добавить задачу",           "todo"],
  ["Таблица",          "Добавить таблицу",          "table"],
  ["Колонки",          "Добавить колонки",          "columns"],
  ["Изображение",      "Добавить изображение",      "image"],
  ["Разделитель",      "Добавить линию",            "divider"],
  ["Сохранить",        "Сохранить сейчас",          "save"],
  ["Экспорт HTML",     "Скачать автономный HTML",   "export"],
  ["Экспорт Markdown", "Скачать Markdown",          "md"],
  ["Печать / PDF",     "Открыть печать",            "print"],

  ["Шрифт: Inter",             "Основной, по умолчанию",  "font:body:Inter"],
  ["Шрифт: Open Sans",         "Основной, гуманистический","font:body:Open Sans"],
  ["Шрифт: Plus Jakarta Sans", "Основной, современный",   "font:body:Plus Jakarta Sans"],

  ["Шрифт H: Montserrat",      "Заголовки, геометрия",    "font:head:Montserrat"],
  ["Шрифт H: Manrope",         "Заголовки, сглаженный",   "font:head:Manrope"],
  ["Шрифт H: Outfit",          "Заголовки, премиум",      "font:head:Outfit"],
  ["Шрифт H: Inter",           "Заголовки, как текст",    "font:head:Inter"],

  ["Шрифт S: Lora",            "Каллиграфический",        "font:serif:Lora"],
  ["Шрифт S: PT Serif",        "Экранная антиква",        "font:serif:PT Serif"],
  ["Шрифт S: Merriweather",    "Для чтения",              "font:serif:Merriweather"],

  ["Шрифт M: JetBrains Mono",  "Код, по умолчанию",       "font:mono:JetBrains Mono"],
  ["Шрифт M: Fira Code",       "Код, гуманистический",    "font:mono:Fira Code"],

  ["Тема: Paper",      "Светлая бумага",            "theme:paper"],
  ["Тема: Sepia",      "Тёплая бумага",             "theme:sepia"],
  ["Тема: Mint",       "Мята",                      "theme:mint"],
  ["Тема: Dark",       "Тёмная",                    "theme:dark"]
];

function openPalette(){
  $("#palette").style.display = "block";
  $("#backdrop").style.display = "block";
  $("#cmdinput").value = "";
  cmdIndex = 0;
  lastCmdLen = -1;
  cmdRender();
  $("#cmdinput").focus();
}

function closeMenus(){
  $("#palette").style.display = "none";
  $("#slash").style.display = "none";
  $("#backdrop").style.display = "none";
  setSlashBlockId(null);
}

function cmdRender(){
  const q = $("#cmdinput").value.toLowerCase();
  const a = commands.filter(x =>
    (x[0] + x[1]).toLowerCase().includes(q));

  if (a.length !== lastCmdLen){
    cmdIndex = 0;
    lastCmdLen = a.length;
  }
  if (a.length === 0) cmdIndex = 0;
  if (cmdIndex >= a.length) cmdIndex = Math.max(0, a.length - 1);

  $("#cmdresults").innerHTML = a.map((x, i) =>
    `<div class="result ${i === cmdIndex ? "sel" : ""}" data-c="${x[2]}">
       ${x[0]}<small>${x[1]}</small>
     </div>`
  ).join("");

  $$("#cmdresults .result").forEach(x =>
    x.onclick = () => run(x.dataset.c));
}

function run(c){
  closeMenus();

  if (c === "new"){
    if (confirm("Создать новый документ?")){
      const old = snapshot();
      window.App.state.history.push(old);
      St().title = "";
      St().blocks = [U.block("text", "")];
      St().selectedId = null;
      St().selectedRange = null;
      render();
      focusActive();
      save();
    }
  }
  else if (c === "save")  { saveNow(); toast("Сохранено"); }
  else if (c === "export"){ window.App.io.downloadHTML(); }
  else if (c === "md")    { window.App.io.downloadMD(); }
  else if (c === "print") { print(); }
  else if (c.startsWith("theme:")){
    const old = snapshot();
    St().theme = c.slice(6);
    commit(old);
    render();
  }
  else if (c.startsWith("font:")){
    const parts = c.split(":");
    const role = parts[1];
    const name = parts.slice(2).join(":");
    const varMap = {
      body:  "--font-current",
      head:  "--font-heading-current",
      serif: "--font-serif",
      mono:  "--font-mono-current"
    };
    const cssVar = varMap[role];
    if (!cssVar) return;

    const fallback =
      role === "mono"  ? "ui-monospace, Consolas, monospace" :
      role === "serif" ? "Georgia, serif" :
                         "system-ui, sans-serif";

    document.documentElement.style.setProperty(cssVar, `'${name}', ${fallback}`);

    if (!St().fonts) St().fonts = {};
    St().fonts[role] = name;
    save();
    toast(`Шрифт: ${name}`);
  }
  else if (c === "image"){ window.App.io.openImagePicker(); }
  else if (["text","h1","h2","todo","table","columns","divider"].includes(c)){
    add(c);
  }
}

/* ============================================================
   Списки: работа на уровне блоков
   ============================================================ */

function getSelectedBlockRange(){
  const sel = getSelection();
  if (!sel.rangeCount) return [];
  const range = sel.getRangeAt(0);
  const blockEls = $$("#editor .block");
  return blockEls.filter(w => {
    try { return range.intersectsNode(w); } catch(e){ return false; }
  });
}

function listItemsHTML(content){
  const tmp = document.createElement("div");
  tmp.innerHTML = content || "";
  const lis = [...tmp.querySelectorAll("li")];
  return lis.map(li => li.innerHTML || "<br>");
}

function blockToOneLi(b){
  if (b.type === "ul" || b.type === "ol"){
    return listItemsHTML(b.content);
  }
  return [b.content || "<br>"];
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

/* ---------- Floatbar ---------- */

function bindFloatbar(){
  $$(".floatbar button").forEach(b => {
    b.onmousedown = e => {
      floatbarDragging = true;
      const s = getSelection();
      if (s.rangeCount && !s.isCollapsed){
        lastRange = s.getRangeAt(0).cloneRange();
      }
      e.preventDefault();
    };

    b.onclick = () => {
      try {
        restoreLastRange();

        const cmd = b.dataset.cmd;

        if (cmd === "font"){
          openFontMenu(b);
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
          const url = prompt("URL:", "https://");
          if (url) document.execCommand("createLink", false, url);
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
            blk.type = "h1";
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
        floatbarDragging = false;
      }
    };
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
  if (!lastRange) return null;
  const node = lastRange.startContainer;
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

function syncContentFromSelection(){
  const blk = getActiveBlockForToolbar();
  if (!blk) return;
  const sel = getSelection();
  const node = sel.anchorNode?.parentElement;
  const body = node?.closest(".body")
    || lastRange?.startContainer?.parentElement?.closest?.(".body");
  if (body){
    window.App.render.cleanupEmptyLis(body);
    blk.content = body.innerHTML;
    save();
    commitDebounced(snapshot());
  }
}

function restoreLastRange(){
  if (!lastRange) return;
  try {
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(lastRange);
  } catch(e){}
}

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
    if (cmd in checks){
      b.classList.toggle("on", !!checks[cmd]);
      return;
    }
    if (cmd === "strike")       b.classList.toggle("on", strikeOn);
    if (cmd === "align-left")   b.classList.toggle("on", !blk || blk.align === "left" || !blk.align);
    if (cmd === "align-center") b.classList.toggle("on", blk?.align === "center");
    if (cmd === "align-right")  b.classList.toggle("on", blk?.align === "right");
    if (cmd === "numbered")     b.classList.toggle("on", blk?.type === "ol");
    if (cmd === "bullets")      b.classList.toggle("on", blk?.type === "ul");
  });
}

/* ---------- Marker menu ---------- */

function toggleMarkerMenu(anchor){
  const menu = $("#markermenu");
  if (!menu) return;

  if (markerMenuOpen){
    closeMarkerMenu();
    return;
  }

  const r = anchor.getBoundingClientRect();
  const w = 7 * 34 + 10;
  const left = Math.min(r.left, window.innerWidth - w - 8);
  const top  = r.bottom + 6;
  menu.style.left = left + "px";
  menu.style.top  = top + "px";
  menu.style.display = "flex";

  menu.querySelectorAll("button").forEach(btn => {
    btn.classList.remove("on");
    btn.onmousedown = e => e.preventDefault();
    btn.onclick = () => {
      const m = btn.dataset.marker;
      applyMarkerToSelection(m === "none" ? "" : m);
      closeMarkerMenu();
    };
  });

  markerMenuOpen = true;
}

function closeMarkerMenu(){
  const menu = $("#markermenu");
  if (menu) menu.style.display = "none";
  markerMenuOpen = false;
}

/* ---------- Font menu ---------- */

const FONT_LIST = [
  { group: "Основной",  name: "Inter",            tag: "sans" },
  { group: "Основной",  name: "Open Sans",        tag: "sans" },
  { group: "Основной",  name: "Plus Jakarta Sans", tag: "sans" },

  { group: "Заголовки", name: "Montserrat",        tag: "head" },
  { group: "Заголовки", name: "Manrope",           tag: "head" },
  { group: "Заголовки", name: "Outfit",            tag: "head" },
  { group: "Заголовки", name: "Inter",            tag: "head" },

  { group: "Serif",     name: "Lora",              tag: "serif" },
  { group: "Serif",     name: "PT Serif",          tag: "serif" },
  { group: "Serif",     name: "Merriweather",      tag: "serif" },

  { group: "Mono",      name: "JetBrains Mono",    tag: "mono" },
  { group: "Mono",      name: "Fira Code",         tag: "mono" }
];

function openFontMenu(anchor){
  const menu = $("#fontmenu");
  const input = $("#fontmenu-input");
  if (!menu || !input) return;

  const r = anchor.getBoundingClientRect();
  const w = 230;
  const left = Math.min(r.left, window.innerWidth - w - 8);
  const top = r.bottom + 6;

  menu.style.left = left + "px";
  menu.style.top = top + "px";
  menu.style.display = "block";

  input.value = "";
  fontMenuRender("");
  fontMenuOpen = true;
}

function closeFontMenu(){
  const menu = $("#fontmenu");
  if (menu) menu.style.display = "none";
  fontMenuOpen = false;
}

function fontMenuRender(query){
  const list = $("#fontmenu-list");
  if (!list) return;

  const q = query.toLowerCase().trim();
  let html = "";
  let lastGroup = "";

  FONT_LIST.forEach(f => {
    if (q && !f.name.toLowerCase().includes(q)) return;
    if (f.group !== lastGroup){
      html += `<div class="fontmenu-group">${f.group}</div>`;
      lastGroup = f.group;
    }
    html += `
      <div class="fontmenu-item" data-font="${f.name}">
        <span class="fname" style="font-family:'${f.name}', system-ui, sans-serif">
          ${f.name}
        </span>
        <span class="ftag">${f.tag}</span>
      </div>`;
  });

  if (!html) html = `<div class="fontmenu-group">Ничего не найдено</div>`;
  list.innerHTML = html;

  list.querySelectorAll(".fontmenu-item").forEach(item => {
    item.onmousedown = e => e.preventDefault();
    item.onclick = () => {
      applyFontToSelection(item.dataset.font);
      closeFontMenu();
    };
  });
}

function applyFontToSelection(name){
  restoreLastRange();
  document.execCommand("fontName", false, name);

  const blk = getActiveBlockForToolbar();
  const sel = getSelection();
  const node = sel.anchorNode?.parentElement;
  const body = node?.closest(".body")
    || lastRange?.startContainer?.parentElement?.closest?.(".body");
  if (blk && body){
    blk.content = body.innerHTML;
    save();
    commitDebounced(snapshot());
  }

  toast(`Шрифт: ${name}`);
}

/* ---------- Handle menu ---------- */

function openHandleMenu(anchor, blockId){
  const menu = $("#handlemenu");
  if (!menu) return;

  handleMenuBlock = blockId;

  /* секция маркеров — всегда видна, только кнопки не подсвечены,
     если блок не ul/text. Так не прыгает высота меню. */
  const markerSection = menu.querySelector('[data-section="marker"]');
  if (markerSection) markerSection.hidden = false;

  /* измеряем высоту до показа — чтобы правильно спозиционировать */
  menu.style.visibility = "hidden";
  menu.style.display = "block";
  const mh = menu.offsetHeight;
  const mw = menu.offsetWidth || 280;

  const r = anchor.getBoundingClientRect();
  const left = Math.min(r.left + 24, window.innerWidth - mw - 8);

  const margin = 8;
  let top = r.top + 4;
  if (top + mh > window.innerHeight - margin){
    top = Math.max(margin, window.innerHeight - mh - margin);
  }

  menu.style.left = left + "px";
  menu.style.top  = top + "px";
  menu.style.visibility = "visible";

  syncHandleMenuState();
  handleMenuOpen = true;
}

function closeHandleMenu(){
  const menu = $("#handlemenu");
  if (menu) menu.style.display = "none";
  handleMenuOpen = false;
  handleMenuBlock = null;
}

function syncHandleMenuState(){
  const menu = $("#handlemenu");
  if (!menu || !handleMenuBlock) return;

  const b = St().blocks.find(x => x.id === handleMenuBlock);
  if (!b) return;

  menu.querySelectorAll("[data-group]").forEach(groupEl => {
    const group = groupEl.dataset.group;
    groupEl.querySelectorAll("button").forEach(btn => {
      const val = btn.dataset.val;
      let on = false;

      if (group === "type")   on = (b.type === val);
      if (group === "bg")     on = ((b.bg || "") === val);
      if (group === "font")   on = ((b.font || "") === val);
      if (group === "indent") on = (String(b.indent || 0) === val);
      if (group === "marker") on = ((b.marker || "disc") === val);

      btn.classList.toggle("on", on);
    });
  });
}

/* ---------- Bind UI ---------- */

function bindMenus(){
  $("#slashinput").oninput = slashRender;
  $("#slashinput").onkeydown = e => {
    if (e.key === "Escape") { setSlashBlockId(null); closeMenus(); }
    if (e.key === "Enter")  $$("#slashresults .result")[0]?.click();
  };

  $("#cmdinput").oninput = cmdRender;
  $("#cmdinput").onkeydown = e => {
    const items = $$("#cmdresults .result");
    const n = items.length;
    if (e.key === "ArrowDown"){
      e.preventDefault();
      if (!n) return;
      cmdIndex = (cmdIndex + 1) % n;
      cmdRender();
    } else if (e.key === "ArrowUp"){
      e.preventDefault();
      if (!n) return;
      cmdIndex = (cmdIndex + n - 1) % n;
      cmdRender();
    } else if (e.key === "Enter"){
      if (!n) return;
      items[Math.min(cmdIndex, n - 1)]?.click();
    } else if (e.key === "Escape"){
      closeMenus();
    }
  };

  $("#backdrop").onclick = closeMenus;

  const fontInput = $("#fontmenu-input");
  if (fontInput){
    fontInput.addEventListener("input", e => fontMenuRender(e.target.value));
    fontInput.addEventListener("keydown", e => {
      if (e.key === "Escape"){ closeFontMenu(); return; }
      if (e.key === "Enter"){
        const first = $("#fontmenu-list .fontmenu-item");
        if (first) first.click();
      }
    });
  }

  const handleMenu = $("#handlemenu");
  if (handleMenu){
    handleMenu.addEventListener("mousedown", e => {
      if (e.target.closest("[data-group] button, .hm-actions button")) e.preventDefault();
    });

    handleMenu.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const b = St().blocks.find(x => x.id === handleMenuBlock);
      if (!b) return;

      if (btn.dataset.action === "duplicate"){
        const old = snapshot();
        const copy = JSON.parse(JSON.stringify(b));
        copy.id = uid();
        const i = St().blocks.findIndex(x => x.id === b.id);
        St().blocks.splice(i + 1, 0, copy);
        commit(old);
        render();
        setSelectedBlock(copy.id);
        closeHandleMenu();
        return;
      }
      if (btn.dataset.action === "delete"){
        if (St().blocks.length <= 1) { toast("Нельзя удалить последний блок"); return; }
        const old = snapshot();
        const i = St().blocks.findIndex(x => x.id === b.id);
        St().blocks.splice(i, 1);
        const nextId = St().blocks[Math.max(0, i - 1)]?.id || null;
        commit(old);
        render();
        setSelectedBlock(nextId);
        closeHandleMenu();
        return;
      }

      const groupContainer = btn.closest("[data-group]");
      if (!groupContainer) return;
      const group = groupContainer.dataset.group;
      const val   = btn.dataset.val;

      const old = snapshot();

      if (group === "type"){
        b.type = val;
        if (val === "table"){
          b.rows = b.rows || [["",""],["",""]];
          b.content = "";
        } else if (val === "columns"){
          b.cols = b.cols || 2;
          b.content = Array.isArray(b.content) ? b.content : ["", ""];
        } else if (val === "ul" || val === "ol"){
          if (typeof b.content !== "string") b.content = "";
          if (!/<\/?li/i.test(b.content)) b.content = "<li><br></li>";
          if (val === "ul" && !b.marker) b.marker = "disc";
        } else {
          if (typeof b.content !== "string") b.content = "";
          if (val === "code") b.content = htmlToText(b.content);
        }
      }
      else if (group === "bg")     b.bg = val;
      else if (group === "font")   b.font = val;
      else if (group === "indent") b.indent = parseInt(val, 10) || 0;
      else if (group === "marker") b.marker = val;

      commit(old);
      render();
      setSelectedBlock(b.id);
      syncHandleMenuState();
    });
  }

  document.addEventListener("click", e => {
    const handle = e.target.closest(".handle");
    if (!handle) return;
    const blockEl = handle.closest(".block");
    if (!blockEl) return;
    if (blockEl.classList.contains("dragging")) return;

    e.preventDefault();
    e.stopPropagation();

    const id = blockEl.dataset.id;
    setActive(id);
    setSelectedBlock(id);
    openHandleMenu(handle, id);
  });

  document.addEventListener("mousedown", e => {
    if (fontMenuOpen){
      if (!e.target.closest("#fontmenu") &&
          !e.target.closest('.floatbar button[data-cmd="font"]')){
        closeFontMenu();
      }
    }

    if (handleMenuOpen){
      if (!e.target.closest("#handlemenu") &&
          !e.target.closest(".handle")){
        closeHandleMenu();
      }
    }

    if (markerMenuOpen){
      if (!e.target.closest("#markermenu") &&
          !e.target.closest('.floatbar button[data-cmd="bullets"]')){
        closeMarkerMenu();
      }
    }

    if (e.target.closest("#floatbar"))   return;
    if (e.target.closest("#palette"))    return;
    if (e.target.closest("#slash"))      return;
    if (e.target.closest("#fontmenu"))   return;
    if (e.target.closest("#handlemenu")) return;
    if (e.target.closest("#markermenu")) return;

    if (e.target.closest(".block"))      return;
    if (e.target.closest("header"))      return;
    if (e.target.closest(".title"))      return;

    clearSelection();
  });

  document.addEventListener("selectionchange", () => {
  /* пока взаимодействуем с floatbar — не прячем и не двигаем */
  if (floatbarDragging) return;

  const s = getSelection();

  /* нет выделения — прячем */
  if (!s.rangeCount || s.isCollapsed){
    $("#floatbar").style.display = "none";
    clearSelectedRange();
    return;
  }

  const anchorEl = s.anchorNode?.parentElement;
  const insideEditor = anchorEl?.closest(".editor");

  /* выделение вне редактора — прячем */
  if (!insideEditor){
    $("#floatbar").style.display = "none";
    clearSelectedRange();
    return;
  }

  /* диапазон блоков под выделением */
  const els = getSelectedBlockRange();
  if (els.length){
    const ids = els.map(w => w.dataset.id);
    const ordered = St().blocks.filter(b => ids.includes(b.id)).map(b => b.id);
    if (ordered.length){
      setSelectedRange(ordered[0], ordered[ordered.length - 1]);
    }
  } else {
    clearSelectedRange();
  }

  /* позиция — над первой строкой выделения */
  const range = s.getRangeAt(0);
  const rects = range.getClientRects();
  const rect = rects && rects.length ? rects[0] : range.getBoundingClientRect();

  if (!rect || (!rect.width && !rect.height)){
    $("#floatbar").style.display = "none";
    return;
  }

  const f = $("#floatbar");
  f.style.left = Math.max(8, rect.left) + "px";
  f.style.top  = Math.max(65, rect.top - 46) + "px";
  f.style.display = "flex";

  updateFloatbarState();
});

  document.addEventListener("keydown", e => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (ctrl && e.shiftKey && key === "7"){
      e.preventDefault();
      applyOlToSelection();
      return;
    }
    if (ctrl && e.shiftKey && key === "8"){
      e.preventDefault();
      const els = getSelectedBlockRange();
      const targets = els.length
        ? els
        : (() => {
            const b = getActiveBlockForToolbar();
            return b ? [$( `[data-id="${b.id}"]`)].filter(Boolean) : [];
          })();
      if (!targets.length) return;
      const ids = targets.map(w => w.dataset.id);
      const blocks = St().blocks.filter(b => ids.includes(b.id));
      const old = snapshot();
      blocks.forEach(b => {
        if (b.type === "ul" || b.type === "ol") splitListBlock(b);
      });
      commit(old);
      render();
      return;
    }

    if (ctrl && key === "k"){ e.preventDefault(); openPalette(); }
    if (ctrl && key === "z"){
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    }
    if (ctrl && key === "y"){ e.preventDefault(); redo(); }
    if (ctrl && key === "f"){ e.preventDefault(); $("#find").focus(); }
    if (e.key === "Escape"){
      if (markerMenuOpen)      closeMarkerMenu();
      else if (fontMenuOpen)   closeFontMenu();
      else if (handleMenuOpen) closeHandleMenu();
      else                     closeMenus();
    }
  });
}

return {
  openSlash, slashRender, slashChoose,
  openPalette, closeMenus, cmdRender, run,
  openFontMenu, closeFontMenu,
  openHandleMenu, closeHandleMenu,
  bindFloatbar, bindMenus,
  get handleMenuOpen(){ return handleMenuOpen; }
};

})();