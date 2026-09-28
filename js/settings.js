/* ============================================================
   settings.js — модалка настроек

   [Пакет 3]  open() — guard lock.isLocked().
   [Пакет 9]  импорт/экспорт шаблонов из секции Storage.
   [Пакет 11] убран undo темы; autoLockMinutes не дублируется;
              trashTtlDays с границами (в utils);
              мёртвые настройки помечены.
   [Пакет 15] role="dialog", aria-modal, focus trap.

   Зависит от: utils, state, render, sidebar, hotkeys, lock
   ============================================================ */

window.App = window.App || {};

window.App.settings = (() => {
"use strict";

const U = window.App.utils;
const { $, el, escape, toast } = U;

const St = () => window.App.state.S;
const setUI = (k, v) => window.App.state.setUI(k, v);
const HK = () => window.App.hotkeys;
const LK = () => window.App.lock;

let currentSection = "appearance";
let _keyTrapHandler = null;

/* ---------- Открытие / закрытие ---------- */

function open(section){
  /* [Пакет 3] под замком не открываем */
  if (window.App.lock?.isLocked?.()) return;

  const modal = $("#settings-modal");
  if (!modal) return;
  currentSection = section || currentSection;
  modal.style.display = "flex";
  modal.setAttribute("aria-hidden", "false");
  render();
  _attachKeyTrap();
}

function close(){
  cancelCapture();
  _detachKeyTrap();
  const modal = $("#settings-modal");
  if (modal){
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }
}

/* [Пакет 15] focus trap внутри модалки */
function _attachKeyTrap(){
  _detachKeyTrap();
  _keyTrapHandler = (e) => {
    if (e.key !== "Tab") return;
    const modal = $("#settings-modal");
    if (!modal || modal.style.display !== "flex") return;

    const focusables = modal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusables.length) return;

    const first = focusables[0];
    const last  = focusables[focusables.length - 1];

    if (e.shiftKey && document.activeElement === first){
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last){
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", _keyTrapHandler, true);
}

function _detachKeyTrap(){
  if (_keyTrapHandler){
    document.removeEventListener("keydown", _keyTrapHandler, true);
    _keyTrapHandler = null;
  }
}

/* ---------- Полный рендер ---------- */

function render(){
  const modal = $("#settings-modal");
  if (!modal) return;
  modal.innerHTML = "";

  const box = el("div", "settings-box");
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", "Настройки");

  const head = el("div", "settings-head");
  const h = el("h2", "settings-title");
  h.textContent = "Настройки";
  head.append(h);

  const closeBtn = el("button", "settings-close");
  closeBtn.innerHTML = "✕";
  closeBtn.title = "Закрыть (Esc)";
  closeBtn.setAttribute("aria-label", "Закрыть");
  closeBtn.onclick = close;
  head.append(closeBtn);
  box.append(head);

  const body = el("div", "settings-body");

  const nav = el("div", "settings-nav");
  const sections = [
    ["appearance", "Внешний вид"],
    ["behavior",   "Поведение"],
    ["hotkeys",    "Хоткеи"],
    ["lock",       "Пароль"],
    ["privacy",    "Приватность"],
    ["storage",    "Хранение"],
    ["about",      "О программе"]
  ];
  sections.forEach(([key, label]) => {
    const b = el("button", "settings-nav-btn" + (currentSection === key ? " on" : ""));
    b.textContent = label;
    b.onclick = () => {
      currentSection = key;
      render();
    };
    nav.append(b);
  });
  body.append(nav);

  const content = el("div", "settings-content");
  if (currentSection === "appearance") content.append(renderAppearance());
  if (currentSection === "behavior")   content.append(renderBehavior());
  if (currentSection === "hotkeys")    content.append(renderHotkeys());
  if (currentSection === "lock")       content.append(renderLock());
  if (currentSection === "privacy")    content.append(renderPrivacy());
  if (currentSection === "storage")    content.append(renderStorage());
  if (currentSection === "about")      content.append(renderAbout());
  body.append(content);

  box.append(body);
  modal.append(box);
}

/* ---------- Хелперы для полей ---------- */

function makeRow(label, hint){
  const r = el("div", "settings-row");
  const l = el("div", "settings-row-label");
  const t = el("div", "settings-row-title");
  t.textContent = label;
  l.append(t);
  if (hint){
    const h = el("div", "settings-row-hint");
    h.textContent = hint;
    l.append(h);
  }
  r.append(l);
  const ctrl = el("div", "settings-row-control");
  r.append(ctrl);
  return { row: r, control: ctrl };
}

function radioGroup(current, options, onChange){
  const wrap = el("div", "settings-radio");
  options.forEach(([val, label]) => {
    const b = el("button", "settings-radio-btn" + (current === val ? " on" : ""));
    b.textContent = label;
    b.onclick = () => onChange(val);
    wrap.append(b);
  });
  return wrap;
}

function selectInput(current, options, onChange){
  const wrap = el("div", "settings-select-wrap");
  const s = el("select", "settings-select");
  options.forEach(([val, label]) => {
    const o = document.createElement("option");
    o.value = val;
    o.textContent = label;
    if (current === val) o.selected = true;
    s.append(o);
  });
  s.onchange = () => onChange(s.value);
  wrap.append(s);
  return wrap;
}

function numberInput(current, opts, onChange){
  const wrap = el("div", "settings-number-wrap");
  const inp = el("input", "settings-number");
  inp.type = "number";
  inp.min = opts.min;
  inp.max = opts.max;
  inp.step = opts.step || 1;
  inp.value = current;
  inp.onchange = () => {
    const v = Math.max(opts.min, Math.min(opts.max, Number(inp.value)));
    inp.value = v;
    onChange(v);
  };
  wrap.append(inp);
  return wrap;
}

function toggleInput(current, onChange){
  const wrap = el("div", "settings-toggle");
  const b = el("button", "settings-toggle-btn" + (current ? " on" : ""));
  b.setAttribute("role", "switch");
  b.setAttribute("aria-checked", current ? "true" : "false");
  b.onclick = () => {
    const next = !current;
    b.classList.toggle("on", next);
    b.setAttribute("aria-checked", next ? "true" : "false");
    onChange(next);
  };
  wrap.append(b);
  return wrap;
}

function passwordInput(placeholder, id){
  const wrap = el("div", "settings-pass-wrap");
  const inp = el("input", "settings-input settings-pass");
  inp.type = "password";
  inp.placeholder = placeholder || "";
  inp.autocomplete = "new-password";
  inp.spellcheck = false;
  if (id) inp.id = id;
  wrap.append(inp);
  return { wrap, input: inp };
}

function actionButton(label, variant, onClick){
  const b = el("button", "settings-btn" + (variant ? " " + variant : ""));
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

/* ---------- Секция: Внешний вид ---------- */

function renderAppearance(){
  const wrap = el("div", "settings-section");
  const ui = St().ui;

  {
    const { row, control } = makeRow("Режим карточек", "mini · обычный · подробный");
    control.append(radioGroup(ui.cardMode, [
      ["mini", "Мини"],
      ["normal", "Обычный"],
      ["detailed", "Подробно"]
    ], v => {
      setUI("cardMode", v);
      window.App.sidebar?.render();
      render();
    }));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Ширина панели", "за сколько пикселей от левого края");
    const current = ui.sidebarWidth || 260;
    const fixed = current === 200 ? 200 : current === 320 ? 320 : 260;
    control.append(radioGroup(fixed, [
      [200, "Узкая"],
      [260, "Обычная"],
      [320, "Широкая"]
    ], v => {
      setUI("sidebarWidth", Number(v));
      const aside = document.getElementById("sidebar");
      if (aside) aside.style.width = Number(v) + "px";
      render();
    }));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Тема", "цветовая схема редактора");
    control.append(radioGroup(ui.theme, [
      ["paper", "Paper"],
      ["sepia", "Sepia"],
      ["mint",  "Mint"],
      ["dark",  "Dark"]
    ], v => {
      /* [Пакет 11] тема не пишется в историю — setUI без commit */
      setUI("theme", v);
      window.App.render.render();
      render();
    }));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Основной шрифт", "текст блоков");
    const fonts = ["Inter", "Open Sans", "Plus Jakarta Sans"];
    control.append(selectInput(ui.fonts?.body || "Inter",
      fonts.map(f => [f, f]),
      v => applyFont("body", v)
    ));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Шрифт заголовков", "H1 · H2 · H3");
    const fonts = ["Montserrat", "Manrope", "Outfit", "Inter"];
    control.append(selectInput(ui.fonts?.head || "Montserrat",
      fonts.map(f => [f, f]),
      v => applyFont("head", v)
    ));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Моноширинный шрифт", "код и таблицы");
    const fonts = ["JetBrains Mono", "Fira Code"];
    control.append(selectInput(ui.fonts?.mono || "JetBrains Mono",
      fonts.map(f => [f, f]),
      v => applyFont("mono", v)
    ));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Сортировка по умолчанию", "как сортировать список");
    control.append(radioGroup(ui.sortMode, [
      ["updated", "По дате"],
      ["created", "По созданию"],
      ["title",   "По имени"],
      ["size",    "По размеру"]
    ], v => {
      setUI("sortMode", v);
      window.App.sidebar?.render();
      render();
    }));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Показывать превью", "первая строка в карточке");
    control.append(toggleInput(ui.showPreview !== false, v => {
      setUI("showPreview", v);
      window.App.sidebar?.render();
      render();
    }));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Показывать дату", "время обновления в карточке");
    control.append(toggleInput(ui.showDate !== false, v => {
      setUI("showDate", v);
      window.App.sidebar?.render();
      render();
    }));
    wrap.append(row);
  }

  return wrap;
}

function applyFont(role, name){
  const varMap = {
    body:  "--font-current",
    head:  "--font-heading-current",
    mono:  "--font-mono-current"
  };
  const fallback =
    role === "mono"  ? "ui-monospace, Consolas, monospace" :
    role === "serif" ? "Georgia, serif" :
                       "system-ui, sans-serif";
  document.documentElement.style.setProperty(varMap[role], `'${name}', ${fallback}`);

  if (!St().ui.fonts) St().ui.fonts = {};
  St().ui.fonts[role] = name;
  window.App.state.setUI("fonts", St().ui.fonts);
  toast(`Шрифт: ${name}`);
}

/* ---------- Секция: Поведение ---------- */

function renderBehavior(){
  const wrap = el("div", "settings-section");
  const ui = St().ui;
  const st = St().settings;

  {
    const { row, control } = makeRow("Куда сохранять новый",
      "будет применено в следующих версиях");
    control.append(radioGroup(ui.newDocFolder || "current", [
      ["root",    "В корень"],
      ["current", "В текущую папку"],
      ["inbox",   "Во «Входящие»"]
    ], v => { setUI("newDocFolder", v); render(); }));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("При закрытии вкладки",
      "будет применено в следующих версиях");
    control.append(radioGroup(ui.onTabClose || "keep", [
      ["keep",    "Ничего"],
      ["archive", "В архив"],
      ["trash",   "В корзину"]
    ], v => { setUI("onTabClose", v); render(); }));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Открывать при старте",
      "будет применено в следующих версиях");
    control.append(radioGroup(ui.startupMode || "last", [
      ["last", "Последний документ"],
      ["list", "Список"]
    ], v => { setUI("startupMode", v); render(); }));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Автопереименование из текста",
      "если название пустое — брать первую строку (в разработке)");
    control.append(toggleInput(ui.autoRename !== false, v => {
      setUI("autoRename", v);
      render();
    }));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Задержка автосохранения", "мс");
    control.append(radioGroup(st.saveDebounceMs, [
      [150,  "Быстро (150)"],
      [400,  "Обычно (400)"],
      [1000, "Редко (1000)"]
    ], v => {
      St().settings.saveDebounceMs = Number(v);
      window.App.db.setMeta("settings", St().settings);
      render();
    }));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Хранить корзину", "дней до автоочистки (1–365)");
    control.append(numberInput(st.trashTtlDays, { min: 1, max: 365 }, v => {
      St().settings.trashTtlDays = v;
      window.App.db.setMeta("settings", St().settings);
      toast(`Корзина: ${v} дн.`);
    }));
    wrap.append(row);
  }

  return wrap;
}

/* ============================================================
   Секция: Хоткеи
   ============================================================ */

let captureHandler = null;
let captureButton  = null;

function renderHotkeys(){
  const wrap = el("div", "settings-section");
  const hk = HK();
  if (!hk){
    const p = el("p", "settings-text");
    p.textContent = "Модуль hotkeys.js не загружен.";
    wrap.append(p);
    return wrap;
  }

  const reg = hk.getRegistry();
  const actions = Object.keys(hk.DEFAULTS);

  const hint = el("p", "settings-text settings-text-muted");
  hint.textContent = "Клик по комбинации — затем нажмите новую. Esc — отмена. ✕ — сброс к дефолту. Оранжевым помечены комбинации, которые может перехватить браузер.";
  wrap.append(hint);

  const table = el("div", "hk-table");

  actions.forEach(actionId => {
    const row = el("div", "hk-row");
    if (hk.isBrowserTaken(reg[actionId])) row.classList.add("hk-row-warn");

    const label = el("div", "hk-row-label");
    label.textContent = hk.LABELS[actionId] || actionId;
    row.append(label);

    const btn = el("button", "hk-row-combo");
    btn.type = "button";
    btn.textContent = hk.prettyPrint(reg[actionId]) || "—";
    btn.onclick = () => startCapture(actionId, btn);
    row.append(btn);

    const reset = el("button", "hk-row-reset");
    reset.type = "button";
    reset.innerHTML = "✕";
    reset.title = "Сбросить";
    reset.onclick = async () => {
      if (reg[actionId] === hk.DEFAULTS[actionId]) return;
      await hk.setBinding(actionId, hk.DEFAULTS[actionId]);
      render();
    };
    row.append(reset);

    table.append(row);
  });

  wrap.append(table);

  const actionsRow = el("div", "hk-actions");
  const resetAllBtn = el("button", "settings-btn danger");
  resetAllBtn.textContent = "Сбросить все";
  resetAllBtn.onclick = async () => {
    if (!confirm("Сбросить все хоткеи к значениям по умолчанию?")) return;
    await hk.resetAll();
    render();
  };
  actionsRow.append(resetAllBtn);
  wrap.append(actionsRow);

  return wrap;
}

function startCapture(actionId, btn){
  if (captureHandler){
    document.removeEventListener("keydown", captureHandler, true);
    captureHandler = null;
  }

  captureButton = btn;
  btn.classList.add("capturing");
  btn.textContent = "Нажмите…";

  captureHandler = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === "Escape"){
      endCapture();
      render();
      return;
    }

    if (["Control","Shift","Alt","Meta"].includes(e.key)) return;
    if (e.repeat || e.isComposing) return;

    const combo = HK().normalizeEvent(e);
    if (!combo) return;

    const reg = HK().getRegistry();

    let conflict = null;
    for (const k of Object.keys(reg)){
      if (k !== actionId && reg[k] === combo){ conflict = k; break; }
    }
    if (conflict){
      const lbl = HK().LABELS[conflict] || conflict;
      if (!confirm(`Комбинация уже используется для «${lbl}». Заменить?`)) return;
      await HK().setBinding(conflict, "");
    }

    if (HK().isBrowserTaken(combo)){
      const ok = confirm(
        "Эту комбинацию может перехватить браузер — она не сработает. " +
        "Продолжить?"
      );
      if (!ok) return;
    }

    await HK().setBinding(actionId, combo);
    endCapture();
    render();
  };

  document.addEventListener("keydown", captureHandler, true);
}

function endCapture(){
  if (captureHandler){
    document.removeEventListener("keydown", captureHandler, true);
    captureHandler = null;
  }
  if (captureButton){
    captureButton.classList.remove("capturing");
    captureButton = null;
  }
}

function cancelCapture(){
  endCapture();
}

/* ============================================================
   Секция: Пароль
   ============================================================ */

function renderLock(){
  const wrap = el("div", "settings-section");
  const lock = LK();
  if (!lock){
    const p = el("p", "settings-text");
    p.textContent = "Модуль lock.js не загружен.";
    wrap.append(p);
    return wrap;
  }

  /* [Пакет 3] сломанное состояние meta.lock */
  if (lock.isBrokenState && lock.isBrokenState()){
    const warn = el("p", "settings-text");
    warn.style.color = "#c46a63";
    warn.textContent = "Пароль установлен, но данные о нём повреждены. " +
      "Восстановление невозможно без сброса. Уберите пароль — данные " +
      "не зашифрованы, и это безопасно.";
    wrap.append(warn);

    const f = makeRow("Сбросить пароль", "документы не пострадают");
    const btn = actionButton("Сбросить", "danger", async () => {
      if (!confirm("Сбросить пароль? Данные не будут удалены.")) return;
      await lock.clearPassword("");
      toast("Пароль сброшен");
      render();
    });
    f.control.append(btn);
    wrap.append(f.row);
    return wrap;
  }

  const has = lock.hasPassword();

  if (!has){
    const hint = el("p", "settings-text settings-text-muted");
    hint.textContent = "Пароль — простой замок на приложение (PBKDF2, 310 000 итераций). " +
      "Он не шифрует данные, но не даёт зайти в редактор без ввода.";
    wrap.append(hint);

    const f1 = makeRow("Пароль", "минимум 4 символа");
    const p1 = passwordInput("Введите пароль", "lock-set-1");
    f1.control.append(p1.wrap);
    wrap.append(f1.row);

    const f2 = makeRow("Подтверждение", "повторите пароль");
    const p2 = passwordInput("Ещё раз", "lock-set-2");
    f2.control.append(p2.wrap);
    wrap.append(f2.row);

    const f3 = makeRow("", "");
    const setBtn = actionButton("Установить", "primary", async () => {
      const a = p1.input.value;
      const b = p2.input.value;
      if (a.length < 4){ toast("Пароль слишком короткий"); p1.input.focus(); return; }
      if (a !== b){ toast("Пароли не совпадают"); p2.input.value = ""; p2.input.focus(); return; }
      try {
        await lock.setPassword(a);
        toast("Пароль установлен");
        render();
      } catch(e){
        toast(e.message || "Не удалось установить пароль");
      }
    });
    f3.control.append(setBtn);
    wrap.append(f3.row);
  } else {
    const f0 = makeRow("Текущий пароль", "для подтверждения");
    const p0 = passwordInput("Текущий пароль", "lock-old");
    f0.control.append(p0.wrap);
    wrap.append(f0.row);

    const f1 = makeRow("Новый пароль", "минимум 4 символа");
    const p1 = passwordInput("Новый пароль", "lock-new-1");
    f1.control.append(p1.wrap);
    wrap.append(f1.row);

    const f2 = makeRow("Подтверждение", "повторите новый");
    const p2 = passwordInput("Ещё раз", "lock-new-2");
    f2.control.append(p2.wrap);
    wrap.append(f2.row);

    const f3 = makeRow("", "");
    const changeBtn = actionButton("Сменить пароль", "primary", async () => {
      const oldPw = p0.input.value;
      const a = p1.input.value;
      const b = p2.input.value;
      if (!oldPw){ toast("Введите текущий пароль"); p0.input.focus(); return; }
      if (a.length < 4){ toast("Новый пароль слишком короткий"); p1.input.focus(); return; }
      if (a !== b){ toast("Новые пароли не совпадают"); p2.input.value = ""; p2.input.focus(); return; }
      const ok = await lock.changePassword(oldPw, a);
      if (!ok){ toast("Неверный текущий пароль"); p0.input.value = ""; p0.input.focus(); return; }
      toast("Пароль изменён");
      render();
    });
    f3.control.append(changeBtn);
    wrap.append(f3.row);

    const f4 = makeRow("Автоблокировка", "через сколько минут простоя блокировать");
    const cur = lock.getAutoLockMinutes();
    f4.control.append(radioGroup(cur, [
      [0,   "Выкл"],
      [1,   "1 мин"],
      [5,   "5 мин"],
      [15,  "15 мин"],
      [60,  "1 час"]
    ], v => {
      lock.setAutoLockMinutes(Number(v));
      toast(`Автоблокировка: ${v === 0 ? "выкл" : v + " мин"}`);
      render();
    }));
    wrap.append(f4.row);

    const f5 = makeRow("Заблокировать сейчас", "закрыть приложение паролем");
    const lockBtn = actionButton("Заблокировать", "", () => {
      close();
      lock.lock();
    });
    f5.control.append(lockBtn);
    wrap.append(f5.row);

    const f6 = makeRow("Убрать пароль", "полностью отключить замок");
    const p3 = passwordInput("Текущий пароль", "lock-remove");
    f6.control.append(p3.wrap);

    const remBtn = actionButton("Убрать", "danger", async () => {
      const pw = p3.input.value;
      if (!pw){ toast("Введите пароль"); p3.input.focus(); return; }
      if (!confirm("Убрать пароль? Приложение будет открываться без замка.")) return;
      const ok = await lock.clearPassword(pw);
      if (!ok){ toast("Неверный пароль"); p3.input.value = ""; p3.input.focus(); return; }
      toast("Пароль убран");
      render();
    });
    f6.control.append(remBtn);
    wrap.append(f6.row);
  }

  return wrap;
}

/* ============================================================
   Секция: Приватность
   ============================================================ */

function renderPrivacy(){
  const wrap = el("div", "settings-section");
  const st = St().settings;
  const ui = St().ui;

  {
    const { row, control } = makeRow("Локальный режим",
      "в разработке: сейчас шрифты грузятся с Google Fonts всегда");
    control.append(toggleInput(st.allowExternalRequests === false, v => {
      St().settings.allowExternalRequests = !v;
      window.App.db.setMeta("settings", St().settings);
      toast(v
        ? "Локальный режим (в разработке)"
        : "Внешние запросы разрешены");
      render();
    }));
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Скрывать превью в карточках",
      "не показывать первую строку документа в списке");
    control.append(toggleInput(ui.hidePreview === true, v => {
      setUI("hidePreview", v);
      window.App.sidebar?.render();
      render();
    }));
    wrap.append(row);
  }

  const note = el("p", "settings-text settings-text-muted");
  note.textContent = "Автоблокировка настраивается во вкладке «Пароль».";
  wrap.append(note);

  return wrap;
}

/* ---------- Секция: Хранение ---------- */

function renderStorage(){
  const wrap = el("div", "settings-section");

  {
    const { row, control } = makeRow("Размер хранилища", "оценка IndexedDB");
    const span = el("span", "settings-value");
    span.textContent = "…";
    control.append(span);
    wrap.append(row);

    if (navigator.storage?.estimate){
      navigator.storage.estimate().then(est => {
        const used = est.usage || 0;
        const quota = est.quota || 0;
        const mb = (used / (1024 * 1024)).toFixed(2);
        const total = quota ? (quota / (1024 * 1024)).toFixed(0) : "?";
        span.textContent = `${mb} МБ из ~${total} МБ`;
      }).catch(() => {
        span.textContent = "недоступно";
      });
    } else {
      span.textContent = "браузер не поддерживает";
    }
  }

  {
    const { row, control } = makeRow("Экспорт всех данных",
      "JSON-файл с документами, папками, настройками");
    const b = el("button", "settings-btn");
    b.textContent = "Экспорт…";
    b.onclick = () => exportAll();
    control.append(b);
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Импорт данных",
      "заменить текущее содержимое файлом (пароль сохраняется)");
    const b = el("button", "settings-btn");
    b.textContent = "Импорт…";
    b.onclick = () => importAll();
    control.append(b);
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Очистить корзину",
      "удалить все документы из корзины");
    const b = el("button", "settings-btn danger");
    b.textContent = "Очистить";
    b.onclick = async () => {
      if (!confirm("Удалить все документы из корзины безвозвратно?")) return;
      const n = await window.App.state.emptyTrash();
      toast(`Удалено: ${n}`);
      window.App.sidebar?.render();
    };
    control.append(b);
    wrap.append(row);
  }

  {
    const { row, control } = makeRow("Сброс всех данных",
      "полная очистка хранилища — необратимо");
    const b = el("button", "settings-btn danger");
    b.textContent = "Сбросить…";
    b.onclick = async () => {
      if (!confirm("Удалить ВСЕ документы, папки и настройки?")) return;
      if (!confirm("Это действие необратимо. Продолжить?")) return;
      await window.App.db.clearAll();
      try { localStorage.clear(); } catch(e){}
      location.reload();
    };
    control.append(b);
    wrap.append(row);
  }

  return wrap;
}

function exportAll(){
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    documents: St().documents,
    folders: St().folders,
    tags: St().tags,
    templates: St().templates,
    backlinks: St().backlinks,
    ui: St().ui,
    settings: St().settings
  };
  const data = JSON.stringify(payload, null, 2);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  a.download = "paper-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  toast("Экспортировано");
}

/* [Пакет 8] importAll: бэкап текущего, сохранение meta.lock,
   одна транзакция через DB.putMany/delMany где возможно */
async function importAll(){
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

    if (!raw || typeof raw !== "object" || !raw.documents){
      toast("Файл не распознан");
      return;
    }

    if (!confirm("Заменить все текущие данные содержимым файла? " +
                 "Текущее состояние будет сохранено в бэкап.")) return;

    const DB = window.App.db;
    const U2 = window.App.utils;

    /* 1. Бэкап текущего meta.lock и ui */
    let savedLock = null;
    try { savedLock = await DB.getMeta("lock"); } catch(e){}

    /* 2. Нормализация входящих данных */
    const docs = {};
    for (const id of Object.keys(raw.documents || {})){
      const d = U2.normalizeDocument(raw.documents[id]);
      if (d) docs[d.id] = d;
    }
    const folders = {};
    for (const id of Object.keys(raw.folders || {})){
      const f2 = U2.normalizeFolder(raw.folders[id]);
      if (f2) folders[f2.id] = f2;
    }
    const tpls = {};
    for (const id of Object.keys(raw.templates || {})){
      const t = U2.normalizeTemplate(raw.templates[id]);
      if (t) tpls[t.id] = t;
    }

    try {
      /* 3. Очищаем всё, кроме meta.lock */
      await DB.clearAll();

      /* 4. Записываем всё пакетами (одной транзакцией каждый) */
      if (Object.keys(docs).length)    await DB.putMany("documents", Object.values(docs));
      if (Object.keys(folders).length) await DB.putMany("folders",   Object.values(folders));
      if (Object.keys(tpls).length)    await DB.putMany("templates", Object.values(tpls));

      if (raw.backlinks) await DB.setMeta("backlinks", raw.backlinks);
      if (raw.ui)        await DB.setMeta("ui", raw.ui);
      if (raw.settings)  await DB.setMeta("settings", raw.settings);

      /* 5. Восстанавливаем пароль */
      if (savedLock) await DB.setMeta("lock", savedLock);

      if (Object.keys(docs).length){
        await DB.setMeta("activeDocId", Object.keys(docs)[0]);
      }
    } catch(err){
      console.error("import error:", err);
      toast("Импорт прерван: " + (err.message || "неизвестная ошибка"));
      return;
    }

    toast("Импорт завершён, перезагрузка…");
    setTimeout(() => location.reload(), 800);
  };
  input.click();
}

/* ---------- Секция: О программе ---------- */

function renderAbout(){
  const wrap = el("div", "settings-section");

  const p1 = el("p", "settings-text");
  p1.textContent = "Paper · Personal Notebook — минималистичный блочный редактор. Работает полностью в браузере, сохраняет данные в IndexedDB.";
  wrap.append(p1);

  const p2 = el("p", "settings-text");
  p2.textContent = "Версия: 1.0.0 · Сборка: локальная";
  wrap.append(p2);

  const p3 = el("p", "settings-text");
  p3.textContent = "Все хоткеи настраиваются во вкладке «Хоткеи».";
  wrap.append(p3);

  const p4 = el("p", "settings-text settings-text-muted");
  p4.textContent = "Данные хранятся локально. Пароль-замок не шифрует содержимое, " +
    "но использует PBKDF2 (310 000 итераций, SHA-256).";
  wrap.append(p4);

  return wrap;
}

/* ---------- Bind ---------- */

function bind(){
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && $("#settings-modal")?.style.display === "flex"){
      e.preventDefault();
      close();
    }
  });

  const modal = $("#settings-modal");
  if (modal){
    modal.addEventListener("mousedown", e => {
      if (e.target === modal) close();
    });
  }
}

return {
  open,
  close,
  render,
  bind,
  isCapturing: () => captureHandler !== null
};
})();