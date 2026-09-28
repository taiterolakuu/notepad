/* ============================================================
   lock.js — пароль-замок на приложение (без шифрования данных)

   [Пакет 3]   fail-closed; PBKDF2 310k; isSecureContext guard;
               setPassword запускает startTimer();
               visibilitychange не блокирует при _autoLockMs === 0;
               ограничение попыток (нарастающая задержка);
               inert на #layout.
   [Пакет 3 fix] bind() ждёт db.init() перед loadLockMeta().
   [Пакет 14]  lock() закрывает открытые модалки.

   Зависит от: utils, state, db
   ============================================================ */

window.App = window.App || {};

window.App.lock = (() => {
"use strict";

const U = window.App.utils;
const { $, $$, toast } = U;

/* ---------- Состояние ---------- */

let _locked       = true;
let _hasPwd       = false;
let _hash         = null;
let _salt         = null;
let _iterations   = 310000;
let _autoLockMs   = 60 * 1000;

let _lastActivity = Date.now();
let _checkTimer   = null;
let _throttleLast = 0;

let _failCount    = 0;
let _nextTryAt    = 0;

let _bound        = false;

const SS_KEY = "paper-last-activity";

/* ---------- base64 ↔ bytes ---------- */

function b64encode(bytes){
  const arr = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s);
}

function b64decode(str){
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

/* ---------- Крипто ---------- */

function ensureSecureContext(){
  if (!window.isSecureContext && location.hostname !== "localhost"){
    console.error("[lock] crypto.subtle недоступен вне HTTPS/localhost");
    return false;
  }
  if (!window.crypto || !window.crypto.subtle){
    console.error("[lock] WebCrypto не поддерживается");
    return false;
  }
  return true;
}

function randomSalt(){
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return b64encode(arr);
}

async function hashPassword(password, saltB64){
  if (!ensureSecureContext()) return null;

  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: b64decode(saltB64),
      iterations: _iterations,
      hash: "SHA-256"
    },
    baseKey,
    256
  );

  return b64encode(bits);
}

function timingSafeEqual(a, b){
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++){
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* ---------- Публичное API ---------- */

function hasPassword(){
  return _hasPwd && !!_hash && !!_salt;
}

function isLocked(){
  return _locked;
}

function isBrokenState(){
  return _hasPwd && (!_hash || !_salt);
}

/* ---------- Установка / смена / сброс ---------- */

async function setPassword(password){
  if (!password || password.length < 4){
    throw new Error("Пароль слишком короткий");
  }
  if (!ensureSecureContext()){
    throw new Error("Шифрование недоступно — нужен HTTPS или localhost");
  }

  const salt = randomSalt();
  const hash = await hashPassword(password, salt);
  if (!hash) throw new Error("Не удалось захэшировать пароль");

  _salt = salt;
  _hash = hash;
  _hasPwd = true;
  _locked = false;
  _failCount = 0;
  _nextTryAt = 0;

  await saveLockMeta();
  _lastActivity = Date.now();
  hideScreen();
  setLayoutInert(false);

  startTimer();
}

async function changePassword(oldPw, newPw){
  if (isBrokenState()) return false;
  const ok = await checkPassword(oldPw);
  if (!ok) return false;
  if (!newPw || newPw.length < 4) return false;

  const salt = randomSalt();
  const hash = await hashPassword(newPw, salt);
  if (!hash) return false;

  _salt = salt;
  _hash = hash;
  _failCount = 0;
  _nextTryAt = 0;

  await saveLockMeta();
  return true;
}

async function checkPassword(password){
  if (!_hasPwd) return true;
  if (!_hash || !_salt) return false;
  const hash = await hashPassword(password, _salt);
  if (!hash) return false;
  return timingSafeEqual(hash, _hash);
}

async function clearPassword(password){
  if (isBrokenState()){
    _hasPwd = false;
    _hash = null;
    _salt = null;
    _locked = false;
    _failCount = 0;
    _nextTryAt = 0;
    await saveLockMeta();
    hideScreen();
    setLayoutInert(false);
    stopTimer();
    return true;
  }

  const ok = await checkPassword(password);
  if (!ok) return false;

  _hasPwd = false;
  _hash = null;
  _salt = null;
  _locked = false;
  _failCount = 0;
  _nextTryAt = 0;

  await saveLockMeta();
  hideScreen();
  setLayoutInert(false);
  stopTimer();
  return true;
}

/* ---------- Блокировка / разблокировка ---------- */

function lock(){
  if (!_hasPwd) return;
  if (_locked) return;

  _locked = true;
  closeAllOverlays();
  showScreen();
  setLayoutInert(true);
  stopTimer();
}

async function unlock(password){
  const nowTs = Date.now();
  if (nowTs < _nextTryAt){
    const wait = Math.ceil((_nextTryAt - nowTs) / 1000);
    return { ok: false, wait };
  }

  /* Если пароля нет (или не загружен) — просто разблокируем */
  if (!_hasPwd){
    _locked = false;
    hideScreen();
    setLayoutInert(false);
    return { ok: true };
  }

  /* Пароль есть в meta, но hash/salt ещё не подгрузились — попробуем
     подгрузить их синхронно перед проверкой */
  if (!_hash || !_salt){
    try {
      await loadLockMeta();
    } catch(e){}
    if (!_hash || !_salt){
      return { ok: false, failCount: _failCount };
    }
  }

  const ok = await checkPassword(password);
  if (!ok){
    _failCount++;
    if (_failCount >= 3){
      const backoff = Math.min(300, Math.pow(2, _failCount - 2));
      _nextTryAt = Date.now() + backoff * 1000;
    }
    return { ok: false, failCount: _failCount };
  }

  _failCount = 0;
  _nextTryAt = 0;
  _locked = false;
  hideScreen();
  setLayoutInert(false);
  recordActivity();
  startTimer();
  return { ok: true };
}

/* ---------- Экран блокировки ---------- */

function showScreen(){
  const s = $("#lock-screen");
  if (!s) return;
  s.style.display = "flex";
  const inp = $("#lock-password");
  if (inp){ inp.value = ""; setTimeout(() => inp.focus(), 0); }
  const err = $("#lock-error");
  if (err) err.textContent = "";
}

function hideScreen(){
  const s = $("#lock-screen");
  if (s) s.style.display = "none";
}

function setLayoutInert(on){
  const layout = document.getElementById("layout");
  if (layout){
    if (on) layout.setAttribute("inert", "");
    else    layout.removeAttribute("inert");
  }
}

function closeAllOverlays(){
  try {
    const settings = $("#settings-modal");
    if (settings && settings.style.display !== "none"){
      window.App.settings?.close?.();
    }
  } catch(e){}

  try { window.App.menus?.closeMenus?.(); } catch(e){}
  try { window.App.menus?.closeFontMenu?.(); } catch(e){}
  try { window.App.menus?.closeHandleMenu?.(); } catch(e){}
  try { window.App.wikilinkPopover?.close?.(); } catch(e){}

  ["#palette", "#slash", "#fontmenu", "#handlemenu", "#markermenu", "#lines-panel", "#backdrop", "#wikilink-popover"]
    .forEach(sel => {
      const el = document.querySelector(sel);
      if (el) el.style.display = "none";
    });

  try { window.App.state?.clearSelection?.(); } catch(e){}
}

/* ---------- Автоблокировка ---------- */

function recordActivity(){
  if (!_hasPwd) return;
  const t = Date.now();
  if (t - _throttleLast > 2000){
    _throttleLast = t;
    try { sessionStorage.setItem(SS_KEY, String(t)); } catch(e){}
  }
  _lastActivity = t;
}

function startTimer(){
  stopTimer();
  if (!_hasPwd) return;
  if (_autoLockMs <= 0) return;

  _checkTimer = setInterval(() => {
    if (_locked) return;
    if (_autoLockMs <= 0) return;
    const nowTs = Date.now();
    if (nowTs - _lastActivity >= _autoLockMs){
      lock();
    }
  }, 5000);
}

function stopTimer(){
  if (_checkTimer){
    clearInterval(_checkTimer);
    _checkTimer = null;
  }
}

/* ---------- meta.lock ---------- */

async function loadLockMeta(){
  try {
    const m = await window.App.db.getMeta("lock");
    if (m && typeof m === "object"){
      _hasPwd = !!m.enabled;
      _hash   = typeof m.hash === "string" && m.hash ? m.hash : null;
      _salt   = typeof m.salt === "string" && m.salt ? m.salt : null;
      _iterations = Number.isFinite(m.iterations) ? m.iterations : 310000;
      if (Number.isFinite(m.autoLockMinutes)){
        _autoLockMs = m.autoLockMinutes * 60 * 1000;
      }
    } else {
      /* meta.lock отсутствует — пароля нет */
      _hasPwd = false;
      _hash = null;
      _salt = null;
    }
  } catch(e){
    /* fail-closed: если не смогли прочитать — считаем, что пароль есть */
    console.error("[lock] meta load error, fail-closed:", e);
    _hasPwd = true;
    _hash = null;
    _salt = null;
    _locked = true;
  }
}

async function saveLockMeta(){
  const autoLockMinutes = _autoLockMs > 0 ? Math.round(_autoLockMs / 60000) : 0;
  await window.App.db.setMeta("lock", {
    enabled: _hasPwd,
    hash: _hash,
    salt: _salt,
    iterations: _iterations,
    autoLockMinutes
  });
}

function setAutoLockMinutes(minutes){
  _autoLockMs = Math.max(0, Number(minutes) || 0) * 60 * 1000;
  saveLockMeta();
  if (_autoLockMs > 0 && _hasPwd && !_locked) startTimer();
  else stopTimer();
}

function getAutoLockMinutes(){
  return _autoLockMs > 0 ? Math.round(_autoLockMs / 60000) : 0;
}

/* ============================================================
   Внутренние обработчики экрана (живут вне bind, чтобы не
   зависеть от порядка вызова)
   ============================================================ */

async function _tryUnlock(){
  const input = $("#lock-password");
  const err = $("#lock-error");
  const pw = input?.value || "";

  if (!pw){
    if (err) err.textContent = "Введите пароль";
    return;
  }

  const res = await unlock(pw);

  if (!res.ok){
    if (res.wait){
      if (err) err.textContent = `Слишком много попыток. Подождите ${res.wait} с.`;
    } else {
      if (err) err.textContent = "Неверный пароль";
    }
    if (input){
      input.value = "";
      input.focus();
      input.classList.add("shake");
      setTimeout(() => input.classList.remove("shake"), 300);
    }
    return;
  }

  if (err) err.textContent = "";
  toast("Разблокировано");
}

function _onLockClick(e){
  e.preventDefault();
  _tryUnlock();
}

function _onLockEnter(e){
  if (e.key === "Enter"){
    e.preventDefault();
    e.stopPropagation();
    _tryUnlock();
  }
}

/* ============================================================
   Bind — навешивает обработчики СРАЗУ (синхронно),
   а затем асинхронно читает meta.lock
   ============================================================ */

function bind(){
  if (_bound) return;
  _bound = true;

  /* Восстанавливаем lastActivity из sessionStorage */
  try {
    const t = Number(sessionStorage.getItem(SS_KEY));
    if (Number.isFinite(t) && t > 0 && t <= Date.now()) _lastActivity = t;
  } catch(e){}

  /* ---------- Обработчики формы — синхронно, безусловно ---------- */

  const btn = $("#lock-btn");
  const input = $("#lock-password");
  const errEl = $("#lock-error");

  /* На всякий случай — снимаем предыдущие (если bind вызывали дважды) */
  if (btn){
    btn.removeEventListener("click", _onLockClick);
    btn.addEventListener("click", _onLockClick);
  }
  if (input){
    input.removeEventListener("keydown", _onLockEnter, true);
    input.addEventListener("keydown", _onLockEnter, true);
  }
  if (errEl) errEl.textContent = "";

  /* ---------- Слушатели активности ---------- */

  const opts = { capture: true, passive: true };
  ["mousedown","click","keydown","wheel","touchstart","touchmove"].forEach(ev => {
    document.addEventListener(ev, (e) => {
      if (ev === "keydown" && e.repeat) return;
      recordActivity();
    }, opts);
  });

  document.addEventListener("mousemove", () => {
    recordActivity();
  }, { capture: true, passive: true });

  const main = document.querySelector("main");
  if (main) main.addEventListener("scroll", recordActivity, { passive: true });

  /* visibilitychange — только если автоблокировка включена */
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible"){
      if (_hasPwd && !_locked && _autoLockMs > 0){
        if (Date.now() - _lastActivity >= _autoLockMs){
          lock();
        }
      }
    }
  });

  /* ---------- Асинхронно читаем meta и решаем, что показать ---------- */

  Promise.resolve(window.App.db?.init?.())
    .catch(e => console.warn("[lock] db.init failed:", e))
    .then(() => loadLockMeta())
    .then(() => {
      if (_hasPwd){
        _locked = true;
        showScreen();
        setLayoutInert(true);
        if (_autoLockMs > 0) startTimer();
      } else {
        _locked = false;
        hideScreen();
        setLayoutInert(false);
      }
    })
    .catch(e => {
      console.error("[lock] bind failed, fail-closed:", e);
      _hasPwd = true;
      _hash = null;
      _salt = null;
      _locked = true;
      showScreen();
      setLayoutInert(true);
    });
}

return {
  bind,
  hasPassword,
  isLocked,
  isBrokenState,
  setPassword,
  changePassword,
  checkPassword,
  clearPassword,
  lock,
  unlock,
  setAutoLockMinutes,
  getAutoLockMinutes,
  recordActivity
};
})();