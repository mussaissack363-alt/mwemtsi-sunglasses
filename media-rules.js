// Upload quality rules for Mwemtsi Sunglasses.
//
// The site is a static build with fixed, full-bleed media slots. A photo or
// video in the wrong shape does not "break" the page outright, but it crops
// badly, letterboxes, buffers forever on mobile data, or shows a black box
// when the browser cannot decode the codec. These rules catch those cases
// before the file ever leaves the admin's machine.
//
// Two kinds of check:
//   errors   - the upload is refused. The file would visibly clash.
//   warnings - the upload is allowed but the admin is told what to improve.
//
// Everything here is read-only and runs entirely in the browser: it inspects
// the chosen file, it never uploads anything.
(function () {
  "use strict";

  var MB = 1024 * 1024;
  var KB = 1024;
  var PROBE_TIMEOUT = 20000;

  // ------------------------------------------------------------------
  // Rule sets
  // ------------------------------------------------------------------

  // Full-bleed hero photography. Rendered with object-fit: cover, so the
  // frame is cropped to whatever the viewport is. A landscape 16:9 source
  // survives cropping; a portrait one loses the subject.
  var HERO_IMAGE = {
    label: "photo",
    formats: ["image/jpeg", "image/png", "image/webp", "image/avif"],
    minWidth: 1280,
    minHeight: 720,
    maxWidth: 3840,
    maxHeight: 2160,
    aspect: 16 / 9,
    aspectTolerance: 0.06,
    minBytes: 12 * KB,
    maxBytes: 5 * MB
  };

  // Product photography. Shown in a 4:5 card with object-fit: contain, so
  // the exact ratio is a preference rather than a requirement - but an
  // extreme ratio turns into a thin sliver inside the card.
  var PRODUCT_IMAGE = {
    label: "product photo",
    formats: ["image/jpeg", "image/png", "image/webp", "image/avif"],
    minWidth: 800,
    minHeight: 800,
    maxWidth: 3000,
    maxHeight: 3000,
    aspectMin: 0.5,
    aspectMax: 2.2,
    aspect: 0.8,
    aspectTolerance: 0.35,
    minBytes: 12 * KB,
    maxBytes: 5 * MB
  };

  // Hero video. Plays full-bleed behind the text, so the aspect ratio has to
  // match or the letterbox bars show. H.264 in MP4 is the only combination
  // that plays everywhere, including Safari and Firefox.
  var HERO_VIDEO = {
    label: "video",
    formats: ["video/mp4", "video/webm"],
    minWidth: 1280,
    minHeight: 720,
    maxWidth: 1920,
    maxHeight: 1080,
    aspect: 16 / 9,
    aspectTolerance: 0.06,
    minBytes: 20 * KB,
    maxBytes: 20 * MB,
    minSeconds: 3,
    maxSeconds: 20,
    recommendedSeconds: 12,
    mp4Codecs: ["avc1"],
    mp4CodecNames: {
      avc1: "H.264",
      avc3: "H.264",
      hev1: "HEVC / H.265",
      hvc1: "HEVC / H.265",
      av01: "AV1",
      vp09: "VP9",
      mp4v: "MPEG-4 Visual"
    }
  };

  // Each media slot on the site. `fallback` is the file that ships with the
  // site and is used whenever an override is missing or fails to load.
  var SLOT_RULES = {
    "intro-video":        { kind: "video", rule: HERO_VIDEO },
    "intro-image":        { kind: "image", rule: HERO_IMAGE },
    "second-intro-video": { kind: "video", rule: HERO_VIDEO },
    "second-intro-image": { kind: "image", rule: HERO_IMAGE },
    "services-video":     { kind: "video", rule: HERO_VIDEO },
    "scrub-video":        { kind: "video", rule: HERO_VIDEO },
    "men-hero-image":     { kind: "image", rule: HERO_IMAGE },
    "men-story-video":    { kind: "video", rule: HERO_VIDEO },
    "women-hero-image":   { kind: "image", rule: HERO_IMAGE },
    "women-story-video":  { kind: "video", rule: HERO_VIDEO }
  };

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------

  function fmtBytes(n) {
    if (n >= MB) return (n / MB).toFixed(1).replace(/\.0$/, "") + " MB";
    return Math.max(1, Math.round(n / KB)) + " KB";
  }

  function ratioLabel(r) {
    var known = [
      [1 / 3, "1:3"], [1 / 2, "1:2"], [2 / 3, "2:3"], [3 / 4, "3:4"],
      [4 / 5, "4:5"], [9 / 16, "9:16"], [1, "1:1"], [4 / 3, "4:3"],
      [3 / 2, "3:2"], [16 / 9, "16:9"], [2, "2:1"], [3, "3:1"]
    ];
    var best = null, bestDiff = Infinity;
    for (var i = 0; i < known.length; i++) {
      var d = Math.abs(known[i][0] - r);
      if (d < bestDiff) { bestDiff = d; best = known[i]; }
    }
    return bestDiff < 0.02 ? best[1] : r.toFixed(2) + ":1";
  }

  function dims(w, h) { return w + "×" + h; }

  // ------------------------------------------------------------------
  // Probing: what is actually inside the file?
  // ------------------------------------------------------------------

  // Width and height of an image, decoded for real rather than read from a
  // header, so a file that claims to be a JPEG but is not gets caught.
  function probeImage(file) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(file).then(function (bmp) {
        var out = { width: bmp.width, height: bmp.height };
        if (bmp.close) bmp.close();
        return out;
      });
    }
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      var timer = setTimeout(function () {
        URL.revokeObjectURL(url);
        reject(new Error("The image took too long to open. It may be damaged."));
      }, PROBE_TIMEOUT);
      img.onload = function () {
        clearTimeout(timer);
        var out = { width: img.naturalWidth, height: img.naturalHeight };
        URL.revokeObjectURL(url);
        resolve(out);
      };
      img.onerror = function () {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        reject(new Error("That file could not be read as an image. It may be damaged."));
      };
      img.src = url;
    });
  }

  // Width, height and length of a video, taken from the decoder itself.
  function probeVideo(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var el = document.createElement("video");
      var settled = false;

      function finish(err, out) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        el.removeAttribute("src");
        try { el.load(); } catch (e) {}
        URL.revokeObjectURL(url);
        if (err) reject(err); else resolve(out);
      }

      var timer = setTimeout(function () {
        finish(new Error("The video took too long to open. Try a smaller file."));
      }, PROBE_TIMEOUT);

      el.preload = "metadata";
      el.muted = true;
      el.playsInline = true;
      el.onloadedmetadata = function () {
        finish(null, {
          width: el.videoWidth || 0,
          height: el.videoHeight || 0,
          duration: (isFinite(el.duration) && el.duration > 0) ? el.duration : 0
        });
      };
      el.onerror = function () {
        finish(new Error("That file could not be read as a video. It may be damaged."));
      };
      el.src = url;
    });
  }

  // Which codec is inside this MP4? The browser will happily play a file it
  // cannot decode, which shows as a black box on the page, so the codec has
  // to be read out of the container instead of guessed from the file name.
  function sniffMp4(file) {
    if (file.size > 64 * MB) return Promise.resolve(null);
    if (typeof DataView === "undefined") return Promise.resolve(null);

    return file.arrayBuffer().then(function (buf) {
      var dv = new DataView(buf);
      var CONTAINERS = { moov: 1, trak: 1, mdia: 1, minf: 1, stbl: 1 };

      function fourcc(off) {
        return String.fromCharCode(
          dv.getUint8(off), dv.getUint8(off + 1),
          dv.getUint8(off + 2), dv.getUint8(off + 3));
      }

      function find(start, end, want, depth) {
        if (depth > 6) return null;
        var off = start;
        while (off + 8 <= end) {
          var size = dv.getUint32(off);
          var type = fourcc(off + 4);
          var hdr = 8;
          if (size === 1) {
            if (off + 16 > end) return null;
            var hi = dv.getUint32(off + 8), lo = dv.getUint32(off + 12);
            size = hi * 4294967296 + lo;
            hdr = 16;
          } else if (size === 0) {
            size = end - off;
          }
          if (size < hdr || off + size > end + 8) return null;
          if (type === want) return { off: off, size: size, hdr: hdr };
          if (CONTAINERS[type]) {
            var hit = find(off + hdr, off + size, want, depth + 1);
            if (hit) return hit;
          }
          off += size;
        }
        return null;
      }

      var moov = find(0, buf.byteLength, "moov", 0);
      if (!moov) return null;
      var stsd = find(moov.off + moov.hdr, moov.off + moov.size, "stsd", 1);
      if (!stsd) return null;

      // stsd payload: version+flags (4), entry count (4), then the entries.
      var p = stsd.off + stsd.hdr + 8;
      if (p + 16 > buf.byteLength) return null;
      var entrySize = dv.getUint32(p);
      var codec = fourcc(p + 4);
      if (entrySize < 16) return { codec: codec, width: 0, height: 0 };

      // Visual sample entry: 8 byte header, then 24 bytes of boilerplate
      // before the 16-bit width and height.
      var width = 0, height = 0;
      if (p + 36 <= buf.byteLength) {
        width = dv.getUint16(p + 32);
        height = dv.getUint16(p + 34);
      }
      return { codec: codec, width: width, height: height };
    }).catch(function () { return null; });
  }

  // ------------------------------------------------------------------
  // Validation
  // ------------------------------------------------------------------

  function checkType(rule, file, errors) {
    var type = (file.type || "").toLowerCase();
    if (!type) {
      errors.push("The browser could not tell what kind of file this is.");
      return;
    }
    if (rule.formats.indexOf(type) === -1) {
      var nice = rule.formats.map(function (t) {
        return { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP",
                 "image/avif": "AVIF", "video/mp4": "MP4", "video/webm": "WebM" }[t] || t;
      }).join(" or ");
      errors.push("That is a " + type + " file. This slot accepts " + nice + " only.");
    }
  }

  function checkBytes(rule, file, errors, warnings) {
    if (file.size > rule.maxBytes) {
      errors.push("The file is " + fmtBytes(file.size) + ". The limit is " +
        fmtBytes(rule.maxBytes) + ".");
    } else if (file.size > rule.maxBytes * 0.6) {
      warnings.push("The file is " + fmtBytes(file.size) + ", close to the " +
        fmtBytes(rule.maxBytes) + " limit. It will still work but will load slowly on mobile data.");
    }
    if (rule.minBytes && file.size < rule.minBytes) {
      errors.push("The file is only " + fmtBytes(file.size) + ". That is too small - it will look blurry.");
    }
  }

  function checkDimensions(rule, w, h, errors, warnings, what) {
    if (!w || !h) {
      errors.push("The " + what + " dimensions could not be read.");
      return;
    }
    if (w < rule.minWidth || h < rule.minHeight) {
      errors.push("The " + what + " is " + dims(w, h) + ". It must be at least " +
        dims(rule.minWidth, rule.minHeight) + ".");
    }
    if (w > rule.maxWidth || h > rule.maxHeight) {
      errors.push("The " + what + " is " + dims(w, h) + ". The limit is " +
        dims(rule.maxWidth, rule.maxHeight) + ". Crop or resize it before uploading.");
    }
  }

  function checkAspect(rule, w, h, errors, warnings, what) {
    if (!w || !h) return;
    var r = w / h;

    if (rule.aspectMin != null) {
      // Product cards accept a wide range but refuse extremes.
      if (r < rule.aspectMin || r > rule.aspectMax) {
        errors.push("The " + what + " is " + ratioLabel(r) + " (" + dims(w, h) +
          "). It must be between " + ratioLabel(rule.aspectMin) + " and " +
          ratioLabel(rule.aspectMax) + " or it will look wrong in the product card.");
        return;
      }
      var off = Math.abs(r - rule.aspect) / rule.aspect;
      if (off > rule.aspectTolerance) {
        warnings.push("The " + what + " is " + ratioLabel(r) + ". A " +
          ratioLabel(rule.aspect) + " image fills the product card best.");
      }
      return;
    }

    var target = rule.aspect;
    var delta = Math.abs(r - target) / target;
    if (delta > rule.aspectTolerance) {
      errors.push("The " + what + " is " + ratioLabel(r) + " (" + dims(w, h) +
        "). This slot is cropped to a " + ratioLabel(target) +
        " frame, so the picture has to match that shape. Crop it to " +
        ratioLabel(target) + " and upload it again.");
    } else if (delta > rule.aspectTolerance * 0.5) {
      warnings.push("The " + what + " is " + ratioLabel(r) + ". " +
        ratioLabel(target) + " is a closer match.");
    }
  }

  function validateImage(file, rule) {
    var errors = [], warnings = [];
    var result = { ok: false, errors: errors, warnings: warnings, info: {} };

    checkType(rule, file, errors);
    // A file of the wrong type cannot be probed at all, so stop here.
    if (errors.length) return Promise.resolve(result);

    // The size check does not stop the probe. Reporting every problem at
    // once saves the admin a round trip of fixing one thing, uploading,
    // and being refused for the next.
    checkBytes(rule, file, errors, warnings);

    return probeImage(file).then(function (info) {
      result.info = { width: info.width, height: info.height, aspect: info.width / info.height };
      checkDimensions(rule, info.width, info.height, errors, warnings, "image");
      checkAspect(rule, info.width, info.height, errors, warnings, "image");
      result.ok = errors.length === 0;
      return result;
    }).catch(function (err) {
      errors.push(err && err.message ? err.message : "The image could not be read.");
      result.ok = false;
      return result;
    });
  }

  function validateVideo(file, rule) {
    var errors = [], warnings = [];
    var result = { ok: false, errors: errors, warnings: warnings, info: {} };

    checkType(rule, file, errors);
    if (errors.length) return Promise.resolve(result);

    checkBytes(rule, file, errors, warnings);

    return Promise.all([probeVideo(file), sniffMp4(file)]).then(function (parts) {
      var v = parts[0] || {};
      var mp4 = parts[1] || null;
      result.info = {
        width: v.width || 0,
        height: v.height || 0,
        duration: v.duration || 0,
        codec: mp4 ? mp4.codec : null
      };

      checkDimensions(rule, v.width, v.height, errors, warnings, "video");

      if (rule.minSeconds && v.duration) {
        if (v.duration < rule.minSeconds) {
          errors.push("The video is " + v.duration.toFixed(1) +
            "s long. It needs at least " + rule.minSeconds + "s to read as a shot.");
        } else if (v.duration > rule.maxSeconds) {
          errors.push("The video is " + v.duration.toFixed(1) +
            "s long. The limit is " + rule.maxSeconds +
            "s - longer clips make the page heavy on mobile.");
        } else if (v.duration > rule.recommendedSeconds) {
          warnings.push("The video is " + v.duration.toFixed(1) +
            "s long. Around " + rule.recommendedSeconds + "s keeps the page light.");
        }
      }

      // Only MP4 can be inspected reliably. WebM carries its codec in an
      // EBML header we do not parse, so it is trusted as-is.
      var isMp4 = (file.type || "").toLowerCase() === "video/mp4";
      if (isMp4 && mp4 && mp4.codec) {
        var name = rule.mp4CodecNames[mp4.codec] || mp4.codec;
        if (rule.mp4Codecs.indexOf(mp4.codec) === -1) {
          errors.push("This MP4 is encoded as " + name + ". Some browsers cannot play it, " +
            "which shows as a black box. Re-export it as H.264 MP4.");
        }
      } else if (isMp4 && !mp4) {
        warnings.push("The video codec could not be read. Make sure it is H.264 " +
          "so it plays in every browser.");
      }

      checkAspect(rule, v.width, v.height, errors, warnings, "video");
      result.ok = errors.length === 0;
      return result;
    }).catch(function (err) {
      errors.push(err && err.message ? err.message : "The video could not be read.");
      result.ok = false;
      return result;
    });
  }

  function validate(file, rule) {
    if (rule.formats.some(function (t) { return t.indexOf("video/") === 0; })) {
      return validateVideo(file, rule);
    }
    return validateImage(file, rule);
  }

  // ------------------------------------------------------------------
  // Poster frame capture
  // ------------------------------------------------------------------

  // Every video slot on the site has a poster attribute. If the video is
  // replaced but the poster is not, the page shows the old shot until the
  // new video starts playing. Grabbing a frame from the uploaded file keeps
  // the two in step.
  function capturePoster(file, atSeconds) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var el = document.createElement("video");
      var settled = false;

      function finish(err, blob) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        el.removeAttribute("src");
        try { el.load(); } catch (e) {}
        URL.revokeObjectURL(url);
        if (err) reject(err); else resolve(blob);
      }

      var timer = setTimeout(function () {
        finish(new Error("Could not read a frame from that video."));
      }, PROBE_TIMEOUT);

      el.preload = "auto";
      el.muted = true;
      el.playsInline = true;
      el.crossOrigin = "anonymous";

      el.onloadeddata = function () {
        var target = (atSeconds && atSeconds > 0) ? atSeconds : Math.min(0.5, (el.duration || 1) / 4);
        function grab() {
          try {
            var canvas = document.createElement("canvas");
            canvas.width = el.videoWidth || 1280;
            canvas.height = el.videoHeight || 720;
            var ctx = canvas.getContext("2d");
            if (!ctx) { finish(new Error("This browser cannot capture video frames.")); return; }
            ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
            canvas.toBlob(function (blob) {
              if (blob) finish(null, blob);
              else finish(new Error("Could not capture a poster frame."));
            }, "image/jpeg", 0.82);
          } catch (e) {
            finish(new Error("Could not capture a poster frame."));
          }
        }
        try { el.currentTime = target; } catch (e) { grab(); return; }
        el.onseeked = grab;
      };
      el.onerror = function () { finish(new Error("That video could not be opened.")); };
      el.src = url;
    });
  }

  // ------------------------------------------------------------------
  // Human readable summaries, shown on each card in the admin panel
  // ------------------------------------------------------------------

  function describeImage(rule) {
    var parts = [];
    parts.push("JPG, PNG, WebP or AVIF");
    parts.push("at least " + dims(rule.minWidth, rule.minHeight));
    parts.push("up to " + dims(rule.maxWidth, rule.maxHeight));
    parts.push(fmtBytes(rule.maxBytes) + " maximum");
    if (rule.aspect) parts.push("best at " + ratioLabel(rule.aspect));
    return parts;
  }

  function describeVideo(rule) {
    var parts = [];
    parts.push("MP4 (H.264) or WebM");
    parts.push("at least " + dims(rule.minWidth, rule.minHeight));
    parts.push("up to " + dims(rule.maxWidth, rule.maxHeight));
    parts.push(rule.minSeconds + "-" + rule.maxSeconds + " seconds");
    parts.push(fmtBytes(rule.maxBytes) + " maximum");
    parts.push("best at " + ratioLabel(rule.aspect));
    return parts;
  }

  function describe(rule) {
    return (rule.formats.some(function (t) { return t.indexOf("video/") === 0; })
      ? describeVideo(rule) : describeImage(rule));
  }

  // Label/value rows for the admin panel, so the requirement is visible
  // next to the file picker instead of being discovered after the upload.
  function summary(rule) {
    var isVideo = rule.formats.some(function (t) { return t.indexOf("video/") === 0; });
    var rows = [];

    rows.push({
      label: "Format",
      value: isVideo ? "MP4 (H.264) or WebM" : "JPG, PNG, WebP or AVIF"
    });
    rows.push({
      label: "Pixels",
      value: "at least " + dims(rule.minWidth, rule.minHeight) +
        ", up to " + dims(rule.maxWidth, rule.maxHeight)
    });
    rows.push({
      label: "Shape",
      value: rule.aspectMin != null
        ? "between " + ratioLabel(rule.aspectMin) + " and " + ratioLabel(rule.aspectMax) +
          ", best at " + ratioLabel(rule.aspect)
        : ratioLabel(rule.aspect) + " - crop to this before uploading"
    });
    if (isVideo) {
      rows.push({
        label: "Length",
        value: rule.minSeconds + "-" + rule.maxSeconds + " seconds (best under " +
          rule.recommendedSeconds + "s)"
      });
    }
    rows.push({ label: "Weight", value: fmtBytes(rule.maxBytes) + " maximum" });

    return rows;
  }

  function ruleForSlot(key) {
    var entry = SLOT_RULES[key];
    return entry ? entry.rule : null;
  }

  window.MwemtsiRules = {
    HERO_IMAGE: HERO_IMAGE,
    PRODUCT_IMAGE: PRODUCT_IMAGE,
    HERO_VIDEO: HERO_VIDEO,
    SLOT_RULES: SLOT_RULES,
    ruleForSlot: ruleForSlot,
    validate: validate,
    validateImage: validateImage,
    validateVideo: validateVideo,
    probeImage: probeImage,
    probeVideo: probeVideo,
    sniffMp4: sniffMp4,
    capturePoster: capturePoster,
    describe: describe,
    summary: summary,
    ratioLabel: ratioLabel,
    fmtBytes: fmtBytes
  };
})();
