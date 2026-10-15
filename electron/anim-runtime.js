// Se inyecta en cada animación HTML. Congela el reloj de la página y lo mueve a mano,
// para que el editor (y la exportación fotograma a fotograma) controlen en qué instante está.
//  - Las animaciones CSS y Web Animations se controlan solas.
//  - Para animaciones hechas con JS (canvas, GSAP...), define en la página:
//      window.cupcutSeek = function (t) { /* pinta el estado del segundo t */ }
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
    if (typeof window.cupcutSeek === 'function') {
      try {
        window.cupcutSeek(t);
      } catch (e) {
        console.error(e);
      }
    }
  }
  window.__cupcutSeek = seek;
  window.__cupcutTime = function () {
    return current;
  };
  // Las animaciones que se creen después (clases añadidas, etc.) también quedan sincronizadas
  // (solo CSS: volver a llamar a cupcutSeek aquí podría provocar un bucle si modifica el DOM)
  new MutationObserver(syncCss).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
  addEventListener('message', function (e) {
    if (e.data && e.data.type === 'cupcut-seek') seek(e.data.t);
  });
  document.addEventListener('DOMContentLoaded', function () {
    seek(current);
  });
  addEventListener('load', function () {
    seek(current);
    if (parent !== window) parent.postMessage({ type: 'cupcut-ready' }, '*');
  });
})();
