/* ============================================================
   hotkeys.js — единый реестр горячих клавиш
   Зависит от: utils, state
   ============================================================ */

window.App = window.App || {};

window.App.hotkeys = (() => {
"use strict";

const U = window.App.utils;
const { toast } = U;

const St = () => window.App.state.S;

/* ---------- Дефолты ---------- */

/* ПАТЧ 1: добавлено "block:delete": "mod+Backspace" */
const DEFAULTS = {
  "doc:new":        "mod+n",
  "doc:template":   "mod+shift+n",
  "doc:open":       "mod+o",
  "doc:save":       "mod+s",
  "doc:saveAs":     "mod+shift+s",
  "doc:close":      "mod+w",
  "doc:next":       "mod+tab",
  "doc:prev":       "mod+shift+tab",
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
  "find:focus":     "mod+f",
  "lock:now":       "",
  "block:delete":   "mod+Backspace"
};

/* ПАТЧ 1: добавлен лейбл "block:delete" */
const LABELS = {
  "doc:new":        "Новый документ",
  "doc:template":   "Новый из шаблона",
  "doc:open":       "Открыть документ",
  "doc:save":       "Сохранить",
  "doc:saveAs":     "Сохранить как новый",
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
  "find:focus":     "Поиск в документе",
  "lock:now":       "Заблокировать сейчас",
  "block:delete":   "Удалить блок"
};

const BROWSER_TAKEN = new Set([
  "mod+shift+n",
  "mod+shift+w",
  "mod+shift+t",
  "mod+t",
  "mod+shift+p",
  "mod+alt+t",
  "mod+l",
  "mod+shift+delete"
]);

/* ---------- Реестр ---------- */

function getRegistry(){
  if (!St().settings) return {};
  if (!St().settings.hotkeys) St().settings.hotkeys = {};
  const reg = St().settings.hotkeys;
  for (const k of Object.keys(DEFAULTS)){
    if (!reg[k]) reg[k] = DEFAULTS[k];
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

/* ---------- Парсер комбинаций ---------- */

function normalizeEvent(e){
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push("mod");
  if (e.shiftKey) mods.push("shift");
  if (e.altKey)  mods.push("alt");

  let key = e.key;
  if (key === " " || key === "Spacebar") key = "Space";
  if (key === "Escape") key = "Escape";
  if (key === "Tab") key = "Tab";
  if (key.length === 1) key = key.toLowerCase();

  return [...mods, key].join("+");
}

function prettyPrint(combo){
  if (!combo) return "—";
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || "");
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

/* ---------- Диспетчер действий ---------- */

function dispatch(actionId, ev){
  const S = () => window.App.state;
  const sidebar = window.App.sidebar;
  const menus   = window.App.menus;
  const tabs    = window.App.tabs;
  const settings = window.App.settings;

  switch (actionId){
    /* Документы */
    case "doc:new":        sidebar?.createNewDocument(); return;
    case "doc:template":   sidebar?.openTemplatePicker(); return;
    case "doc:open":       menus?.openPalette("docs"); return;

    case "doc:save":
      S().saveNow();
      U.toast("Сохранено");
      return;

    case "doc:saveAs":
      S().createDocument({}).then(doc => {
        S().setActiveDoc(doc.id);
        sidebar?.render();
        tabs?.render();
        U.toast("Создан новый документ");
      });
      return;

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
    case "edit:undo":
      if (ev && ev.shiftKey) S().redo();
      else                   S().undo();
      return;

    case "edit:redo":
      S().redo();
      return;

    /* Поиск */
    case "find:focus": {
      const el = document.getElementById("find");
      if (el){ el.focus(); el.select?.(); }
      return;
    }

    /* Замок */
    case "lock:now":
      window.App.lock?.lock?.();
      return;

    /* ПАТЧ 1: удаление блока.
       Реальная логика — в menus.js (слушает mod+Backspace).
       Здесь только фолбэк: если по какой-то причине menus.js
       не загружен — эмулируем keydown, чтобы сработал его
       обработчик. Но в onKeydown мы эту комбинацию
       пропускаем, поэтому сюда не должны попадать. */
    case "block:delete": {
      const ev = new KeyboardEvent("keydown", {
        key: "Backspace",
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true
      });
      (document.activeElement || document.body).dispatchEvent(ev);
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

function onKeydown(e){
  /* Если settings.js сейчас захватывает комбинацию — не реагируем вообще */
  if (window.App.settings?.isCapturing?.()) return;

  /* ПАТЧ 1: mod+Backspace обрабатывается в menus.js.
     Пропускаем здесь, чтобы не сработало дважды. */
  if ((e.ctrlKey || e.metaKey) && e.key === "Backspace") return;

  /* Поповер [[ перехватывает клавиши раньше */
  if (window.App.wikilinkPopover?.isOpen?.()){
    if (window.App.wikilinkPopover.handleKey(e, null, null)) return;
  }

  const combo = normalizeEvent(e);
  const reg = getRegistry();

  let actionId = null;
  for (const k of Object.keys(reg)){
    if (reg[k] === combo){ actionId = k; break; }
  }
  if (!actionId) return;

  /* Некоторые действия не должны срабатывать в поле ввода */
  const skipInField = new Set(["doc:trash"]);
  if (skipInField.has(actionId) && inField()) return;

  /* Если фокус в поле и нет модификатора и это не функциональная клавиша */
  const hasMod = e.ctrlKey || e.metaKey || e.altKey;
  const isFn = /^F\d+$/.test(e.key) || e.key === "Delete" || e.key === "Escape";
  if (inField() && !hasMod && !isFn) return;

  e.preventDefault();
  e.stopPropagation();
  dispatch(actionId, e);
}

function bind(){
  document.addEventListener("keydown", onKeydown);
}

/* ---------- Публичный API ---------- */

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