/* ============================================================
   hotkeys.js — единый реестр горячих клавиш

   [Пакет 3]  guard lock.isLocked() в onKeydown.
   [Пакет 4]  handleKey(e, block, body) — передаём активный блок.
   [Пакет 10] normalizeEvent по e.code; guard !e.key/repeat/isComposing;
              getRegistry: !(k in reg); одна регистрация;
              doc:saveAs → дублирование; doc:new/close/next/prev
              на alt+*; find:focus удалён; doc:trash — confirm;
              block:delete — реальное удаление.

   Зависит от: utils, state, lock, wikilink-popover, render
   ============================================================ */

window.App = window.App || {};

window.App.hotkeys = (() => {
"use strict";

const U = window.App.utils;
const { toast } = U;

const St = () => window.App.state.S;

/* ---------- Дефолты ---------- */

const DEFAULTS = {
  "doc:new":        "alt+n",
  "doc:template":   "alt+shift+n",
  "doc:open":       "alt+o",
  "doc:save":       "mod+s",
  "doc:saveAs":     "mod+shift+s",
  "doc:close":      "alt+w",
  "doc:next":       "alt+tab",
  "doc:prev":       "alt+shift+tab",
  "doc:rename":     "F2",
  "doc:trash":      "Delete",
  "sidebar:toggle": "mod+\\",
  "search:global":  "mod+shift+f",
  "palette:open":   "mod+k",
  "settings:open":  "mod+,",
  "nav:back":       "alt+ArrowLeft",
  "nav:forward":    "alt+ArrowRight",
  "list:ol":        "mod+shift+7",
  "list:none":      "mod+shift+8",
  "edit:undo":      "mod+z",
  "edit:redo":      "mod+y",
  "lines:panel":    "mod+shift+l",
  "lock:now":       "",
  "block:delete":   "mod+Backspace",
  "block:new":      "mod+Enter",
  "line:new":       "mod+shift+Enter"
};

const LABELS = {
  "doc:new":        "Новый документ",
  "doc:template":   "Новый из шаблона",
  "doc:open":       "Открыть документ",
  "doc:save":       "Сохранить",
  "doc:saveAs":     "Дублировать текущий",
  "doc:close":      "Закрыть вкладку",
  "doc:next":       "Следующая вкладка",
  "doc:prev":       "Предыдущая вкладка",
  "doc:rename":     "Переименовать документ",
  "doc:trash":      "В корзину",
  "sidebar:toggle": "Свернуть/показать панель",
  "search:global":  "Глобальный поиск",
  "palette:open":   "Командная палитра",
  "settings:open":  "Настройки",
  "nav:back":       "Назад по истории",
  "nav:forward":    "Вперёд по истории",
  "list:ol":        "Нумерованный список",
  "list:none":      "Снять список",
  "edit:undo":      "Отменить",
  "edit:redo":      "Повторить",
  "lines:panel":    "Панель строк блока",
  "lock:now":       "Заблокировать сейчас",
  "block:delete":   "Удалить блок",
  "block:new":      "Новый блок",
  "line:new":       "Новая строка"
};

const BROWSER_TAKEN = new Set([
  "mod+n", "mod+w", "mod+t", "mod+tab", "mod+shift+tab",
  "mod+shift+n", "mod+shift+w", "mod+shift+t",
  "mod+shift+p", "mod+alt+t", "mod+l", "mod+shift+delete"
]);

/* ---------- Реестр ---------- */

function getRegistry(){
  if (!St().settings) return {};
  if (!St().settings.hotkeys) St().settings.hotkeys = {};
  const reg = St().settings.hotkeys;
  for (const k of Object.keys(DEFAULTS)){
    if (!(k in reg)) reg[k] = DEFAULTS[k];
  }
  return reg;
}

async function setBinding(actionId, combo){
  const reg = getRegistry();
  reg[actionId] = combo;
  await window.App.db.setMeta("settings", St().settings);
}

async function resetAll(){
  St().settings.hotkeys = { ...DEFAULTS };
  await window.App.db.setMeta("settings", St().settings);
}

/* ---------- Парсер ---------- */

function normalizeEvent(e){
  if (!e || !e.key) return "";

  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push("mod");
  if (e.shiftKey) mods.push("shift");
  if (e.altKey)  mods.push("alt");

  let key = "";

  const code = e.code || "";
  if (/^Key[A-Z]$/.test(code)){
    key = code.slice(3).toLowerCase();
  } else if (/^Digit[0-9]$/.test(code)){
    key = code.slice(5);
  } else if (/^Numpad[0-9]$/.test(code)){
    key = code.slice(6);
  } else if (code === "Backslash"){
    key = "\\";
  } else if (code === "Comma"){
    key = ",";
  } else if (code === "Period"){
    key = ".";
  } else if (code === "Slash"){
    key = "/";
  }

  if (!key){
    let k = e.key;
    if (k === " " || k === "Spacebar") k = "Space";
    if (k.length === 1) k = k.toLowerCase();
    key = k;
  }

  return [...mods, key].join("+");
}

function prettyPrint(combo){
  if (!combo) return "—";
  const isMac = /Mac|iPhone|iPad/.test(
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform || ""
  );
  return combo
    .split("+")
    .map(p => {
      if (p === "mod")   return isMac ? "⌘" : "Ctrl";
      if (p === "shift") return isMac ? "⇧" : "Shift";
      if (p === "alt")   return isMac ? "⌥" : "Alt";
      if (p === "ArrowLeft")  return "←";
      if (p === "ArrowRight") return "→";
      if (p === "ArrowUp")    return "↑";
      if (p === "ArrowDown")  return "↓";
      if (p === "Backspace")  return isMac ? "⌫" : "Backspace";
      if (p === "Delete")     return isMac ? "⌦" : "Delete";
      if (p === "Enter")      return isMac ? "↩" : "Enter";
      if (p === "\\") return "\\";
      if (p.length === 1) return p.toUpperCase();
      return p;
    })
    .join(isMac ? "" : "+");
}

function isBrowserTaken(combo){
  return BROWSER_TAKEN.has(combo);
}

/* ============================================================
   [Пакет 10] Реализация block:delete — удаление блоков
   ============================================================ */

function _doBlockDelete(){
  const state = window.App.state;
  const blocks = state.getBlocks();
  if (!blocks.length) return;

  /* Какие блоки удалить: выделение или блок под кареткой */
  const floatbar = window.App.menusFloatbar;
  let ids = [];

  if (floatbar?.getSelectedBlockRange){
    const els = floatbar.getSelectedBlockRange();
    if (els.length){
      ids = els.map(w => w.dataset.id);
    }
  }

  if (!ids.length && floatbar?.getBlockUnderCaret){
    const b = floatbar.getBlockUnderCaret();
    if (b) ids = [b.id];
  }

  if (!ids.length){
    /* Если каретка вне блока — работаем с последним выделенным */
    if (St().selectedId) ids = [St().selectedId];
  }

  if (!ids.length) return;

  const before = state.snapshot();

  /* Если останется меньше одного блока — очищаем содержимое */
  if (blocks.length - ids.length < 1){
    const keep = blocks.find(b => !ids.includes(b.id)) || blocks[0];
    blocks.length = 0;
    if (keep){
      keep.content = "";
      keep.type = "text";
      keep.checked = false;
      keep.rows = null;
      keep.cols = null;
      keep.lines = [ U.line("") ];
      blocks.push(keep);
    } else {
      blocks.push(U.block("text", ""));
    }
    state.setActive(blocks[0].id);
    state.setSelectedBlock(blocks[0].id);
  } else {
    const firstIdx = blocks.findIndex(b => ids.includes(b.id));
    const remaining = blocks.filter(b => !ids.includes(b.id));
    blocks.length = 0;
    blocks.push(...remaining);

    const nextId = remaining[Math.min(firstIdx, remaining.length - 1)]?.id || null;
    state.setActive(nextId);
    state.setSelectedBlock(nextId);
  }

  state.commit(before);
  window.App.render.render();
  setTimeout(() => window.App.render.focusActive(), 0);
}

/* ---------- Диспетчер ---------- */

function dispatch(actionId, ev){
  const S = () => window.App.state;
  const sidebar = window.App.sidebar;
  const menus   = window.App.menus;
  const tabs    = window.App.tabs;
  const settings = window.App.settings;

  switch (actionId){
    /* Документы */
    case "doc:new":        sidebar?.createNewDocument(); return;
    case "doc:template":   sidebar?.openTemplatePicker?.(); return;
    case "doc:open":       menus?.openPalette("docs"); return;

    case "doc:save":
      S().saveNow();
      U.toast("Сохранено");
      return;

    case "doc:saveAs": {
      const doc = S().getActiveDoc();
      if (!doc) return;
      S().duplicateDocument(doc.id).then(copy => {
        if (copy){
          S().setActiveDoc(copy.id);
          sidebar?.render();
          tabs?.render();
          U.toast("Создан дубликат");
        }
      });
      return;
    }

    case "doc:close": {
      const id = S().S.activeDocId;
      if (id) tabs?.closeTab(id);
      return;
    }

    case "doc:next": tabs?.nextTab(); return;
    case "doc:prev": tabs?.prevTab(); return;

    case "doc:rename": {
      const doc = S().getActiveDoc();
      if (!doc) return;
      const titleEl = document.getElementById("title");
      if (titleEl){
        titleEl.focus();
        const r = document.createRange();
        r.selectNodeContents(titleEl);
        r.collapse(false);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      }
      return;
    }

    case "doc:trash": {
      const doc = S().getActiveDoc();
      if (!doc) return;
      if (!confirm(`В корзину: «${doc.title || "Без названия"}»?`)) return;
      S().trashDocument(doc.id).then(() => {
        sidebar?.render();
        tabs?.render();
        U.toast("В корзине");
      });
      return;
    }

    /* UI */
    case "sidebar:toggle": sidebar?.toggleSidebar(); return;
    case "search:global":  menus?.openGlobalSearch(); return;
    case "palette:open":   menus?.openPalette(); return;
    case "settings:open":  settings?.open(); return;

    /* Навигация */
    case "nav:back": {
      const prev = S().historyBack();
      if (prev) S().setActiveDoc(prev);
      return;
    }
    case "nav:forward": {
      const next = S().historyForward();
      if (next) S().setActiveDoc(next);
      return;
    }

    /* Списки */
    case "list:ol":
      if (menus?.run) menus.run("fmt:numbered");
      return;
    case "list:none":
      if (menus?.run) menus.run("fmt:clear");
      return;

    /* Редактирование */
    case "edit:undo": S().undo(); return;
    case "edit:redo": S().redo(); return;

    case "lines:panel": {
      if (menus?.openLinesPanel) menus.openLinesPanel();
      return;
    }

    case "lock:now":
      window.App.lock?.lock?.();
      return;

    /* [Пакет 10] реальное удаление блока */
    case "block:delete":
      _doBlockDelete();
      return;

    case "block:new": {
      const ae = document.activeElement;
      if (ae?.closest?.(".line")) return;
      if (!(ae?.isContentEditable && ae.closest?.("#editor"))) return;
      const state = S();
      const blocks = state.getBlocks();
      const blockEl = ae.closest(".block");
      let idx = blocks.length;
      if (blockEl){
        const found = blocks.findIndex(b => b.id === blockEl.dataset.id);
        if (found >= 0) idx = found + 1;
      }
      window.App.render.add("text", idx);
      return;
    }

    case "line:new": {
      const ae = document.activeElement;
      const lineEl = ae?.closest?.(".line");
      if (!lineEl) return;

      const blockEl = lineEl.closest(".block");
      if (!blockEl) return;

      const state = S();
      const blocks = state.getBlocks();
      const b = blocks.find(x => x.id === blockEl.dataset.id);
      if (!b || !U.LINE_TYPES.has(b.type)) return;

      const lineIdx = parseInt(lineEl.dataset.lineIndex, 10) || 0;
      const old = state.snapshot();
      const newLn = U.line("");
      if (!Array.isArray(b.lines)) b.lines = [];
      b.lines.splice(lineIdx + 1, 0, newLn);
      b.content = b.lines.map(l => l.text).join("<br>");
      state.commit(old);
      window.App.render.render();

      setTimeout(() => {
        const el2 = document.querySelector(
          `#editor .block[data-id="${b.id}"] .line[data-line-id="${newLn.id}"]`
        );
        if (el2){
          const rr = document.createRange();
          rr.setStart(el2, 0);
          rr.collapse(true);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(rr);
          el2.focus();
        }
      }, 0);
      return;
    }
  }
}

/* ---------- Единый keydown ---------- */

function inField(){
  const ae = document.activeElement;
  if (!ae) return false;
  if (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA") return true;
  if (ae.isContentEditable) return true;
  return false;
}

function _activeBlockForPopover(){
  try {
    const ae = document.activeElement;
    const lineEl = ae?.closest?.(".line");
    if (!lineEl) return null;
    const blockEl = lineEl.closest(".block");
    if (!blockEl) return null;
    return window.App.state.getBlocks().find(b => b.id === blockEl.dataset.id) || null;
  } catch(e){
    return null;
  }
}

function onKeydown(e){
  if (e.defaultPrevented) return;

  /* [Пакет 3] под замком игнорируем всё, кроме самого замка */
  if (window.App.lock?.isLocked?.()) return;

  /* [Пакет 10] IME / авто-повтор */
  if (!e.key || e.isComposing || e.repeat) return;

  if (window.App.settings?.isCapturing?.()) return;

  /* mod+Backspace — обрабатывается в menus/bind и render/line */
  if ((e.ctrlKey || e.metaKey) && e.key === "Backspace") return;

  if (window.App.wikilinkPopover?.isOpen?.()){
    const b = _activeBlockForPopover();
    if (b){
      const ae = document.activeElement;
      if (window.App.wikilinkPopover.handleKey(e, b, ae)) return;
    }
  }

  const combo = normalizeEvent(e);
  if (!combo) return;

  const reg = getRegistry();

  let actionId = null;
  for (const k of Object.keys(reg)){
    if (reg[k] === combo){ actionId = k; break; }
  }
  if (!actionId) return;

  const ae = document.activeElement;
  const inLine = !!ae?.closest?.(".line");
  const inEditor = !!(ae?.isContentEditable && ae.closest?.("#editor"));

  if (actionId === "block:new"){
    if (inLine) return;
    if (!inEditor) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch(actionId, e);
    return;
  }

  if (actionId === "line:new"){
    if (!inLine) return;
    e.preventDefault();
    e.stopPropagation();
    dispatch(actionId, e);
    return;
  }

  const skipInField = new Set(["doc:trash"]);
  if (skipInField.has(actionId) && inField()) return;

  if (actionId === "lines:panel"){
    e.preventDefault();
    e.stopPropagation();
    dispatch(actionId, e);
    return;
  }

  const hasMod = e.ctrlKey || e.metaKey || e.altKey;
  const isFn = /^F\d+$/.test(e.key) || e.key === "Delete" || e.key === "Escape";
  if (inField() && !hasMod && !isFn) return;

  e.preventDefault();
  e.stopPropagation();
  dispatch(actionId, e);
}

function bind(){
  window.addEventListener("keydown", onKeydown, true);
}

return {
  DEFAULTS,
  LABELS,
  getRegistry,
  setBinding,
  resetAll,
  normalizeEvent,
  prettyPrint,
  isBrowserTaken,
  dispatch,
  bind
};
})();