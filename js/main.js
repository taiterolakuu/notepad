/* ============================================================
   main.js — точка входа
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

/* ---------- Title ---------- */

function bindTitle(){
  const titleEl = $("#title");
  if (!titleEl) return;

  titleEl.oninput = () => {
    const doc = window.App.state.getActiveDoc();
    if (!doc) return;
    const wasEmpty = doc.title === "";
    doc.title = titleEl.innerText;
    if (wasEmpty) window.App.state.commit(window.App.state.snapshot());
    else          window.App.state.commitDebounced(window.App.state.snapshot());
    window.App.state.save();
  };

  titleEl.onblur = () => {
    const doc = window.App.state.getActiveDoc();
    if (!doc) return;
    window.App.state.renameDocument(doc.id, doc.title);
  };

  titleEl.dir = "auto";
}

/* ---------- Header ---------- */

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

  if ($theme) $theme.onclick = () => {
    const a = ["paper","sepia","mint","dark"];
    const i = a.indexOf(St().theme);
    const old = window.App.state.snapshot();
    window.App.state.setUI("theme", a[(i + 1) % a.length]);
    window.App.state.commit(old);
    window.App.render.render();
  };

  if ($find) $find.oninput = e => {
    const q = e.target.value.toLowerCase();
    U.$$(".block").forEach(w => {
      w.style.display =
        !q || w.innerText.toLowerCase().includes(q) ? "" : "none";
    });
  };
}

/* ---------- Init ---------- */

async function init(){
  await window.App.state.load();
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
  window.App.render.bindWikilinkClicks();   /* клики по [[...]] */
  window.App.backlinks?.bind?.();           /* панель backlinks */
  window.App.wikilinkPopover?.bind?.();     /* поповер автодополнения */
  window.App.settings?.bind?.();            /* модалка настроек */
  window.App.hotkeys?.bind?.();             /* единый обработчик хоткеев */
  window.App.lock?.bind?.();                /* пароль-замок */

  window.App.state.startTimers();

  console.log("Paper notebook: мультидокумент запущен.");
}

if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})();