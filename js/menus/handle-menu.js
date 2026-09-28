/* ============================================================
   menus/handle-menu.js — handle menu, font menu, ID, строки, колонки

   [Пакет 8]  fillLinesList — обрезка + tooltip; escape имён
              шрифтов в data-атрибутах.
   [Пакет 14] openHandleMenu не открывается для мёртвых блоков;
              fillLinesList проверяет массив.

   Зависит от: menus/_shared
   ============================================================ */

window.App = window.App || {};

window.App.menusHandleMenu = (() => {
"use strict";

const S = window.App.menusShared;
const {
  $, $$, toast, escape, htmlToText,
  LINE_TYPES, newLineFn, shortId,
  St, setActive, setSelectedBlock, getActiveDoc,
  snapshot, commit,
  render
} = S;

/* ---------- ID блока ---------- */

function fillIdSection(b){
  const idValue = document.getElementById("hm-id-value");
  const idInput = document.getElementById("hm-id-input");
  if (!idValue || !idInput) return;

  idValue.textContent = b.customId || b.id;
  idValue.hidden = false;
  idInput.hidden = true;
  idInput.value = "";
}

function bindIdInputOnce(){
  const idInput = document.getElementById("hm-id-input");
  const idValue = document.getElementById("hm-id-value");
  if (!idInput || idInput.dataset.bound) return;
  idInput.dataset.bound = "1";

  const commitId = () => {
    const b = St().blocks.find(x => x.id === S.handleMenuBlock);
    if (!b) return;

    const raw = String(idInput.value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\-_]/g, "")
      .slice(0, 64);

    if (!raw || raw === b.id){
      const old = snapshot();
      b.customId = "";
      commit(old);
      render();
      setSelectedBlock(b.id);
      idValue.textContent = b.id;
      return;
    }

    const doc = getActiveDoc();
    const dup = doc?.blocks.find(x =>
      x.id !== b.id && (x.customId === raw || x.id === raw)
    );

    let finalId = raw;
    if (dup){
      let n = 2;
      while (doc.blocks.some(x =>
        x.id !== b.id && (x.customId === `${raw}-${n}` || x.id === `${raw}-${n}`)
      )){
        n++;
      }
      finalId = `${raw}-${n}`;
      toast(`ID занят, использован #${finalId}`);
    }

    const old = snapshot();
    b.customId = finalId;
    commit(old);
    render();
    setSelectedBlock(b.id);
    idValue.textContent = finalId;
  };

  idInput.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter"){
      e.preventDefault();
      commitId();
      idInput.hidden = true;
      idValue.hidden = false;
    } else if (e.key === "Escape"){
      e.preventDefault();
      idInput.hidden = true;
      idValue.hidden = false;
      const b = St().blocks.find(x => x.id === S.handleMenuBlock);
      if (b) idValue.textContent = b.customId || b.id;
    }
  });

  idInput.addEventListener("blur", () => {
    if (!idInput.hidden){
      commitId();
      idInput.hidden = true;
      idValue.hidden = false;
    }
  });
}

/* ============================================================
   [Пакет 8, 14] Строки блока — обрезка + tooltip
   ============================================================ */

function fillLinesList(section, b){
  const list = section.querySelector('[data-group="lines-list"]');
  if (!list) return;
  if (!b || !Array.isArray(b.lines)){ list.innerHTML = ""; return; }

  list.innerHTML = b.lines.map((ln, i) => {
    const id = ln.customId || ln.id;
    const fullText = htmlToText(ln.text || "").trim() || "(пусто)";
    const short = fullText.length > 40
      ? fullText.slice(0, 40) + "…"
      : fullText;
    return `
      <div class="hm-line-row" data-line-id="${escape(id)}" data-line-index="${i}">
        <span class="hm-line-num">${i + 1}</span>
        <span class="hm-line-text" title="${escape(fullText)}">${escape(short)}</span>
        <span class="hm-line-id">#${escape(id)}</span>
        <button class="hm-id-btn" data-action="line-copy-id"   type="button" title="Копировать ID строки">ID</button>
        <button class="hm-id-btn" data-action="line-copy-link" type="button" title="Копировать ссылку на строку">🔗</button>
        <button class="hm-id-btn" data-action="line-edit-id"   type="button" title="Изменить ID строки">✎</button>
        <button class="hm-id-btn" data-action="line-remove-id" type="button" title="Удалить ID строки">✗</button>
      </div>`;
  }).join("");
}

/* ---------- Пропорции колонок ---------- */

function fillColsRatioButtons(section, b){
  if (!section) return;
  const row = section.querySelector('[data-group="cols-ratio"]');
  if (!row) return;
  row.innerHTML = "";

  const presets = {
    2: [
      { label: "1:1", w: [1,1] },
      { label: "2:1", w: [2,1] },
      { label: "1:2", w: [1,2] },
      { label: "3:1", w: [3,1] }
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

  const arr = presets[b.cols] || presets[2];
  arr.forEach(p => {
    const btn = document.createElement("button");
    btn.dataset.val = JSON.stringify(p.w);
    btn.textContent = p.label;
    btn.style.fontFamily = "var(--font-mono-current)";
    btn.style.fontSize = "11.5px";

    const sum = p.w.reduce((a,x)=>a+x,0) || 1;
    const cur = b.widths || [];
    const sumCur = cur.reduce((a,x)=>a+x,0) || 1;
    const same = cur.length === p.w.length &&
      p.w.every((w, i) => Math.abs(w/sum - cur[i]/sumCur) < 0.03);
    if (same) btn.classList.add("on");

    btn.onmousedown = e => e.preventDefault();
    row.append(btn);
  });
}

/* ---------- Синхронизация состояния ---------- */

function syncHandleMenuState(){
  const menu = $("#handlemenu");
  if (!menu || !S.handleMenuBlock) return;

  const b = St().blocks.find(x => x.id === S.handleMenuBlock);
  if (!b) return;

  menu.querySelectorAll("[data-group]").forEach(groupEl => {
    const group = groupEl.dataset.group;
    if (group === "lines-list" || group === "cols-ratio") return;

    groupEl.querySelectorAll("button").forEach(btn => {
      const val = btn.dataset.val;
      let on = false;

      if (group === "type")   on = (b.type === val);
      if (group === "bg")     on = ((b.bg || "") === val);
      if (group === "font")   on = ((b.font || "") === val);
      if (group === "indent") on = (String(b.indent || 0) === val);
      if (group === "marker") on = ((b.marker || "disc") === val);
      if (group === "cols-count")  on = (String(b.cols) === val);
      if (group === "cols-valign") on = ((b.valign || "top") === val);
      if (group === "cols-gap")    on = (String(b.gap ?? 14) === val);

      btn.classList.toggle("on", on);
    });
  });
}

/* ============================================================
   [Пакет 14] Открытие / закрытие handle menu
   ============================================================ */

function openHandleMenu(anchor, blockId){
  const menu = $("#handlemenu");
  if (!menu) return;

  /* [Пакет 14] Не открываем для несуществующих/удалённых блоков */
  const b = St().blocks.find(x => x.id === blockId);
  if (!b) return;
  const doc = getActiveDoc();
  if (!doc || doc.trashed) return;

  S.handleMenuBlock = blockId;

  const markerSection = menu.querySelector('[data-section="marker"]');
  if (markerSection) markerSection.hidden = (b.type !== "ul");

  const colsSection = menu.querySelector('[data-section="columns"]');
  if (colsSection){
    colsSection.hidden = (b.type !== "columns");
    if (b.type === "columns") fillColsRatioButtons(colsSection, b);
  }

  const linesSection = menu.querySelector('[data-section="lines"]');
  if (linesSection){
    const showLines = LINE_TYPES.has(b.type)
      && Array.isArray(b.lines)
      && b.lines.length > 1;
    linesSection.hidden = !showLines;
    if (showLines) fillLinesList(linesSection, b);
  }

  fillIdSection(b);

  menu.dataset.display = "block";
  menu.style.display = "block";

  const r = anchor.getBoundingClientRect();
  S.U.positionFloating(menu, r, { preferBelow: true, gap: 6, margin: 8 });

  syncHandleMenuState();
  S.handleMenuOpen = true;
}

function closeHandleMenu(){
  const menu = $("#handlemenu");
  if (menu) menu.style.display = "none";

  const idInput = document.getElementById("hm-id-input");
  const idValue = document.getElementById("hm-id-value");
  if (idInput && idValue){
    idInput.hidden = true;
    idValue.hidden = false;
  }

  S.handleMenuOpen = false;
  S.handleMenuBlock = null;
}

/* ---------- Font menu ---------- */

const FONT_LIST = [
  { group: "Основной",  name: "Inter",            tag: "sans" },
  { group: "Основной",  name: "Open Sans",        tag: "sans" },
  { group: "Основной",  name: "Plus Jakarta Sans", tag: "sans" },
  { group: "Заголовки", name: "Montserrat",        tag: "head" },
  { group: "Заголовки", name: "Manrope",           tag: "head" },
  { group: "Заголовки", name: "Outfit",            tag: "head" },
  { group: "Заголовки", name: "Inter",             tag: "head" },
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

  menu.dataset.display = "block";
  menu.style.display = "block";
  menu.setAttribute("role", "menu");

  const r = anchor.getBoundingClientRect();
  S.U.positionFloating(menu, r, { preferBelow: true, gap: 6, margin: 8 });

  input.value = "";
  fontMenuRender("");
  S.fontMenuOpen = true;
}

function closeFontMenu(){
  const menu = $("#fontmenu");
  if (menu) menu.style.display = "none";
  S.fontMenuOpen = false;
}

function fontMenuRender(query){
  const list = $("#fontmenu-list");
  if (!list) return;

  const q = String(query || "").toLowerCase().trim();
  let html = "";
  let lastGroup = "";

  FONT_LIST.forEach(f => {
    if (q && !f.name.toLowerCase().includes(q)) return;
    if (f.group !== lastGroup){
      html += `<div class="fontmenu-group">${escape(f.group)}</div>`;
      lastGroup = f.group;
    }
    /* [Пакет 8] escape name и tag */
    const safeName = escape(f.name);
    const safeTag = escape(f.tag);
    html += `
      <div class="fontmenu-item" data-font="${safeName}">
        <span class="fname" style="font-family:'${safeName}', system-ui, sans-serif">
          ${safeName}
        </span>
        <span class="ftag">${safeTag}</span>
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
  window.App.menusFloatbar.restoreLastRange();
  document.execCommand("fontName", false, name);
  window.App.menusFloatbar.syncContentFromSelection();
  toast(`Шрифт: ${name}`);
}

return {
  openHandleMenu, closeHandleMenu, syncHandleMenuState,
  fillIdSection, bindIdInputOnce, fillLinesList, fillColsRatioButtons,
  openFontMenu, closeFontMenu, fontMenuRender, applyFontToSelection,
  FONT_LIST
};
})();