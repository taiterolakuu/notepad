/* ============================================================
   menus/lines-panel.js — панель строк блока (Ctrl+Shift+L)

   [Пакет 12] клик по строке — корректный scrollToAnchorPath;
              customId через escape в data-*.
   [Пакет 14] openLinesPanel не открывается для удалённых блоков;
              защита от Array.isArray(b.lines).

   Зависит от: menus/_shared
   ============================================================ */

window.App = window.App || {};

window.App.menusLinesPanel = (() => {
"use strict";

const S = window.App.menusShared;
const {
  $, toast, escape, htmlToText,
  LINE_TYPES,
  St, setSelectedBlock, getActiveDoc,
  snapshot, commit,
  render
} = S;

/* [Пакет 14] CSS.escape с fallback */
function _cssEscape(s){
  if (window.CSS && typeof CSS.escape === "function"){
    return CSS.escape(String(s));
  }
  return String(s).replace(/[^a-zA-Z0-9\-_]/g, "\\$&");
}

/* ---------- Открытие ---------- */

function openLinesPanel(){
  const panel = $("#lines-panel");
  if (!panel){
    window.App.menusPalette.openPalette();
    return;
  }

  const activeEl = document.activeElement;
  const blockEl = activeEl?.closest?.(".block");
  let b = null;
  if (blockEl){
    b = St().blocks.find(x => x.id === blockEl.dataset.id);
  }
  /* [Пакет 14] защита: блок должен существовать и быть LINE_TYPE */
  if (!b || !LINE_TYPES.has(b.type) || !Array.isArray(b.lines)){
    b = St().blocks.find(x => LINE_TYPES.has(x.type) && Array.isArray(x.lines));
  }

  if (!b){
    toast("Нет строк в документе");
    return;
  }

  /* [Пакет 14] не открываем для trashed-документа */
  const doc = getActiveDoc();
  if (!doc || doc.trashed) return;

  panel.dataset.blockId = b.id;

  const list = $("#lines-panel-list");
  if (!list) return;

  if (!b.lines.length){
    list.innerHTML = `<div class="lsp-empty">Нет строк</div>`;
  } else {
    list.innerHTML = b.lines.map((ln, i) => {
      const id = ln.customId || ln.id;
      const fullText = htmlToText(ln.text || "").trim() || "(пусто)";
      const short = fullText.length > 60 ? fullText.slice(0, 60) + "…" : fullText;
      return `
        <div class="lsp-item" data-line-id="${escape(id)}" data-line-index="${i}">
          <span class="lsp-num">${i + 1}</span>
          <span class="lsp-text" title="${escape(fullText)}">${escape(short)}</span>
          <span class="lsp-id">#${escape(id)}</span>
          <button class="lsp-btn" data-action="copy-id"     title="Копировать ID">ID</button>
          <button class="lsp-btn" data-action="copy-link"   title="Копировать ссылку">🔗</button>
          <button class="lsp-btn" data-action="edit-id"     title="Изменить ID">✎</button>
          <button class="lsp-btn danger" data-action="remove-id" title="Удалить ID">✗</button>
        </div>`;
    }).join("");
  }

  const head = $("#lines-panel-head");
  if (head){
    const blockId = b.customId || b.id;
    head.innerHTML = `
      <div class="lsp-title">Строки блока</div>
      <div class="lsp-block">
        #${escape(blockId)}
        <button class="lsp-btn" data-action="copy-block-id"   title="Копировать ID блока">ID</button>
        <button class="lsp-btn" data-action="copy-block-link" title="Копировать ссылку на блок">🔗</button>
      </div>`;
  }

  panel.style.display = "block";
  S.linesPanelOpen = true;
}

function closeLinesPanel(){
  const panel = $("#lines-panel");
  if (panel) panel.style.display = "none";
  S.linesPanelOpen = false;
}

function isLinesPanelOpen(){ return S.linesPanelOpen; }

/* ---------- Обработчики панели строк ---------- */

function bindLinesPanelOnce(){
  const linesPanel = $("#lines-panel");
  if (!linesPanel || linesPanel.dataset.bound) return;
  linesPanel.dataset.bound = "1";

  linesPanel.addEventListener("mousedown", e => {
    if (e.target.closest("button, .lsp-item")) e.preventDefault();
  });

  linesPanel.addEventListener("click", e => {
    if (e.target.closest('[data-action="close"]')){
      closeLinesPanel();
      return;
    }

    const btn = e.target.closest("button");
    const panelBlockId = linesPanel.dataset.blockId;
    const b = St().blocks.find(x => x.id === panelBlockId);
    if (!b) return;

    /* [Пакет 14] если блок удалён — закрываем панель */
    if (!b || !Array.isArray(b.lines)){
      closeLinesPanel();
      return;
    }

    const row = e.target.closest(".lsp-item");
    if (row && btn){
      const lineIdx = parseInt(row.dataset.lineIndex, 10);
      const ln = b.lines && b.lines[lineIdx];
      if (!ln) return;

      const action = btn.dataset.action;

      if (action === "copy-id"){
        const id = ln.customId || ln.id;
        navigator.clipboard.writeText(id).then(
          () => toast("ID строки скопирован: " + id),
          () => toast("Не удалось скопировать")
        );
        return;
      }

      if (action === "copy-link"){
        const doc = getActiveDoc();
        const blockId = b.customId || b.id;
        const lineId = ln.customId || ln.id;
        const title = doc?.title || "Без названия";
        const link = `[[${title}#${blockId}#${lineId}]]`;
        navigator.clipboard.writeText(link).then(
          () => toast("Ссылка на строку скопирована"),
          () => toast("Не удалось скопировать")
        );
        return;
      }

      if (action === "edit-id"){
        const newId = prompt("Новый ID строки:", ln.customId || ln.id);
        if (newId === null) return;
        const clean = String(newId).trim().toLowerCase().replace(/[^a-z0-9\-_]/g, "").slice(0, 64);
        const old = snapshot();
        if (!clean || clean === ln.id){
          ln.customId = "";
        } else {
          const doc = getActiveDoc();
          let final = clean;
          let n = 2;
          while (doc.blocks.some(x => (x.lines || []).some(l =>
            l !== ln && (l.customId === final || l.id === final)
          ))){
            final = `${clean}-${n}`;
            n++;
          }
          ln.customId = final;
        }
        commit(old);
        render();
        setSelectedBlock(b.id);
        openLinesPanel();
        return;
      }

      if (action === "remove-id"){
        if (!ln.customId) return;
        const old = snapshot();
        ln.customId = "";
        commit(old);
        render();
        setSelectedBlock(b.id);
        openLinesPanel();
        return;
      }
      return;
    }

    if (btn && btn.dataset.action === "copy-block-id"){
      const id = b.customId || b.id;
      navigator.clipboard.writeText(id).then(
        () => toast("ID блока скопирован: " + id),
        () => toast("Не удалось скопировать")
      );
      return;
    }
    if (btn && btn.dataset.action === "copy-block-link"){
      const doc = getActiveDoc();
      const id = b.customId || b.id;
      const title = doc?.title || "Без названия";
      const link = `[[${title}#${id}]]`;
      navigator.clipboard.writeText(link).then(
        () => toast("Ссылка на блок скопирована"),
        () => toast("Не удалось скопировать")
      );
      return;
    }

    if (row && !btn){
      /* [Пакет 12] клик по строке — фокус + скролл */
      const lineId = row.dataset.lineId;
      const blockAnchor = b.customId || b.id;
      try {
        window.App.state.scrollToAnchorPath(
          St().activeDocId,
          blockAnchor,
          lineId,
          ""
        );
      } catch(err){}
      closeLinesPanel();

      /* Дополнительно фокусируем строку в редакторе */
      setTimeout(() => {
        try {
          const el = document.querySelector(
            `#editor .block[data-id="${_cssEscape(b.id)}"] .line[data-line-id="${_cssEscape(lineId)}"]`
          );
          if (el) el.focus();
        } catch(err){}
      }, 200);
    }
  });
}

return {
  openLinesPanel,
  closeLinesPanel,
  isLinesPanelOpen,
  bindLinesPanelOnce
};
})();