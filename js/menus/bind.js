/* ============================================================
   menus/bind.js — единая точка привязки обработчиков

   [Пакет 12] Ctrl+Backspace с guard isComposing;
              line-edit/remove через rAF.
   [Пакет 13] selectionchange через requestAnimationFrame.

   Зависит от: menus/_shared, все модули menus/*
   ============================================================ */

window.App = window.App || {};

window.App.menusBind = (() => {
"use strict";

const S = window.App.menusShared;
const {
  $, $$, toast,
  St, setActive, setSelectedBlock,
  setSelectedRange, clearSelectedRange, clearSelection,
  snapshot, commit, save,
  render, focusActive,
  newLineFn,
  U
} = S;

/* ---------- Хелпер для пересборки палитры ---------- */

function rerenderPalette(cmdInput){
  const raw = cmdInput.value;
  const mode = window.App.menusPalette.detectMode(raw);
  if (S.paletteMode === "search" || mode === "docs"){
    window.App.menusSearch.globalSearchRender(
      window.App.menusPalette.stripPrefix(raw)
    );
  } else {
    window.App.menusPalette.cmdRender();
  }
  const items = $$("#cmdresults .result");
  items.forEach((el, i) => {
    const on = i === S.cmdIndex;
    el.classList.toggle("sel", on);
    el.setAttribute("aria-selected", on ? "true" : "false");
  });
}

/* ============================================================
   [Пакет 13] selectionchange через rAF
   ============================================================ */

let _selRafId = null;
function _scheduleSelectionChange(handler){
  if (_selRafId) return;
  _selRafId = requestAnimationFrame(() => {
    _selRafId = null;
    handler();
  });
}

/* ---------- Основная привязка ---------- */

function bindMenus(){
  /* --- Slash --- */
  const slashInput = $("#slashinput");
  if (slashInput){
    slashInput.oninput = window.App.menusSlash.slashRender;
    slashInput.onkeydown = e => {
      if (e.key === "Escape"){
        S.setSlashBlockId(null);
        window.App.menusPalette.closeMenus();
      }
      if (e.key === "Enter") $$("#slashresults .result")[0]?.click();
    };
  }

  /* --- Palette --- */
  const cmdInput = $("#cmdinput");
  if (cmdInput){
    cmdInput.oninput = () => {
      const raw = cmdInput.value;
      const mode = window.App.menusPalette.detectMode(raw);
      if (S.paletteMode === "search" || mode === "docs"){
        window.App.menusSearch.globalSearchRender(
          window.App.menusPalette.stripPrefix(raw)
        );
      } else {
        S.cmdIndex = 0;
        window.App.menusPalette.cmdRender();
      }
    };

    cmdInput.onkeydown = e => {
      const items = $$("#cmdresults .result");
      const n = items.length;

      if (e.key === "ArrowDown"){
        e.preventDefault();
        if (!n) return;
        S.cmdIndex = (S.cmdIndex + 1) % n;
        rerenderPalette(cmdInput);
      } else if (e.key === "ArrowUp"){
        e.preventDefault();
        if (!n) return;
        S.cmdIndex = (S.cmdIndex + n - 1) % n;
        rerenderPalette(cmdInput);
      } else if (e.key === "Enter"){
        e.preventDefault();
        if (!n) return;
        items[Math.min(S.cmdIndex, n - 1)]?.click();
      } else if (e.key === "Escape"){
        window.App.menusPalette.closeMenus();
      }
    };
  }

  const backdrop = $("#backdrop");
  if (backdrop) backdrop.onclick = window.App.menusPalette.closeMenus;

  /* --- Font menu input --- */
  const fontInput = $("#fontmenu-input");
  if (fontInput){
    fontInput.addEventListener("input", e =>
      window.App.menusHandleMenu.fontMenuRender(e.target.value));
    fontInput.addEventListener("keydown", e => {
      if (e.key === "Escape"){
        window.App.menusHandleMenu.closeFontMenu();
        return;
      }
      if (e.key === "Enter"){
        const first = $("#fontmenu-list .fontmenu-item");
        if (first) first.click();
      }
    });
  }

  /* --- ID input в handle-menu --- */
  window.App.menusHandleMenu.bindIdInputOnce();

  /* --- Handle menu клики --- */
  const handleMenu = $("#handlemenu");
  if (handleMenu){
    handleMenu.addEventListener("mousedown", e => {
      if (e.target.closest("[data-group] button, .hm-actions button, .hm-id-btn, .hm-id-input, .hm-line-row button")) {
        e.preventDefault();
      }
    });

    handleMenu.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const b = St().blocks.find(x => x.id === S.handleMenuBlock);
      if (!b) return;

      /* Строки */
      const lineRow = btn.closest(".hm-line-row");
      if (lineRow){
        const lineIdx = parseInt(lineRow.dataset.lineIndex, 10);
        const ln = b.lines && b.lines[lineIdx];
        if (!ln) return;

        const action = btn.dataset.action;

        if (action === "line-copy-id"){
          const id = ln.customId || ln.id;
          navigator.clipboard.writeText(id).then(
            () => toast("ID строки скопирован: " + id),
            () => toast("Не удалось скопировать")
          );
          return;
        }
        if (action === "line-copy-link"){
          const doc = getActiveDocForMenu();
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
        if (action === "line-edit-id"){
          const newId = prompt("Новый ID строки:", ln.customId || ln.id);
          if (newId === null) return;
          const clean = String(newId).trim().toLowerCase().replace(/[^a-z0-9\-_]/g, "").slice(0, 64);
          const old = snapshot();
          if (!clean || clean === ln.id){
            ln.customId = "";
          } else {
            const doc = getActiveDocForMenu();
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
          window.App.menusHandleMenu.fillLinesList(
            handleMenu.querySelector('[data-section="lines"]'), b);
          return;
        }
        if (action === "line-remove-id"){
          if (!ln.customId) return;
          const old = snapshot();
          ln.customId = "";
          commit(old);
          render();
          setSelectedBlock(b.id);
          window.App.menusHandleMenu.fillLinesList(
            handleMenu.querySelector('[data-section="lines"]'), b);
          return;
        }
      }

      /* Стандартные действия handle-menu */
      if (btn.dataset.action === "copy-id"){
        const id = b.customId || b.id;
        navigator.clipboard.writeText(id).then(
          () => toast("ID скопирован: " + id),
          () => toast("Не удалось скопировать")
        );
        return;
      }

      if (btn.dataset.action === "copy-link"){
        const doc = getActiveDocForMenu();
        const id = b.customId || b.id;
        const title = doc?.title || "Без названия";
        const link = `[[${title}#${id}]]`;
        navigator.clipboard.writeText(link).then(
          () => toast("Ссылка скопирована"),
          () => toast("Не удалось скопировать")
        );
        return;
      }

      if (btn.dataset.action === "edit-id"){
        const idValue = document.getElementById("hm-id-value");
        const idInput = document.getElementById("hm-id-input");
        if (!idValue || !idInput) return;
        idInput.value = b.customId || b.id;
        idValue.hidden = true;
        idInput.hidden = false;
        idInput.focus();
        idInput.select();
        return;
      }

      if (btn.dataset.action === "duplicate"){
        const old = snapshot();
        const copy = JSON.parse(JSON.stringify(b));
        copy.id = U.shortId();
        copy.customId = "";
        if (Array.isArray(copy.lines)){
          for (const ln of copy.lines){
            ln.id = U.shortId();
            ln.customId = "";
            if (Array.isArray(ln.fragments)){
              ln.fragments = ln.fragments.map(f => ({ ...f, id: U.shortId(), customId: "" }));
            }
          }
        }
        const i = St().blocks.findIndex(x => x.id === b.id);
        St().blocks.splice(i + 1, 0, copy);
        commit(old);
        render();
        setSelectedBlock(copy.id);
        window.App.menusHandleMenu.closeHandleMenu();
        return;
      }

      if (btn.dataset.action === "delete"){
        if (St().blocks.length <= 1){ toast("Нельзя удалить последний блок"); return; }
        const old = snapshot();
        const i = St().blocks.findIndex(x => x.id === b.id);
        St().blocks.splice(i, 1);
        const nextId = St().blocks[Math.max(0, i - 1)]?.id || null;
        commit(old);
        render();
        setSelectedBlock(nextId);
        window.App.menusHandleMenu.closeHandleMenu();
        return;
      }

      const groupContainer = btn.closest("[data-group]");
      if (!groupContainer) return;
      const group = groupContainer.dataset.group;
      const val   = btn.dataset.val;

      /* Колонки */
      if (group === "cols-count"){
        const n = parseInt(val, 10);
        if (![2,3,4].includes(n)) return;
        const old = snapshot();
        b.cols = n;
        const arr = Array.isArray(b.content) ? b.content.slice(0, n) : [];
        while (arr.length < n) arr.push("");
        b.content = arr;
        const w = Array.isArray(b.widths) ? b.widths.slice(0, n) : [];
        while (w.length < n) w.push(1);
        const sum = w.reduce((a,x)=>a+x,0) || 1;
        b.widths = w.map(x => x / sum);
        commit(old);
        render();
        setSelectedBlock(b.id);
        window.App.menusHandleMenu.fillColsRatioButtons(
          handleMenu.querySelector('[data-section="columns"]'), b);
        window.App.menusHandleMenu.syncHandleMenuState();
        return;
      }

      if (group === "cols-ratio"){
        let w;
        try { w = JSON.parse(val); } catch(e){ return; }
        if (!Array.isArray(w) || w.length !== b.cols) return;
        const old = snapshot();
        const sum = w.reduce((a,x)=>a+x,0) || 1;
        b.widths = w.map(x => x / sum);
        commit(old);
        render();
        setSelectedBlock(b.id);
        window.App.menusHandleMenu.fillColsRatioButtons(
          handleMenu.querySelector('[data-section="columns"]'), b);
        window.App.menusHandleMenu.syncHandleMenuState();
        return;
      }

      if (group === "cols-valign"){
        const old = snapshot();
        b.valign = val;
        commit(old);
        render();
        setSelectedBlock(b.id);
        window.App.menusHandleMenu.syncHandleMenuState();
        return;
      }

      if (group === "cols-gap"){
        const old = snapshot();
        b.gap = parseInt(val, 10) || 0;
        commit(old);
        render();
        setSelectedBlock(b.id);
        window.App.menusHandleMenu.syncHandleMenuState();
        return;
      }

      /* Стандартные группы */
      const old = snapshot();

      if (group === "type"){
        b.type = val;
        if (val === "table"){
          b.rows = b.rows || [["",""],["",""]];
          b.content = "";
          b.lines = [];
        } else if (val === "columns"){
          b.cols = b.cols || 2;
          b.content = Array.isArray(b.content) ? b.content : ["", ""];
          if (!Array.isArray(b.widths) || b.widths.length !== b.cols){
            b.widths = Array(b.cols).fill(1 / b.cols);
          }
          if (!Number.isFinite(b.gap)) b.gap = 14;
          if (!b.valign) b.valign = "top";
          b.lines = [];
        } else if (val === "ul" || val === "ol"){
          if (typeof b.content !== "string") b.content = "";
          if (!/<\/?li/i.test(b.content)) b.content = "<li><br></li>";
          if (val === "ul" && !b.marker) b.marker = "disc";
          b.lines = [];
        } else if (S.LINE_TYPES.has(val)){
          if (!Array.isArray(b.lines) || !b.lines.length){
            b.lines = [ S.newLineFn("") ];
            b.content = "";
          }
        } else {
          if (typeof b.content !== "string") b.content = "";
          if (val === "code") b.content = S.htmlToText(b.content);
          b.lines = [];
        }
      }
      else if (group === "bg")     b.bg = val;
      else if (group === "font")   b.font = val;
      else if (group === "indent") b.indent = parseInt(val, 10) || 0;
      else if (group === "marker") b.marker = val;

      commit(old);
      render();
      setSelectedBlock(b.id);
      window.App.menusHandleMenu.syncHandleMenuState();

      if (group === "type"){
        const cs = handleMenu.querySelector('[data-section="columns"]');
        if (cs){
          cs.hidden = (val !== "columns");
          if (val === "columns") window.App.menusHandleMenu.fillColsRatioButtons(cs, b);
        }
        const ms = handleMenu.querySelector('[data-section="marker"]');
        if (ms) ms.hidden = (val !== "ul");
        const ls = handleMenu.querySelector('[data-section="lines"]');
        if (ls){
          const show = S.LINE_TYPES.has(val) && Array.isArray(b.lines) && b.lines.length > 1;
          ls.hidden = !show;
          if (show) window.App.menusHandleMenu.fillLinesList(ls, b);
        }
      }
    });
  }

  /* --- Lines panel --- */
  window.App.menusLinesPanel.bindLinesPanelOnce();

  /* --- Handle (клик по ручке) --- */
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
    window.App.menusHandleMenu.openHandleMenu(handle, id);
  });

  /* --- Закрытие меню при клике вне --- */
  document.addEventListener("mousedown", e => {
    if (S.fontMenuOpen){
      if (!e.target.closest("#fontmenu") &&
          !e.target.closest('.floatbar button[data-cmd="font"]')){
        window.App.menusHandleMenu.closeFontMenu();
      }
    }
    if (S.handleMenuOpen){
      if (!e.target.closest("#handlemenu") &&
          !e.target.closest(".handle")){
        window.App.menusHandleMenu.closeHandleMenu();
      }
    }
    if (S.markerMenuOpen){
      if (!e.target.closest("#markermenu") &&
          !e.target.closest('.floatbar button[data-cmd="bullets"]')){
        window.App.menusFloatbar.closeMarkerMenu();
      }
    }
    if (S.linesPanelOpen){
      if (!e.target.closest("#lines-panel")){
        window.App.menusLinesPanel.closeLinesPanel();
      }
    }

    if (e.target.closest("#floatbar"))   return;
    if (e.target.closest("#palette"))    return;
    if (e.target.closest("#slash"))      return;
    if (e.target.closest("#fontmenu"))   return;
    if (e.target.closest("#handlemenu")) return;
    if (e.target.closest("#markermenu")) return;
    if (e.target.closest("#lines-panel"))return;
    if (e.target.closest(".block"))      return;
    if (e.target.closest("header"))      return;
    if (e.target.closest(".title"))      return;

    clearSelection();
  });

  /* ============================================================
     [Пакет 13] selectionchange — через rAF
     ============================================================ */
  document.addEventListener("selectionchange", () => {
    if (S.floatbarDragging) return;
    _scheduleSelectionChange(() => _handleSelectionChange());
  });

  function _handleSelectionChange(){
    if (S.floatbarDragging) return;

    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed){
      const f = $("#floatbar");
      if (f) f.style.display = "none";
      clearSelectedRange();
      return;
    }
    const anchorEl = s.anchorNode?.parentElement;
    if (!anchorEl?.closest(".editor")){
      const f = $("#floatbar");
      if (f) f.style.display = "none";
      clearSelectedRange();
      return;
    }

    const els = window.App.menusFloatbar.getSelectedBlockRange();
    if (els.length){
      const ids = els.map(w => w.dataset.id);
      const ordered = St().blocks.filter(b => ids.includes(b.id)).map(b => b.id);
      if (ordered.length){
        setSelectedRange(ordered[0], ordered[ordered.length - 1]);
      }
    } else {
      clearSelectedRange();
    }

    const range = s.getRangeAt(0);
    const rects = range.getClientRects();
    const rect = rects && rects.length ? rects[0] : range.getBoundingClientRect();
    if (!rect || (!rect.width && !rect.height)){
      const f = $("#floatbar");
      if (f) f.style.display = "none";
      return;
    }

    const f = $("#floatbar");
    if (!f) return;
    f.dataset.display = "flex";
    f.style.display = "flex";

    const anchorRect = {
      left:  rect.left,
      right: rect.right,
      top:   rect.top,
      bottom:rect.top - 4,
      width: rect.width,
      height: 0
    };

    U.positionFloating(f, anchorRect, {
      preferBelow: false,
      gap: 8,
      margin: 8
    });

    window.App.menusFloatbar.updateFloatbarState();
  }

  /* ============================================================
     [Пакет 12] Ctrl+Backspace: удалить блок
     ============================================================ */
  document.addEventListener("keydown", e => {
    /* IME guard */
    if (e.isComposing || e.keyCode === 229) return;

    const isMod = e.ctrlKey || e.metaKey;
    if (!isMod || e.key !== "Backspace") return;
    if (document.activeElement?.closest?.(".line")) return;

    const ae = document.activeElement;
    if (!ae) return;
    const inEditor = ae.isContentEditable && ae.closest?.("#editor");
    if (!inEditor) return;

    e.preventDefault();
    e.stopPropagation();

    const blocks = St().blocks;
    const els = window.App.menusFloatbar.getSelectedBlockRange();
    let ids = [];

    if (els.length){
      ids = els.map(w => w.dataset.id);
    } else {
      const b = window.App.menusFloatbar.getBlockUnderCaret();
      if (b) ids = [b.id];
    }
    if (!ids.length) return;

    if (blocks.length - ids.length < 1){
      const keep = blocks.find(b => !ids.includes(b.id)) || blocks[0];
      const before = snapshot();
      blocks.length = 0;
      if (keep){
        keep.content = "";
        keep.type = "text";
        keep.checked = false;
        keep.rows = null;
        keep.cols = null;
        keep.lines = [ S.newLineFn("") ];
        blocks.push(keep);
      } else {
        blocks.push(U.block("text", ""));
      }
      setActive(blocks[0].id);
      setSelectedBlock(blocks[0].id);
      commit(before);
      render();
      setTimeout(() => focusActive(), 0);
      return;
    }

    const before = snapshot();
    const firstIdx = blocks.findIndex(b => ids.includes(b.id));
    const remaining = blocks.filter(b => !ids.includes(b.id));
    blocks.length = 0;
    blocks.push(...remaining);

    const nextId = remaining[Math.min(firstIdx, remaining.length - 1)]?.id || null;
    setActive(nextId);
    setSelectedBlock(nextId);
    commit(before);
    render();
    setTimeout(() => focusActive(), 0);
  });

  /* --- Escape закрывает всё --- */
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (S.markerMenuOpen)      window.App.menusFloatbar.closeMarkerMenu();
    else if (S.fontMenuOpen)   window.App.menusHandleMenu.closeFontMenu();
    else if (S.handleMenuOpen) window.App.menusHandleMenu.closeHandleMenu();
    else if (S.linesPanelOpen) window.App.menusLinesPanel.closeLinesPanel();
    else                       window.App.menusPalette.closeMenus();
  });
}

/* ---------- Локальный хелпер ---------- */

function getActiveDocForMenu(){
  return window.App.state.getActiveDoc();
}

return { bindMenus };
})();