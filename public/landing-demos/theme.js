// THEME BRIDGE: every demo loads this first, in <head>, so it paints in the right theme.
// Puts a `light` or `dark` class on this page's <html>, so the demo's CSS can switch
// its colour variables with `html.light { ... }`.
// Embedded on the landing page, it copies the parent page's theme class (set by
// next-themes) and follows it when the user switches. Opened on its own, or if the
// parent has no class, it follows the OS setting.
(function () {
  var root = document.documentElement;
  var media = window.matchMedia("(prefers-color-scheme: dark)");

  function parentRoot() {
    try {
      return window.parent !== window ? window.parent.document.documentElement : null;
    } catch (e) {
      return null; // a parent on another origin can't be read
    }
  }

  function resolve() {
    var p = parentRoot();
    if (p && p.classList.contains("dark")) return "dark";
    if (p && p.classList.contains("light")) return "light";
    return media.matches ? "dark" : "light";
  }

  function apply() {
    var theme = resolve();
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    root.style.colorScheme = theme;
  }

  apply();
  media.addEventListener("change", apply);
  var p = parentRoot();
  if (p) new MutationObserver(apply).observe(p, { attributes: true, attributeFilter: ["class"] });
})();
