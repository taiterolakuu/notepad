/* ============================================================
   sidebar/modals.js — универсальная модалка, свойства документа,
                      шаблоны (CRUD + import/export), папки (CRUD)

   [Пакет 9]  openTemplatePicker / saveCurrentAsTemplate /
              importTemplateDialog / exportAllTemplates.
   [Пакет 11] openProperties сохраняет значения полей при
              перерисовке (иконка/цвет).
   [Пакет 14] Не теряет введённые данные при клике по иконке/цвету.

   Зависит от: sidebar/_shared, utils, state, db
   ============================================================ */

window.App = window.App || {};

window.App.sidebarModals = (() => {
"use strict";

const S = window.App.sidebarShared;
const {
  $, el, escape, uid, now, toast,
  St,
  EMOJI_PRESETS, COLOR_PRESETS
} = S;

const U = window.App.utils;

/* [Пакет 11, 14] Снимок значений полей свойств */
let _propsDraft = null;

function _capturePropsDraft(nameInput, descInput, tagInput){
  if (!nameInput || !descInput || !tagInput) return null;
  return {
    title: nameInput.value,
    description: descInput.value,
    tags: tagInput.value
  };
}

/* ============================================================
   Универсальная модалка с одним input
   ============================================================ */

function openModal({ title, placeholder, value = "", okLabel = "Создать", onOk }){
  closeModal();

  const backdrop = el("div", "modal-backdrop");
  backdrop.id = "paper-modal-backdrop";

  const box = el("div", "modal");
  box.id = "paper-modal";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");

  const h = el("div", "modal-title");
  h.textContent = title;
  box.append(h);

  const input = el("input", "modal-input");
  input.type = "text";
  input.placeholder = placeholder || "";
  input.value = value;
  input.autocomplete = "off";
  input.spellcheck = false;
  box.append(input);

  const actions = el("div", "modal-actions");

  const cancel = el("button", "modal-btn");
  cancel.textContent = "Отмена";
  cancel.onclick = closeModal;
  actions.append(cancel);

  const ok = el("button", "modal-btn primary");
  ok.textContent = okLabel;
  ok.onclick = () => {
    const v = input.value.trim();
    if (!v){
      input.classList.add("shake");
      setTimeout(() => input.classList.remove("shake"), 300);
      input.focus();
      return;
    }
    closeModal();
    onOk(v);
  };
  actions.append(ok);
  box.append(actions);

  backdrop.append(box);
  document.body.append(backdrop);

  backdrop.addEventListener("mousedown", e => {
    if (e.target === backdrop) closeModal();
  });

  input.addEventListener("keydown", e => {
    if (e.key === "Enter"){ e.preventDefault(); ok.click(); }
    if (e.key === "Escape"){ e.preventDefault(); closeModal(); }
  });

  setTimeout(() => { input.focus(); input.select(); }, 0);
}

function closeModal(){
  const m = document.getElementById("paper-modal-backdrop");
  if (m) m.remove();
  _propsDraft = null;
}

/* ============================================================
   Свойства документа
   ============================================================ */

function openProperties(docId, preserveDraft){
  const doc = St().documents[docId];
  if (!doc) return;

  if (!preserveDraft){
    _propsDraft = null;
  }

  closeModal();
  if (!preserveDraft) _propsDraft = null;

  const backdrop = el("div", "modal-backdrop");
  backdrop.id = "paper-modal-backdrop";

  const box = el("div", "modal props-modal");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");

  const h = el("div", "modal-title");
  h.textContent = "Свойства документа";
  box.append(h);

  /* Иконка */
  const iconLabel = el("div", "props-label");
  iconLabel.textContent = "Иконка";
  box.append(iconLabel);

  const iconGrid = el("div", "props-icon-grid");
  EMOJI_PRESETS.forEach(e => {
    const b = el("button", "props-icon-btn" + (doc.icon === e ? " on" : ""));
    b.textContent = e;
    b.onclick = async () => {
      const draft = _capturePropsDraft(
        box.querySelector(".props-modal input.modal-input"),
        box.querySelector(".props-modal textarea"),
        box.querySelectorAll(".props-modal input.modal-input")[1]
      );
      await window.App.state.setDocumentField(docId, "icon", doc.icon === e ? "" : e);
      _propsDraft = draft;
      openProperties(docId, true);
      window.App.sidebarMain.render();
    };
    iconGrid.append(b);
  });
  box.append(iconGrid);

  /* Цвет */
  const colorLabel = el("div", "props-label");
  colorLabel.textContent = "Цвет";
  box.append(colorLabel);

  const colorRow = el("div", "props-color-row");
  COLOR_PRESETS.forEach(c => {
    const b = el("button", "props-color-btn" + (doc.color === c ? " on" : ""));
    b.style.background = c;
    b.onclick = async () => {
      const draft = _capturePropsDraft(
        box.querySelector(".props-modal input.modal-input"),
        box.querySelector(".props-modal textarea"),
        box.querySelectorAll(".props-modal input.modal-input")[1]
      );
      await window.App.state.setDocumentField(docId, "color", doc.color === c ? "" : c);
      _propsDraft = draft;
      openProperties(docId, true);
      window.App.sidebarMain.render();
    };
    colorRow.append(b);
  });
  box.append(colorRow);

  /* Название */
  const nameLabel = el("div", "props-label");
  nameLabel.textContent = "Название";
  box.append(nameLabel);

  const nameInput = el("input", "modal-input");
  nameInput.type = "text";
  nameInput.value = _propsDraft ? _propsDraft.title : (doc.title || "");
  nameInput.placeholder = "Название документа";
  box.append(nameInput);

  /* Описание */
  const descLabel = el("div", "props-label");
  descLabel.textContent = "Описание";
  box.append(descLabel);

  const descInput = el("textarea", "modal-input props-textarea");
  descInput.value = _propsDraft ? _propsDraft.description : (doc.description || "");
  descInput.placeholder = "Короткое описание (для карточки)";
  descInput.rows = 3;
  box.append(descInput);

  /* Теги */
  const tagLabel = el("div", "props-label");
  tagLabel.textContent = "Теги (через запятую)";
  box.append(tagLabel);

  const tagInput = el("input", "modal-input");
  tagInput.type = "text";
  tagInput.value = _propsDraft ? _propsDraft.tags : (doc.tags || []).join(", ");
  tagInput.placeholder = "todo, идеи, важно";
  box.append(tagInput);

  /* Actions */
  const actions = el("div", "modal-actions");
  const cancel = el("button", "modal-btn");
  cancel.textContent = "Отмена";
  cancel.onclick = () => { _propsDraft = null; closeModal(); };
  actions.append(cancel);

  const ok = el("button", "modal-btn primary");
  ok.textContent = "Сохранить";
  ok.onclick = async () => {
    const newTitle = nameInput.value.trim();
    if (newTitle && newTitle !== doc.title){
      await window.App.state.renameDocument(docId, newTitle);
    }
    const description = descInput.value.trim().slice(0, 200);
    const tags = tagInput.value
      .split(",")
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 20);

    doc.description = description;
    doc.tags = tags;
    doc.updatedAt = now();
    await window.App.db.saveDocument(doc);

    _propsDraft = null;
    closeModal();
    window.App.sidebarMain.render();
    window.App.tabs?.render();
    toast("Свойства сохранены");
  };
  actions.append(ok);
  box.append(actions);

  backdrop.append(box);
  document.body.append(backdrop);

  backdrop.addEventListener("mousedown", e => {
    if (e.target === backdrop){ _propsDraft = null; closeModal(); }
  });
}

/* ============================================================
   Папки
   ============================================================ */

function createFolder(parentId){
  const parent = parentId === undefined ? S.currentFolderId : parentId;

  openModal({
    title: parent ? "Новая подпапка" : "Новая папка",
    placeholder: "Название папки",
    value: "",
    okLabel: "Создать",
    onOk: async (name) => {
      const id = uid();
      const folder = {
        id,
        name,
        parentId: parent || null,
        color: "",
        icon: "",
        createdAt: now()
      };
      St().folders[id] = folder;
      try {
        await window.App.db.put("folders", folder);
        toast("Папка создана");
        window.App.sidebarMain.render();
      } catch (e){
        console.error("folder save error:", e);
        toast("Не удалось сохранить папку");
      }
    }
  });
}

async function renameFolder(folderId){
  const f = St().folders[folderId];
  if (!f) return;
  openModal({
    title: "Переименовать папку",
    placeholder: "Название",
    value: f.name,
    okLabel: "Переименовать",
    onOk: async (name) => {
      f.name = name;
      try {
        await window.App.db.put("folders", f);
        window.App.sidebarMain.render();
      } catch(e){ toast("Ошибка сохранения"); }
    }
  });
}

async function deleteFolder(folderId){
  const f = St().folders[folderId];
  if (!f) return;

  const affected = Object.values(St().documents).filter(d => d.folderId === folderId);
  for (const d of affected){
    d.folderId = f.parentId || null;
    try { await window.App.db.saveDocument(d); } catch(e){}
  }

  const subs = Object.values(St().folders).filter(x => x.parentId === folderId);
  for (const s of subs){
    s.parentId = f.parentId || null;
    try { await window.App.db.put("folders", s); } catch(e){}
  }

  delete St().folders[folderId];
  try {
    await window.App.db.del("folders", folderId);
    toast("Папка удалена");
    if (S.currentFolderId === folderId) S.currentFolderId = f.parentId || null;
    window.App.sidebarMain.render();
  } catch(e){ toast("Ошибка удаления"); }
}

/* ============================================================
   [Пакет 9] Шаблоны — picker, save, import, export
   ============================================================ */

/* Хелпер: создать документ из шаблона */
async function _createDocFromTemplate(t){
  const blocks = (t.blocks || []).map(b => {
    const nb = U.block(b.type, b.content || "");
    if (b.type === "ul" || b.type === "ol"){
      nb.content = b.content || "<li><br></li>";
      if (b.type === "ul") nb.marker = "disc";
    }
    return nb;
  });
  const doc = await window.App.state.createDocument({
    title: t.name || "Без названия",
    blocks,
    folderId: S.currentFolderId
  });
  await window.App.state.setActiveDoc(doc.id);
  window.App.tabs?.render();
  window.App.sidebarMain.render();
}

/* Полуноценный picker: список + превью */
function openTemplatePicker(){
  closeModal();

  const backdrop = el("div", "modal-backdrop");
  backdrop.id = "paper-modal-backdrop";

  const box = el("div", "modal template-picker");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");

  /* Head */
  const head = el("div", "template-picker-head");
  const h = el("div", "modal-title");
  h.textContent = "Новый из шаблона";
  head.append(h);

  const search = el("input", "modal-input tpl-search");
  search.type = "search";
  search.placeholder = "Поиск шаблона…";
  head.append(search);

  const importBtn = el("button", "modal-btn");
  importBtn.textContent = "Импорт…";
  importBtn.onclick = () => importTemplateDialog();
  head.append(importBtn);

  const exportBtn = el("button", "modal-btn");
  exportBtn.textContent = "Экспорт всех";
  exportBtn.onclick = () => exportAllTemplates();
  head.append(exportBtn);

  box.append(head);

  /* Body: list + preview */
  const body = el("div", "template-picker-body");
  const listWrap = el("div", "tpl-list");
  const previewWrap = el("div", "tpl-preview");
  body.append(listWrap, previewWrap);
  box.append(body);

  /* Actions */
  const actions = el("div", "modal-actions");
  const cancel = el("button", "modal-btn");
  cancel.textContent = "Отмена";
  cancel.onclick = closeModal;
  actions.append(cancel);
  box.append(actions);

  /* Список шаблонов */
  const templates = (S.TEMPLATES || []).slice();

  let selectedIdx = 0;

  function renderPreview(t){
    previewWrap.innerHTML = "";

    if (!t){
      const empty = el("div", "sb-empty");
      empty.textContent = "Выберите шаблон";
      previewWrap.append(empty);
      return;
    }

    const headPrev = el("div", "tpl-prev-head");
    const iconEl = el("span", "tpl-prev-icon");
    iconEl.textContent = t.icon || "📄";
    headPrev.append(iconEl);

    const meta = el("div", "tpl-prev-meta");
    const nameEl = el("div", "tpl-prev-name");
    nameEl.textContent = t.name || "Шаблон";
    meta.append(nameEl);
    if (t.description){
      const descEl = el("div", "tpl-prev-desc");
      descEl.textContent = t.description;
      meta.append(descEl);
    }
    headPrev.append(meta);
    previewWrap.append(headPrev);

    const prevBody = el("div", "tpl-prev-body");
    (t.blocks || []).forEach(b => {
      const blockEl = el("div", "tpl-prev-block");
      const type = b.type;
      if (type === "h1") blockEl.innerHTML = `<h1>${escape(U.htmlToText(b.content || ""))}</h1>`;
      else if (type === "h2") blockEl.innerHTML = `<h2>${escape(U.htmlToText(b.content || ""))}</h2>`;
      else if (type === "h3") blockEl.innerHTML = `<h3>${escape(U.htmlToText(b.content || ""))}</h3>`;
      else if (type === "quote") blockEl.innerHTML = `<blockquote>${escape(U.htmlToText(b.content || ""))}</blockquote>`;
      else if (type === "code") blockEl.innerHTML = `<pre>${escape(U.htmlToText(b.content || ""))}</pre>`;
      else if (type === "divider") blockEl.innerHTML = `<hr>`;
      else if (type === "ul" || type === "ol"){
        const inner = b.content || "";
        blockEl.innerHTML = `<${type}>${inner}</${type}>`;
      }
      else if (type === "todo"){
        blockEl.textContent = "☐ " + U.htmlToText(b.content || "");
      }
      else {
        blockEl.textContent = U.htmlToText(b.content || "");
      }
      prevBody.append(blockEl);
    });
    previewWrap.append(prevBody);
  }

  function renderList(q){
    listWrap.innerHTML = "";
    const lower = String(q || "").toLowerCase().trim();
    const arr = templates.filter(t =>
      !lower || (t.name || "").toLowerCase().includes(lower)
    );

    if (!arr.length){
      const empty = el("div", "sb-empty");
      empty.textContent = "Ничего не найдено";
      listWrap.append(empty);
      renderPreview(null);
      return;
    }

    if (selectedIdx >= arr.length) selectedIdx = 0;

    arr.forEach((t, i) => {
      const item = el("button", "tpl-item" + (i === selectedIdx ? " on" : ""));
      const icon = el("span", "tpl-item-icon");
      icon.textContent = t.icon || "📄";
      item.append(icon);

      const bodyEl = el("div", "tpl-item-body");
      const name = el("div", "tpl-item-name");
      name.textContent = t.name || "Шаблон";
      bodyEl.append(name);
      if (t.description){
        const d = el("div", "tpl-item-desc");
        d.textContent = t.description;
        bodyEl.append(d);
      }
      item.append(bodyEl);

      item.onmousedown = e => e.preventDefault();
      item.onclick = () => {
        selectedIdx = i;
        renderList(search.value);
        renderPreview(arr[i]);
      };
      item.ondblclick = async () => {
        closeModal();
        await _createDocFromTemplate(t);
      };
      listWrap.append(item);
    });

    renderPreview(arr[selectedIdx] || null);
  }

  search.oninput = () => { selectedIdx = 0; renderList(search.value); };
  search.onkeydown = (e) => {
    if (e.key === "Enter"){
      e.preventDefault();
      const lower = search.value.toLowerCase().trim();
      const arr = templates.filter(t => !lower || (t.name || "").toLowerCase().includes(lower));
      if (arr[selectedIdx]) {
        closeModal();
        _createDocFromTemplate(arr[selectedIdx]);
      }
    }
  };

  renderList("");

  backdrop.append(box);
  document.body.append(backdrop);
  backdrop.addEventListener("mousedown", e => {
    if (e.target === backdrop) closeModal();
  });

  /* F2-подобное создание: двойной клик по элементу */
  box.addEventListener("keydown", e => {
    if (e.key === "Escape") closeModal();
  });

  setTimeout(() => search.focus(), 0);
}

/* Алиас для совместимости со старым API */
function createFromTemplate(){
  openTemplatePicker();
}

/* Сохранить текущий документ как шаблон */
async function saveCurrentAsTemplate(docId){
  const doc = St().documents[docId];
  if (!doc) return;

  openModal({
    title: "Сохранить как шаблон",
    placeholder: "Название шаблона",
    value: doc.title || "",
    okLabel: "Сохранить",
    onOk: async (name) => {
      const tpl = {
        id: uid(),
        name: name.slice(0, 100),
        icon: doc.icon || "📄",
        description: doc.description || "",
        builtin: false,
        hidden: false,
        blocks: JSON.parse(JSON.stringify(doc.blocks || [])),
        createdAt: now()
      };

      /* Регенерируем id-блоков и строк, чтобы шаблон не делился с документом */
      for (const b of tpl.blocks){
        b.id = U.shortId();
        b.customId = "";
        if (Array.isArray(b.lines)){
          for (const ln of b.lines){
            ln.id = U.shortId();
            ln.customId = "";
          }
        }
      }

      St().templates[tpl.id] = tpl;
      try {
        await window.App.db.saveTemplate(tpl);
        toast("Шаблон сохранён");
      } catch(e){
        console.error("template save error:", e);
        toast("Не удалось сохранить шаблон");
      }
    }
  });
}

/* Импорт шаблона (JSON) */
function importTemplateDialog(){
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async e => {
    const f = e.target.files?.[0];
    if (!f) return;

    let raw;
    try {
      raw = JSON.parse(await f.text());
    } catch(err){
      toast("Не удалось прочитать файл");
      return;
    }

    const arr = Array.isArray(raw) ? raw : [raw];
    let imported = 0;

    for (const item of arr){
      const t = U.normalizeTemplate(item);
      if (!t) continue;
      /* Новый id, чтобы не перезаписать существующий */
      t.id = uid();
      t.builtin = false;
      St().templates[t.id] = t;
      try {
        await window.App.db.saveTemplate(t);
        imported++;
      } catch(e){}
    }

    if (!imported){
      toast("Не удалось импортировать");
      return;
    }
    toast(`Импортировано шаблонов: ${imported}`);
    closeModal();
  };
  input.click();
}

/* Экспорт всех шаблонов в .zip (метод store, UTF-8) */
function exportAllTemplates(){
  const templates = Object.values(St().templates || {}).filter(t => t && t.blocks);

  const list = templates.length
    ? templates
    : (S.TEMPLATES || []);

  if (!list.length){
    toast("Нет шаблонов");
    return;
  }

  const files = list.map(t => ({
    name: (String(t.name || "template")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "template") + ".json",
    data: JSON.stringify(t, null, 2)
  }));

  /* CRC32 + ZIP store с UTF-8 bit */
  const crc32 = (() => {
    const table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++){
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[i] = c;
      }
      return t;
    })();
    return (bytes) => {
      let crc = 0xFFFFFFFF;
      for (let i = 0; i < bytes.length; i++){
        crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
      }
      return (crc ^ 0xFFFFFFFF) >>> 0;
    };
  })();

  const strBytes = s => new TextEncoder().encode(s);

  const chunks = [];
  const central = [];
  let offset = 0;
  const FLAG_UTF8 = 0x0800;

  for (const f of files){
    const nameBytes = strBytes(f.name);
    const dataBytes = strBytes(f.data);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, FLAG_UTF8, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    chunks.push(local, dataBytes);

    const cdir = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdir.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, FLAG_UTF8, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    cdir.set(nameBytes, 46);
    central.push(cdir);

    offset += local.length + dataBytes.length;
  }

  const centralBytes = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralBytes, true);
  ev.setUint32(16, offset, true);

  const blob = new Blob([...chunks, ...central, end], { type: "application/zip" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "paper-templates.zip";
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  toast("Экспортировано");
}

return {
  openModal, closeModal,
  openProperties,
  createFolder, renameFolder, deleteFolder,
  /* [Пакет 9] */
  openTemplatePicker,
  createFromTemplate,
  saveCurrentAsTemplate,
  importTemplateDialog,
  exportAllTemplates
};
})();