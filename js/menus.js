/* ============================================================
   menus.js — фасад над модулями js/menus/*
   Публичный API не меняется: window.App.menus.*
   Загружается ПОСЛЕДНИМ из menus/*
   ============================================================ */

window.App = window.App || {};

window.App.menus = (() => {
"use strict";

const Slash       = window.App.menusSlash;
const Palette     = window.App.menusPalette;
const Search      = window.App.menusSearch;
const Floatbar    = window.App.menusFloatbar;
const HandleMenu  = window.App.menusHandleMenu;
const LinesPanel  = window.App.menusLinesPanel;
const Bind        = window.App.menusBind;

return {
  /* Slash */
  openSlash:       Slash.openSlash,
  slashRender:     Slash.slashRender,
  slashChoose:     Slash.slashChoose,

  /* Palette */
  openPalette:     Palette.openPalette,
  closeMenus:      Palette.closeMenus,
  cmdRender:       Palette.cmdRender,
  run:             Palette.run,
  openDocById:     Palette.openDocById,

  /* Search */
  openGlobalSearch: Search.openGlobalSearch,

  /* Lines panel */
  openLinesPanel:   LinesPanel.openLinesPanel,
  closeLinesPanel:  LinesPanel.closeLinesPanel,
  isLinesPanelOpen: LinesPanel.isLinesPanelOpen,

  /* Font menu */
  openFontMenu:     HandleMenu.openFontMenu,
  closeFontMenu:    HandleMenu.closeFontMenu,

  /* Handle menu */
  openHandleMenu:   HandleMenu.openHandleMenu,
  closeHandleMenu:  HandleMenu.closeHandleMenu,

  /* Binding */
  bindFloatbar: Floatbar.bindFloatbar,
  bindMenus:    Bind.bindMenus,

  /* Геттеры для обратной совместимости */
  get handleMenuOpen(){ return window.App.menusShared.handleMenuOpen; },
  get fontMenuOpen(){   return window.App.menusShared.fontMenuOpen;   },
  get markerMenuOpen(){ return window.App.menusShared.markerMenuOpen; },
  get linesPanelOpen(){ return window.App.menusShared.linesPanelOpen; }
};
})();