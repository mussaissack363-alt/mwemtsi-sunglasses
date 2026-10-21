// Media overrides loader.
//
// Reads admin-selected replacements from the `site_media` table and applies
// them to elements marked with data-media-key="...".
//
// This file is defensive on purpose: if Supabase is unreachable, the table is
// missing, or a replacement file fails to load, the page keeps showing the
// media that shipped with the site. It never throws and never removes an
// element.
(function () {
  "use strict";

  var SUPABASE_URL = "https://bjjyotduxvcwcuaztxgj.supabase.co";
  var SUPABASE_KEY = "sb_publishable_dVi5KufBJGYDM6slTAz0Hw_VN4XsRTq";
  var PROBE_TIMEOUT = 15000;

  function warn(msg, err) {
    if (window.console && console.warn) console.warn("[media] " + msg, err || "");
  }

  function client() {
    try {
      if (window.mwemtsiSupabase) return window.mwemtsiSupabase;
      if (window.supabase && typeof window.supabase.createClient === "function") {
        window.mwemtsiSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        return window.mwemtsiSupabase;
      }
    } catch (e) {
      warn("client init failed", e);
    }
    return null;
  }

  function targets(key) {
    try {
      return Array.prototype.slice.call(
        document.querySelectorAll('[data-media-key="' + String(key).replace(/"/g, '\\"') + '"]')
      );
    } catch (e) {
      return [];
    }
  }

  function applyImage(el, url) {
    var probe = new Image();
    var done = false;
    var timer = setTimeout(function () {
      if (!done) { done = true; warn("image timeout, keeping default: " + url); }
    }, PROBE_TIMEOUT);

    probe.onload = function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (el.tagName === "IMG") {
        el.src = url;
      } else {
        // Background slots (e.g. the Men/Women page heroes) expose the
        // image through a CSS custom property so the gradient overlay
        // on ::before keeps working.
        el.style.setProperty("--media-bg", 'url("' + url.replace(/"/g, "%22") + '")');
      }
    };
    probe.onerror = function () {
      if (done) return;
      done = true;
      clearTimeout(timer);
      warn("image failed, keeping default: " + url);
    };
    probe.src = url;
  }

  function applyVideo(el, url) {
    var probe = document.createElement("video");
    var done = false;
    var wasPlaying = !el.paused;

    function finish(ok) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      probe.removeAttribute("src");
      probe.load();
      if (!ok) return;

      var original = el.getAttribute("src");
      el.src = url;
      el.load();

      // If the new file breaks mid-playback, quietly go back to the default.
      function onError() {
        el.removeEventListener("error", onError);
        if (original) {
          el.src = original;
          el.load();
          if (wasPlaying) el.play().catch(function () {});
        }
        warn("video failed after swap, reverted: " + url);
      }
      el.addEventListener("error", onError);

      if (wasPlaying) {
        var p = el.play();
        if (p && p.catch) p.catch(function () {});
      }
    }

    var timer = setTimeout(function () { finish(false); }, PROBE_TIMEOUT);

    probe.preload = "metadata";
    probe.muted = true;
    probe.playsInline = true;
    probe.onloadedmetadata = function () { finish(true); };
    probe.onerror = function () { finish(false); };
    probe.src = url;
  }

  function apply(row) {
    if (!row || !row.key || !row.url) return;
    var kind = row.kind === "video" ? "video" : "image";
    targets(row.key).forEach(function (el) {
      try {
        if (kind === "video" || el.tagName === "VIDEO") applyVideo(el, row.url);
        else applyImage(el, row.url);
      } catch (e) {
        warn("apply failed for " + row.key, e);
      }
    });
  }

  function load() {
    var sb = client();
    if (!sb) return;
    try {
      Promise.resolve(sb.from("site_media").select("key,url,kind"))
        .then(function (res) {
          if (res && res.error) {
            warn("could not read site_media (admin overrides skipped)", res.error.message);
            return;
          }
          (res && res.data ? res.data : []).forEach(apply);
        })
        .catch(function (e) {
          warn("site_media request failed", e);
        });
    } catch (e) {
      warn("load failed", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
