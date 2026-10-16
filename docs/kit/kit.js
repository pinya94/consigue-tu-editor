// Partes de las animaciones que no son CSS. Todo depende solo del segundo t que manda el editor,
// así la preview y la exportación fotograma a fotograma salen idénticas.
//  <span data-count data-from="0" data-to="180000" data-at="1" data-dur="1.5" data-suffix=" tokens"></span>
//  <span data-type="editor cut c12 3.5" data-at="0.5" data-cps="28"></span>
(function () {
  var ease = function (x) { return 1 - Math.pow(1 - x, 4); };
  var fmt = function (n, dec) {
    var s = n.toFixed(dec || 0).split('.');
    s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return s.join(',');
  };
  window.seekAnimation = function (t) {
    document.querySelectorAll('[data-count]').forEach(function (el) {
      var a = +el.dataset.at || 0, d = +el.dataset.dur || 1.2;
      var k = ease(Math.min(1, Math.max(0, (t - a) / d)));
      var v = +el.dataset.from + (+el.dataset.to - +el.dataset.from) * k;
      el.textContent = (el.dataset.prefix || '') + fmt(v, +el.dataset.dec || 0) + (el.dataset.suffix || '');
    });
    document.querySelectorAll('[data-type]').forEach(function (el) {
      var a = +el.dataset.at || 0, cps = +el.dataset.cps || 30, full = el.dataset.type;
      var n = Math.max(0, Math.min(full.length, Math.floor((t - a) * cps)));
      el.textContent = full.slice(0, n);
      el.classList.toggle('caret', t >= a - 0.3 && (n < full.length || el.hasAttribute('data-keep-caret')));
      el.style.visibility = t >= a - 0.3 ? 'visible' : 'hidden';
    });
  };
})();
