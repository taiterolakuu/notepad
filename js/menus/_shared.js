/* ============================================================
   menus/_shared.js — общие зависимости, состояние, хелперы
   Загружается ПЕРВЫМ из всех menus/*
   ============================================================ */

window.App = window.App || {};

window.App.menusShared = (() => {
"use strict";

const U = window.App.utils;
const {
  $, $$, types, htmlToText, uid, toast, escape,
  LINE_TYPES, line: newLineFn, shortId
} = U;

const St = () => window.App.state.S;
const setActive          = v => window.App.state.setActive(v);
const setSlashBlockId    = v => window.App.state.setSlashBlockId(v);
const getSlashBlockId    = () => window.App.state.slashBlockId;
const setSelectedBlock   = v => window.App.state.setSelectedBlock(v);
const setSelectedRange   = (a, b) => window.App.state.setSelectedRange(a, b);
const clearSelectedRange = () => window.App.state.clearSelectedRange();
const clearSelection     = () => window.App.state.clearSelection();

const snapshot        = () => window.App.state.snapshot();
const commit          = b => window.App.state.commit(b);
const commitDebounced = b => window.App.state.commitDebounced(b);
const save            = () => window.App.state.save();
const saveNow         = () => window.App.state.saveNow();
const undo            = () => window.App.state.undo();
const redo            = () => window.App.state.redo();
const getActiveDoc    = () => window.App.state.getActiveDoc();

const render      = () => window.App.render.render();
const add         = (...a) => window.App.render.add(...a);
const focusActive = () => window.App.render.focusActive();

/* ---------- Общее мутабельное состояние ---------- */

/* lastRange — используется floatbar и fontmenu */
let _lastRange = null;

/* floatbarDragging — используется floatbar и selectionchange */
let _floatbarDragging = false;

/* markerMenuOpen — используется floatbar и bind */
let _markerMenuOpen = false;

/* fontMenuOpen — используется fontmenu и bind */
let _fontMenuOpen = false;

/* handleMenuOpen — используется handle-menu и bind */
let _handleMenuOpen = false;

/* linesPanelOpen — используется lines-panel и bind */
let _linesPanelOpen = false;

/* ---------- Slash body (для slash.js) ---------- */
let _slashBody = null;

/* ---------- Палитра (для palette.js) ---------- */
let _cmdIndex = 0;
let _paletteMode = "commands";
let _lastCmdLen = -1;

/* ---------- Handle menu (для handle-menu.js) ---------- */
let _handleMenuBlock = null;

const ALIGN_CMDS = new Set(["align-left","align-center","align-right"]);

return {
  /* utils */
  $, $$, types, htmlToText, uid, toast, escape,
  LINE_TYPES, newLineFn, shortId,
  U,

  /* state */
  St,
  setActive, setSlashBlockId, getSlashBlockId,
  setSelectedBlock, setSelectedRange, clearSelectedRange, clearSelection,
  snapshot, commit, commitDebounced, save, saveNow, undo, redo, getActiveDoc,

  /* render */
  render, add, focusActive,

  /* shared mutable — доступ через геттеры/сеттеры */
  get lastRange(){ return _lastRange; },
  set lastRange(v){ _lastRange = v; },

  get floatbarDragging(){ return _floatbarDragging; },
  set floatbarDragging(v){ _floatbarDragging = v; },

  get markerMenuOpen(){ return _markerMenuOpen; },
  set markerMenuOpen(v){ _markerMenuOpen = v; },

  get fontMenuOpen(){ return _fontMenuOpen; },
  set fontMenuOpen(v){ _fontMenuOpen = v; },

  get handleMenuOpen(){ return _handleMenuOpen; },
  set handleMenuOpen(v){ _handleMenuOpen = v; },

  get linesPanelOpen(){ return _linesPanelOpen; },
  set linesPanelOpen(v){ _linesPanelOpen = v; },

  get slashBody(){ return _slashBody; },
  set slashBody(v){ _slashBody = v; },

  get cmdIndex(){ return _cmdIndex; },
  set cmdIndex(v){ _cmdIndex = v; },

  get paletteMode(){ return _paletteMode; },
  set paletteMode(v){ _paletteMode = v; },

  get lastCmdLen(){ return _lastCmdLen; },
  set lastCmdLen(v){ _lastCmdLen = v; },

  get handleMenuBlock(){ return _handleMenuBlock; },
  set handleMenuBlock(v){ _handleMenuBlock = v; },

  ALIGN_CMDS
};
})();