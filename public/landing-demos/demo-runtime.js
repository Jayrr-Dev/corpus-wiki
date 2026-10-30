// DEMO RUNTIME: every demo loads this in <head>, right after theme.js.
// Gives the demos one way to wait for fonts, pauses their animation while they are
// off screen, and tells the landing page when there is something to show.
(function () {
  var FONT_WAIT_MS = 600; // a slow font never holds a demo back longer than this
  var embedded = location.search.includes("embed");

  // FONTS: `demoFontsReady` settles when the fonts arrive or the wait runs out,
  // whichever comes first. Fonts that land later trigger a resize, so a demo that
  // measures its text lays out again with the real font.
  var loaded = document.fonts.ready;
  window.demoFontsReady = Promise.race([
    loaded,
    new Promise(function (resolve) { setTimeout(resolve, FONT_WAIT_MS); }),
  ]);
  loaded.then(function () { dispatchEvent(new Event("resize")); });

  if (!embedded) return;

  // READY: the landing page drops its loading panel at this signal. The attribute
  // covers a demo that finishes before the landing page's script is listening.
  window.demoFontsReady.then(function () {
    setTimeout(function () {
      document.documentElement.dataset.demoReady = "true";
      parent.postMessage({ landingDemo: location.pathname, ready: true }, location.origin);
    }, 0);
  });

  // OFF-SCREEN PAUSE: browsers keep same-origin frames animating when out of view, so
  // nine demos would all draw at once. Animation frames wait here until this one is
  // back in view; its timeline jumps forward when it resumes.
  var nativeRequest = window.requestAnimationFrame.bind(window);
  var nativeCancel = window.cancelAnimationFrame.bind(window);
  var visible = true;
  var waiting = new Map();
  var nextId = -1;

  window.requestAnimationFrame = function (callback) {
    if (visible) return nativeRequest(callback);
    var id = nextId--;
    waiting.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    if (id < 0) waiting.delete(id);
    else nativeCancel(id);
  };

  new IntersectionObserver(function (entries) {
    visible = entries[entries.length - 1].isIntersecting;
    if (!visible) return;
    var callbacks = Array.from(waiting.values());
    waiting.clear();
    callbacks.forEach(nativeRequest);
  }).observe(document.documentElement);
})();
