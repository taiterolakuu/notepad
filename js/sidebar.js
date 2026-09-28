/* ============================================================
   sidebar.js — фасад над js/sidebar/*
   Публичный API не меняется: window.App.sidebar.*
   Загружается ПОСЛЕДНИМ из sidebar/*
   ============================================================ */

window.App = window.App || {};

window.App.sidebar = (() => {
"use strict";

const Main    = window.App.sidebarMain;
const Modals  = window.App.sidebarModals;
const Cards   = window.App.sidebarCards;
const Folders = window.App.sidebarFolders;
const List    = window.App.sidebarList;

return {
  /* Main */
  render:            Main.render,
  toggleSidebar:     Main.toggleSidebar,
  createNewDocument: Main.createNewDocument,
  makeCrumb:         Main.makeCrumb,

  /* Modals */
  openModal:         Modals.openModal,
  closeModal:        Modals.closeModal,
  openProperties:    Modals.openProperties,
  createFolder:      Modals.createFolder,
  renameFolder:      Modals.renameFolder,
  deleteFolder:      Modals.deleteFolder,
  createFromTemplate:Modals.createFromTemplate,

  /* Cards */
  openDocument:      Cards.openDocument,
  moveDocumentToFolder: Cards.moveDocumentToFolder,
  openCardMenu:      Cards.openCardMenu,
  closeCardMenu:     Cards.closeCardMenu,
  promptRename:      Cards.promptRename,
  duplicate:         Cards.duplicate,
  trash:             Cards.trash,
  restore:           Cards.restore,
  purge:             Cards.purge,

  /* Folders */
  folderChain:  Folders.folderChain,
  relTime:      Folders.relTime,

  /* List */
  renderList:   List.renderList,

  /* Геттер текущей папки */
  get currentFolderId(){ return window.App.sidebarShared.currentFolderId; },
  set currentFolderId(v){ window.App.sidebarShared.currentFolderId = v; }
};
})();