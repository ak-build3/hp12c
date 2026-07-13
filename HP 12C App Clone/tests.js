/* Node test harness for the HP-12C engine. */
'use strict';
var HP12C = require('./engine.js');

var passed = 0, failed = 0;
function calc() { return new HP12C(); }
function keys(c, list) { list.forEach(function (k) { c.press(k); }); return c; }
// type a number via key ids: "1234.5" etc.
function type(c, s) {
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (ch === '.') c.press('dot');
    else if (ch === '-') c.press('chs');
    else c.press('d' + ch);
  }
  return c;
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1e-7 : tol); }
function ok(name, cond, extra) {
  if (cond) { passed++; }
  else { failed++; console.log('FAIL: ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
}
function okNear(name, got, want, tol) { ok(name, near(got, want, tol), 'got ' + got + ' want ' + want); }

/* ---- RPN basics ---- */
(function () {
  var c = calc();
  type(c, '3'); c.press('enter'); type(c, '4'); c.press('add');
  okNear('3+4', c.x(), 7);
  var c2 = calc();
  type(c2, '1'); c2.press('enter'); type(c2, '2'); c2.press('enter');
  type(c2, '3'); c2.press('enter'); type(c2, '4');
  keys(c2, ['add', 'add', 'add']);
  okNear('stack sum', c2.x(), 10);

  var c3 = calc();
  type(c3, '2'); c3.press('enter'); type(c3, '10'); keys(c3, ['ytox']);
  okNear('2^10', c3.x(), 1024);

  var c4 = calc();
  type(c4, '25'); keys(c4, ['g', 'ytox']); okNear('sqrt 25', c4.x(), 5);
  keys(c4, ['recip']); okNear('1/5', c4.x(), 0.2);
  keys(c4, ['g', 'mul']); okNear('0.2^2', c4.x(), 0.04);

  var c5 = calc();
  type(c5, '300'); c5.press('enter'); type(c5, '25'); c5.press('pct');
  okNear('300 25%', c5.x(), 75);
  ok('% keeps y', c5.stk[1] === 300);
  var c6 = calc();
  type(c6, '58.5'); c6.press('enter'); type(c6, '53.25'); c6.press('dpct');
  okNear('delta%', c6.x(), -8.9743589, 1e-6);
  var c7 = calc();
  type(c7, '65'); c7.press('enter'); type(c7, '25'); c7.press('pctT');
  okNear('%T', c7.x(), 38.4615384, 1e-6);

  var c8 = calc();
  type(c8, '5'); c8.press('enter'); type(c8, '3'); c8.press('sub');
  keys(c8, ['g', 'enter']); // LSTx
  okNear('LSTx', c8.x(), 3);

  var c9 = calc();
  type(c9, '6'); keys(c9, ['g', 'd3']);   // n!
  okNear('6!', c9.x(), 720);

  var c10 = calc();
  type(c10, '12345'); keys(c10, ['chs']);
  okNear('CHS entry', c10.x(), -12345);
  c10.press('enter'); keys(c10, ['chs']);
  okNear('CHS on X', c10.x(), 12345);

  var c11 = calc();
  type(c11, '2.5'); c11.press('eex'); type(c11, '3'); c11.press('enter');
  okNear('EEX', c11.x(), 2500);

  var c12 = calc();
  type(c12, '9'); c12.press('enter'); type(c12, '4');
  keys(c12, ['xy']); okNear('x<>y', c12.x(), 9);
  keys(c12, ['rdn']); okNear('Rdn', c12.x(), 4);
})();

/* ---- display formatting ---- */
(function () {
  var c = calc();
  type(c, '1234567.891'); c.press('enter');
  ok('fix2 grouping', c.getDisplay().text === '1,234,567.89', c.getDisplay().text);
  keys(c, ['f', 'd4']);
  ok('fix4 clipped to 10 digits', c.getDisplay().text === '1,234,567.891', c.getDisplay().text);
  keys(c, ['f', 'd9']);
  ok('fix9 truncates to width', c.getDisplay().text === '1,234,567.891', c.getDisplay().text);
  var c2 = calc();
  type(c2, '123'); keys(c2, ['enter', 'f', 'dot']);
  ok('sci', c2.getDisplay().text === '1.230000 02', c2.getDisplay().text);
  var c3 = calc();
  type(c3, '0.000123'); keys(c3, ['chs', 'enter', 'f', 'dot']);
  ok('sci neg exp', c3.getDisplay().text === '-1.230000-04', c3.getDisplay().text);
  var c4 = calc();
  keys(c4, ['on']); c4.press('dot'); keys(c4, ['on']);
  type(c4, '1234.5'); c4.press('enter');
  ok('comma mode', c4.getDisplay().text === '1.234,50', c4.getDisplay().text);
})();

/* ---- TVM ---- */
(function () {
  var c = calc();
  type(c, '360'); c.press('n');
  type(c, '0.5'); c.press('i');
  type(c, '100000'); c.press('pv');
  type(c, '0'); c.press('fv');
  c.press('pmt');
  okNear('PMT 30yr 6%', c.x(), -599.5505252, 1e-5);
  // re-solve i from pmt
  type(c, '0'); c.press('i'); c.press('i');
  okNear('i recovered', c.x(), 0.5, 1e-6);
  // n recompute
  type(c, '0'); c.press('n'); c.press('n');
  okNear('n recovered', c.x(), 360, 0);

  // g 12x / 12÷
  var c2 = calc();
  type(c2, '30'); keys(c2, ['g', 'n']);
  okNear('12x', c2.fin.n, 360);
  type(c2, '6'); keys(c2, ['g', 'i']);
  okNear('12div', c2.fin.i, 0.5);

  // FV growth: 1000 at 1% for 10 periods
  var c3 = calc();
  type(c3, '10'); c3.press('n'); type(c3, '1'); c3.press('i');
  type(c3, '1000'); c3.press('chs'); c3.press('pv');
  type(c3, '0'); c3.press('pmt'); c3.press('fv');
  okNear('FV', c3.x(), 1104.622125, 1e-5);

  // BEGIN mode annuity due: 10 pmts of -100 at 5%, PV?
  var c4 = calc();
  keys(c4, ['g', 'd7']); // BEG
  type(c4, '10'); c4.press('n'); type(c4, '5'); c4.press('i');
  type(c4, '100'); c4.press('chs'); c4.press('pmt'); type(c4, '0'); c4.press('fv');
  c4.press('pv');
  okNear('annuity due PV', c4.x(), 810.7821676, 1e-5);

  // CLEAR FIN
  keys(c4, ['f', 'xy']);
  ok('clear fin', c4.fin.n === 0 && c4.fin.i === 0 && c4.fin.pmt === 0);

  // odd period: n=3.5, simple interest odd (C off)
  var c5 = calc();
  type(c5, '3.5'); c5.press('n'); type(c5, '10'); c5.press('i');
  type(c5, '100'); c5.press('chs'); c5.press('pv'); type(c5, '0'); c5.press('pmt');
  c5.press('fv');
  // FV = 100*(1+.1*.5)*(1.1)^3 = 105*1.331 = 139.755
  okNear('odd period simple', c5.x(), 139.755, 1e-6);
  // C on: compound odd
  keys(c5, ['sto', 'eex']);
  ok('C flag on', c5.cOdd === true);
  type(c5, '0'); c5.press('fv'); c5.press('fv');
  okNear('odd period compound', c5.x(), 100 * Math.pow(1.1, 3.5), 1e-6);
})();

/* ---- AMORT ---- */
(function () {
  var c = calc();
  type(c, '360'); c.press('n'); // will be reset
  keys(c, ['f', 'xy']); // clear fin
  type(c, '0.5'); c.press('i');
  type(c, '100000'); c.press('pv');
  type(c, '599.55'); c.press('chs'); c.press('pmt');
  type(c, '12'); keys(c, ['f', 'n']); // AMORT 12
  // year-1 interest on $100k at 6%/12 with pmt 599.55 ≈ -5966.5 (rounded per FIX 2)
  ok('amort interest sign', c.x() < 0);
  okNear('amort interest', c.x(), -5966.57, 0.25);
  okNear('amort principal', c.stk[1], -(12 * 599.55) - c.x(), 1e-9);
  okNear('amort n bumped', c.fin.n, 12);
  ok('amort pv reduced', c.fin.pv < 100000 && c.fin.pv > 98000, c.fin.pv);
})();

/* ---- simple interest ---- */
(function () {
  var c = calc();
  type(c, '60'); c.press('n');
  type(c, '7'); c.press('i');
  type(c, '450'); c.press('chs'); c.press('pv');
  keys(c, ['f', 'i']);
  okNear('INT 360', c.x(), 5.25, 1e-9);
  keys(c, ['rdn', 'xy']);
  okNear('INT 365', c.x(), 450 * 0.07 * 60 / 365, 1e-9);
})();

/* ---- NPV / IRR ---- */
(function () {
  var c = calc();
  type(c, '1000'); c.press('chs'); keys(c, ['g', 'pv']);   // CF0
  type(c, '500'); keys(c, ['g', 'pmt']);                    // CFj
  type(c, '3'); keys(c, ['g', 'fv']);                       // Nj = 3
  type(c, '10'); c.press('i');
  keys(c, ['f', 'pv']);                                     // NPV
  okNear('NPV', c.x(), -1000 + 500 / 1.1 + 500 / 1.21 + 500 / 1.331, 1e-7);
  keys(c, ['f', 'fv']);                                     // IRR
  okNear('IRR', c.x(), 23.37519, 1e-4);
  okNear('IRR stored in i', c.fin.i, c.x(), 1e-12);

  // grouped flows count
  var c2 = calc();
  type(c2, '100'); c2.press('chs'); keys(c2, ['g', 'pv']);
  type(c2, '50'); keys(c2, ['g', 'pmt']);
  type(c2, '60'); keys(c2, ['g', 'pmt']);
  okNear('CF count in n', c2.fin.n, 2);
  ok('CF regs', c2.reg[0] === -100 && c2.reg[1] === 50 && c2.reg[2] === 60);
})();

/* ---- dates ---- */
(function () {
  var c = calc();  // M.DY default
  type(c, '6.032026'); c.press('enter'); type(c, '30'); keys(c, ['g', 'chs']);
  okNear('date+30', c.x(), 7.032026, 1e-9);
  ok('weekday shown', c.getDisplay().text.indexOf('7.03.2026') === 0 &&
    /5$/.test(c.getDisplay().text), c.getDisplay().text);   // 2026-07-03 = Friday
  var c2 = calc();
  type(c2, '1.012000'); c2.press('enter'); type(c2, '3.012000'); keys(c2, ['g', 'eex']);
  okNear('ddays actual', c2.x(), 60);
  c2.press('xy');
  okNear('ddays 360', c2.x(), 60);
  // D.MY mode
  var c3 = calc();
  keys(c3, ['g', 'd4']);
  type(c3, '3.062026'); c3.press('enter'); type(c3, '30'); keys(c3, ['g', 'chs']);
  okNear('dmy date+30', c3.x(), 3.072026, 1e-9);
  // invalid date
  var c4 = calc();
  type(c4, '13.012026'); c4.press('enter'); type(c4, '10'); keys(c4, ['g', 'chs']);
  ok('bad date err 8', c4.error === 8);
})();

/* ---- bonds ---- */
(function () {
  // par bond sanity: coupon = yield, settle on coupon date → price 100
  var c = calc();
  type(c, '5'); c.press('i');
  type(c, '5'); c.press('pmt');
  type(c, '6.041996'); c.press('enter'); type(c, '6.042006');
  keys(c, ['f', 'ytox']);   // PRICE
  okNear('par bond price', c.x(), 100, 1e-6);
  okNear('par bond accrued', c.stk[1], 0, 1e-9);
  // round trip ytm
  var c2 = calc();
  type(c2, '4.75'); c2.press('i');
  type(c2, '6.75'); c2.press('pmt');
  type(c2, '4.282004'); c2.press('enter'); type(c2, '6.042018');
  keys(c2, ['f', 'ytox']);
  var price = c2.x();
  ok('premium bond > 100', price > 100, price);
  // now solve back
  var c3 = calc();
  type(c3, String(price.toFixed(6))); c3.press('pv');
  type(c3, '6.75'); c3.press('pmt');
  type(c3, '4.282004'); c3.press('enter'); type(c3, '6.042018');
  keys(c3, ['f', 'recip']);  // YTM
  okNear('ytm roundtrip', c3.x(), 4.75, 1e-4);
})();

/* ---- depreciation ---- */
(function () {
  var c = calc();
  type(c, '10000'); c.press('pv');
  type(c, '500'); c.press('fv');
  type(c, '5'); c.press('n');
  type(c, '1'); keys(c, ['f', 'pctT']);   // SL year 1
  okNear('SL dep', c.x(), 1900);
  okNear('SL remaining', c.stk[1], 9500 - 1900);
  var c2 = calc();
  type(c2, '10000'); c2.press('pv'); type(c2, '500'); c2.press('fv'); type(c2, '5'); c2.press('n');
  type(c2, '1'); keys(c2, ['f', 'dpct']); // SOYD year 1
  okNear('SOYD dep', c2.x(), 9500 * 5 / 15, 1e-7);
  var c3 = calc();
  type(c3, '10000'); c3.press('pv'); type(c3, '500'); c3.press('fv'); type(c3, '5'); c3.press('n');
  type(c3, '200'); c3.press('i');
  type(c3, '2'); keys(c3, ['f', 'pct']);  // DB year 2
  okNear('DB dep y2', c3.x(), 2400);
})();

/* ---- statistics ---- */
(function () {
  var c = calc();
  [[1, 2], [2, 4], [3, 6]].forEach(function (p) {
    type(c, String(p[1])); c.press('enter'); type(c, String(p[0])); c.press('sigma');
  });
  okNear('n=3', c.x(), 3);
  keys(c, ['g', 'd0']);
  okNear('mean x', c.x(), 2);
  okNear('mean y', c.stk[1], 4);
  keys(c, ['g', 'dot']);
  okNear('s x', c.x(), 1);
  var c2 = calc();
  [[1, 2], [2, 4], [3, 6]].forEach(function (p) {
    type(c2, String(p[1])); c2.press('enter'); type(c2, String(p[0])); c2.press('sigma');
  });
  type(c2, '4'); keys(c2, ['g', 'd2']);   // y-hat at x=4
  okNear('y estimate', c2.x(), 8);
  okNear('corr', c2.stk[1], 1);
  // weighted mean: price ENTER qty Σ+ ; xw = Σxy/Σx
  var c3 = calc();
  [[10, 2], [20, 3]].forEach(function (p) { // price, weight(qty in x)
    type(c3, String(p[0])); c3.press('enter'); type(c3, String(p[1])); c3.press('sigma');
  });
  keys(c3, ['g', 'd6']);
  okNear('weighted mean', c3.x(), (10 * 2 + 20 * 3) / 5);
  // sigma minus
  var c4 = calc();
  type(c4, '5'); c4.press('sigma'); type(c4, '9'); c4.press('sigma');
  type(c4, '9'); keys(c4, ['g', 'sigma']);
  okNear('sigma minus n', c4.reg[1], 1);
  okNear('sigma minus sum', c4.reg[2], 5);
})();

/* ---- STO / RCL ---- */
(function () {
  var c = calc();
  type(c, '42'); keys(c, ['sto', 'd3']);
  type(c, '0'); c.press('enter');
  keys(c, ['rcl', 'd3']);
  okNear('sto/rcl', c.x(), 42);
  type(c, '8'); keys(c, ['sto', 'add', 'd3']);
  keys(c, ['rcl', 'd3']);
  okNear('sto+ arith', c.x(), 50);
  type(c, '7'); keys(c, ['sto', 'dot', 'd4']);
  keys(c, ['rcl', 'dot', 'd4']);
  okNear('dot regs', c.x(), 7);
  type(c, '123'); keys(c, ['sto', 'pv']);
  okNear('sto PV', c.fin.pv, 123);
  keys(c, ['f', 'clx']);   // CLEAR REG
  keys(c, ['rcl', 'd3']);
  okNear('clear reg', c.x(), 0);
})();

/* ---- programming ---- */
(function () {
  // square program: ENTER, ×
  var c = calc();
  keys(c, ['f', 'rs']);        // P/R
  ok('prgm mode', c.prgmMode);
  keys(c, ['f', 'rdn']);       // CLEAR PRGM
  keys(c, ['enter', 'mul']);
  ok('2 lines', c.prog.length === 2);
  keys(c, ['f', 'rs']);        // back to run
  type(c, '7'); c.press('rs');
  okNear('program square', c.x(), 49);
  type(c, '9'); c.press('rs');
  okNear('program square again', c.x(), 81);

  // loop with conditional: count down from x to 0
  // lines: 1, -, g x=0, GTO 05, GTO 01, (line 05 =) R/S? simpler: 1 - ; g x=0 ; GTO 00 ; GTO 01
  var c2 = calc();
  keys(c2, ['f', 'rs', 'f', 'rdn']);
  type(c2, '1'); c2.press('sub');            // 01: 1  02: -
  keys(c2, ['g', 'clx']);                    // 03: x=0
  keys(c2, ['g', 'rdn', 'd0', 'd0']);        // 04: GTO 00
  keys(c2, ['g', 'rdn', 'd0', 'd1']);        // 05: GTO 01
  keys(c2, ['f', 'rs']);
  type(c2, '5'); c2.press('rs');
  okNear('countdown to 0', c2.x(), 0);

  // program line display codes
  var c3 = calc();
  keys(c3, ['f', 'rs', 'f', 'rdn']);
  keys(c3, ['f', 'fv']);       // IRR → 42 15
  ok('line code', c3.getDisplay().text === '01-   42 15', JSON.stringify(c3.getDisplay().text));
  keys(c3, ['g', 'rdn', 'd0', 'd5']);
  ok('gto code', c3.getDisplay().text === '02-43,33 05', JSON.stringify(c3.getDisplay().text));
  keys(c3, ['f', 'rs']);
})();

/* ---- error handling ---- */
(function () {
  var c = calc();
  type(c, '5'); c.press('enter'); type(c, '0'); c.press('div');
  ok('div by zero', c.error === 0);
  ok('error display', c.getDisplay().text === 'Error  0');
  c.press('d9');   // any key clears, is ignored
  ok('error cleared', c.error === null && c.x() === 0);
  var c2 = calc();
  type(c2, '2'); c2.press('chs'); keys(c2, ['g', 'ytox']);
  ok('sqrt neg', c2.error === 0);
})();

/* ---- MEM / mantissa / RND ---- */
(function () {
  var c = calc();
  keys(c, ['g', 'd9']);
  ok('mem display', c.getDisplay().text === 'P-99  r-.9', c.getDisplay().text);
  var c2 = calc();
  type(c2, '3.14159265'); c2.press('enter');
  keys(c2, ['f', 'enter']);   // PREFIX = show mantissa
  ok('mantissa', c2.getDisplay().text === '3141592650', c2.getDisplay().text);
  var c3 = calc();
  type(c3, '2.6666'); c3.press('enter');
  keys(c3, ['f', 'pmt']);     // RND at FIX 2
  okNear('rnd', c3.x(), 2.67);
})();

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
