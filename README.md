# Paper — Personal Notebook

Локальное веб-приложение для заметок с блочным редактором, мультидокументом,
wikilinks, шаблонами, пароль-замком и полной работой офлайн. Данные хранятся
в IndexedDB браузера. Никакого бэкенда, никакой отправки данных наружу.

---

## Что это

Одностраничное приложение (SPA), целиком в браузере. Редактор построен на
`contenteditable` и собственной блочной модели: документ — это массив
«блоков» (`text`, `h1..h3`, `ul`, `ol`, `todo`, `quote`, `code`, `table`,
`columns`, `divider`, `image`).

Поддерживается:

- Мультидокумент: неограниченное число документов, вкладки, папки, теги,
  избранное, архив, корзина с TTL.
- Блочный редактор с типами блоков, фоном/шрифтом/выравниванием/отступом,
  чек-листами, таблицами, **табличной сеткой ячеек** (`columns`).
- Wikilinks `[[Имя]]` с анкорами `[[Имя#блок#строка#фрагмент]]`,
  автодополнение у каретки, панель backlinks и «Возможно, вы имели в виду».
- Автосохранение, undo/redo с историей по каждому документу, отложенный
  commit, индикатор статуса сохранения.
- Экспорт HTML / Markdown / JSON / PDF, экспорт всех документов в ZIP,
  импорт HTML / MD / JSON.
- Командная палитра (Ctrl+K), слэш-меню «/тип», floatbar выделения,
  контекстное меню блока, панель строк блока, автодополнение шрифтов.
- Шаблоны документов (встроенные + пользовательские), импорт/экспорт.
- Темы: paper, sepia, mint, dark; настройка шрифтов; авто-сохранение UI.
- Пароль-замок приложения (PBKDF2 310k итераций, SHA-256), автоблокировка,
  ограничение попыток. **Данные не шифруются** — замок только не пускает в UI.
- Полностью офлайн. CSP: `default-src 'none'`, `script-src 'self'`.
  Сторонние запросы только на Google Fonts (CSS + сами шрифты).

---

## Быстрый старт

1. Склонировать репозиторий.
2. Открыть `index.html` в браузере.
   Достаточно `file://` или любого статического сервера (`python -m http.server`).
3. Для работы пароль-замка и IndexedDB нужен `http(s)://` или `localhost` —
   на `file://` WebCrypto недоступен.

Никаких билд-шагов, никакого `npm install`. Это чистый HTML+CSS+JS.

---

## Архитектура (для разработчиков и ИИ)

### Общий принцип

- Всё в глобальном неймспейсе `window.App.*`.
- Каждый модуль — IIFE, возвращает объект, экспортирует его в `window.App.xxx`.
- Модули подключаются в `index.html` в **строгом порядке**, потому что многие
  берут зависимости **на этапе инициализации модуля** (деструктуризация,
  а не ленивый вызов). Порядок `<script>` критичен.
- Никаких ES-модулей, `import`/`export`, бандлеров. Только глобальный `window`.
- Реактивной системы нет. Перерисовка — императивным `render()`.

### Порядок загрузки скриптов
js/db.js
js/utils.js
js/state.js

js/render/_shared.js
js/render/wikilinks.js
js/render/paste.js
js/render/line.js
js/render/block.js
js/render/cols-drag.js
js/render/main.js
js/render.js

js/sidebar/_shared.js
js/sidebar/modals.js
js/sidebar/folders.js
js/sidebar/cards.js
js/sidebar/list.js
js/sidebar/main.js
js/sidebar.js

js/tabs.js
js/io.js
js/backlinks.js
js/wikilink-popover.js
js/hotkeys.js
js/settings.js
js/lock.js

js/menus/_shared.js
js/menus/slash.js
js/menus/palette.js
js/menus/search.js
js/menus/floatbar.js
js/menus/handle-menu.js
js/menus/lines-panel.js
js/menus/bind.js
js/menus.js
js/main.js

Точка входа — `js/main.js`. Он делает:

1. `await App.db.init()` — открывает IndexedDB.
2. `App.lock.bind()` — экран пароля до всего остального.
3. `await App.state.load()` — читает всё из БД.
4. `App.render.render()` — первый рендер редактора.
5. `App.sidebar.render()`, `App.tabs.render()`.
6. `bindTitle`, `bindHeader`, `menus.bindFloatbar`, `menus.bindMenus`, `io.bindIO`, ...
7. `state.startTimers()` — автобэкап и автоочистка корзины.

---

## Структура папок
.
├── index.html # единственная HTML-страница
├── css/
│ ├── tokens.css # CSS-переменные: темы, шрифты, focus-ring
│ ├── base.css # reset, layout, шапка, page, title, скроллбары
│ ├── blocks.css # .block, .handle, .body, типографика, таблица
│ ├── lists.css # todo, ul/ol, маркеры
│ ├── columns.css # табличная сетка ячеек, аккордеон ctx-меню
│ ├── lines.css # .lines, панель строк, секция «Строки»
│ ├── floating.css # floatbar, palette, slash, fontmenu, handlemenu, swatches
│ ├── sidebar.css # sidebar, tabs, modal, props, settings, lock
│ ├── wikilinks.css # .wikilink, backlinks, anchor-highlight
│ └── misc.css # add-block-zone, block-gap, адаптив, print
└── js/
├── db.js # IndexedDB-обёртка + миграция из localStorage
├── utils.js # константы, escape, sanitize, нормализация, модель cells
├── state.js # S, история, undo/redo, backlinks, CRUD документов
├── render.js # фасад над js/render/*
├── render/
│ ├── _shared.js # общие зависимости для render/*
│ ├── wikilinks.js # toDisplayHTML / toSourceHTML, click по ссылкам
│ ├── paste.js # paste handler + cleanupEmptyLis
│ ├── line.js # renderLine + keyLine (Enter/Backspace/arrows)
│ ├── block.js # renderBlock, table, columns, ctx-меню ячейки
│ ├── cols-drag.js # drag ячеек, resize высоты/ширины
│ └── main.js # главный render(), add(), focusActive(), fonts
├── sidebar.js # фасад над js/sidebar/*
├── sidebar/
│ ├── _shared.js # TEMPLATES, placeCtxMenu, общее состояние
│ ├── modals.js # openModal, свойства, шаблоны, папки
│ ├── folders.js # строка папки, ctx-меню папки, время
│ ├── cards.js # карточка документа, ctx-меню карточки
│ ├── list.js # список карточек и папок
│ └── main.js # render() sidebar, секции, теги, breadcrumbs
├── tabs.js # панель вкладок над редактором
├── io.js # экспорт HTML/MD/JSON/PDF/ZIP, импорт, картинки
├── backlinks.js # панель backlinks + findUnlinkedMentions
├── wikilink-popover.js # автодополнение [[Имя]] у каретки
├── hotkeys.js # единый реестр горячих клавиш
├── settings.js # модалка настроек
├── lock.js # пароль-замок, PBKDF2, автоблокировка
├── menus.js # фасад над js/menus/*
├── menus/
│ ├── _shared.js # общее состояние меню
│ ├── slash.js # слэш-меню «/тип»
│ ├── palette.js # командная палитра (Ctrl+K)
│ ├── search.js # глобальный поиск по содержимому
│ ├── floatbar.js # floatbar выделения, списки, strike
│ ├── handle-menu.js # handle-menu, fontmenu, секция колонок
│ ├── lines-panel.js # панель строк блока
│ └── bind.js # единая привязка обработчиков меню
└── main.js # точка входа: init(), bindTitle, bindHeader

---

## Описание по файлам

### Корень

#### `index.html`

Единственная страница. Содержит:

- CSP-мету. `default-src 'none'`, `script-src 'self'`, `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`, `font-src https://fonts.gstatic.com`, `connect-src 'none'`, `object-src 'none'`.
- Ссылки на Google Fonts (Inter, Open Sans, Plus Jakarta Sans, Montserrat, Manrope, Outfit, Lora, PT Serif, Merriweather, JetBrains Mono, Fira Code).
- 10 CSS-файлов в строгом порядке.
- Разметка: `#layout`, `#sidebar`, `#app`, `header`, `#tabs`, `main.page`, `#title`, `#editor`, `#backlinks`.
- Floating-меню и модалки: `#floatbar`, `#markermenu`, `#fontmenu`, `#handlemenu`, `#backdrop`, `#palette`, `#slash`, `#toast`, `#file`, `#wikilink-popover`, `#lines-panel`, `#settings-modal`, `#lock-screen`.
- Разметка `#handlemenu` включает полную секцию `[data-section="columns"]` с вкладками контейнера/колонок (устаревшая — оставлена для совместимости; фактически табличная модель использует свою ctx-меню).
- Подключение скриптов в фиксированном порядке (см. выше).

---

### Ядро

#### `js/db.js`

Обёртка над IndexedDB. Не зависит ни от чего, кроме `window.App.utils` (использует `uid`, `now`).

- Константа `DB_VERSION = 3`. Сторы: `documents`, `folders`, `tags`, `templates`, `meta`, `backup`, `imgStore`.
- `init()` — открывает БД, запрашивает persistent storage, запускает миграцию из localStorage (`paper-notebook-v1`).
- `open()` — кэширует промис. `onversionchange` закрывает соединение, если другая вкладка апгрейдит схему.
- `tx(store, mode)`, `writeTx(store, executor)`, `readTx(...)` — транзакции, ждут `oncomplete` (не `onsuccess`), чтобы commit был надёжным.
- Примитивы: `get`, `all`, `put`, `del`, `clear`, `putMany`, `delMany`.
- Документы: `listDocuments`, `getDocument`, `saveDocument`, `deleteDocument(s)`.
- Мета: `getMeta`, `setMeta`.
- Бэкап: `createBackup`, `listBackups`, `deleteBackup`.
- Картинки (пакет 13): `listImages`, `getImage`, `putImage`, `deleteImage`, `clearImages`.
- `clearAll()` — очищает все сторы.

**Ключевое:** `saveDocument` ставит `doc.updatedAt = App.utils.now()` автоматически.

#### `js/utils.js`

Константы, хелперы, sanitizer, нормализация. **Ни от чего не зависит**, подключается вторым.

Экспортирует:

- **Константы:** `KEY`, `HISTORY_LIMIT`, `INPUT_DEBOUNCE`, `SAVE_DEBOUNCE`, `MAX_IMG_BYTES`, `TRASH_TTL_DAYS`, `types` (список типов блоков), `VALID_TYPES`, `VALID_BG`, `VALID_FONT`, `VALID_INDENT`, `VALID_ALIGN`, `VALID_MARKER`, `VALID_VALIGN`, `VALID_COL_BG`, `VALID_COL_BORDER`, `LINE_TYPES`, `EMOJI_PRESETS`, `COLOR_PRESETS`.
- **DOM:** `$`, `$$`, `el(tag, cls)`, `escape(s)`, `toast(s)`.
- **id/время:** `uid()`, `shortId()`, `now()`.
- **Парсинг HTML:** `parseHTMLFragment(html)` (через `<template>`), `parseHTMLToDiv(html)`.
- **Sanitizer:** `sanitize(html)` — белый список тегов и атрибутов, режет script/style/iframe/svg/math, чистит `href` у не-wikilink `<a>`.
- **Анкоры:** `sanitizeAnchor(str)` — кириллица, `\p{L}\p{N}_\-`, до 64 символов.
- **Строки:** `line(text)`, `normalizeLine(raw)`, `syncBlockLines(b)`, `getBlockText(b)`, `getBlockHTML(b)`, `setBlockHTML(b, html)`, `findLine`, `findLineIndex`, `parseAnchorString(raw)`.
- **Табличная модель ячеек (columns):**
  - `_defaultCellStyle()` — стиль ячейки без `width`.
  - `_defaultCell(x, y)` — фабрика ячейки.
  - `_recompactCells(b)` — **гарантия инвариантов**: дедуп `(x, y)`, автосжатие влево по каждому `y`, сортировка `(y, x)`.
  - `_findCell(b, x, y)`, `_maxCellY(b)`.
- **Нормализация:**
  - `normalizeBlock(raw)` — включая миграцию columns со старой модели (`content[]` + `colStyles[]` + `widths[]` + `newRow`) на табличную (`cells[]` + `colWidths[]` + `cols`).
  - `normalizeDocument(raw)`, `normalizeTemplate(raw)`, `normalizeFolder(raw)`, `normalizeTag(raw)`, `normalizeUI(raw)`, `normalizeSettings(raw)`, `normalizeState(raw)`.
- **Блоки:** `block(type, content)` — фабрика блока. Для `columns` создаёт 2 ячейки `(0,0)` и `(1,0)`, `colWidths = [1, 1]`, `gap = 14`.
- **Конвертация:** `convertBlockType(b, newType)` — меняет `b.type`, переносит содержимое.
- **Wikilinks:** `extractWikilinks(html)`, `renderWikilinks(html, resolver)`.
- **Экспорт:** `blockToHTML(b)` — рендер блока в HTML-строку (используется в `io.js` и в превью шаблонов).
- **Статистика:** `recomputeDocStats(doc)` — считает `blockCount`, `charCount`, `wordCount`.
- **Флоат-меню:** `positionFloating(el, anchorRect, opts)` — единая функция позиционирования (с флипом вверх).
- **Пакет 5+:** `cleanPastedHTML(html)` — чистка вставки из буфера.
- **Утилиты:** `isArrayOfArrays(x)`, `isValidId(id)`, `validateDocId`.
- **Текст:** `htmlToText(html)`, `htmlToMD(html)`.

#### `js/state.js`

Ядро состояния. **Зависит от `App.db` и `App.utils`.**

- `S` — единый объект состояния:
  - `S.documents` (Object.create(null)), `S.folders`, `S.tags`, `S.templates`, `S.backlinks`.
  - `S.ui` — normalizeUI.
  - `S.settings` — normalizeSettings.
  - `S.activeDocId`.
  - Геттеры/сеттеры через `Object.defineProperty`: `S.blocks`, `S.title`, `S.theme`, `S.fonts`, `S.selectedId`, `S.selectedRange`.
- `histories`, `futures` — по каждому документу (Object.create(null)).
- `active`, `slashBlockId`, `draggedId` — геттеры/сеттеры.
- **Индикатор сохранения:** `markDirty`, `markSaved`, `markError` — управляют `#status`.
- **Snapshot / история:** `snapshot()`, `snapshotForHistory()`, `commit(before)`, `commitDebounced(before)`, `flushPending()`. Истории привязаны к `docId`, есть `_pendingBefore`, `_pendingDocId`, `_pendingTimer`.
- **Картинки в истории:** `_stripImages`, `_restoreImages`, `_imgRef`, `_imgByRef`, `_loadImgStore` — картинки не таскаются в историю, хранятся в `imgStore` (IndexedDB).
- **Загрузка:** `load()` — из IndexedDB заполняет `S`, нормализует, строит `backlinks`.
- **Сохранение:** `save()` (debounced), `saveNow()`.
- **Undo/Redo:** `undo()`, `redo()`.
- **Selection:** `setSelectedBlock`, `setSelectedRange`, `clearSelectedRange`, `clearSelection`, `blockIdsInRange`, `syncInSelectionClass`.
- **CRUD документов:** `createDocument`, `setActiveDoc`, `renameDocument` (заменяет `[[Old]]` на `[[New]]` во всех документах), `setDocumentField`, `duplicateDocument` (регенерит `id`, `customId`, `line.id`), `trashDocument`, `restoreDocument`, `purgeDocument`, `emptyTrash`, `autoCleanTrash`, `listDocuments`.
- **Конвертер типов (пакет 12):** `convertBlockType`.
- **Backlinks:** `resolveDocByName`, `extractWikilinksFromBlock`, `rebuildBacklinks`, `getBacklinks`, `findUnlinkedMentions` (кэш `_mentionsCache` по `updatedAt`), `anchorToString`.
- **Анкоры:** `scrollToAnchor(docId, anchor)`, `scrollToAnchorPath(docId, blockAnchor, lineAnchor, fragmentAnchor)` — использует `CSS.escape`.
- **История навигации:** `historyBack`, `historyForward`, `pushToHistory`.
- **UI:** `setUI(key, value)` — пишет в meta.
- **Автобэкап:** `maybeBackup()`, `startTimers()` — часовая проверка бэкапа и автоочистки корзины.
- **Публичный API** — сводный объект в `return`. Ключевые методы вызываются из `render/*`, `menus/*`, `sidebar/*`, `tabs.js`, `backlinks.js`, `hotkeys.js`, `wikilink-popover.js`, `io.js`, `lock.js`, `main.js`.

---

### Рендер

#### `js/render/_shared.js` (`App.renderShared`)

Общие зависимости для всех `render/*`. Загружается первым.

Экспортирует: `$`, `$$`, `el`, `escape`, `sanitize`, `newBlock`, `newLine`, `LINE_TYPES`, `syncBlockLines`, `getBlockHTML`, `U`, `St`, `getActiveDoc`, `setActive`, `setSelectedBlock`, `setSelectedRange`, `clearSelectedRange`, `setDraggedId`, `getDraggedId`, `getActiveId`, `snapshot`, `commit`, `commitDebounced`, `save`.

Также:

- `colsDrag` — общий мутабельный флаг для resizer'а.
- `resizerBound` — идемпотентность `bindColumnResizer`.
- `extendSelectionByWord`, `shrinkSelectionByWord`, `handleWordSelectionKey(e, root)` — Ctrl/Cmd+Arrow расширяет/сжимает выделение по словам внутри contenteditable.

#### `js/render/wikilinks.js` (`App.renderWikilinks`)

- `wikilinkResolver(name)` — ищет документ по имени в `App.state`.
- `toDisplayHTML(html)` — `[[Имя]]` → `<a class="wikilink" data-wikilink="...">`.
- `toSourceHTML(html)` — наоборот, `<a class="wikilink">` → `[[Имя#...]]`.
- `bindWikilinkClicks()` — глобальный клик по `.wikilink`. С модификатором Ctrl/Cmd/Shift/Alt не перехватывает.

#### `js/render/paste.js` (`App.renderPaste`)

- `makePasteHandler(target)` — обработчик `paste` для contenteditable. HTML — `sanitize` + `cleanPastedHTML`, plain — `escape` + `<br>`.
- `cleanupEmptyLis(body)` — удаляет пустые `<li>`.

#### `js/render/line.js` (`App.renderLine`)

- `renderLine(b, ln, i)` — рендер `.line`. `oninput` пишет в `b.lines[i].text`, `onkeydown` — в `keyLine`.
- `keyLine(e, b, lineEl)` — Enter split, Backspace merge, Delete merge, ArrowUp/ArrowDown навигация между строками и блоками.
- Хелперы caret: `caretAtStart`, `caretAtEnd`, `placeCaretStart`, `placeCaretEnd`.

#### `js/render/block.js` (`App.renderBlock`)

Самый крупный. Рендер блоков, таблицы, **табличной сетки ячеек**, контекстного меню ячейки.

- `renderBlock(b)` — разветвляется по `b.type`.
- `renderTable(b)` — HTML-таблица с редактируемыми ячейками, `Tab` создаёт строку.
- `renderColumns(b)` — **табличная сетка**:
  - вызывает `_ensureCellsModel(b)`,
  - строит `.cols` с `grid-template-columns` из `colWidths`,
  - для каждой ячейки ставит `grid-row-start` / `grid-column-start`,
  - вешает `cell-drag-handle`, `cell-resize-v`, `col-resizer` (для `y=0`),
  - плейсхолдер «Кликните, чтобы добавить»,
  - contextmenu → `openColContextMenu(b, x, y, px, py)`.
- `_ensureCellsModel(b)` — гарантирует инварианты модели (нормализация ячеек, `_recompactCells`, синхронизация `cols` / `colWidths`, дефолт 2×1).
- `buildColsTemplate(b)` — `minmax(0, Wfr)` по `colWidths`.
- `buildColsToolbar(b)` — только `+` (добавить столбец) и кнопка настроек контейнера.
- `bindColumnResizer()` — глобальный `mousedown` для `.col-resizer`: ресайз ширины столбца (меняет `b.colWidths[x]` и `b.colWidths[x+1]`).
- `openColContextMenu(b, cellX, cellY, x, y)` — **строгий аккордеон** по категориям:
  - Фон (paint-bucket),
  - Размер и отступы (move-horizontal),
  - Граница (square),
  - Выравнивание (align-left),
  - Действия (settings-2): вставить строку ниже, вставить столбец справа, удалить ячейку.
- `_placeMenuAtPoint(menu, x, y)` — позиционирование ctx-меню с флипом вверх.
- `_setCellField(b, x, y, key, value)` — меняет поле ячейки.
- `_insertRowBelow(b, y)` — сдвигает `y > y` на +1, добавляет пустые ячейки.
- `_insertColRight(b)` — `b.cols++`, `colWidths.push(1)`.
- `_deleteCell(b, x, y)` — удаляет ячейку, `_recompactCells`, подрезает `cols`/`colWidths`.
- `_colBgColor(key)` — маппинг `bg`-ключей в CSS-цвета.
- `checkInputRules(b, body)` — конвертация по вводу (`# ` → h1, `- ` → ul и т.д.).
- `keyBlock(e, b, body)` — обработчик клавиш для `ul`/`ol` и вставки indent-tab.

**Табличная модель `columns`:**

- `b.cols` — число столбцов сетки (хранимое).
- `b.cells` — плоский массив `{ x, y, content, style }` (может быть разреженным).
- `b.colWidths` — массив fr-долей по столбцам.
- `b.gap`, `b.valign`, `b.padding`, `b.minHeight`, `b.containerBg`, `b.containerRadius`, `b.width`.
- Инварианты: уникальные `(x, y)`, автосжатие влево по `y`, сортировка по `(y, x)`. Всё это делает `U._recompactCells`.

#### `js/render/cols-drag.js` (`App.renderColsDrag`)

Драг ячеек и все ресайзы, кроме ширины столбца (это в `block.js`).

- `_onDragHandleDown(e)` — начало драга ячейки.
- `_onDragMove(e)` — определяет цель: `.col` под курсором. Если ячейка на `(overX, overY)` занята — `mode = "swap"`, `.drop-target-cell`. Если пусто — `mode = "move"`, `.drop-free`.
- `_onDragUp()` — swap координат или простой переезд, затем `U._recompactCells(b)`, расширение `b.cols` при выходе за границу, `commit`, `save`, `render`.
- `_onCellVResizeDown` / Move / Up — ресайз `cell.style.minHeight`.
- `_onColsVResizeDown` / Move / Up — ресайз `b.minHeight` контейнера.
- `_onColsHResizeDown` / Move / Up — ресайз `b.width` контейнера.
- `bind()` — единый `mousedown`-делегат на `document` с `capture: true`.

#### `js/render/main.js` (`App.renderMain`)

- `render()` — главный рендер:
  - обновляет `#title` (не трогает, если пользователь в нём),
  - `editor.replaceChildren(...)` — пересобирает все блоки,
  - вставляет `.block-gap` между блоками,
  - добавляет `.add-block-zone`,
  - вешает drag-n-drop блоков по handle,
  - вызывает `bindColumnResizer()` и `window.App.renderColsDrag?.bind?.()`,
  - через `rAF` — `App.backlinks.render()`.
- `add(type, at)` — добавляет блок, фокусирует.
- `focusActive()` — фокусирует первую `.line` или `[contenteditable]`.
- `applySavedFonts()` — применяет `S.ui.fonts` через CSS-переменные.

#### `js/render.js`

Фасад: `App.render.*` → методы из `render/*`. Загружается **последним** из `render/*`.

---

### Sidebar

#### `js/sidebar/_shared.js` (`App.sidebarShared`)

- Мутабельное состояние сайдбара: `currentFolderId`, `searchQuery`, `contextMenuDoc`, `currentTag`.
- `FALLBACK_TEMPLATES` — 6 встроенных шаблонов.
- `TEMPLATES` (геттер) — берёт из `S.templates`, иначе fallback.
- `placeCtxMenu(menu, anchor)` — единое позиционирование `.sb-ctxmenu` с флипом вверх. Используется в `cards.js` и `folders.js`.

#### `js/sidebar/modals.js` (`App.sidebarModals`)

- `openModal({ title, placeholder, value, okLabel, onOk })` — универсальная модалка с одним input.
- `openProperties(docId)` — свойства документа: иконка, цвет, название, описание, теги.
- `createFolder`, `renameFolder`, `deleteFolder`.
- `openTemplatePicker` — пикер шаблонов с превью.
- `saveCurrentAsTemplate(docId)`.
- `importTemplateDialog`, `exportAllTemplates` — импорт/экспорт шаблонов (JSON, ZIP).

#### `js/sidebar/folders.js` (`App.sidebarFolders`)

- `folderChain(id)` — цепочка родителей с защитой от циклов.
- `relTime(ts)` — «только что», «5 мин», «3 ч», «2 д», дата.
- `makeFolderRow(f)` — строка папки + drag&drop документов в неё.
- `openFolderMenu(folderId, anchor)` — ctx-меню папки (переименовать, подпапка, удалить).

#### `js/sidebar/cards.js` (`App.sidebarCards`)

- `makeCard(doc, mode)` — карточка документа (`mini`/`normal`/`detailed`), inline-rename, drag, контекстное меню.
- `startInlineRename`, `firstLineOf`.
- `openDocument(id)` — `App.state.setActiveDoc`.
- `openCardMenu(docId, anchor)` — ctx-меню: открыть, свойства, переименовать, дублировать, закрепить, в избранное, в архив, экспорт HTML/PDF, в корзину.
- Операции: `promptRename`, `duplicate`, `toggleFavorite`, `togglePinned`, `toggleArchived`, `trash`, `restore`, `purge`, `moveDocumentToFolder`.

#### `js/sidebar/list.js` (`App.sidebarList`)

- `renderList()` — рендер списка карточек и папок для текущей секции.
- Drop-зона в корень.

#### `js/sidebar/main.js` (`App.sidebarMain`)

- `render()` — главный рендер сайдбара: шапка, breadcrumbs, теги, секции, список, ноги.
- `makeCrumb(label, folderId)`.
- `toggleSidebar(open)`.
- `createNewDocument()`.

#### `js/sidebar.js`

Фасад: `App.sidebar.*`.

---

### Прочие модули

#### `js/tabs.js` (`App.tabs`)

- `render()`, `closeTab(id)`, `nextTab()`, `prevTab()`.
- Вкладки открытых документов над редактором.

#### `js/io.js` (`App.io`)

- `download(name, data, mime)`, `slugify(s)`.
- `docToHTML(doc)`, `docToMD(doc)`, `docToJSON(doc)`, `blockToHTML(b)`, `blockToMD(b)`.
- `downloadHTML`, `downloadMD`, `downloadJSON`, `downloadPDF` (sandbox-iframe).
- `downloadAllAsZip(format)` — все документы в ZIP (собственный `zipFiles`, метод store, UTF-8 flag).
- `openImportPicker`, `importFromText(name, text)`, `mdToBlocks`, `htmlToBlocks`.
- `compressImage(file, maxSide, quality)` — webp/jpeg.
- `openImagePicker`, `handleFileUpload`, `bindIO()`.

#### `js/backlinks.js` (`App.backlinks`)

- `render()` — панель под документом: «Ссылаются отсюда» + «Возможно, вы имели в виду».
- `linkifyMention(sourceId, targetName)` — превращает первое упоминание в `[[Ссылку]]`.
- Внутри `_linkifyInHtml` — через `<template>`, не `<div>`, с `\p{L}\p{N}`.
- `bind()`.

#### `js/wikilink-popover.js` (`App.wikilinkPopover`)

- `onInput(block, body)` — вызывается из `render/line.js` и `render/block.js`. Извлекает текст между `[[` и кареткой, открывает поповер.
- `handleKey(e, block, body)` — стрелки, Enter, Escape, Tab.
- `commit()` — вставляет `[[Имя]]` или `[[Имя#анкор]]`, обновляет `b.content` / `b.lines[i].text`.
- `bind()` — закрытие по клику/фокусу/resize/scroll.

#### `js/hotkeys.js` (`App.hotkeys`)

- Реестр хоткеев. `DEFAULTS`, `LABELS`.
- `getRegistry()`, `setBinding(actionId, combo)`, `resetAll()`.
- `normalizeEvent(e)`, `prettyPrint(combo)`, `isBrowserTaken(combo)`.
- `dispatch(actionId, ev)` — switch по `actionId`.
- `onKeydown(e)` — единый обработчик. `bind()` — `window.addEventListener("keydown", onKeydown, true)`.
- Хоткеи: `doc:new`, `doc:save`, `doc:close`, `doc:trash`, `palette:open`, `sidebar:toggle`, `edit:undo/redo`, `block:delete`, `block:new`, `line:new`, `lines:panel`, `lock:now` и т.д.

#### `js/settings.js` (`App.settings`)

- `open(section)`, `close()`, `render()`.
- Секции: appearance, behavior, hotkeys, lock, privacy, storage, about.
- Импорт/экспорт всех данных JSON, очистка корзины, сброс.
- Focus trap на Tab.

#### `js/lock.js` (`App.lock`)

- `bind()` — читает `meta.lock`, при наличии пароля показывает `#lock-screen`, ставит `inert` на `#layout`.
- `setPassword`, `changePassword`, `checkPassword`, `clearPassword`.
- `lock()`, `unlock(password)`. Ограничение попыток с нарастающей задержкой.
- PBKDF2, 310k итераций, SHA-256. `fail-closed` при ошибке чтения meta.
- `setAutoLockMinutes(minutes)`, `getAutoLockMinutes()`.
- `visibilitychange` — автоблокировка.
- `recordActivity()` — троттлинг 2 секунды, пишет в `sessionStorage`.

#### `js/main.js`

Точка входа. Описан выше.

---

### Меню

#### `js/menus/_shared.js` (`App.menusShared`)

Единое состояние меню: `lastRange`, `floatbarDragging`, `markerMenuOpen`, `fontMenuOpen`, `handleMenuOpen`, `linesPanelOpen`, `slashBody`, `cmdIndex`, `paletteMode`, `lastCmdLen`, `handleMenuBlock`. Плюс общие `$`, `$$`, `St`, `render`, `add`, `focusActive`, `ALIGN_CMDS`.

#### `js/menus/slash.js` (`App.menusSlash`)

- `openSlash(body, blockId)`, `closeSlash()`, `isSlashOpen()`.
- `slashRender()`, `slashChoose(type)`, `slashKeydown(e)`.
- `maybeOpen(body, blockId)` — вызывается из `oninput` в `render/line.js` и `render/block.js`.

#### `js/menus/palette.js` (`App.menusPalette`)

- Реестр команд `commands`.
- `openPalette(initialMode)`, `closeMenus()`, `cmdRender()`, `run(c)`.
- `detectMode(q)` — `>` команды, `#` документы, `/` блоки, `@` шрифты, `~` темы.
- `_confirmWithPassword(message)` — для `data:reset`.

#### `js/menus/search.js` (`App.menusSearch`)

- `openGlobalSearch()`, `globalSearchRender(q)`.
- Debounce 150 мс, regex-escape, подсветка через функцию.
- Учитывает строки, ячейки таблиц и колонок.

#### `js/menus/floatbar.js` (`App.menusFloatbar`)

- `bindFloatbar()` — привязка кнопок floatbar.
- `getSelectedBlockRange()`, `getBlockUnderCaret()`, `getBlockFromLastRange()`, `getActiveBlockForToolbar()`.
- Работа со списками: `toggleListForSelection(kind, marker)`, `mergeBlocksIntoList`, `splitListBlock`, `listItemsHTML`, `blockToOneLi`, `classifySelection`.
- `applyStrike`, `selectionHasStrike`.
- `syncContentFromSelection()` — не трогает колонки и ячейки таблиц.
- `updateFloatbarState()` — `aria-pressed`, `.on`.
- `toggleMarkerMenu(anchor)`, `closeMarkerMenu()`.

#### `js/menus/handle-menu.js` (`App.menusHandleMenu`)

- `openHandleMenu(anchor, blockId)`, `closeHandleMenu()`.
- `syncHandleMenuState()` — актуализирует `.on` для всех кнопок.
- `fillIdSection`, `bindIdInputOnce`, `fillLinesList`.
- `fillColsRatioButtons`, `fillColsContainerFields`, `fillColsColumnFields`, `fillColsTabs` — секция «Колонки» в handle-menu (устаревшая ветка, работает на **старой** модели; основная работа с ячейками идёт через ctx-меню в `render/block.js`).
- Font menu: `openFontMenu(anchor)`, `closeFontMenu()`, `fontMenuRender(query)`, `applyFontToSelection(name)`.

#### `js/menus/lines-panel.js` (`App.menusLinesPanel`)

- `openLinesPanel()` — открывает панель строк для активного блока (только `LINE_TYPES`).
- `closeLinesPanel()`, `isLinesPanelOpen()`, `bindLinesPanelOnce()`.
- Клик по строке — `scrollToAnchorPath`.
- Копирование `id` / `[[doc#block#line]]`.

#### `js/menus/bind.js` (`App.menusBind`)

Единая привязка обработчиков меню:

- Slash-input, palette-input.
- Fontmenu-input.
- Handle-menu — клики по секциям, включая **устаревшую секцию columns** (container/column).
- Lines-panel.
- Клик по `.handle` → `openHandleMenu`.
- Закрытие по клику вне.
- `selectionchange` через `rAF`.
- Ctrl+Backspace — удаление блока.
- Escape — закрывает всё.

#### `js/menus.js`

Фасад: `App.menus.*` — собирает публичный API из `menus/*`.

---

## Модель данных

### Документ

```js
{
  id: "uuid",
  title: "",
  icon: "",
  color: "",
  description: "",
  blocks: [Block, ...],
  tags: ["todo", "идеи"],
  folderId: null,
  favorite, pinned, archived, trashed, trashedAt,
  createdAt, updatedAt,
  customFields: {},
  blockCount, charCount, wordCount
}
```
Блок
```js

{
  id, type, content, checked,
  rows: null,          // для table
  cols, cells, colWidths,   // для columns (табличная модель)
  bg, font, indent, align, offsetX,
  marker,             // для ul
  gap, valign,        // для columns
  padding,            // общий + columns-контейнер
  customId,
  lines: [],          // для LINE_TYPES
  minHeight, containerBg, containerRadius, width   // columns-контейнер
}
```
Для columns:
```js
b.cols = 3
b.colWidths = [1, 1.5, 1]
b.cells = [
  { x:0, y:0, content:"", style:{ bg, padding, minHeight, align, borderRadius, border } },
  { x:1, y:0, content:"", style:{...} },
  { x:0, y:1, content:"", style:{...} }
]
b.gap = 14
b.valign = "top"
b.padding, b.minHeight, b.containerBg, b.containerRadius, b.width
```
Строка
```js
{ id, text, customId, fragments: [] }
```
Ячейка columns
```js
{
  x: 0,
  y: 0,
  content: "",
  style: {
    bg: "", padding: 0, minHeight: 0,
    align: "left", borderRadius: 8, border: "none"
  }
}
```
## Инварианты

1. **`b.cells` (columns).** Нет двух ячеек с одинаковыми `(x, y)`. В каждом `y` ячейки прижаты влево (`x = 0, 1, 2, ...`). Массив отсортирован по `(y, x)`. Гарантия — `U._recompactCells(b)`.
2. **`b.cols`.** ≥ 2. Всегда ≥ `max(cell.x) + 1`.
3. **`b.colWidths`.** Длина = `b.cols`. Все значения > 0.
4. **`b.rows` (table).** Минимум `[["",""],["",""]]`.
5. **`b.lines` (LINE_TYPES).** Минимум одна строка. `b.content = b.lines.map(l => l.text).join("<br>")`.
6. **Sanitize.** Все `content` проходят через `U.sanitize` при нормализации и вставке.

---

## Потоки данных

### Сохранение

- Изменение → `App.state.save()` (debounce `saveDebounceMs`, дефолт 150 мс) → `saveNow()` → `App.db.saveDocument(doc)`.
- `visibilitychange` / `pagehide` → `flushPending()` + `saveNow()`.
- Индикатор статуса `#status`: dirty (жёлтый) → unsaved (оранжевый) → saved (зелёный) / error (красный).

### Undo/redo

- Перед мутацией — `snapshot()` (JSON текущего документа, картинки зарезаны на `#img-ref:id`).
- После — `commit(before)` или `commitDebounced(before)`.
- `undo()` / `redo()` восстанавливают документ целиком.
- История привязана к документу.

### Backlinks

- `rebuildBacklinks(docId)` — перебирает все wikilinks в документе, находит целевые документы, кладёт в `S.backlinks[targetId]`.
- Панель `App.backlinks.render()` показывает обратные ссылки + mentions.

### Рендер

- `App.render.render()`:
  - title,
  - `editor.replaceChildren(...)` — пересоздаёт все `.block`,
  - вставляет `.block-gap` между блоками,
  - добавляет `.add-block-zone`,
  - идемпотентно привязывает `bindColumnResizer` и `renderColsDrag.bind`,
  - планирует `backlinks.render` через `rAF`.

---

## Хоткеи по умолчанию

| Действие | Сочетание |
|---|---|
| Новый документ | `mod+n` |
| Новый из шаблона | `mod+shift+n` |
| Открыть документ | `mod+o` |
| Сохранить | `mod+s` |
| Дублировать | `mod+shift+s` |
| Закрыть вкладку | `mod+w` |
| Следующая/предыдущая вкладка | `mod+tab` / `mod+shift+tab` |
| Переименовать документ | `F2` |
| В корзину | `Delete` |
| Свернуть сайдбар | `mod+\` |
| Глобальный поиск | `mod+shift+f` |
| Командная палитра | `mod+k` |
| Настройки | `mod+,` |
| Назад/вперёд по истории | `alt+←` / `alt+→` |
| Нумерованный список | `mod+shift+7` |
| Снять список | `mod+shift+8` |
| Undo/Redo | `mod+z` / `mod+y` |
| Панель строк | `mod+shift+l` |
| Удалить блок | `mod+Backspace` |
| Новый блок | `mod+Enter` |
| Новая строка | `mod+shift+Enter` |
| Ctrl/Cmd+Arrow | расширение выделения по словам |

Хоткеи настраиваются в `Настройки → Хоткеи`.

---

## Зависимости между модулями

```text
db.js           → —
utils.js        → —
state.js        → db, utils

render/_shared  → utils, state
render/wikilinks→ render/_shared, utils
render/paste    → render/_shared, utils
render/line     → render/_shared, render/wikilinks, render/paste
render/block    → render/_shared, render/wikilinks, render/paste, render/line, utils
render/cols-drag→ render/_shared, render/block, utils
render/main     → render/_shared, render/block, render/line
render.js       → все render/*

sidebar/_shared → utils, state
sidebar/modals  → sidebar/_shared, utils, db
sidebar/folders → sidebar/_shared, sidebar/modals
sidebar/cards   → sidebar/_shared, sidebar/modals, sidebar/folders, utils
sidebar/list    → sidebar/_shared, sidebar/folders, sidebar/cards
sidebar/main    → sidebar/_shared, sidebar/modals, sidebar/folders, sidebar/cards, sidebar/list
sidebar.js      → все sidebar/*

tabs.js         → utils, state
io.js           → utils, state, db
backlinks.js    → utils, state
wikilink-popover→ utils, state
hotkeys.js      → utils, state, lock
settings.js     → utils, state, hotkeys, lock
lock.js         → utils, state, db

menus/_shared   → utils, state, render
menus/slash     → menus/_shared
menus/palette   → menus/_shared, menus/slash
menus/search    → menus/_shared
menus/floatbar  → menus/_shared
menus/handle-menu → menus/_shared
menus/lines-panel → menus/_shared
menus/bind      → menus/_shared + все menus/*
menus.js        → все menus/*

main.js         → db, state, render, sidebar, tabs, menus, io, hotkeys, lock
```
