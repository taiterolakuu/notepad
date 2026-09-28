/* ============================================================
   render.js — фасад над js/render/*
   Публичный API не меняется: window.App.render.*
   Загружается ПОСЛЕДНИМ из render/*
   ============================================================ */

window.App = window.App || {};

window.App.render = (() => {
"use strict";

const Wikilinks = window.App.renderWikilinks;
const Paste     = window.App.renderPaste;
const LineMod   = window.App.renderLine;
const BlockMod  = window.App.renderBlock;
const Main      = window.App.renderMain;

return {
  /* Wikilinks */
  toDisplayHTML:      Wikilinks.toDisplayHTML,
  toSourceHTML:       Wikilinks.toSourceHTML,
  wikilinkResolver:   Wikilinks.wikilinkResolver,
  bindWikilinkClicks: Wikilinks.bindWikilinkClicks,

  /* Paste */
  makePasteHandler: Paste.makePasteHandler,
  cleanupEmptyLis:  Paste.cleanupEmptyLis,

  /* Line */
  renderLine:     LineMod.renderLine,
  keyLine:        LineMod.keyLine,
  caretAtStart:   LineMod.caretAtStart,
  caretAtEnd:     LineMod.caretAtEnd,
  placeCaretStart:LineMod.placeCaretStart,
  placeCaretEnd:  LineMod.placeCaretEnd,

  /* Block */
  renderBlock:       BlockMod.renderBlock,
  renderTable:       BlockMod.renderTable,
  renderColumns:     BlockMod.renderColumns,
  focusCell:         BlockMod.focusCell,
  buildColsToolbar:  BlockMod.buildColsToolbar,
  buildColsTemplate: BlockMod.buildColsTemplate,
  isSameWidths:      BlockMod.isSameWidths,
  bindColumnResizer: BlockMod.bindColumnResizer,
  checkInputRules:   BlockMod.checkInputRules,
  keyBlock:          BlockMod.keyBlock,

  /* Main */
  render:          Main.render,
  add:             Main.add,
  focusActive:     Main.focusActive,
  applySavedFonts: Main.applySavedFonts
};
})();