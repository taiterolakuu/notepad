/* ============================================================
   main.js — точка входа

   [Пакет 3 fix] db.init() ПЕРВЫМ, потом lock.bind(), потом
                 state.load() — иначе db.getMeta бросает
                 "[db] not initialized" и lock ложно fail-closed.
   [Пакет 8]     io.bindIO().
   [Пакет 11]    $theme.onclick без commit — тема не в истории;
                 startupMode применяется при первом рендере.
   [Пакет 12]    #find — debounce, сброс при смене документа.
   [Пакет 15]    graceful error при падении init.
   ============================================================ */

window.App = window.App || {};

(() => {
"use strict";

const U = window.App.utils;
const { $ } = U;
const St = () => window.App.state.S;
const menus   = window.App.menus;
const io      = window.App.io;
const sidebar = window.App.sidebar;
const tabs    = window.App.tabs;

/* ============================================================
   Title
   ============================================================ */

function bindTitle(){
  const titleEl = $("#title");
  if (!titleEl) return;

  let _titleAtFocus     = null;
  let _prevTitleOnInput = null;

  titleEl.addEventListener("focus", () => {
    const doc = window.App.state.getActiveDoc();
    if (!doc) return;
    _titleAtFocus     = doc.title || "";
    _prevTitleOnInput = doc.title || "";
  });

  titleEl.oninput = () => {
    const doc = window.App.state.getActiveDoc();
    if (!doc) return;

    const before = window.App.state.snapshot();

    doc.title = titleEl.innerText;
    window.App.state.save();
    window.App.state.commitDebounced(before);
  };

  titleEl.onblur = () => {
    const doc = window.App.state.getActiveDoc();
    if (!doc) return;

    window.App.state.flushPending?.();

    const prev = (_prevTitleOnInput != null)
      ? _prevTitleOnInput
      : _titleAtFocus;

    window.App.state.renameDocument(doc.id, doc.title, prev);

    _titleAtFocus     = null;
    _prevTitleOnInput = null;
  };

  titleEl.addEventListener("keydown", e => {
    if (e.key === "Enter"){
      e.preventDefault();
      titleEl.blur();
    }
  });

  titleEl.addEventListener("paste", e => {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") || "")
      .replace(/\r?\n/g, " ");
    document.execCommand("insertText", false, text);
  });

  titleEl.dir = "auto";
}

/* ============================================================
   Header
   ============================================================ */

let _findTimer = null;
let _findLastQuery = "";

function _applyFindFilter(q){
  const query = String(q || "").toLowerCase().trim();
  _findLastQuery = query;

  const blocks = U.$$("#editor .block");
  if (!query){
    blocks.forEach(w => { w.style.display = ""; });
    return;
  }

  blocks.forEach(w => {
    const text = (w.innerText || "").toLowerCase();
    w.style.display = text.includes(query) ? "" : "none";
  });
}

function bindHeader(){
  const $undo = $("#undo");
  const $redo = $("#redo");
  const $new  = $("#new");
  const $menu = $("#menu");
  const $theme = $("#theme");
  const $find = $("#find");
  const $toggle = $("#sidebar-toggle");

  if ($undo) $undo.onclick = () => window.App.state.undo();
  if ($redo) $redo.onclick = () => window.App.state.redo();
  if ($new)  $new.onclick  = () => sidebar.createNewDocument();
  if ($menu) $menu.onclick = () => menus.openPalette();
  if ($toggle) $toggle.onclick = () => sidebar.toggleSidebar();

  /* [Пакет 11] тема меняется без записи в историю */
  if ($theme) $theme.onclick = () => {
    const a = ["paper","sepia","mint","dark"];
    const i = a.indexOf(St().theme);
    window.App.state.setUI("theme", a[(i + 1) % a.length]);
    window.App.render.render();
  };

  if ($find){
    $find.oninput = e => {
      const q = e.target.value;
      clearTimeout(_findTimer);
      _findTimer = setTimeout(() => _applyFindFilter(q), 150);
    };
  }
}

/* ============================================================
   Init
   ============================================================ */

function _showFatalError(err){
  console.error("[init] fatal:", err);
  const layout = document.getElementById("layout");
  if (layout){
    layout.innerHTML = `
      <div style="padding:40px;max-width:600px;margin:0 auto;
                  font:15px/1.6 system-ui,sans-serif;color:#343330">
        <h1 style="margin:0 0 12px;font-size:22px">Не удалось запустить Paper</h1>
        <p style="color:#666;margin:0 0 16px">
          Возможно, браузер не поддерживает IndexedDB или хранилище недоступно
          (например, в приватном режиме Firefox).
        </p>
        <p style="color:#999;font-size:13px;margin:0 0 16px">
          ${String(err && err.message || err || "").replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]))}
        </p>
        <button onclick="location.reload()"
                style="padding:8px 16px;border:1px solid #ddd;border-radius:8px;
                       background:#fffdf8;cursor:pointer">
          Перезагрузить
        </button>
      </div>`;
  }
}

async function init(){
  /* [Пакет 3 fix] 1) Открыть IndexedDB.
     Без этого lock.bind() → db.getMeta() бросит "not initialized",
     catch в loadLockMeta сработает fail-closed, и приложение
     навсегда застрянет на экране блокировки. */
  try {
    await window.App.db.init();
  } catch(e){
    console.error("[init] db.init failed:", e);
    _showFatalError(e);
    return;
  }

  /* [Пакет 3] 2) lock.bind() — после db.init, до render() */
  try { window.App.lock?.bind?.(); } catch(e){ console.warn("lock bind:", e); }

  /* 3) Загрузить состояние и запустить приложение */
  try {
    await window.App.state.load();

    /* [Пакет 11] применить startupMode */
    try { window.App.state.applyStartupMode?.(); } catch(e){}

    window.App.render.applySavedFonts();
    window.App.render.render();

    sidebar.render();
    tabs.render();

    window.App.state.setActive(window.App.state.getBlocks()[0]?.id);

    bindTitle();
    bindHeader();
    menus.bindFloatbar();
    menus.bindMenus();
    io.bindIO();
    window.App.render.bindWikilinkClicks();
    window.App.backlinks?.bind?.();
    window.App.wikilinkPopover?.bind?.();
    window.App.settings?.bind?.();
    window.App.hotkeys?.bind?.();

    /* [Пакет 2] flush + save при уходе в фон */
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden"){
        try {
          window.App.state.flushPending?.();
          window.App.state.saveNow?.();
        } catch(e){}
      }
    });

    window.addEventListener("pagehide", () => {
      try {
        window.App.state.flushPending?.();
        window.App.state.saveNow?.();
      } catch(e){}
    });

    /* [Пакет 12] Сброс фильтра #find при смене документа */
    const _origSetActive = window.App.state.setActiveDoc;
    window.App.state.setActiveDoc = async function(id){
      await _origSetActive.apply(this, arguments);
      const find = $("#find");
      if (find && find.value){
        find.value = "";
        _applyFindFilter("");
      }
    };

    /* [Пакет 12] Переприменение фильтра после render() */
    const _origRender = window.App.render.render;
    window.App.render.render = function(){
      _origRender.apply(this, arguments);
      if (_findLastQuery){
        _applyFindFilter(_findLastQuery);
      }
    };

    window.App.state.startTimers();

    console.log("Paper notebook: мультидокумент запущен.");
  } catch(err){
    _showFatalError(err);
  }
}

if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})();