/* TelePro — interfaz de la tableta, control remoto y segunda pantalla. */
(function () {
  'use strict';

  // ---------------------------------------------------------------- utilidades
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const fmt = (sec) => {
    sec = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  };
  const words = (t) => (t.trim() ? t.trim().split(/\s+/).length : 0);
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  const I = {
    play: '<path d="M7 4v16l13-8z"/>',
    pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    restart: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
    up: '<path d="M18 11l-6-6-6 6M18 19l-6-6-6 6"/>',
    down: '<path d="M6 5l6 6 6-6M6 13l6 6 6-6"/>',
    gear: '<path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    mirror: '<path d="M12 3v18M8 7l-5 5 5 5zM16 7l5 5-5 5z"/>',
    flipv: '<path d="M3 12h18M7 8l5-5 5 5zM7 16l5 5 5-5z"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h9"/>',
    file: '<path d="M14 3H6v18h12V7zM14 3v4h4M12 11v6M9 14l3 3 3-3"/>',
    paste: '<path d="M9 3h6v4H9zM9 5H5v16h14V5h-4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.5-4.5"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    screen: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    lines: '<path d="M4 6h16M4 12h16M4 18h10"/>'
  };
  const ic = (n, fill) => '<svg class="ic' + (fill ? ' fill' : '') + '" viewBox="0 0 24 24">' + I[n] + '</svg>';

  function toast(msg, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('on'), ms || 2600);
  }
  function closeModal() { $('#modal').innerHTML = ''; }
  function modal(html, cls) {
    const m = $('#modal');
    m.innerHTML = '<div class="dialog ' + (cls || '') + '">' + html + '</div>';
    m.onclick = (e) => { if (e.target === m) closeModal(); };
    return m.firstChild;
  }
  function confirmBox(title, text, okLabel) {
    return new Promise((res) => {
      const d = modal('<h2>' + esc(title) + '</h2><p class="sub">' + esc(text) + '</p><div class="foot"><button class="btn" data-a="no">Cancelar</button><button class="btn primary" data-a="ok">' + esc(okLabel) + '</button></div>', 'narrow');
      d.onclick = (e) => { const b = e.target.closest('[data-a]'); if (b) { closeModal(); res(b.dataset.a === 'ok'); } };
    });
  }
  /** Repite la acción mientras se mantiene pulsado el botón. */
  function holdable(btn, fn) {
    let t1, t2;
    const stop = () => { clearTimeout(t1); clearInterval(t2); };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      fn();
      stop();
      t1 = setTimeout(() => { t2 = setInterval(fn, 70); }, 380);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stop));
  }

  // ------------------------------------------------------------------ conexión
  const qs = new URLSearchParams(location.search);
  const isLoop = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const Native = window.Native || null;
  let role = qs.get('role') || (isLoop ? 'display' : 'remote');
  let pin = qs.get('k') || '';
  try { if (!pin) pin = localStorage.getItem('telepro_k') || ''; } catch (e) { /* sin almacenamiento */ }
  const cid = Math.random().toString(36).slice(2, 10);

  function url(path, extra) {
    const u = new URLSearchParams(extra || {});
    if (pin) u.set('k', pin);
    u.set('id', cid);
    return path + '?' + u.toString();
  }
  async function kvGet(key) {
    const r = await fetch(url('/api/kv', { key }));
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('Sin conexión con la tableta');
    return r.json();
  }
  async function kvSet(key, val) {
    const r = await fetch(url('/api/kv', { key }), { method: 'POST', body: JSON.stringify(val) });
    if (!r.ok) throw new Error('No se pudo guardar');
  }
  function send(msg, kind) {
    fetch(url('/api/send', kind ? { kind } : {}), { method: 'POST', body: JSON.stringify(msg) }).catch(() => {});
  }
  const cmd = (a, v) => send({ t: 'cmd', a, v });

  const bus = {};
  const on = (t, fn) => { bus[t] = fn; };
  let online = false, peers = 0, lastState = { view: 'library' };
  function connect() {
    const es = new EventSource(url('/api/events', { role }));
    es.onopen = () => { online = true; if (bus.link) bus.link(); };
    es.onerror = () => { online = false; if (bus.link) bus.link(); };
    es.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.t === 'peers') peers = m.n;
      if (m.t === 'state') lastState = m;
      if (bus[m.t]) bus[m.t](m);
    };
  }

  // ------------------------------------------------------------------- ajustes
  const ACTIONS = [
    ['toggle', 'Iniciar / pausar'], ['speedUp', 'Más velocidad'], ['speedDown', 'Menos velocidad'],
    ['forward', 'Avanzar'], ['back', 'Retroceder'], ['restart', 'Volver al inicio'],
    ['sizeUp', 'Texto más grande'], ['sizeDown', 'Texto más pequeño'], ['mirror', 'Modo espejo'], ['exit', 'Salir del guion']
  ];
  const DEF_KEYS = {
    KEYCODE_SPACE: 'toggle', KEYCODE_ENTER: 'toggle', KEYCODE_DPAD_CENTER: 'toggle', KEYCODE_NUMPAD_ENTER: 'toggle',
    KEYCODE_MEDIA_PLAY_PAUSE: 'toggle', KEYCODE_MEDIA_PLAY: 'toggle', KEYCODE_MEDIA_PAUSE: 'toggle', KEYCODE_HEADSETHOOK: 'toggle', KEYCODE_BUTTON_A: 'toggle',
    KEYCODE_DPAD_UP: 'speedUp', KEYCODE_VOLUME_UP: 'speedUp', KEYCODE_DPAD_DOWN: 'speedDown', KEYCODE_VOLUME_DOWN: 'speedDown',
    KEYCODE_DPAD_RIGHT: 'forward', KEYCODE_PAGE_DOWN: 'forward', KEYCODE_MEDIA_NEXT: 'forward', KEYCODE_MEDIA_FAST_FORWARD: 'forward',
    KEYCODE_DPAD_LEFT: 'back', KEYCODE_PAGE_UP: 'back', KEYCODE_MEDIA_PREVIOUS: 'back', KEYCODE_MEDIA_REWIND: 'back',
    KEYCODE_MOVE_HOME: 'restart', KEYCODE_M: 'mirror', KEYCODE_PLUS: 'sizeUp', KEYCODE_EQUALS: 'sizeUp', KEYCODE_NUMPAD_ADD: 'sizeUp',
    KEYCODE_MINUS: 'sizeDown', KEYCODE_NUMPAD_SUBTRACT: 'sizeDown', KEYCODE_ESCAPE: 'exit'
  };
  const DEF = {
    speed: 20, size: 60, margin: 8, line: 1.35, align: 'left', theme: 'dark', font: 'sans', upper: false,
    mirror: false, flipV: false, guide: true, guidePos: 35, countdown: 3, loop: false, editorSize: 22,
    keymap: Object.assign({}, DEF_KEYS)
  };
  const LIMITS = { speed: [1, 100], size: [20, 160], margin: [0, 30], line: [1, 2.2], guidePos: [10, 80], countdown: [0, 10], editorSize: [14, 44] };
  let settings = JSON.parse(JSON.stringify(DEF));
  const saveSettings = debounce(() => kvSet('settings', settings).catch(() => {}), 500);
  const publicSettings = () => { const s = Object.assign({}, settings); delete s.keymap; return s; };

  const DOMKEY = {
    ' ': 'KEYCODE_SPACE', Enter: 'KEYCODE_ENTER', ArrowUp: 'KEYCODE_DPAD_UP', ArrowDown: 'KEYCODE_DPAD_DOWN', ArrowLeft: 'KEYCODE_DPAD_LEFT',
    ArrowRight: 'KEYCODE_DPAD_RIGHT', PageUp: 'KEYCODE_PAGE_UP', PageDown: 'KEYCODE_PAGE_DOWN', Home: 'KEYCODE_MOVE_HOME', End: 'KEYCODE_MOVE_END',
    Escape: 'KEYCODE_ESCAPE', MediaPlayPause: 'KEYCODE_MEDIA_PLAY_PAUSE', MediaTrackNext: 'KEYCODE_MEDIA_NEXT', MediaTrackPrevious: 'KEYCODE_MEDIA_PREVIOUS',
    AudioVolumeUp: 'KEYCODE_VOLUME_UP', AudioVolumeDown: 'KEYCODE_VOLUME_DOWN', '+': 'KEYCODE_PLUS', '-': 'KEYCODE_MINUS', '=': 'KEYCODE_EQUALS',
    Tab: 'KEYCODE_TAB', Backspace: 'KEYCODE_DEL'
  };
  function domKeyName(e) {
    if (DOMKEY[e.key]) return DOMKEY[e.key];
    if (/^[a-z0-9]$/i.test(e.key)) return 'KEYCODE_' + e.key.toUpperCase();
    if (/^F\d+$/.test(e.key)) return 'KEYCODE_' + e.key;
    return 'DOM_' + e.key;
  }
  const keyLabel = (k) => k.replace(/^KEYCODE_|^DOM_/, '').replace(/_/g, ' ');

  // -------------------------------------------------------------------- guiones
  const SAMPLE = 'Bienvenido a TelePro.\n\nEste es un guion de ejemplo. Toca la pantalla para iniciar o pausar, y arrastra con el dedo para mover el texto.\n\n[PAUSA — el texto entre corchetes se muestra como nota y no se lee]\n\nCon los botones de abajo cambias la velocidad y el tamaño de la letra. El botón de espejo invierte el texto para usarlo en el cristal del teleprompter.\n\nConecta tu celular con el botón «Control remoto»: escanea el código QR y maneja todo desde el navegador, sin instalar nada.\n\nCuando quieras, vuelve a la biblioteca y crea tu propio guion: puedes escribirlo, pegarlo o importarlo desde un archivo PDF, Word o de texto.\n\n¡Buena grabación!';
  const Store = {
    async index() {
      let ix = await kvGet('index');
      if (!ix) {
        ix = [];
        if (role === 'display') {
          const s = { id: 'bienvenida', title: 'Guion de ejemplo', text: SAMPLE, updated: Date.now() };
          await kvSet('s_' + s.id, s);
          ix = [Store.meta(s)];
          await kvSet('index', ix);
        }
      }
      return ix;
    },
    meta(s) {
      return { id: s.id, title: s.title, updated: s.updated, words: words(s.text), snippet: s.text.replace(/\s+/g, ' ').trim().slice(0, 160) };
    },
    get(id) { return kvGet('s_' + id); },
    async save(s) {
      s.updated = Date.now();
      await kvSet('s_' + s.id, s);
      const ix = (await kvGet('index')) || [];
      const i = ix.findIndex((m) => m.id === s.id);
      if (i >= 0) ix[i] = Store.meta(s); else ix.unshift(Store.meta(s));
      await kvSet('index', ix);
      send({ t: 'scripts', id: s.id });
    },
    async remove(id) {
      const ix = ((await kvGet('index')) || []).filter((m) => m.id !== id);
      await kvSet('index', ix);
      await fetch(url('/api/kv/delete', { key: 's_' + id }), { method: 'POST' });
      send({ t: 'scripts', id });
    },
    create(title, text) {
      return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title: title || 'Guion sin título', text: text || '', updated: Date.now() };
    }
  };

  // ---------------------------------------------------------------- importación
  function pickFile() {
    return new Promise((res) => {
      const f = $('#file');
      f.value = '';
      f.onchange = () => res(f.files[0] || null);
      f.click();
    });
  }
  function decodeText(buf) {
    if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
    if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('windows-1252').decode(buf); }
  }
  async function pdfText(buf) {
    const pdfjs = await import('./lib/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = './lib/pdf.worker.min.mjs';
    const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: true }).promise;
    const lines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const tc = await (await doc.getPage(p)).getTextContent();
      let cur = null;
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        const y = it.transform[5];
        if (!cur || (Math.abs(y - cur.y) > 2 && it.str.trim())) {
          if (cur) lines.push(cur);
          cur = { text: '', y, page: p };
        }
        cur.text += it.str;
        if (it.hasEOL && cur.text.trim()) { lines.push(cur); cur = null; }
      }
      if (cur) lines.push(cur);
    }
    const ls = lines.map((l) => ({ text: l.text.replace(/\s+/g, ' ').trim(), y: l.y, page: l.page })).filter((l) => l.text);
    if (!ls.length) throw new Error('Este PDF no contiene texto seleccionable (parece una imagen escaneada)');
    const gaps = [];
    for (let i = 1; i < ls.length; i++) if (ls[i].page === ls[i - 1].page && ls[i - 1].y > ls[i].y) gaps.push(ls[i - 1].y - ls[i].y);
    gaps.sort((a, b) => a - b);
    const med = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    const maxLen = Math.max.apply(null, ls.map((l) => l.text.length));
    let out = ls[0].text;
    for (let i = 1; i < ls.length; i++) {
      const a = ls[i - 1], b = ls[i];
      const gap = a.page === b.page ? a.y - b.y : med;
      const endsSentence = /[.!?:»”"]$/.test(a.text);
      const newPara = (med && gap > med * 1.45) || (endsSentence && a.text.length < maxLen * 0.7);
      if (newPara) out += '\n\n' + b.text;
      else if (/[a-záéíóúñ]-$/i.test(a.text) && /^[a-záéíóúñ]/.test(b.text)) out = out.slice(0, -1) + b.text;
      else out += ' ' + b.text;
    }
    return out;
  }
  async function fileToText(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const head = String.fromCharCode.apply(null, buf.slice(0, 5));
    if (head.startsWith('%PDF')) return pdfText(buf);
    if (head.startsWith('PK')) {
      const r = await fetch(url('/api/docx'), { method: 'POST', body: buf });
      if (!r.ok) throw new Error('No se pudo leer el documento de Word');
      return r.text();
    }
    if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new Error('El formato .doc antiguo no es compatible: guárdalo como .docx o PDF');
    if (head.startsWith('{\\rtf')) throw new Error('El formato RTF no es compatible: guárdalo como .docx, PDF o .txt');
    return decodeText(buf);
  }
  async function importFile() {
    const file = await pickFile();
    if (!file) return null;
    toast('Leyendo archivo…', 8000);
    try {
      const text = (await fileToText(file)).replace(/\r\n?/g, '\n').trim();
      let title = (file.name || '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_-]+/g, ' ').trim();
      if (!/[a-záéíóúñ]{2}/i.test(title) || /^(document|msf|primary|image)[: ]/i.test(title)) title = 'Guion importado';
      toast('Archivo importado');
      return { title, text };
    } catch (e) {
      toast(e.message || 'No se pudo leer el archivo', 4500);
      return null;
    }
  }
  async function readClipboard() {
    try {
      if (Native) return Native.readClipboard() || '';
      if (navigator.clipboard && navigator.clipboard.readText) return await navigator.clipboard.readText();
    } catch (e) { /* sin permiso */ }
    return null;
  }

  // ---------------------------------------------------------------- teleprompter
  class Prompter {
    constructor(root, opts) {
      this.root = root;
      this.follower = !!(opts && opts.follower);
      this.onChange = (opts && opts.onChange) || function () {};
      const host = document.createElement('div');
      host.className = 'pr-stage';
      host.innerHTML = '<div class="pr-flip"><div class="pr-text"></div><div class="pr-guide"><i></i></div></div>';
      root.prepend(host);
      const cnt = document.createElement('div');
      cnt.className = 'pr-count';
      root.appendChild(cnt);
      this.stage = host;
      this.flip = host.firstChild;
      this.textEl = $('.pr-text', host);
      this.guide = $('.pr-guide', host);
      this.countEl = cnt;
      this.s = Object.assign({}, DEF);
      this.progress = 0;
      this.playing = false;
      this.counting = false;
      this.elapsed = 0;
      this.contentH = 1;
      this.lineH = 60;
      this.guideY = 0;
      this.last = 0;
      this.dead = false;
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(host);
      this.tick = this.tick.bind(this);
      requestAnimationFrame(this.tick);
    }
    destroy() { this.dead = true; this.ro.disconnect(); clearInterval(this.cd); }
    setText(text) {
      const html = text.replace(/\r/g, '').split('\n').map((l) => {
        if (!l.trim()) return '<div class="gap"></div>';
        return '<div>' + esc(l).replace(/\[[^\]\n]*\]/g, (m) => '<span class="cue">' + m + '</span>') + '</div>';
      }).join('');
      this.textEl.innerHTML = html || '<div class="gap"></div>';
      this.layout();
    }
    apply(s) {
      this.s = s;
      const r = this.root;
      r.className = r.className.replace(/\b(theme|font)-\S+/g, '').trim();
      r.classList.add('theme-' + s.theme, 'font-' + s.font);
      r.classList.toggle('upper', !!s.upper);
      r.classList.toggle('no-guide', !s.guide);
      this.layout();
    }
    layout() {
      const w = this.stage.clientWidth, h = this.stage.clientHeight, s = this.s;
      if (!w || !h) return;
      const fs = (w * s.size) / 1000;
      this.lineH = fs * s.line;
      this.root.style.setProperty('--fs', fs.toFixed(2) + 'px');
      this.root.style.setProperty('--lh', s.line);
      this.root.style.setProperty('--pad', s.margin + '%');
      this.root.style.setProperty('--al', s.align);
      this.guideY = (h * s.guidePos) / 100;
      this.guide.style.top = this.guideY + 'px';
      this.flip.style.transform = 'scale(' + (s.mirror ? -1 : 1) + ',' + (s.flipV ? -1 : 1) + ')';
      this.contentH = Math.max(1, this.textEl.offsetHeight);
      this.draw();
    }
    draw() {
      this.textEl.style.transform = 'translate3d(0,' + (this.guideY - this.progress * this.contentH).toFixed(2) + 'px,0)';
    }
    pxPerSec() { return Math.max(1, this.s.speed * this.lineH * 0.025); }
    remaining() { return ((1 - this.progress) * this.contentH) / this.pxPerSec(); }
    tick(t) {
      if (this.dead) return;
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      if (this.playing && !this.counting && dt > 0) {
        this.progress += (this.pxPerSec() * dt) / this.contentH;
        this.elapsed += dt;
        if (this.progress >= 1) {
          if (this.follower) this.progress = 1;
          else if (this.s.loop) this.progress = 0;
          else { this.progress = 1; this.pause(); }
        }
        this.draw();
      }
      requestAnimationFrame(this.tick);
    }
    play() {
      if (this.playing) return;
      if (this.progress >= 0.9999) { this.progress = 0; this.elapsed = 0; this.draw(); }
      this.playing = true;
      if (!this.follower && this.s.countdown > 0 && this.progress < 0.0005) this.countdown(this.s.countdown);
      this.onChange();
    }
    countdown(n) {
      this.counting = true;
      const show = () => { this.countEl.textContent = n; this.countEl.classList.add('on'); };
      show();
      clearInterval(this.cd);
      this.cd = setInterval(() => {
        n--;
        if (n <= 0) this.endCountdown(); else show();
      }, 1000);
    }
    endCountdown() {
      clearInterval(this.cd);
      this.counting = false;
      this.countEl.classList.remove('on');
      this.onChange();
    }
    pause() {
      if (!this.playing) return;
      this.playing = false;
      if (this.counting) this.endCountdown();
      this.onChange();
    }
    toggle() { if (this.playing) this.pause(); else this.play(); }
    setProgress(p) { this.progress = clamp(p, 0, 1); this.draw(); this.onChange(); }
    seekLines(n) { this.setProgress(this.progress + (n * this.lineH) / this.contentH); }
    restart() { this.progress = 0; this.elapsed = 0; this.draw(); this.onChange(); }
    /** Segunda pantalla: sigue el estado que envía la tableta. */
    sync(st) {
      this.playing = !!st.playing && !st.counting;
      this.elapsed = st.elapsed || 0;
      const err = st.progress - this.progress;
      if (!this.playing || Math.abs(err * this.contentH) > this.lineH * 1.5) this.progress = st.progress;
      else this.progress += err * 0.5;
      this.countEl.classList.toggle('on', !!st.counting);
      if (st.counting) this.countEl.textContent = st.count || '';
      this.draw();
    }
  }

  // --------------------------------------------------------------------- vistas
  const app = $('#app');
  let view = { name: '' };
  function go(name, params) {
    if (view.destroy) view.destroy();
    closeModal();
    app.innerHTML = '';
    app.className = '';
    Object.keys(bus).forEach((k) => delete bus[k]);
    view = { name };
    VIEWS[name](params || {});
    if (Native) Native.setCaptureKeys(name === 'prompter');
    if (role === 'display' && name !== 'prompter') send({ t: 'state', view: name }, 'state');
  }
  const home = () => go(role === 'remote' ? 'control' : 'library');

  function tabs(active) {
    if (role !== 'remote') return;
    app.classList.add('has-tabs');
    const n = document.createElement('nav');
    n.className = 'tabs';
    n.innerHTML = [['control', 'phone', 'Control'], ['library', 'list', 'Guiones'], ['mirror', 'screen', 'Pantalla']]
      .map((t) => '<button data-v="' + t[0] + '" class="' + (t[0] === active ? 'on' : '') + '">' + ic(t[1]) + t[2] + '</button>').join('');
    n.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.v === 'mirror') location.href = '/?role=mirror' + (pin ? '&k=' + encodeURIComponent(pin) : '');
      else go(b.dataset.v);
    };
    app.appendChild(n);
  }
  const brand = '<div class="brand"><i>' + ic('lines') + '</i><b>Tele<span>Pro</span></b></div>';
  const linkPill = () => (role === 'display'
    ? '<span class="pill" id="link"><span class="dot ' + (peers ? 'on' : '') + '"></span>' + (peers ? peers + (peers === 1 ? ' control conectado' : ' controles conectados') : 'Sin controles') + '</span>'
    : '<span class="pill" id="link"><span class="dot ' + (online ? 'on' : 'off') + '"></span>' + (online ? 'Conectado' : 'Sin conexión') + '</span>');
  function refreshLink() { const l = $('#link'); if (l) l.outerHTML = linkPill(); }

  const VIEWS = {};

  // ---- Biblioteca
  VIEWS.library = function () {
    app.innerHTML =
      '<div class="bar">' + brand + '<div class="grow"></div>' + linkPill() +
      (role === 'display' ? '<button class="btn" id="bConnect">' + ic('phone') + '<span class="hide-s">Control remoto</span></button>' : '') + '</div>' +
      '<div class="lib"><div class="lib-head"><h1>Mis guiones</h1><label class="search">' + ic('search') + '<input id="q" type="search" placeholder="Buscar guion…"></label></div><div class="cards" id="cards"></div></div>';
    tabs('library');
    let index = [];
    const cards = $('#cards');
    const render = () => {
      const q = $('#q').value.trim().toLowerCase();
      const list = index.filter((m) => !q || (m.title + ' ' + m.snippet).toLowerCase().includes(q));
      cards.innerHTML =
        '<div class="card new"><button class="btn primary" data-a="new">' + ic('plus') + 'Nuevo guion</button>' +
        '<button class="btn" data-a="import">' + ic('file') + 'Importar PDF, Word o TXT</button>' +
        '<button class="btn" data-a="paste">' + ic('paste') + 'Pegar texto copiado</button></div>' +
        list.map((m) =>
          '<div class="card" data-id="' + m.id + '"><h3>' + esc(m.title) + '</h3><p>' + esc(m.snippet || 'Guion vacío') + '</p>' +
          '<div class="meta"><span>' + m.words + ' palabras</span><span>≈ ' + fmt((m.words / 150) * 60) + ' min</span></div>' +
          '<div class="acts"><button class="btn primary small" data-a="present">' + ic('play', 1) + 'Presentar</button>' +
          '<button class="btn small" data-a="edit">' + ic('edit') + 'Editar</button>' +
          '<button class="btn small icon ghost" data-a="dup" title="Duplicar" aria-label="Duplicar">' + ic('copy') + '</button>' +
          '<button class="btn small icon ghost danger" data-a="del" title="Eliminar" aria-label="Eliminar">' + ic('trash') + '</button></div></div>').join('') +
        (q && !list.length ? '<div class="empty">Ningún guion coincide con «' + esc(q) + '».</div>' : '');
    };
    const load = () => Store.index().then((ix) => { index = ix; if (view.name === 'library') render(); }).catch((e) => toast(e.message));
    load();
    $('#q').oninput = render;
    const bc = $('#bConnect');
    if (bc) bc.onclick = showConnect;
    cards.onclick = async (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const a = b.dataset.a, card = b.closest('[data-id]'), id = card && card.dataset.id;
      if (a === 'new') {
        const s = Store.create('', '');
        await Store.save(s);
        go('editor', { id: s.id, fresh: true });
      } else if (a === 'import') {
        const r = await importFile();
        if (r) { const s = Store.create(r.title, r.text); await Store.save(s); go('editor', { id: s.id }); }
      } else if (a === 'paste') {
        const t = await readClipboard();
        const s = Store.create('', t || '');
        if (t) s.title = t.trim().split('\n')[0].slice(0, 50) || s.title;
        await Store.save(s);
        go('editor', { id: s.id, fresh: !t });
        toast(t ? 'Texto pegado' : 'Mantén pulsado sobre el texto y elige «Pegar»', 3500);
      } else if (a === 'present') {
        if (role === 'display') go('prompter', { id });
        else { cmd('open', id); go('control'); }
      } else if (a === 'edit') {
        go('editor', { id });
      } else if (a === 'dup') {
        const o = await Store.get(id);
        if (o) { await Store.save(Store.create(o.title + ' (copia)', o.text)); load(); }
      } else if (a === 'del') {
        const m = index.find((x) => x.id === id);
        if (await confirmBox('Eliminar guion', '«' + (m ? m.title : '') + '» se eliminará definitivamente.', 'Eliminar')) { await Store.remove(id); load(); }
      }
    };
    on('scripts', load);
    on('peers', refreshLink);
    on('link', refreshLink);
    view.back = () => 'exit';
  };

  // ---- Editor
  VIEWS.editor = async function (p) {
    app.innerHTML =
      '<div class="editor"><div class="bar"><button class="btn icon ghost" id="bBack" aria-label="Volver">' + ic('back') + '</button>' +
      '<input class="ed-title" id="title" placeholder="Título del guion" maxlength="120"><span class="saved hide-s" id="saved"></span>' +
      '<button class="btn primary" id="bPresent">' + ic('play', 1) + 'Presentar</button></div>' +
      '<div class="ed-tools"><button class="btn small" id="bImport">' + ic('file') + 'Importar archivo</button><button class="btn small" id="bPaste">' + ic('paste') + 'Pegar</button>' +
      '<button class="btn small" id="bCue" title="Nota que se muestra resaltada">[ Nota ]</button><button class="btn small ghost danger" id="bClear">Vaciar</button><div class="grow"></div>' +
      '<span class="stat" id="stat"></span><button class="btn small icon" id="bSm" aria-label="Letra más pequeña">A−</button><button class="btn small icon" id="bLg" aria-label="Letra más grande">A+</button></div>' +
      '<div class="ed-area"><textarea id="text" placeholder="Escribe o pega aquí tu guion…" spellcheck="true"></textarea></div></div>';
    const ta = $('#text'), ti = $('#title'), saved = $('#saved');
    let s;
    try { s = await Store.get(p.id); } catch (e) { toast(e.message); }
    if (view.name !== 'editor') return;
    if (!s) { home(); return; }
    ti.value = p.fresh ? '' : s.title;
    ta.value = s.text;
    ta.style.fontSize = settings.editorSize + 'px';
    const stat = () => { const w = words(ta.value); $('#stat').textContent = w + ' palabras · ≈ ' + fmt((w / 150) * 60) + ' min'; };
    stat();
    let dirty = false, saving = Promise.resolve();
    const doSave = () => {
      if (!dirty) return saving;
      dirty = false;
      s.title = ti.value.trim() || 'Guion sin título';
      s.text = ta.value;
      saving = Store.save(s).then(() => { saved.textContent = 'Guardado'; }).catch(() => { dirty = true; saved.textContent = 'Sin guardar'; });
      return saving;
    };
    const later = debounce(doSave, 700);
    const touch = () => { dirty = true; saved.textContent = 'Guardando…'; stat(); later(); };
    ta.oninput = touch;
    ti.oninput = touch;
    const insert = (t) => {
      ta.focus();
      const a = ta.selectionStart, b = ta.selectionEnd;
      ta.setRangeText(t, a, b, 'end');
      touch();
    };
    $('#bImport').onclick = async () => {
      const r = await importFile();
      if (!r) return;
      if (!ta.value.trim() && !ti.value.trim()) ti.value = r.title;
      insert(r.text);
    };
    $('#bPaste').onclick = async () => {
      const t = await readClipboard();
      if (t) insert(t); else toast('Mantén pulsado sobre el texto y elige «Pegar»', 3500);
    };
    $('#bCue').onclick = () => insert('[PAUSA]');
    $('#bClear').onclick = async () => { if (await confirmBox('Vaciar guion', 'Se borrará todo el texto de este guion.', 'Vaciar')) { ta.value = ''; touch(); } };
    const size = (d) => { settings.editorSize = clamp(settings.editorSize + d, LIMITS.editorSize[0], LIMITS.editorSize[1]); ta.style.fontSize = settings.editorSize + 'px'; if (role === 'display') saveSettings(); };
    $('#bSm').onclick = () => size(-2);
    $('#bLg').onclick = () => size(2);
    const leave = async (then) => { dirty = dirty || false; await doSave(); then(); };
    $('#bBack').onclick = () => leave(() => go('library'));
    $('#bPresent').onclick = () => leave(() => {
      if (role === 'display') go('prompter', { id: s.id });
      else { cmd('open', s.id); go('control'); }
    });
    if (p.fresh) ti.focus();
    view.back = () => { leave(() => go('library')); return 'ok'; };
    view.destroy = () => { doSave(); };
  };

  // ---- Teleprompter (tableta)
  VIEWS.prompter = async function (p) {
    app.innerHTML =
      '<div class="prompter" id="pr">' +
      '<div class="pr-top hud"><button class="btn icon" id="bBack" aria-label="Volver">' + ic('back') + '</button><div class="title grow" id="pTitle"></div>' +
      '<div class="timer"><span class="rec"></span><span id="tEl">00:00</span><small id="tRem"></small></div>' +
      '<button class="btn icon" id="bConnect" aria-label="Control remoto">' + ic('phone') + '</button></div>' +
      '<div class="pr-progress"><i id="bar"></i></div>' +
      '<div class="pr-bottom hud">' +
      '<div class="group"><button class="btn icon" data-a="restart" aria-label="Volver al inicio">' + ic('restart') + '</button><button class="btn icon" data-h="back" aria-label="Retroceder">' + ic('up') + '</button>' +
      '<button class="btn icon play" data-a="toggle" id="bPlay" aria-label="Iniciar o pausar">' + ic('play', 1) + '</button><button class="btn icon" data-h="forward" aria-label="Avanzar">' + ic('down') + '</button></div>' +
      '<div class="group stepper"><button class="btn icon" data-h="speedDown" aria-label="Menos velocidad">' + ic('minus') + '</button><div class="val"><b id="vSpeed"></b><small>Velocidad</small></div><button class="btn icon" data-h="speedUp" aria-label="Más velocidad">' + ic('plus') + '</button></div>' +
      '<div class="group stepper"><button class="btn icon" data-h="sizeDown" aria-label="Texto más pequeño">' + ic('minus') + '</button><div class="val"><b id="vSize"></b><small>Tamaño</small></div><button class="btn icon" data-h="sizeUp" aria-label="Texto más grande">' + ic('plus') + '</button></div>' +
      '<div class="group"><button class="btn" data-a="mirror" id="bMirror">' + ic('mirror') + 'Espejo</button><button class="btn icon" data-a="flipV" id="bFlip" aria-label="Voltear vertical">' + ic('flipv') + '</button><button class="btn icon" id="bGear" aria-label="Ajustes">' + ic('gear') + '</button></div>' +
      '</div><aside class="drawer" id="drawer"></aside></div>';
    const root = $('#pr'), drawer = $('#drawer');
    let script = null, learning = null, hudT, lastPush = 0;
    const P = new Prompter(root, { onChange: () => { refresh(); push(true); wake(); } });
    P.apply(settings);

    const push = (force) => {
      const now = Date.now();
      if (!force && now - lastPush < 280) return;
      lastPush = now;
      send({ t: 'state', view: 'prompter', scriptId: p.id, title: script ? script.title : '', playing: P.playing, counting: P.counting, count: P.countEl.textContent,
        progress: +P.progress.toFixed(5), elapsed: Math.round(P.elapsed), remaining: Math.round(P.remaining()), s: publicSettings() }, 'state');
    };
    function refresh() {
      root.classList.toggle('playing', P.playing);
      $('#bPlay').innerHTML = ic(P.playing ? 'pause' : 'play', 1);
      $('#vSpeed').textContent = settings.speed;
      $('#vSize').textContent = settings.size;
      $('#bMirror').classList.toggle('on', settings.mirror);
      $('#bFlip').classList.toggle('on', settings.flipV);
      $('#tEl').textContent = fmt(P.elapsed);
      $('#tRem').textContent = '−' + fmt(P.remaining());
      $('#bar').style.width = (P.progress * 100).toFixed(2) + '%';
    }
    function wake() {
      root.classList.remove('hud-off');
      clearTimeout(hudT);
      hudT = setTimeout(() => { if (P.playing && !drawer.classList.contains('open')) root.classList.add('hud-off'); }, 2800);
    }
    function set(k, v) {
      if (LIMITS[k]) v = clamp(v, LIMITS[k][0], LIMITS[k][1]);
      if (k === 'line') v = Math.round(v * 100) / 100;
      settings[k] = v;
      P.apply(settings);
      saveSettings();
      refresh();
      push(true);
      if (drawer.classList.contains('open')) syncDrawer();
    }
    function act(a, v) {
      switch (a) {
        case 'toggle': P.toggle(); break;
        case 'play': P.play(); break;
        case 'pause': P.pause(); break;
        case 'speedUp': set('speed', settings.speed + 1); break;
        case 'speedDown': set('speed', settings.speed - 1); break;
        case 'sizeUp': set('size', settings.size + 2); break;
        case 'sizeDown': set('size', settings.size - 2); break;
        case 'forward': P.seekLines(3); break;
        case 'back': P.seekLines(-3); break;
        case 'restart': P.restart(); break;
        case 'mirror': set('mirror', !settings.mirror); break;
        case 'flipV': set('flipV', !settings.flipV); break;
        case 'seek': P.setProgress(+v || 0); break;
        case 'set': if (v && v.k in DEF && v.k !== 'keymap') set(v.k, v.v); break;
        case 'open': if (v && v !== p.id) go('prompter', { id: v }); break;
        case 'exit': go('library'); break;
      }
    }

    // Ajustes
    const slider = (k, label, step) => '<div class="row"><label>' + label + '</label><input type="range" data-k="' + k + '" min="' + LIMITS[k][0] + '" max="' + LIMITS[k][1] + '" step="' + (step || 1) + '"><output data-o="' + k + '"></output></div>';
    const sw = (k, label) => '<div class="row"><label>' + label + '</label><button class="sw" data-sw="' + k + '" role="switch" aria-label="' + label + '"></button></div>';
    const seg = (k, label, opts) => '<div class="row"><label>' + label + '</label><div class="seg" data-seg="' + k + '">' + opts.map((o) => '<button data-v="' + o[0] + '">' + o[1] + '</button>').join('') + '</div></div>';
    function buildDrawer() {
      drawer.innerHTML = '<header><span class="grow">Ajustes</span><button class="btn icon ghost" data-x aria-label="Cerrar">' + ic('x') + '</button></header><div class="body">' +
        '<div class="sect">Lectura</div>' + slider('speed', 'Velocidad') + slider('size', 'Tamaño del texto', 2) + slider('line', 'Interlineado', 0.05) + slider('margin', 'Márgenes laterales') +
        seg('align', 'Alineación', [['left', 'Izquierda'], ['center', 'Centro']]) +
        '<div class="sect">Apariencia</div>' +
        '<div class="row"><label>Colores</label><div style="display:flex;gap:6px" data-seg="theme">' +
        [['dark', '#000', '#fff'], ['yellow', '#000', '#ffe45c'], ['green', '#000', '#7dff9b'], ['light', '#fff', '#0b0d10']].map((t) => '<button class="swatch" data-v="' + t[0] + '" style="background:' + t[1] + ';color:' + t[2] + '" aria-label="Tema ' + t[0] + '">A</button>').join('') + '</div></div>' +
        seg('font', 'Tipo de letra', [['sans', 'Moderna'], ['serif', 'Serif'], ['mono', 'Mono']]) + sw('upper', 'Todo en MAYÚSCULAS') +
        '<div class="sect">Pantalla</div>' + sw('mirror', 'Modo espejo (horizontal)') + sw('flipV', 'Voltear vertical') + sw('guide', 'Guía de lectura') + slider('guidePos', 'Altura de la guía') +
        '<div class="sect">Reproducción</div>' + slider('countdown', 'Cuenta regresiva (s)') + sw('loop', 'Repetir al terminar') +
        '<div class="sect">Mando Bluetooth</div><p class="hint">Empareja el mando en los ajustes de Bluetooth de la tableta. Para cambiar un botón, toca «Asignar» y púlsalo en el mando.</p><div id="keys"></div>' +
        '<div class="row"><label></label><button class="btn small" data-reset>Restablecer botones</button></div></div>';
      syncDrawer();
    }
    function syncDrawer() {
      $$('[data-k]', drawer).forEach((i) => { i.value = settings[i.dataset.k]; });
      $$('[data-o]', drawer).forEach((o) => { o.textContent = settings[o.dataset.o]; });
      $$('[data-sw]', drawer).forEach((b) => { b.classList.toggle('on', !!settings[b.dataset.sw]); b.setAttribute('aria-checked', !!settings[b.dataset.sw]); });
      $$('[data-seg]', drawer).forEach((g) => $$('button', g).forEach((b) => b.classList.toggle('on', b.dataset.v === settings[g.dataset.seg])));
      $('#keys', drawer).innerHTML = ACTIONS.map((a) => {
        const ks = Object.keys(settings.keymap).filter((k) => settings.keymap[k] === a[0]);
        return '<div class="row"><label>' + a[1] + '</label><div class="keys">' + (learning === a[0] ? '<span class="key" style="color:var(--accent)">Pulsa un botón…</span>' : ks.slice(-4).map((k) => '<span class="key">' + esc(keyLabel(k)) + '</span>').join('')) +
          '</div><button class="btn small" data-learn="' + a[0] + '">' + (learning === a[0] ? 'Cancelar' : 'Asignar') + '</button></div>';
      }).join('');
    }
    drawer.oninput = (e) => { const k = e.target.dataset.k; if (k) set(k, parseFloat(e.target.value)); };
    drawer.onclick = (e) => {
      const t = e.target;
      if (t.closest('[data-x]')) { drawer.classList.remove('open'); learning = null; wake(); return; }
      const s = t.closest('[data-sw]');
      if (s) return set(s.dataset.sw, !settings[s.dataset.sw]);
      const g = t.closest('[data-seg]'), b = t.closest('[data-v]');
      if (g && b) return set(g.dataset.seg, b.dataset.v);
      const l = t.closest('[data-learn]');
      if (l) { learning = learning === l.dataset.learn ? null : l.dataset.learn; syncDrawer(); return; }
      if (t.closest('[data-reset]')) { settings.keymap = Object.assign({}, DEF_KEYS); saveSettings(); syncDrawer(); toast('Botones restablecidos'); }
    };
    $('#bGear').onclick = () => { if (!drawer.innerHTML) buildDrawer(); else syncDrawer(); drawer.classList.toggle('open'); wake(); };

    // Controles
    $$('[data-h]', root).forEach((b) => holdable(b, () => { act(b.dataset.h); wake(); }));
    $('.pr-bottom', root).addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) act(b.dataset.a); });
    $('#bBack').onclick = () => go('library');
    $('#bConnect').onclick = showConnect;

    // Tocar = iniciar/pausar; arrastrar = mover el texto
    let drag = null;
    P.stage.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, p: P.progress, moved: false }; P.stage.setPointerCapture(e.pointerId); });
    P.stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dy) < 12) return;
      drag.moved = true;
      P.setProgress(drag.p - (dy * (settings.flipV ? -1 : 1)) / P.contentH);
    });
    const end = (e) => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      if (drawer.classList.contains('open')) { drawer.classList.remove('open'); learning = null; wake(); return; }
      if (!moved && e.type === 'pointerup') act('toggle');
    };
    P.stage.addEventListener('pointerup', end);
    P.stage.addEventListener('pointercancel', end);
    root.addEventListener('wheel', (e) => { if (!e.target.closest('.drawer')) P.setProgress(P.progress + e.deltaY / P.contentH); }, { passive: true });
    root.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wake(); });

    view.onKey = (name, repeat) => {
      if (learning) {
        if (repeat) return true;
        settings.keymap[name] = learning;
        toast('«' + keyLabel(name) + '» asignado');
        learning = null;
        saveSettings();
        syncDrawer();
        return true;
      }
      const a = settings.keymap[name];
      if (!a) return false;
      if (repeat && ['toggle', 'restart', 'mirror', 'exit'].includes(a)) return true;
      act(a);
      return true;
    };
    view.back = () => {
      if (drawer.classList.contains('open')) { drawer.classList.remove('open'); learning = null; } else go('library');
      return 'ok';
    };
    view.pause = () => P.pause();
    on('cmd', (m) => { act(m.a, m.v); wake(); });
    on('peers', () => push(true));
    on('scripts', async (m) => {
      if (m.id !== p.id) return;
      const s = await Store.get(p.id);
      if (s && view.name === 'prompter') { script = s; $('#pTitle').textContent = s.title; P.setText(s.text); push(true); }
    });
    const iv = setInterval(() => { refresh(); if (P.playing) push(false); }, 250);
    view.destroy = () => { clearInterval(iv); clearTimeout(hudT); P.destroy(); };

    try { script = await Store.get(p.id); } catch (e) { toast(e.message); }
    if (view.name !== 'prompter') return;
    if (!script) { go('library'); return; }
    $('#pTitle').textContent = script.title;
    P.setText(script.text || 'Este guion está vacío. Vuelve y escribe tu texto.');
    refresh();
    push(true);
    wake();
  };

  // ---- Control remoto (celular / computador)
  VIEWS.control = function () {
    app.innerHTML =
      '<div class="bar">' + brand + '<div class="grow"></div>' + linkPill() + '</div>' +
      '<div class="remote"><div class="r-now"><div class="t" id="rTitle"></div><div class="r-clock"><b id="rEl">00:00</b><span id="rRem"></span></div>' +
      '<input type="range" id="rSeek" min="0" max="1000" value="0" aria-label="Posición en el guion"></div>' +
      '<button class="r-play" id="rPlay"></button>' +
      '<div class="r-grid"><button class="btn" data-a="restart">' + ic('restart') + 'Inicio</button><button class="btn" data-h="back">' + ic('up') + 'Retroceder</button><button class="btn" data-h="forward">' + ic('down') + 'Avanzar</button></div>' +
      '<div class="r-step"><button class="btn" data-h="speedDown" aria-label="Menos velocidad">−</button><div class="val"><b id="rSpeed">–</b><small>Velocidad</small></div><button class="btn" data-h="speedUp" aria-label="Más velocidad">+</button></div>' +
      '<div class="r-step"><button class="btn" data-h="sizeDown" aria-label="Texto más pequeño">−</button><div class="val"><b id="rSize">–</b><small>Tamaño del texto</small></div><button class="btn" data-h="sizeUp" aria-label="Texto más grande">+</button></div>' +
      '<div class="r-grid"><button class="btn" data-a="mirror" id="rMirror">' + ic('mirror') + 'Espejo</button><button class="btn" data-a="flipV" id="rFlip">' + ic('flipv') + 'Voltear</button><button class="btn" data-a="exit">' + ic('x') + 'Cerrar guion</button></div></div>';
    tabs('control');
    const rm = $('.remote');
    let seeking = false, local = null;
    const render = () => {
      const st = lastState, inP = st.view === 'prompter', s = st.s || {};
      $('#rTitle').textContent = inP ? st.title : 'Ningún guion en pantalla';
      $('#rEl').textContent = inP ? fmt(st.elapsed) : '00:00';
      $('#rRem').textContent = inP ? 'faltan ' + fmt(st.remaining) : 'Abre uno desde «Guiones»';
      const pl = $('#rPlay');
      pl.className = 'r-play' + (st.playing ? ' pause' : '');
      pl.innerHTML = ic(st.playing ? 'pause' : 'play', 1) + (st.playing ? 'Pausar' : 'Iniciar');
      if (!local) { $('#rSpeed').textContent = inP ? s.speed : '–'; $('#rSize').textContent = inP ? s.size : '–'; }
      $('#rMirror').classList.toggle('on', !!s.mirror);
      $('#rFlip').classList.toggle('on', !!s.flipV);
      if (!seeking) $('#rSeek').value = Math.round((st.progress || 0) * 1000);
      $$('.remote .btn, #rPlay, #rSeek').forEach((b) => { b.disabled = !inP; });
    };
    render();
    const fire = (a) => { if (navigator.vibrate) navigator.vibrate(8); cmd(a); };
    $('#rPlay').onclick = () => fire('toggle');
    rm.addEventListener('click', (e) => { const b = e.target.closest('[data-a]'); if (b) fire(b.dataset.a); });
    $$('[data-h]', rm).forEach((b) => holdable(b, () => {
      const a = b.dataset.h, s = lastState.s;
      if (s && /^(speed|size)/.test(a)) {
        // respuesta inmediata en el número mientras llega la confirmación
        const k = a.startsWith('speed') ? 'speed' : 'size', d = (a.endsWith('Up') ? 1 : -1) * (k === 'size' ? 2 : 1);
        s[k] = clamp(s[k] + d, LIMITS[k][0], LIMITS[k][1]);
        $(k === 'speed' ? '#rSpeed' : '#rSize').textContent = s[k];
      }
      cmd(a);
    }));
    const seek = $('#rSeek');
    seek.oninput = () => { seeking = true; cmd('seek', seek.value / 1000); };
    seek.onchange = () => { setTimeout(() => { seeking = false; }, 400); };
    view.onKey = (name, repeat) => {
      const a = DEF_KEYS[name];
      if (!a || (repeat && ['toggle', 'restart', 'mirror', 'exit'].includes(a))) return !!a;
      cmd(a);
      return true;
    };
    on('state', render);
    on('link', refreshLink);
  };

  // ---- Segunda pantalla (TV, monitor u otro dispositivo)
  VIEWS.mirror = function () {
    app.innerHTML = '<div class="prompter" id="pr"><div class="m-hud"><button class="btn small" id="mMirror">' + ic('mirror') + 'Espejo</button><button class="btn small icon" id="mFlip" aria-label="Voltear">' + ic('flipv') + '</button>' +
      '<button class="btn small icon" id="mFull" aria-label="Pantalla completa">' + ic('full') + '</button><button class="btn small icon" id="mExit" aria-label="Salir">' + ic('x') + '</button></div><div class="pr-wait" id="wait"></div></div>';
    const root = $('#pr'), wait = $('#wait');
    const P = new Prompter(root, { follower: true });
    const loc = { mirror: false, flipV: false };
    let curId = null, hudT;
    const wake = () => { root.classList.remove('hud-off'); clearTimeout(hudT); hudT = setTimeout(() => root.classList.add('hud-off'), 3000); };
    const applyS = () => { if (lastState.s) P.apply(Object.assign({}, DEF, lastState.s, loc)); };
    const loadText = async () => { const s = await Store.get(curId).catch(() => null); if (s) P.setText(s.text); };
    const render = async () => {
      const st = lastState;
      if (st.view !== 'prompter') {
        wait.style.display = '';
        wait.innerHTML = '<div><b style="color:#fff;font-size:26px">Segunda pantalla lista</b><br><br>' + (online ? 'Esperando a que se abra un guion en la tableta…' : 'Sin conexión con la tableta. Reintentando…') + '</div>';
        P.playing = false;
        return;
      }
      wait.style.display = 'none';
      applyS();
      if (st.scriptId !== curId) { curId = st.scriptId; await loadText(); }
      P.sync(lastState);
    };
    render();
    wake();
    root.addEventListener('pointerdown', wake);
    root.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wake(); });
    $('#mMirror').onclick = () => { loc.mirror = !loc.mirror; $('#mMirror').classList.toggle('primary', loc.mirror); applyS(); };
    $('#mFlip').onclick = () => { loc.flipV = !loc.flipV; $('#mFlip').classList.toggle('primary', loc.flipV); applyS(); };
    $('#mFull').onclick = () => { const d = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else if (d.requestFullscreen) d.requestFullscreen().catch(() => {}); else toast('Usa «Añadir a pantalla de inicio» para verlo a pantalla completa', 4000); };
    $('#mExit').onclick = () => { location.href = '/?role=remote' + (pin ? '&k=' + encodeURIComponent(pin) : ''); };
    on('state', render);
    on('link', render);
    on('scripts', (m) => { if (m.id === curId) loadText(); });
    view.destroy = () => P.destroy();
  };

  // ---- PIN
  VIEWS.pin = function (p) {
    app.innerHTML = '<div class="bar">' + brand + '</div><div class="pin"><form><h2 style="margin:0">Conectar con la tableta</h2><p class="sub" style="margin:0;color:var(--muted)">Escribe el PIN de 6 dígitos que aparece en la tableta, en «Control remoto».</p>' +
      '<input class="field" id="pinIn" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="••••••"><button class="btn primary" type="submit">Conectar</button>' +
      (p.bad ? '<p style="color:var(--danger);margin:0">PIN incorrecto. Inténtalo de nuevo.</p>' : '') + '</form></div>';
    $('form', app).onsubmit = (e) => { e.preventDefault(); pin = $('#pinIn').value.trim(); boot(); };
    $('#pinIn').focus();
  };

  // ---- Ventana de conexión
  async function showConnect() {
    let info;
    try { info = await (await fetch(url('/api/info'))).json(); } catch (e) { toast('No se pudo obtener la dirección'); return; }
    const ips = info.ips || [];
    let ip = ips[0];
    const draw = () => {
      const base = 'http://' + ip + ':' + info.port + '/';
      const full = base + '?k=' + info.pin;
      const d = modal(!ip
        ? '<h2>Control remoto</h2><p class="sub">La tableta no está conectada a ninguna red. Conéctala al mismo Wi‑Fi que tu celular, o activa la zona Wi‑Fi (hotspot) del celular y conecta la tableta a ella. No hace falta internet.</p><div class="foot"><button class="btn primary" data-x>Entendido</button></div>'
        : '<h2>Control remoto y segunda pantalla</h2><p class="sub">Funciona en Android, iPhone y computador, desde el navegador y sin instalar nada.</p><div class="connect"><div class="qr">' + QR.svg(full) + '</div><div>' +
          '<ol class="steps"><li><div>Conecta el celular al <b>mismo Wi‑Fi</b> que la tableta (o conecta la tableta a la zona Wi‑Fi del celular).</div></li>' +
          '<li><div>Escanea el código con la cámara del celular.</div></li>' +
          '<li><div>En un computador o TV, escribe esta dirección en el navegador:<div class="addr">' + esc(base) + '</div>y usa el PIN <b style="color:var(--accent);font-size:19px;letter-spacing:.12em">' + info.pin + '</b></div></li>' +
          '<li><div>Para ver el texto en otra pantalla (TV, monitor), abre la pestaña <b>Pantalla</b> en ese dispositivo.</div></li></ol>' +
          (ips.length > 1 ? '<p class="hint" style="margin-top:14px">Redes disponibles: ' + ips.map((a) => '<button class="btn small' + (a === ip ? ' primary' : '') + '" data-ip="' + a + '">' + a + '</button>').join(' ') + '</p>' : '') +
          '</div></div><div class="foot"><span class="pill grow" style="justify-content:flex-start;border:0;background:none"><span class="dot ' + (peers ? 'on' : '') + '"></span>' + (peers ? peers + ' dispositivo(s) conectado(s)' : 'Esperando conexión…') + '</span><button class="btn primary" data-x>Listo</button></div>');
      d.onclick = (e) => {
        if (e.target.closest('[data-x]')) closeModal();
        const b = e.target.closest('[data-ip]');
        if (b) { ip = b.dataset.ip; draw(); }
      };
    };
    draw();
  }

  // ------------------------------------------------------------ teclas y sistema
  window.onNativeKey = (name, repeat) => { if (view.onKey) view.onKey(name, repeat); };
  window.onNativeBack = () => {
    if ($('#modal').innerHTML) { closeModal(); return 'ok'; }
    return view.back ? view.back() : 'exit';
  };
  window.onNativePause = () => { if (view.pause) view.pause(); };
  document.addEventListener('keydown', (e) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (view.onKey && view.onKey(domKeyName(e), e.repeat)) e.preventDefault();
  });
  document.addEventListener('contextmenu', (e) => { if (!/^(INPUT|TEXTAREA)$/.test(e.target.tagName)) e.preventDefault(); });

  // ---------------------------------------------------------------------- inicio
  async function boot() {
    try {
      const r = await fetch(url('/api/info'));
      if (r.status === 403) { go('pin', { bad: !!pin }); return; }
      const info = await r.json();
      peers = info.peers || 0;
    } catch (e) {
      app.innerHTML = '<div class="pin"><div style="text-align:center;color:var(--muted)"><h2 style="color:var(--text)">Sin conexión con la tableta</h2><p>Comprueba que TelePro esté abierto en la tableta y que ambos dispositivos estén en la misma red Wi‑Fi.</p><button class="btn primary" onclick="location.reload()">Reintentar</button></div></div>';
      return;
    }
    try { if (pin) localStorage.setItem('telepro_k', pin); } catch (e) { /* sin almacenamiento */ }
    if (role === 'display') {
      try {
        const s = await kvGet('settings');
        if (s) { settings = Object.assign({}, DEF, s); settings.keymap = Object.assign({}, s.keymap || DEF_KEYS); }
      } catch (e) { /* ajustes por defecto */ }
    }
    connect();
    go(role === 'mirror' ? 'mirror' : role === 'remote' ? 'control' : 'library');
  }
  boot();
})();
