/* ============================================================
   render/_shared.js — общие зависимости и состояние
   Загружается ПЕРВЫМ из render/*
   ============================================================ */

window.App = window.App || {};

window.App.renderShared = (() => {
"use strict";

const U = window.App.utils;
const {
  $, $$, el, escape, sanitize,
  block: newBlock,
  line: newLine,
  LINE_TYPES,
  syncBlockLines,
  getBlockHTML
} = U;

const St = () => window.App.state.S;
const getActiveDoc = () => window.App.state.getActiveDoc();

const setActive          = v => window.App.state.setActive(v);
const setSelectedBlock   = v => window.App.state.setSelectedBlock(v);
const setSelectedRange   = (a, b) => window.App.state.setSelectedRange(a, b);
const clearSelectedRange = () => window.App.state.clearSelectedRange();
const setDraggedId       = v => window.App.state.setDraggedId(v);
const getDraggedId       = () => window.App.state.draggedId;
const getActiveId        = () => window.App.state.active;

const snapshot        = () => window.App.state.snapshot();
const commit          = b => window.App.state.commit(b);
const commitDebounced = b => window.App.state.commitDebounced(b);
const save            = () => window.App.state.save();

/* Общий мутабельный флаг для column-resizer */
let _colsDrag = null;

/* Общий флаг "bindColumnResizer уже повешен" */
let _resizerBound = false;

return {
  /* utils */
  $, $$, el, escape, sanitize,
  newBlock, newLine, LINE_TYPES, syncBlockLines, getBlockHTML,
  U,

  /* state */
  St, getActiveDoc,
  setActive, setSelectedBlock, setSelectedRange, clearSelectedRange,
  setDraggedId, getDraggedId, getActiveId,
  snapshot, commit, commitDebounced, save,

  /* shared mutable */
  get colsDrag(){ return _colsDrag; },
  set colsDrag(v){ _colsDrag = v; },

  get resizerBound(){ return _resizerBound; },
  set resizerBound(v){ _resizerBound = v; }
};
})();