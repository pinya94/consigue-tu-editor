// Se inyecta en cada animación HTML. Congela el reloj de la página y lo mueve a mano,
// para que el editor (y la exportación fotograma a fotograma) controlen en qué instante está.
//  - Las animaciones CSS y Web Animations se controlan solas.
//  - Para animaciones hechas con JS (canvas, GSAP...), define en la página:
//      window.seekAnimation = function (t) { /* pinta el estado del segundo t */ }
(function () {
  var current = 0;
  function syncCss() {
    try {
      document.getAnimations().forEach(function (a) {
        a.pause();
        a.currentTime = current * 1000;
      });
    } catch (e) {}
  }
  function seek(t) {
    current = t;
    syncCss();
    // (cupcutSeek: nombre antiguo, se mantiene para animaciones ya hechas)
    var custom = window.seekAnimation || window.cupcutSeek;
    if (typeof custom === 'function') {
      try {
        custom(t);
      } catch (e) {
        console.error(e);
      }
    }
  }
  window.__seekAnimation = seek;
  window.__editorTime = function () {
    return current;
  };
  // Las animaciones que se creen después (clases añadidas, etc.) también quedan sincronizadas
  // (solo CSS: volver a llamar a seekAnimation aquí podría provocar un bucle si modifica el DOM)
  new MutationObserver(syncCss).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  addEventListener('message', function (e) {
    if (e.data && e.data.type === 'editor-seek') seek(e.data.t);
  });
  document.addEventListener('DOMContentLoaded', function () {
    seek(current);
  });
  addEventListener('load', function () {
    seek(current);
    if (parent !== window) parent.postMessage({ type: 'editor-ready' }, '*');
  });
})();
