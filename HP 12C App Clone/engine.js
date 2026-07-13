/* HP-12C calculator engine — pure logic, no DOM.
   Works in browser (window.HP12C) and Node (module.exports). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HP12C = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX = 9.999999999e99;

  // Two-digit program keycodes (row/column). Digits display as themselves.
  var KEYCODE = {
    n: '11', i: '12', pv: '13', pmt: '14', fv: '15', chs: '16', d7: '7', d8: '8', d9: '9', div: '10',
    ytox: '21', recip: '22', pctT: '23', dpct: '24', pct: '25', eex: '26', d4: '4', d5: '5', d6: '6', mul: '20',
    rs: '31', sst: '32', rdn: '33', xy: '34', clx: '35', enter: '36', d1: '1', d2: '2', d3: '3', sub: '30',
    on: '41', f: '42', g: '43', sto: '44', rcl: '45', d0: '0', dot: '48', sigma: '49', add: '40'
  };

  var DIGIT_IDS = { d0: 0, d1: 1, d2: 2, d3: 3, d4: 4, d5: 5, d6: 6, d7: 7, d8: 8, d9: 9 };
  var TVM_IDS = { n: 'n', i: 'i', pv: 'pv', pmt: 'pmt', fv: 'fv' };
  var OP_IDS = { add: '+', sub: '-', mul: '*', div: '/' };

  function HP12C() { this.powerReset(); }

  HP12C.prototype.powerReset = function () {
    this.stk = [0, 0, 0, 0];          // x, y, z, t
    this.lastX = 0;
    this.reg = new Array(20).fill(0); // R0-R9, R.0-R.9
    this.fin = { n: 0, i: 0, pv: 0, pmt: 0, fv: 0 };
    this.cf = [0]; this.nj = [1];
    this.begin = false; this.dmy = false; this.cOdd = false; this.comma = false;
    this.fix = 2; this.sci = false;
    this.entry = null;                // {mant, neg, exp, expNeg} while typing
    this.stackLift = false;
    this.numberPending = false;       // decides store-vs-compute on TVM keys
    this.seq = [];                    // prefix key buffer
    this.error = null;
    this.off = false;
    this.special = null;              // temporary alt display {text, sticky}
    this.prgmMode = false;
    this.prog = [];                   // array of token arrays, max 99
    this.pc = 0;                      // 1-based line of NEXT instruction; 0 = top
    this.running = false;
    this.executing = false;           // true while replaying program tokens
  };

  /* ---------------- helpers ---------------- */

  HP12C.prototype.x = function () { return this.stk[0]; };
  HP12C.prototype.setX = function (v) { this.stk[0] = v; };

  HP12C.prototype.err = function (nr) { this.error = nr; this.entry = null; this.seq = []; this.running = false; return 'err'; };

  HP12C.prototype.lift = function () { // push stack, t lost
    this.stk = [this.stk[0], this.stk[0], this.stk[1], this.stk[2]];
  };
  HP12C.prototype.drop = function (v) { // binary op result
    this.stk = [v, this.stk[2], this.stk[3], this.stk[3]];
  };
  HP12C.prototype.pushResult = function (v) { // computed value enters X
    if (this.stackLift) this.lift();
    this.stk[0] = v; this.stackLift = true;
  };
  HP12C.prototype.chk = function (v, e) {
    if (!isFinite(v) || isNaN(v)) { this.err(e === undefined ? 0 : e); return null; }
    if (Math.abs(v) > MAX) { this.err(e === undefined ? 0 : e); return null; }
    return v;
  };

  HP12C.prototype.dispDecimals = function () {
    return this.sci ? 6 : this.fix;
  };
  HP12C.prototype.roundFix = function (v) {
    if (this.sci) { // round mantissa
      if (v === 0) return 0;
      var e = Math.floor(Math.log10(Math.abs(v)));
      var p = Math.pow(10, 6 - e);
      return Math.round(v * p) / p;
    }
    var f = Math.pow(10, this.fix);
    return Math.round(v * f) / f;
  };

  /* ---------------- number entry ---------------- */

  HP12C.prototype.beginEntry = function () {
    if (this.stackLift) this.lift();
    this.stackLift = true;
    this.entry = { mant: '', neg: false, exp: null, expNeg: false };
  };
  HP12C.prototype.entryValue = function () {
    var e = this.entry;
    var m = e.mant === '' || e.mant === '.' ? '0' : e.mant;
    var v = parseFloat(m) * (e.neg ? -1 : 1);
    if (e.exp !== null) {
      var ex = parseInt(e.exp === '' ? '0' : e.exp, 10) * (e.expNeg ? -1 : 1);
      v = v * Math.pow(10, ex);
    }
    return v;
  };
  HP12C.prototype.endEntry = function () {
    if (this.entry) { this.stk[0] = this.entryValue(); this.entry = null; }
  };

  HP12C.prototype.digitIn = function (d) {
    if (!this.entry) this.beginEntry();
    var e = this.entry;
    if (e.exp !== null) { e.exp = (e.exp + d).slice(-2); }
    else {
      var digits = e.mant.replace(/\./g, '');
      if (digits.length >= 10) return;
      e.mant += d;
    }
    this.stk[0] = this.entryValue();
    this.numberPending = true;
  };
  HP12C.prototype.dotIn = function () {
    if (!this.entry) this.beginEntry();
    var e = this.entry;
    if (e.exp === null && e.mant.indexOf('.') < 0) e.mant += e.mant === '' ? '0.' : '.';
    this.stk[0] = this.entryValue();
    this.numberPending = true;
  };
  HP12C.prototype.eexIn = function () {
    if (!this.entry) { this.beginEntry(); this.entry.mant = '1'; }
    if (this.entry.exp === null) this.entry.exp = '';
    this.stk[0] = this.entryValue();
    this.numberPending = true;
  };
  HP12C.prototype.chsIn = function () {
    if (this.entry) {
      if (this.entry.exp !== null) this.entry.expNeg = !this.entry.expNeg;
      else this.entry.neg = !this.entry.neg;
      this.stk[0] = this.entryValue();
    } else {
      if (this.stk[0] !== 0) this.stk[0] = -this.stk[0];
      this.numberPending = true;
    }
  };

  /* ---------------- TVM ---------------- */

  // 0 = pv*K + pmt*(1+iS)*(1-v^m)/i + fv*v^m   (i as decimal per period)
  HP12C.prototype.tvmParts = function (i) {
    var n = this.fin.n, m = Math.trunc(n), fp = n - m;
    var S = this.begin ? 1 : 0;
    var K, v, a;
    if (i === 0) return { K: 1, v: 1, a: m + fp, zero: true };
    K = fp === 0 ? 1 : (this.cOdd ? Math.pow(1 + i, fp) : 1 + i * fp);
    v = Math.pow(1 + i, -m);
    a = (1 + i * S) * (1 - v) / i;
    return { K: K, v: v, a: a, zero: false };
  };
  HP12C.prototype.tvmF = function (i) {
    var p = this.tvmParts(i);
    if (p.zero) return this.fin.pv + this.fin.pmt * p.a + this.fin.fv;
    return this.fin.pv * p.K + this.fin.pmt * p.a + this.fin.fv * p.v;
  };

  HP12C.prototype.tvmKey = function (which) {
    if (this.numberPending) {              // store
      this.endEntry();
      this.fin[which] = this.stk[0];
      this.numberPending = false;
      this.stackLift = true;
      return;
    }
    // compute
    var f = this.fin, i = f.i / 100, r, p;
    if (which === 'n') {
      if (i === 0) {
        if (f.pmt === 0) return this.err(5);
        r = -(f.pv + f.fv) / f.pmt;
      } else {
        var S = this.begin ? 1 : 0, A = f.pmt * (1 + i * S) / i;
        var num = -(f.pv + A), den = f.fv - A;
        if (den === 0 || num / den <= 0) return this.err(5);
        r = Math.log(num / den) / Math.log(1 / (1 + i));
      }
      if (this.chk(r, 5) === null) return;
      r = Math.ceil(r - 1e-9);
      f.n = r; this.pushResult(r); this.numberPending = false; return;
    }
    if (which === 'i') {
      var self = this;
      r = solveRoot(function (ii) { return self.tvmF(ii); }, -0.999999, 1e9, 0.01);
      if (r === null) return this.err(5);
      f.i = r * 100;
      if (this.chk(f.i, 5) === null) return;
      this.pushResult(f.i); this.numberPending = false; return;
    }
    p = this.tvmParts(i);
    if (which === 'pv') {
      r = p.zero ? -(f.pmt * p.a + f.fv) : -(f.pmt * p.a + f.fv * p.v) / p.K;
    } else if (which === 'pmt') {
      if (p.a === 0) return this.err(5);
      r = p.zero ? -(f.pv + f.fv) / p.a : -(f.pv * p.K + f.fv * p.v) / p.a;
    } else { // fv
      if (p.zero) r = -(f.pv + f.pmt * p.a);
      else { if (p.v === 0) return this.err(5); r = -(f.pv * p.K + f.pmt * p.a) / p.v; }
    }
    if (this.chk(r, 5) === null) return;
    f[which] = r; this.pushResult(r); this.numberPending = false;
  };

  HP12C.prototype.amort = function () {
    this.endEntry();
    var count = Math.trunc(Math.abs(this.stk[0]));
    if (count < 1) return this.err(5);
    var i = this.fin.i / 100, pv = this.fin.pv, pmt = this.fin.pmt;
    var sgn = pmt !== 0 ? (pmt < 0 ? -1 : 1) : 1;
    var totI = 0, totP = 0, k, intk, prink;
    for (k = 1; k <= count; k++) {
      if (this.begin && this.fin.n === 0 && k === 1) intk = 0;
      else intk = Math.abs(this.roundFix(pv * i)) * sgn;
      prink = pmt - intk;
      pv = pv + prink;
      totI += intk; totP += prink;
    }
    this.lastX = this.stk[0];
    this.fin.n += count;
    this.fin.pv = pv;
    this.stk = [totI, totP, this.stk[1], this.stk[2]];
    this.stackLift = true; this.numberPending = false;
  };

  HP12C.prototype.simpleInt = function () {
    this.endEntry();
    var d = this.fin.n, r = this.fin.i / 100, pv = this.fin.pv;
    var i360 = -pv * r * d / 360, i365 = -pv * r * d / 365;
    if (this.chk(i360) === null) return;
    this.lastX = this.stk[0];
    this.stk = [i360, this.stk[1], i365, this.stk[3]];
    this.stackLift = true; this.numberPending = false;
  };

  /* ---------------- NPV / IRR ---------------- */

  HP12C.prototype.npvAt = function (r) {
    var sum = this.cf[0], t = 0, j, k;
    for (j = 1; j < this.cf.length; j++) {
      for (k = 0; k < this.nj[j]; k++) { t++; sum += this.cf[j] / Math.pow(1 + r, t); }
    }
    return sum;
  };
  HP12C.prototype.npv = function () {
    this.endEntry();
    var v = this.npvAt(this.fin.i / 100);
    if (this.chk(v) === null) return;
    this.lastX = this.stk[0];
    this.pushResult(v); this.numberPending = false;
  };
  HP12C.prototype.irr = function () {
    this.endEntry();
    var pos = false, neg = false, j;
    for (j = 0; j < this.cf.length; j++) { if (this.cf[j] > 0) pos = true; if (this.cf[j] < 0) neg = true; }
    if (!pos || !neg) return this.err(3);
    var self = this;
    var r = solveRoot(function (rr) { return self.npvAt(rr); }, -0.999999, 1e6, 0.1);
    if (r === null) return this.err(3);
    this.fin.i = r * 100;
    this.lastX = this.stk[0];
    this.pushResult(r * 100); this.numberPending = false;
  };

  /* ---------------- dates ---------------- */

  HP12C.prototype.parseDate = function (v) {
    if (v < 0) return null;
    var t = Math.round(v * 1e6);
    var ip = Math.floor(t / 1e6), rest = t - ip * 1e6;
    var b = Math.floor(rest / 1e4), y = rest % 1e4;
    var m = this.dmy ? b : ip, d = this.dmy ? ip : b;
    if (y < 1582 || y > 9999 || m < 1 || m > 12 || d < 1) return null;
    if (d > daysInMonth(y, m)) return null;
    return { y: y, m: m, d: d };
  };
  HP12C.prototype.dateToNum = function (dt) {
    var a = this.dmy ? dt.d : dt.m, b = this.dmy ? dt.m : dt.d;
    return a + b / 100 + dt.y / 1e6;
  };

  HP12C.prototype.dateAdd = function () {
    this.endEntry();
    var d1 = this.parseDate(this.stk[1]);
    if (!d1) return this.err(8);
    var days = Math.round(this.stk[0]);
    var jd = jdn(d1.y, d1.m, d1.d) + days;
    var dt = fromJdn(jd);
    if (dt.y < 1582 || dt.y > 9999) return this.err(8);
    var wd = ((jd % 7) + 7) % 7 + 1;        // 1=Mon .. 7=Sun
    this.lastX = this.stk[0];
    var num = this.dateToNum(dt);
    this.drop(num);
    this.stackLift = true; this.numberPending = false;
    var txt = (this.dmy ? dt.d : dt.m) + '.' +
      pad2(this.dmy ? dt.m : dt.d) + '.' + String(dt.y);
    this.special = { text: txt + '  ' + wd, sticky: true };
  };

  HP12C.prototype.deltaDays = function () {
    this.endEntry();
    var a = this.parseDate(this.stk[1]), b = this.parseDate(this.stk[0]);
    if (!a || !b) return this.err(8);
    var act = jdn(b.y, b.m, b.d) - jdn(a.y, a.m, a.d);
    var z1 = a.d === 31 ? 30 : a.d;
    var z2 = (b.d === 31 && a.d >= 30) ? 30 : b.d;
    var d360 = 360 * (b.y - a.y) + 30 * (b.m - a.m) + (z2 - z1);
    this.lastX = this.stk[0];
    this.stk = [act, d360, this.stk[2], this.stk[3]];
    this.stackLift = true; this.numberPending = false;
  };

  /* ---------------- bonds (semiannual, actual/actual) ---------------- */

  HP12C.prototype.bondData = function () {
    var settle = this.parseDate(this.stk[1]), mat = this.parseDate(this.stk[0]);
    if (!settle || !mat) return null;
    var js = jdn(settle.y, settle.m, settle.d), jm = jdn(mat.y, mat.m, mat.d);
    if (jm <= js) return null;
    // step back from maturity by 6 months to bracket settlement
    var k = 0, prev, next;
    for (k = 0; k < 2000; k++) {
      var c1 = addMonths(mat, -6 * (k + 1)), c0 = addMonths(mat, -6 * k);
      var j1 = jdn(c1.y, c1.m, c1.d), j0 = jdn(c0.y, c0.m, c0.d);
      if (j1 <= js && js < j0) { prev = { jd: j1 }; next = { jd: j0 }; break; }
      if (j1 > js) continue; else break;
    }
    if (!prev) return null;
    var N = k + 1;                       // coupons remaining incl. maturity
    var E = next.jd - prev.jd, DSC = next.jd - js, A = js - prev.jd;
    return { N: N, E: E, DSC: DSC, A: A };
  };
  HP12C.prototype.bondPriceAt = function (yld, b) {
    var y = yld / 200, c = this.fin.pmt / 2;
    if (b.N === 1) {
      return (100 + c) / (1 + (b.DSC / b.E) * y) - c * (b.A / b.E);
    }
    var q = b.DSC / b.E, p = 100 / Math.pow(1 + y, b.N - 1 + q), kk;
    for (kk = 1; kk <= b.N; kk++) p += c / Math.pow(1 + y, kk - 1 + q);
    return p - c * (b.A / b.E);
  };
  HP12C.prototype.bondPrice = function () {
    this.endEntry();
    var b = this.bondData();
    if (!b) return this.err(8);
    var p = this.bondPriceAt(this.fin.i, b);
    if (this.chk(p) === null) return;
    var acc = (this.fin.pmt / 2) * (b.A / b.E);
    this.lastX = this.stk[0];
    this.fin.pv = p;
    this.stk = [p, acc, this.stk[2], this.stk[3]];
    this.stackLift = true; this.numberPending = false;
  };
  HP12C.prototype.bondYtm = function () {
    this.endEntry();
    var b = this.bondData();
    if (!b) return this.err(8);
    var self = this, target = this.fin.pv;
    var r = solveRoot(function (yy) { return self.bondPriceAt(yy, b) - target; }, -99, 1e5, 5);
    if (r === null) return this.err(5);
    this.fin.i = r;
    this.lastX = this.stk[0];
    this.stk = [r, this.stk[1], this.stk[2], this.stk[3]];
    this.stackLift = true; this.numberPending = false;
  };

  /* ---------------- depreciation ---------------- */

  HP12C.prototype.deprec = function (kind) {
    this.endEntry();
    var j = Math.trunc(this.stk[0]);
    var n = this.fin.n, cost = this.fin.pv, sal = this.fin.fv;
    if (j < 1 || n <= 0 || j > n) return this.err(5);
    var depTotal = cost - sal, dep = 0, remaining = 0, k, bv;
    if (kind === 'sl') {
      dep = depTotal / n;
      remaining = depTotal - dep * j;
    } else if (kind === 'soyd') {
      var S = n * (n + 1) / 2, used = 0;
      for (k = 1; k <= j; k++) used += (n - k + 1) / S * depTotal;
      dep = (n - j + 1) / S * depTotal;
      remaining = depTotal - used;
    } else { // db — declining balance, factor % in i
      var rate = (this.fin.i / 100) / n;
      bv = cost;
      for (k = 1; k <= j; k++) {
        dep = bv * rate;
        if (bv - dep < sal) dep = bv - sal;
        bv -= dep;
      }
      remaining = bv - sal;
    }
    if (this.chk(dep) === null) return;
    this.lastX = this.stk[0];
    this.stk = [dep, remaining, this.stk[1], this.stk[2]];
    this.stackLift = true; this.numberPending = false;
  };

  /* ---------------- statistics (R1..R6) ---------------- */

  HP12C.prototype.sigma = function (dir) {
    this.endEntry();
    var x = this.stk[0], y = this.stk[1];
    this.lastX = x;
    this.reg[1] += dir; this.reg[2] += dir * x; this.reg[3] += dir * x * x;
    this.reg[4] += dir * y; this.reg[5] += dir * y * y; this.reg[6] += dir * x * y;
    this.stk[0] = this.reg[1];
    this.stackLift = false; this.numberPending = true;
  };
  HP12C.prototype.statN = function () { return this.reg[1]; };
  HP12C.prototype.mean = function () {
    var n = this.reg[1];
    if (n === 0) return this.err(2);
    this.endEntry(); this.lastX = this.stk[0];
    var mx = this.reg[2] / n, my = this.reg[4] / n;
    if (this.stackLift) this.lift();
    this.stk[0] = mx; this.stk[1] = my;
    this.stackLift = true; this.numberPending = true;
  };
  HP12C.prototype.stdev = function () {
    var n = this.reg[1];
    if (n < 2) return this.err(2);
    this.endEntry(); this.lastX = this.stk[0];
    var sx = Math.sqrt((n * this.reg[3] - this.reg[2] * this.reg[2]) / (n * (n - 1)));
    var sy = Math.sqrt((n * this.reg[5] - this.reg[4] * this.reg[4]) / (n * (n - 1)));
    if (this.stackLift) this.lift();
    this.stk[0] = sx; this.stk[1] = sy;
    this.stackLift = true; this.numberPending = true;
  };
  HP12C.prototype.wmean = function () {
    if (this.reg[2] === 0) return this.err(2);
    this.endEntry(); this.lastX = this.stk[0];
    var v = this.reg[6] / this.reg[2];
    this.pushResult(v); this.numberPending = true;
  };
  HP12C.prototype.linReg = function () {
    var n = this.reg[1];
    var den = n * this.reg[3] - this.reg[2] * this.reg[2];
    if (n < 2 || den === 0) return null;
    var B = (n * this.reg[6] - this.reg[2] * this.reg[4]) / den;
    var A = (this.reg[4] - B * this.reg[2]) / n;
    var dy = n * this.reg[5] - this.reg[4] * this.reg[4];
    var r = dy <= 0 ? 0 : (n * this.reg[6] - this.reg[2] * this.reg[4]) / Math.sqrt(den * dy);
    return { A: A, B: B, r: r };
  };
  HP12C.prototype.estimate = function (which) {
    var lr = this.linReg();
    if (!lr) return this.err(2);
    this.endEntry(); this.lastX = this.stk[0];
    var v;
    if (which === 'y') v = lr.A + lr.B * this.stk[0];
    else { if (lr.B === 0) return this.err(2); v = (this.stk[0] - lr.A) / lr.B; }
    this.stk[0] = v; this.stk[1] = lr.r;
    this.stackLift = true; this.numberPending = true;
  };

  /* ---------------- unary / binary math ---------------- */

  HP12C.prototype.unary = function (fn, edom) {
    this.endEntry();
    var v = fn(this.stk[0]);
    if (this.chk(v, edom) === null) return;
    this.lastX = this.stk[0];
    this.stk[0] = v;
    this.stackLift = true; this.numberPending = true;
  };
  HP12C.prototype.binary = function (op) {
    this.endEntry();
    var x = this.stk[0], y = this.stk[1], v;
    if (op === '+') v = y + x;
    else if (op === '-') v = y - x;
    else if (op === '*') v = y * x;
    else if (op === '/') { if (x === 0) return this.err(0); v = y / x; }
    else if (op === 'pow') v = Math.pow(y, x);
    if (this.chk(v) === null) return;
    this.lastX = x;
    this.drop(v);
    this.stackLift = true; this.numberPending = true;
  };
  HP12C.prototype.pctOp = function (kind) {
    this.endEntry();
    var x = this.stk[0], y = this.stk[1], v;
    if (kind === 'pct') v = y * x / 100;
    else if (kind === 'dpct') { if (y === 0) return this.err(0); v = (x - y) / y * 100; }
    else { if (y === 0) return this.err(0); v = x / y * 100; }
    if (this.chk(v) === null) return;
    this.lastX = x;
    this.stk[0] = v;                       // y preserved
    this.stackLift = true; this.numberPending = true;
  };

  /* ---------------- STO / RCL ---------------- */

  HP12C.prototype.regIndex = function (tokens, from) {
    // tokens like ['d5'] or ['dot','d3'] starting at index `from`
    if (tokens[from] === 'dot') return 10 + DIGIT_IDS[tokens[from + 1]];
    return DIGIT_IDS[tokens[from]];
  };
  HP12C.prototype.doSto = function (tokens) {
    this.endEntry();
    var x = this.stk[0], t1 = tokens[1];
    if (t1 === 'eex') { this.cOdd = !this.cOdd; return; }
    if (TVM_IDS[t1]) { this.fin[t1] = x; this.numberPending = false; this.stackLift = true; return; }
    if (OP_IDS[t1]) {
      var idx = this.regIndex(tokens, 2), cur = this.reg[idx], v;
      var op = OP_IDS[t1];
      if (op === '+') v = cur + x; else if (op === '-') v = cur - x;
      else if (op === '*') v = cur * x;
      else { if (x === 0) return this.err(1); v = cur / x; }
      if (!isFinite(v) || Math.abs(v) > MAX) return this.err(1);
      this.reg[idx] = v;
    } else {
      this.reg[this.regIndex(tokens, 1)] = x;
    }
    this.stackLift = true;
  };
  HP12C.prototype.doRcl = function (tokens) {
    this.endEntry();
    var t1 = tokens[1], v;
    if (TVM_IDS[t1]) v = this.fin[t1];
    else v = this.reg[this.regIndex(tokens, 1)];
    this.pushResult(v);
    this.numberPending = true;
  };

  /* ---------------- key sequence builder ---------------- */
  // feed(id) accumulates prefix sequences; returns a complete token array or null.

  HP12C.prototype.feed = function (id) {
    var s = this.seq;
    if (s.length === 0) {
      if (id === 'f' || id === 'g' || id === 'sto' || id === 'rcl') { s.push(id); return null; }
      return [id];
    }
    var head = s[0];
    if (id === 'f' || id === 'g') {                    // new shift replaces pending prefix
      this.seq = [id]; return null;
    }
    if (head === 'f') {
      if (id === 'sto' || id === 'rcl') { this.seq = [id]; return null; }
      s.push(id); this.seq = []; return s;
    }
    if (head === 'g') {
      if (s.length === 1 && id === 'rdn') { s.push(id); return null; }   // GTO — needs target
      if (s.length >= 2 && s[1] === 'rdn') {           // collecting GTO target
        if (id === 'dot' && s.length === 2) { s.push(id); return null; }
        if (DIGIT_IDS[id] !== undefined) {
          s.push(id);
          var need = s[2] === 'dot' ? 5 : 4;
          if (s.length === need) { this.seq = []; return s; }
          return null;
        }
        this.seq = []; return ['noop'];
      }
      if (id === 'sto' || id === 'rcl') { this.seq = [id]; return null; }
      s.push(id); this.seq = []; return s;
    }
    if (head === 'sto' || head === 'rcl') {
      if (DIGIT_IDS[id] !== undefined) {
        s.push(id);
        // complete unless we're waiting after 'dot' or an operator
        this.seq = []; return s;
      }
      if (id === 'dot') {
        s.push(id); return null;                        // need one digit
      }
      if (head === 'sto' && OP_IDS[id] && s.length === 1) { s.push(id); return null; }
      if (TVM_IDS[id] && s.length === 1) { s.push(id); this.seq = []; return s; }
      if (id === 'eex' && head === 'sto' && s.length === 1) { s.push(id); this.seq = []; return s; }
      this.seq = []; return ['noop'];
    }
    this.seq = []; return [id];
  };

  // fix incomplete dot/operator sequences: digits after 'dot' handled above needs care
  // (handled in feed: after 'dot' push digit completes because DIGIT branch returns s)

  /* ---------------- main dispatch ---------------- */

  HP12C.prototype.press = function (id) {
    if (this.off) {
      if (id === 'on') { this.off = false; }
      else if (id === 'dot') { this.comma = !this.comma; }
      return;
    }
    if (id === 'on') { this.off = true; this.seq = []; return; }
    if (this.error !== null) { this.error = null; return; }   // any key clears error
    if (!this.executing) this.special = null;

    var tokens = this.feed(id);
    if (!tokens) return;
    if (tokens[0] === 'noop') return;

    // program-mode: record almost everything
    if (this.prgmMode && !this.executing) {
      var t0 = tokens[0], t1 = tokens[1];
      var immediate =
        (t0 === 'f' && (t1 === 'rs' || t1 === 'rdn')) ||   // P/R, CLEAR PRGM
        (t0 === 'g' && t1 === 'sst') ||                    // BST
        (t0 === 'g' && t1 === 'rdn' && tokens[2] === 'dot') || // GTO . nn
        (t0 === 'sst');
      if (!immediate) {
        if (this.prog.length >= 99) return this.err(4);
        this.prog.splice(this.pc, 0, tokens);
        this.pc++;
        return;
      }
    }
    return this.exec(tokens);
  };

  HP12C.prototype.exec = function (tokens) {
    var t0 = tokens[0], t1 = tokens[1];

    if (t0 === 'sto') return this.doSto(tokens);
    if (t0 === 'rcl') return this.doRcl(tokens);

    if (t0 === 'f') return this.execF(t1);
    if (t0 === 'g') return this.execG(tokens);

    // plain keys
    if (DIGIT_IDS[t0] !== undefined) return this.digitIn(String(DIGIT_IDS[t0]));
    switch (t0) {
      case 'dot': return this.dotIn();
      case 'eex': return this.eexIn();
      case 'chs': return this.chsIn();
      case 'enter':
        this.endEntry();
        this.lift();
        this.stackLift = false;
        this.numberPending = true;
        return;
      case 'clx':
        this.entry = null; this.stk[0] = 0;
        this.stackLift = false; this.numberPending = true;
        return;
      case 'xy':
        this.endEntry();
        var t = this.stk[0]; this.stk[0] = this.stk[1]; this.stk[1] = t;
        this.stackLift = true; this.numberPending = true;
        return;
      case 'rdn':
        this.endEntry();
        this.stk = [this.stk[1], this.stk[2], this.stk[3], this.stk[0]];
        this.stackLift = true; this.numberPending = true;
        return;
      case 'add': return this.binary('+');
      case 'sub': return this.binary('-');
      case 'mul': return this.binary('*');
      case 'div': return this.binary('/');
      case 'ytox': return this.binary('pow');
      case 'recip':
        return this.unary(function (x) { if (x === 0) return NaN; return 1 / x; });
      case 'pct': return this.pctOp('pct');
      case 'dpct': return this.pctOp('dpct');
      case 'pctT': return this.pctOp('pctT');
      case 'sigma': return this.sigma(1);
      case 'n': case 'i': case 'pv': case 'pmt': case 'fv':
        this.endEntry();
        return this.tvmKey(t0);
      case 'rs':
        if (this.prgmMode) return;               // recorded, not run
        return this.runProgram();
      case 'sst': return this.singleStep();
      default: return;
    }
  };

  HP12C.prototype.execF = function (k) {
    if (DIGIT_IDS[k] !== undefined) { this.endEntry(); this.fix = DIGIT_IDS[k]; this.sci = false; return; }
    switch (k) {
      case 'dot': this.endEntry(); this.sci = true; return;
      case 'n': return this.amort();
      case 'i': return this.simpleInt();
      case 'pv': return this.npv();
      case 'pmt': this.endEntry(); this.lastX = this.stk[0]; this.stk[0] = this.roundFix(this.stk[0]); this.stackLift = true; return;
      case 'fv': return this.irr();
      case 'ytox': return this.bondPrice();
      case 'recip': return this.bondYtm();
      case 'pctT': return this.deprec('sl');
      case 'dpct': return this.deprec('soyd');
      case 'pct': return this.deprec('db');
      case 'rs':                                   // P/R
        this.prgmMode = !this.prgmMode;
        if (!this.prgmMode) this.pc = 0;
        return;
      case 'sst':                                  // CLEAR Σ
        this.endEntry();
        var j; for (j = 1; j <= 6; j++) this.reg[j] = 0;
        this.stk = [0, 0, 0, 0]; this.stackLift = false;
        return;
      case 'rdn':                                  // CLEAR PRGM
        if (this.prgmMode) { this.prog = []; this.pc = 0; }
        else this.pc = 0;
        return;
      case 'xy':                                   // CLEAR FIN
        this.fin = { n: 0, i: 0, pv: 0, pmt: 0, fv: 0 };
        this.numberPending = this.numberPending; return;
      case 'clx':                                  // CLEAR REG
        this.reg = new Array(20).fill(0);
        this.fin = { n: 0, i: 0, pv: 0, pmt: 0, fv: 0 };
        this.cf = [0]; this.nj = [1];
        this.stk = [0, 0, 0, 0]; this.lastX = 0;
        this.entry = null; this.stackLift = false;
        return;
      case 'enter':                                // CLEAR PREFIX → show mantissa
        this.endEntry();
        this.special = { text: mantissaText(this.stk[0]), sticky: false };
        return;
      default: return;
    }
  };

  HP12C.prototype.execG = function (tokens) {
    var k = tokens[1];
    switch (k) {
      case 'n':   // 12×
        this.endEntry();
        this.stk[0] = this.stk[0] * 12; this.fin.n = this.stk[0];
        this.stackLift = true; this.numberPending = false; return;
      case 'i':   // 12÷
        this.endEntry();
        this.stk[0] = this.stk[0] / 12; this.fin.i = this.stk[0];
        this.stackLift = true; this.numberPending = false; return;
      case 'pv':  // CF0
        this.endEntry();
        this.cf = [this.stk[0]]; this.nj = [1]; this.fin.n = 0;
        this.reg[0] = this.stk[0];
        this.stackLift = true; this.numberPending = false; return;
      case 'pmt': // CFj
        this.endEntry();
        if (this.cf.length > 20) return this.err(6);
        this.cf.push(this.stk[0]); this.nj.push(1);
        this.fin.n = this.cf.length - 1;
        if (this.fin.n <= 9) this.reg[this.fin.n] = this.stk[0];
        this.stackLift = true; this.numberPending = false; return;
      case 'fv':  // Nj
        this.endEntry();
        var nv = this.stk[0];
        if (nv < 1 || nv > 99 || nv !== Math.trunc(nv)) return this.err(6);
        if (this.cf.length < 1) return this.err(6);
        this.nj[this.cf.length - 1] = nv;
        this.stackLift = true; this.numberPending = false; return;
      case 'chs': return this.dateAdd();
      case 'd7': this.begin = true; return;
      case 'd8': this.begin = false; return;
      case 'd9': // MEM
        this.special = { text: 'P-' + pad2(99 - this.prog.length) + '  r-.9', sticky: false };
        return;
      case 'ytox': return this.unary(function (x) { return x < 0 ? NaN : Math.sqrt(x); });
      case 'recip': return this.unary(function (x) { return Math.exp(x); });
      case 'pctT': return this.unary(function (x) { return x <= 0 ? NaN : Math.log(x); });
      case 'dpct': return this.unary(function (x) { return x - Math.trunc(x); });
      case 'pct': return this.unary(function (x) { return Math.trunc(x); });
      case 'eex': return this.deltaDays();
      case 'd4': this.dmy = true; return;
      case 'd5': this.dmy = false; return;
      case 'd6': return this.wmean();
      case 'mul': return this.unary(function (x) { return x * x; });
      case 'rs':  // PSE — meaningful inside programs; from keyboard shows X briefly
        return 'pause';
      case 'sst': // BST
        if (this.prgmMode) { this.pc = this.pc > 0 ? this.pc - 1 : this.prog.length; }
        else { this.pc = this.pc > 0 ? this.pc - 1 : 0; }
        return;
      case 'rdn': // GTO nn  or  GTO . nn
        var dotForm = tokens[2] === 'dot';
        var a = dotForm ? tokens[3] : tokens[2], b = dotForm ? tokens[4] : tokens[3];
        var line = DIGIT_IDS[a] * 10 + DIGIT_IDS[b];
        if (dotForm) { this.pc = Math.min(line, this.prog.length); return; }
        if (line > this.prog.length) return this.err(4);
        this.pc = line === 0 ? 0 : line - 1;   // next instruction executed is `line`
        if (this.running) { this.branched = true; if (line === 0) this.running = false; }
        return;
      case 'xy':  // x<=y test
        if (this.running) { if (!(this.stk[0] <= this.stk[1])) this.skipNext = true; }
        return;
      case 'clx': // x=0 test
        if (this.running) { if (this.stk[0] !== 0) this.skipNext = true; }
        return;
      case 'enter': // LSTx
        this.endEntry();
        this.pushResult(this.lastX);
        this.numberPending = true; return;
      case 'd1': return this.estimate('x');
      case 'd2': return this.estimate('y');
      case 'd3': return this.unary(function (x) {
        if (x < 0 || x !== Math.trunc(x)) return NaN;
        if (x > 69) return NaN;
        var r = 1, kk; for (kk = 2; kk <= x; kk++) r *= kk; return r;
      });
      case 'd0': return this.mean();
      case 'dot': return this.stdev();
      case 'sigma': return this.sigma(-1);
      default: return;
    }
  };

  /* ---------------- program execution ---------------- */

  HP12C.prototype.runProgram = function () {
    if (this.prog.length === 0) return;
    this.endEntry();
    this.running = true;
    if (this.pc >= this.prog.length) this.pc = 0;
    return this.stepLoop();
  };
  // executes until halt or pause; returns 'pause' if a PSE was hit
  HP12C.prototype.stepLoop = function () {
    var steps = 0;
    while (this.running) {
      if (++steps > 100000) { this.running = false; break; }
      if (this.pc >= this.prog.length) { this.pc = 0; this.running = false; break; }
      var tokens = this.prog[this.pc];
      this.branched = false; this.skipNext = false;
      if (tokens[0] === 'rs' && tokens.length === 1) { this.pc++; this.running = false; break; }
      if (tokens[0] === 'g' && tokens[1] === 'rs') {   // PSE
        this.pc++;
        if (this.error !== null) { this.running = false; break; }
        return 'pause';
      }
      this.executing = true;
      this.exec(tokens);
      this.executing = false;
      if (this.error !== null) { this.running = false; break; }
      if (!this.branched) this.pc++;
      if (this.skipNext) this.pc++;
    }
    return 'done';
  };
  HP12C.prototype.resume = function () {       // continue after a PSE
    if (!this.running) return 'done';
    return this.stepLoop();
  };
  HP12C.prototype.singleStep = function () {
    if (this.prgmMode) {                        // show next line
      this.pc = this.pc < this.prog.length ? this.pc + 1 : 0;
      return;
    }
    if (this.prog.length === 0) return;
    if (this.pc >= this.prog.length) { this.pc = 0; return; }
    var tokens = this.prog[this.pc];
    this.branched = false; this.skipNext = false;
    if (tokens[0] === 'rs' && tokens.length === 1) { this.pc++; return; }
    this.running = true;                        // let tests behave as in-program
    this.executing = true;
    this.exec(tokens);
    this.executing = false;
    this.running = false;
    if (!this.branched) this.pc++;
    if (this.skipNext) this.pc++;
    if (this.pc >= this.prog.length) this.pc = 0;
  };

  /* ---------------- display ---------------- */

  HP12C.prototype.getDisplay = function () {
    var ann = {
      f: this.seq[0] === 'f',
      g: this.seq[0] === 'g',
      begin: this.begin,
      dmy: this.dmy,
      c: this.cOdd,
      prgm: this.prgmMode
    };
    if (this.off) return { text: '', align: 'left', ann: { f: false, g: false, begin: false, dmy: false, c: false, prgm: false } };
    if (this.error !== null) return { text: 'Error  ' + this.error, align: 'left', ann: ann };
    if (this.running) return { text: 'running', align: 'left', ann: ann };
    if (this.prgmMode) return { text: this.progLineText(), align: 'left', ann: ann };
    if (this.special) return { text: this.special.text, align: 'left', ann: ann };
    if (this.entry) return { text: entryText(this.entry, this.comma), align: 'right', ann: ann };
    return { text: formatNumber(this.stk[0], this.fix, this.sci, this.comma), align: 'right', ann: ann };
  };

  HP12C.prototype.progLineText = function () {
    if (this.pc === 0) return '00-';
    var tokens = this.prog[this.pc - 1] || [];
    var codes;
    if (tokens[0] === 'g' && tokens[1] === 'rdn') {   // GTO nn shows as 43,33 nn
      var tgt = tokens.slice(2).map(function (t) { return DIGIT_IDS[t]; }).join('');
      codes = '43,33 ' + tgt;
    } else {
      codes = tokens.map(function (t) { return KEYCODE[t] || ''; }).join(' ');
    }
    return pad2(this.pc) + '-' + padLeft(codes, 8);
  };

  /* ---------------- persistence ---------------- */

  HP12C.prototype.saveState = function () {
    return JSON.stringify({
      stk: this.stk, lastX: this.lastX, reg: this.reg, fin: this.fin,
      cf: this.cf, nj: this.nj, begin: this.begin, dmy: this.dmy,
      cOdd: this.cOdd, comma: this.comma, fix: this.fix, sci: this.sci,
      prog: this.prog
    });
  };
  HP12C.prototype.loadState = function (json) {
    try {
      var s = JSON.parse(json);
      this.stk = s.stk; this.lastX = s.lastX; this.reg = s.reg; this.fin = s.fin;
      this.cf = s.cf; this.nj = s.nj; this.begin = s.begin; this.dmy = s.dmy;
      this.cOdd = s.cOdd; this.comma = s.comma; this.fix = s.fix; this.sci = s.sci;
      this.prog = s.prog || [];
    } catch (e) { /* corrupted state — start fresh */ }
  };

  /* ---------------- formatting helpers ---------------- */

  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  function padLeft(s, w) { while (s.length < w) s = ' ' + s; return s; }

  function groupInt(s, sep) {
    var out = '', c = 0, i;
    for (i = s.length - 1; i >= 0; i--) {
      out = s[i] + out; c++;
      if (c % 3 === 0 && i > 0) out = sep + out;
    }
    return out;
  }

  function sciText(x, comma) {
    var neg = x < 0; x = Math.abs(x);
    var e = x === 0 ? 0 : Math.floor(Math.log10(x));
    var m = x === 0 ? 0 : x / Math.pow(10, e);
    m = Math.round(m * 1e6) / 1e6;
    if (m >= 10) { m /= 10; e += 1; }
    var dp = comma ? ',' : '.';
    var ms = m.toFixed(6).replace('.', dp);
    var es = pad2(Math.abs(e));
    return (neg ? '-' : '') + ms + (e < 0 ? '-' : ' ') + es;
  }

  function formatNumber(x, fix, sci, comma) {
    if (x !== 0 && Math.abs(x) < 1e-99) x = 0;
    if (Math.abs(x) > MAX) x = Math.sign(x) * MAX;
    if (sci) return sciText(x, comma);
    var ax = Math.abs(x);
    if (ax >= 1e10) return sciText(x, comma);
    var intDigits = ax < 1 ? 1 : Math.floor(Math.log10(ax)) + 1;
    var dec = Math.max(0, Math.min(fix, 10 - intDigits));
    var s = ax.toFixed(dec);
    if (parseFloat(s) >= 1e10) return sciText(x, comma);
    var parts = s.split('.');
    var dp = comma ? ',' : '.', sep = comma ? '.' : ',';
    var out = groupInt(parts[0], sep);
    out += dp + (parts[1] || '');
    return (x < 0 ? '-' : '') + out;
  }

  function entryText(e, comma) {
    var m = e.mant === '' ? '0' : e.mant;
    var dp = comma ? ',' : '.', sep = comma ? '.' : ',';
    var parts = m.split('.');
    var out = groupInt(parts[0], sep);
    if (m.indexOf('.') >= 0) out += dp + (parts[1] || '');
    if (e.exp !== null) {
      var es = pad2(e.exp === '' ? '0' : e.exp);
      out += (e.expNeg ? '-' : ' ') + es;
    }
    return (e.neg ? '-' : '') + out;
  }

  function mantissaText(x) {
    if (x === 0) return '0000000000';
    var e = Math.floor(Math.log10(Math.abs(x)));
    var m = Math.abs(x) / Math.pow(10, e);
    var s = m.toFixed(9).replace('.', '');
    return s.slice(0, 10);
  }

  /* ---------------- generic root finder ---------------- */
  // Finds a root of fn in (lo, hi); tries a grid scan for a sign change, then bisects.
  function solveRoot(fn, lo, hi, seed) {
    var pts = [], i, k;
    pts.push(lo + 1e-9);
    var negs = [-0.99, -0.9, -0.75, -0.5, -0.25, -0.1, -0.05, -0.01];
    for (i = 0; i < negs.length; i++) if (negs[i] > lo) pts.push(negs[i]);
    pts.push(0);
    var mags = [1e-4, 1e-3, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 100, 1000, 1e4, 1e5];
    for (i = 0; i < mags.length; i++) if (mags[i] < hi) pts.push(mags[i]);
    if (seed && seed > lo && seed < hi) pts.push(seed);
    pts.sort(function (a, b) { return a - b; });

    var prevX = null, prevY = null, a = null, b = null;
    for (i = 0; i < pts.length; i++) {
      var y = fn(pts[i]);
      if (!isFinite(y) || isNaN(y)) { prevX = null; prevY = null; continue; }
      if (y === 0) return pts[i];
      if (prevY !== null && ((y > 0) !== (prevY > 0))) { a = prevX; b = pts[i]; break; }
      prevX = pts[i]; prevY = y;
    }
    if (a === null) return null;
    var fa = fn(a);
    for (k = 0; k < 200; k++) {
      var mid = (a + b) / 2, fm = fn(mid);
      if (!isFinite(fm) || fm === 0) return mid;
      if ((fm > 0) === (fa > 0)) { a = mid; fa = fm; } else { b = mid; }
      if (Math.abs(b - a) < 1e-13 * Math.max(1, Math.abs(a))) break;
    }
    return (a + b) / 2;
  }

  /* ---------------- calendar ---------------- */

  function daysInMonth(y, m) {
    return [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  function jdn(y, m, d) {
    var a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
    return d + Math.floor((153 * mm + 2) / 5) + 365 * yy +
      Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  }
  function fromJdn(jd) {
    var a = jd + 32044, b = Math.floor((4 * a + 3) / 146097), c = a - Math.floor(146097 * b / 4);
    var dd = Math.floor((4 * c + 3) / 1461), e = c - Math.floor(1461 * dd / 4);
    var mm = Math.floor((5 * e + 2) / 153);
    return {
      d: e - Math.floor((153 * mm + 2) / 5) + 1,
      m: mm + 3 - 12 * Math.floor(mm / 10),
      y: 100 * b + dd - 4800 + Math.floor(mm / 10)
    };
  }
  function addMonths(dt, delta) {
    var m0 = dt.m - 1 + delta;
    var y = dt.y + Math.floor(m0 / 12);
    var m = ((m0 % 12) + 12) % 12 + 1;
    var d = Math.min(dt.d, daysInMonth(y, m));
    return { y: y, m: m, d: d };
  }

  HP12C.KEYCODE = KEYCODE;
  HP12C.formatNumber = formatNumber;
  return HP12C;
}));
