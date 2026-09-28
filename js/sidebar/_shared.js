/* ============================================================
   sidebar/_shared.js — общие зависимости и состояние sidebar

   [Пакет 9]  TEMPLATES: если S.templates не пуст — берём из state;
              иначе fallback на встроенный набор.
              Object.create(null) для «словарных» полей защиты.

   Загружается ПЕРВЫМ из sidebar/*
   ============================================================ */

window.App = window.App || {};

window.App.sidebarShared = (() => {
"use strict";

const U = window.App.utils;
const { $, $$, el, escape, uid, now, toast } = U;

const St = () => window.App.state.S;
const getActiveDoc = () => window.App.state.getActiveDoc();

/* Общее мутабельное состояние sidebar */
let _currentFolderId = null;
let _searchQuery     = "";
let _contextMenuDoc  = null;
let _currentTag      = null;

/* Пресеты для модалки свойств */
const EMOJI_PRESETS = ["📝","📔","📚","💡","⭐","✅","🎯","🍳","✈️","💼","🎨","🔬","🏠","❤️","⚡"];
const COLOR_PRESETS = ["#829b91","#a78663","#c46a63","#c98a3c","#8a7bc4","#6a8dc4","#5fa57a","#7a7a7a"];

/* Fallback-шаблоны, если state.S.templates пуст */
const FALLBACK_TEMPLATES = [
  {
    id: "note",
    name: "Заметка",
    icon: "📝",
    blocks: [
      { type: "h1", content: "Заметка" },
      { type: "text", content: "" },
      { type: "text", content: "Ключевая мысль:" },
      { type: "quote", content: "" },
      { type: "text", content: "Детали:" },
      { type: "ul", content: "<li><br></li><li><br></li>" }
    ]
  },
  {
    id: "meeting",
    name: "Встреча",
    icon: "👥",
    blocks: [
      { type: "h1", content: "Встреча" },
      { type: "text", content: "Дата: " + new Date().toLocaleDateString("ru-RU") },
      { type: "text", content: "Участники:" },
      { type: "ul", content: "<li><br></li>" },
      { type: "h2", content: "Повестка" },
      { type: "ul", content: "<li><br></li><li><br></li>" },
      { type: "h2", content: "Решения" },
      { type: "ul", content: "<li><br></li>" },
      { type: "h2", content: "Задачи" },
      { type: "todo", content: "" }
    ]
  },
  {
    id: "task",
    name: "Задача",
    icon: "✅",
    blocks: [
      { type: "h1", content: "Задача" },
      { type: "text", content: "Что нужно сделать:" },
      { type: "todo", content: "" },
      { type: "text", content: "Дедлайн:" },
      { type: "text", content: "" },
      { type: "text", content: "Заметки:" }
    ]
  },
  {
    id: "recipe",
    name: "Рецепт",
    icon: "🍳",
    blocks: [
      { type: "h1", content: "Рецепт" },
      { type: "text", content: "Порций: · Время: " },
      { type: "h2", content: "Ингредиенты" },
      { type: "ul", content: "<li><br></li><li><br></li><li><br></li>" },
      { type: "h2", content: "Приготовление" },
      { type: "ol", content: "<li><br></li><li><br></li>" }
    ]
  },
  {
    id: "diary",
    name: "Дневник",
    icon: "📔",
    blocks: [
      { type: "h1", content: new Date().toLocaleDateString("ru-RU", { day:"numeric", month:"long", year:"numeric" }) },
      { type: "text", content: "Настроение:" },
      { type: "text", content: "" },
      { type: "text", content: "Что произошло сегодня:" },
      { type: "text", content: "" },
      { type: "text", content: "Благодарности:" },
      { type: "ul", content: "<li><br></li><li><br></li>" }
    ]
  },
  {
    id: "outline",
    name: "Конспект",
    icon: "📚",
    blocks: [
      { type: "h1", content: "Конспект" },
      { type: "text", content: "Источник:" },
      { type: "text", content: "" },
      { type: "h2", content: "Главное" },
      { type: "ul", content: "<li><br></li><li><br></li><li><br></li>" },
      { type: "h2", content: "Детали" },
      { type: "text", content: "" },
      { type: "h2", content: "Вопросы" },
      { type: "ul", content: "<li><br></li>" }
    ]
  }
];

/* [Пакет 9] Возвращает актуальный список шаблонов:
   сначала из state.S.templates, иначе fallback. */
function getTemplates(){
  try {
    const st = St().templates;
    if (st && typeof st === "object"){
      const arr = Object.values(st).filter(t => t && !t.hidden && Array.isArray(t.blocks) && t.blocks.length);
      if (arr.length) return arr;
    }
  } catch(e){}
  return FALLBACK_TEMPLATES;
}

return {
  U, $, $$, el, escape, uid, now, toast,
  St, getActiveDoc,
  EMOJI_PRESETS, COLOR_PRESETS,
  /* [Пакет 9] TEMPLATES — геттер, чтобы читал актуальные */
  get TEMPLATES(){ return getTemplates(); },

  get currentFolderId(){ return _currentFolderId; },
  set currentFolderId(v){ _currentFolderId = v; },

  get searchQuery(){ return _searchQuery; },
  set searchQuery(v){ _searchQuery = v; },

  get contextMenuDoc(){ return _contextMenuDoc; },
  set contextMenuDoc(v){ _contextMenuDoc = v; },

  get currentTag(){ return _currentTag; },
  set currentTag(v){ _currentTag = v; }
};
})();