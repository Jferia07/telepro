/* Generador de códigos QR (modo byte, corrección L, versiones 1–10). Sin dependencias. */
(function () {
  const ECC_LEN = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
  const BLOCKS = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4];

  function rawModules(v) {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const n = Math.floor(v / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  }
  function mul(x, y) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xff;
  }
  function divisor(deg) {
    const res = new Array(deg).fill(0);
    res[deg - 1] = 1;
    let root = 1;
    for (let i = 0; i < deg; i++) {
      for (let j = 0; j < deg; j++) {
        res[j] = mul(res[j], root);
        if (j + 1 < deg) res[j] ^= res[j + 1];
      }
      root = mul(root, 2);
    }
    return res;
  }
  function remainder(data, div) {
    const res = new Array(div.length).fill(0);
    for (const b of data) {
      const f = b ^ res.shift();
      res.push(0);
      div.forEach((c, i) => (res[i] ^= mul(c, f)));
    }
    return res;
  }

  function matrix(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let v = 0, dataLen = 0;
    for (let i = 1; i <= 10; i++) {
      const cap = Math.floor(rawModules(i) / 8) - ECC_LEN[i] * BLOCKS[i];
      const need = 4 + (i < 10 ? 8 : 16) + bytes.length * 8;
      if (need <= cap * 8) { v = i; dataLen = cap; break; }
    }
    if (!v) throw new Error('Texto demasiado largo para el QR');

    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4);
    push(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach((b) => push(b, 8));
    push(0, Math.min(4, dataLen * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    for (let pad = 0xec; bits.length < dataLen * 8; pad ^= 0xec ^ 0x11) push(pad, 8);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }

    const nb = BLOCKS[v], el = ECC_LEN[v];
    const rawCw = Math.floor(rawModules(v) / 8);
    const nShort = nb - (rawCw % nb);
    const shortLen = Math.floor(rawCw / nb);
    const div = divisor(el);
    const blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const dat = data.slice(k, k + shortLen - el + (i < nShort ? 0 : 1));
      k += dat.length;
      const ecc = remainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    const all = [];
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((b, j) => { if (i !== shortLen - el || j >= nShort) all.push(b[i]); });
    }

    const size = v * 4 + 17;
    const m = [], fn = [];
    for (let y = 0; y < size; y++) { m.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }
    const set = (x, y, d) => { m[y][x] = !!d; fn[y][x] = true; };

    for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => {
      for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
      }
    };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    let pos = [];
    if (v > 1) {
      const n = Math.floor(v / 7) + 2;
      const step = Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2;
      pos = [6];
      for (let p = size - 7; pos.length < n; p -= step) pos.splice(1, 0, p);
    }
    const na = pos.length;
    for (let i = 0; i < na; i++) for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
        set(pos[i] + dx, pos[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

    const mask = 0;
    const fdata = (1 << 3) | mask; // nivel L
    let rem = fdata;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fb = ((fdata << 10) | rem) ^ 0x5412;
    const bit = (i) => ((fb >>> i) & 1) !== 0;
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);

    if (v >= 7) {
      let r = v;
      for (let i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1f25);
      const vb = (v << 12) | r;
      for (let i = 0; i < 18; i++) {
        const b = ((vb >>> i) & 1) !== 0, a = size - 11 + (i % 3), c = Math.floor(i / 3);
        set(a, c, b); set(c, a, b);
      }
    }

    let i = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j;
        const up = ((right + 1) & 2) === 0;
        const y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && i < all.length * 8) {
          m[y][x] = ((all[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++)
      if (!fn[y][x] && (x + y) % 2 === 0) m[y][x] = !m[y][x];
    return m;
  }

  function svg(text) {
    const m = matrix(text), n = m.length, q = 4;
    let d = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (m[y][x]) d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z';
    const s = n + q * 2;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + s + ' ' + s + '" shape-rendering="crispEdges">' +
      '<rect width="' + s + '" height="' + s + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  window.QR = { matrix, svg };
})();
