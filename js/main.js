/* ============================================================
   main.js — точка входа
   Зависит от: все модули
   ============================================================ */

window.App = window.App || {};

(() => {
"use strict";

const U = window.App.utils;
const { $, $$, toast } = U;
const St = () => window.App.state.S;
const menus = window.App.menus;
const io    = window.App.io;

/* ---------- Title binding ---------- */

function bindTitle(){
  $("#title").oninput = () => {
    const wasEmpty = St().title === "";
    St().title = $("#title").innerText;
    if (wasEmpty) window.App.state.commit(window.App.state.snapshot());
    else          window.App.state.commitDebounced(window.App.state.snapshot());
    window.App.state.save();
  };
}

/* ---------- Header bindings ---------- */

function bindHeader(){
  $("#undo").onclick = () => window.App.state.undo();
  $("#redo").onclick = () => window.App.state.redo();
  $("#new").onclick  = () => menus.run("new");
  $("#menu").onclick = () => menus.openPalette();

  $("#theme").onclick = () => {
    const a = ["paper","sepia","mint","dark"];
    const i = a.indexOf(St().theme);
    const old = window.App.state.snapshot();
    St().theme = a[(i + 1) % a.length];
    window.App.state.commit(old);
    window.App.render.render();
  };

  $("#find").oninput = e => {
    const q = e.target.value.toLowerCase();
    $$(".block").forEach(w => {
      w.style.display =
        !q || w.innerText.toLowerCase().includes(q) ? "" : "none";
    });
  };
}

/* ---------- Init ---------- */

function init(){
  window.App.state.load();
  window.App.render.applySavedFonts();
  window.App.render.render();
  window.App.state.setActive(St().blocks[0]?.id);

  bindTitle();
  bindHeader();
  menus.bindFloatbar();
  menus.bindMenus();
  io.bindIO();

  console.log("Paper notebook готов.");
}

if (document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

})();