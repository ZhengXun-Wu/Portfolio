/* Portfolio analytics: observable exposure/playback, never a claim that text was read.
 * Test: ?analytics=test (also localhost). Opt out: ?analytics=off, or
 * localStorage.setItem('portfolio-analytics', 'off') before reloading.
 * No dependencies. If IntersectionObserver is unavailable, exposure/PDF tracking
 * is omitted rather than guessed. Native media events do not inspect iframe players.
 */
(function (window, document) {
  'use strict';
  if (window.PortfolioAnalytics) return;

  var MEASUREMENT_ID = 'G-SBQJQKZJ2C';
  var noop = function () {};
  var option = '';
  var storedOff = false;
  var sessionMode = '';
  try { option = new URLSearchParams(window.location.search).get('analytics') || ''; } catch (_) {}
  try { storedOff = window.localStorage.getItem('portfolio-analytics') === 'off'; } catch (_) {}
  try {
    if (option === 'test' || option === 'off') window.sessionStorage.setItem('portfolio-analytics-mode', option);
    sessionMode = window.sessionStorage.getItem('portfolio-analytics-mode') || '';
  } catch (_) {}
  var local = /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/.test(window.location.hostname);
  var mode = option === 'off' || storedOff || (option !== 'test' && sessionMode === 'off') ? 'off' :
    option === 'test' || sessionMode === 'test' || local ? 'test' : 'production';
  var events = mode === 'test' ? (window.__portfolioAnalyticsEvents = []) : null;
  var allowedEvents = new Set([
    'project_open', 'project_engagement', 'description_engagement', 'description_end_visible',
    'pdf_page_view', 'contact_click', 'external_video_click', 'portfolio_download_click',
    'portfolio_video_start', 'portfolio_video_progress', 'portfolio_video_complete'
  ]);
  var allowedParams = new Set([
    'project_id', 'project_title', 'entry_point', 'threshold_seconds', 'document_id',
    'page_number', 'page_count', 'contact_method', 'platform', 'media_id',
    'media_context', 'playback_type', 'video_percent'
  ]);

  function cleanParams(params) {
    var result = {};
    Object.keys(params || {}).forEach(function (key) {
      if (!allowedParams.has(key)) return;
      var value = params[key];
      if (typeof value === 'string' && value) result[key] = value.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100);
      else if (typeof value === 'number' && Number.isFinite(value)) result[key] = value;
      else if (typeof value === 'boolean') result[key] = value;
    });
    return result;
  }

  function track(name, params) {
    if (mode === 'off' || !allowedEvents.has(name)) return false;
    try {
      var safe = cleanParams(params);
      if (events) {
        events.push({ name: name, params: safe });
        if (window.console && window.console.debug) window.console.debug('[PortfolioAnalytics:test]', name, JSON.stringify(safe));
      }
      else if (typeof window.gtag === 'function') window.gtag('event', name, safe);
      return true;
    } catch (_) { return false; }
  }

  // Do not initialize gtag at all in test/off modes. Strip query strings and
  // fragments from default page metadata; they may contain contact or test data.
  function safePageUrl(value) {
    try { var url = new URL(value, window.location.href); return url.origin + url.pathname; } catch (_) { return ''; }
  }
  if (mode !== 'production') window['ga-disable-' + MEASUREMENT_ID] = true;
  else {
    try {
      window.dataLayer = window.dataLayer || [];
      window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
      window.gtag('js', new Date());
      window.gtag('config', MEASUREMENT_ID, {
        page_location: safePageUrl(window.location.href),
        page_referrer: document.referrer ? safePageUrl(document.referrer) : '',
        allow_google_signals: false,
        allow_ad_personalization_signals: false
      });
      var script = document.createElement('script');
      script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
      (document.head || document.documentElement).appendChild(script);
    } catch (_) { /* Analytics must never interrupt portfolio navigation. */ }
  }

  function attr(element, name) { return element && element.getAttribute ? element.getAttribute(name) : null; }
  function nearest(element, selector) { return element && element.closest ? element.closest(selector) : null; }
  function metadata(element) {
    var project = nearest(element, '[data-analytics-project-id]');
    var entry = nearest(element, '[data-analytics-entry]');
    return cleanParams({
      project_id: attr(project, 'data-analytics-project-id'),
      project_title: attr(project, 'data-analytics-project-title'),
      entry_point: attr(entry, 'data-analytics-entry')
    });
  }
  function foreground() {
    return document.visibilityState !== 'hidden' && (!document.hasFocus || document.hasFocus());
  }
  function now() { return window.performance && window.performance.now ? window.performance.now() : Date.now(); }
  function connected(element) { return element && element.isConnected !== false; }
  function seen(entry) { return entry.isIntersecting && entry.intersectionRatio > 0; }
  function onForeground(callback) {
    document.addEventListener('visibilitychange', callback);
    window.addEventListener('focus', callback);
    window.addEventListener('blur', callback);
    return function () {
      document.removeEventListener('visibilitychange', callback);
      window.removeEventListener('focus', callback);
      window.removeEventListener('blur', callback);
    };
  }

  function watchProject(root, suppliedMeta) {
    if (mode === 'off' || !root || !window.IntersectionObserver) return noop;
    var observer;
    var removeForeground = noop;
    var timer = null;
    var stopped = false;
    var projectVisible = false;
    var descriptionVisible = false;
    var endVisible = false;
    var endSent = false;
    var projectActive = false;
    var descriptionActive = false;
    var last = now();
    var totals = { project: 0, description: 0 };
    var sent = { project: new Set(), description: new Set() };
    var meta = cleanParams(suppliedMeta || metadata(root));
    function emitThresholds(kind, event) {
      [10, 30].forEach(function (seconds) {
        if (totals[kind] >= seconds * 1000 && !sent[kind].has(seconds)) {
          sent[kind].add(seconds);
          track(event, Object.assign({}, meta, { threshold_seconds: seconds }));
        }
      });
    }
    function settle() {
      var time = now();
      var elapsed = Math.max(0, time - last);
      if (projectActive) totals.project += elapsed;
      if (descriptionActive) totals.description += elapsed;
      last = time;
      emitThresholds('project', 'project_engagement');
      emitThresholds('description', 'description_engagement');
    }
    function update() {
      if (stopped) return;
      settle();
      projectActive = projectVisible && foreground() && connected(root);
      descriptionActive = projectActive && descriptionVisible;
      if (projectActive && endVisible && !endSent) {
        endSent = true;
        track('description_end_visible', meta);
      }
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      if ((projectActive && !sent.project.has(30)) || (descriptionActive && !sent.description.has(30))) {
        var delay = 1000;
        [10, 30].forEach(function (seconds) {
          if (projectActive && !sent.project.has(seconds)) delay = Math.min(delay, seconds * 1000 - totals.project);
          if (descriptionActive && !sent.description.has(seconds)) delay = Math.min(delay, seconds * 1000 - totals.description);
        });
        timer = window.setTimeout(update, Math.max(1, delay));
      }
    }
    function stop() {
      if (stopped) return;
      settle();
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
      if (observer) observer.disconnect();
      removeForeground();
    }
    try {
      var description = root.querySelector('[data-analytics-description]');
      var end = root.querySelector('[data-analytics-description-end]');
      // A viewport-rooted observer also clips against ALL scroll ancestors,
      // including the project's inner description scroller and the outer viewport.
      observer = new window.IntersectionObserver(function (entries) {
        if (stopped) return;
        settle();
        entries.forEach(function (entry) {
          if (entry.target === root) projectVisible = seen(entry);
          if (entry.target === description) descriptionVisible = seen(entry);
          if (entry.target === end) endVisible = seen(entry);
        });
        update();
      }, { root: null, threshold: [0, 0.01] });
      observer.observe(root);
      if (description) observer.observe(description);
      if (end) observer.observe(end);
      removeForeground = onForeground(update);
      return stop;
    } catch (_) { stop(); return noop; }
  }

  var pdfSeen = new Set();
  var pdfPending = new Map();
  function pdfPage(canvas, page, total) {
    if (mode === 'off' || !canvas || !window.IntersectionObserver) return noop;
    var documentRoot = nearest(canvas, '[data-analytics-document-id]');
    var documentId = attr(documentRoot, 'data-analytics-document-id') || 'portfolio';
    // Cancel even when the replacement page was already counted. The old canvas
    // may have been detached or repainted while waiting for foreground exposure.
    var previous = pdfPending.get(documentId);
    if (previous) previous();
    if (!Number.isInteger(page) || !Number.isInteger(total) || page < 1 || page > total) return noop;
    var key = documentId + ':' + page;
    if (pdfSeen.has(key)) return noop;
    var observer;
    var removeForeground = noop;
    var visible = false;
    var stopped = false;
    function stop() {
      if (stopped) return;
      stopped = true;
      if (observer) observer.disconnect();
      removeForeground();
      if (pdfPending.get(documentId) === stop) pdfPending.delete(documentId);
    }
    function check() {
      if (stopped || !visible || !foreground() || !connected(canvas)) return;
      pdfSeen.add(key);
      track('pdf_page_view', Object.assign({}, metadata(canvas), {
        document_id: documentId, page_number: page, page_count: total
      }));
      stop();
    }
    try {
      pdfPending.set(documentId, stop);
      observer = new window.IntersectionObserver(function (entries) {
        if (stopped) return;
        entries.forEach(function (entry) { if (entry.target === canvas) visible = seen(entry); });
        check();
      }, { root: null, threshold: [0, 0.01] });
      observer.observe(canvas);
      removeForeground = onForeground(check);
      return stop;
    } catch (_) { stop(); return noop; }
  }

  function click(event) {
    try {
      var target = event.target && event.target.nodeType === 3 ? event.target.parentElement : event.target;
      var link = nearest(target, 'a[href]');
      if (!link) return;
      var href = attr(link, 'href') || '';
      if (/^mailto:/i.test(href)) { track('contact_click', { contact_method: 'email' }); return; }
      if (/^tel:/i.test(href)) { track('contact_click', { contact_method: 'phone' }); return; }
      var url = new URL(href, window.location.href);
      var meta = metadata(link);
      // Preserve the test gate across same-origin page navigation even when
      // session storage is blocked. Never rewrite downloads or external links.
      if (mode === 'test' && url.origin === window.location.origin && href.charAt(0) !== '#' &&
          !link.hasAttribute('download') && !link.hasAttribute('data-analytics-download') &&
          /(?:\.html?\/?|\/|\/[^/.]+)$/.test(url.pathname)) {
        url.searchParams.set('analytics', 'test');
        link.setAttribute('href', url.href);
      }
      if (link.hasAttribute('download') || link.hasAttribute('data-analytics-download')) {
        track('portfolio_download_click', Object.assign({}, meta, {
          document_id: attr(link, 'data-analytics-document-id') || 'portfolio-2026',
          entry_point: meta.entry_point || 'pdf_viewer'
        }));
        return;
      }
      var host = url.hostname.toLowerCase();
      var platform = /(^|\.)youtube\.com$/.test(host) || host === 'youtu.be' ? 'youtube' :
        /(^|\.)bilibili\.com$/.test(host) || host === 'b23.tv' ? 'bilibili' : '';
      if (platform) track('external_video_click', Object.assign({}, meta, { platform: platform }));
    } catch (_) {}
  }

  var videos = new WeakMap();
  var videoSequence = 0;
  function videoState(video) {
    // Source URLs are used ONLY as in-memory identities, never event parameters.
    var source = video.currentSrc || attr(video, 'src') || '';
    var sources = videos.get(video);
    if (!sources) { sources = new Map(); videos.set(video, sources); }
    var state = sources.get(source);
    if (!state) {
      state = {
        id: attr(video, 'data-analytics-media-id') || attr(video, 'data-analytics-video-id') || 'native_video_' + (++videoSequence),
        started: false, completed: false, progress: new Set(), playing: false,
        seeking: false, lastTime: null, lastWall: now(), natural: 0, completionEligible: false
      };
      sources.set(source, state);
    }
    return state;
  }
  function videoParams(video, state, percent) {
    var meta = metadata(video);
    return Object.assign({}, meta, {
      media_id: state.id,
      media_context: meta.project_id ? 'project' : 'hero',
      // This describes the element's playback mode, not inferred user intent.
      playback_type: video.autoplay ? 'autoplay' : 'user_initiated'
    }, percent === undefined ? {} : { video_percent: percent });
  }
  function completeVideo(video, state) {
    var duration = video.duration;
    var tolerance = Math.min(0.5, duration * 0.02);
    if (!state.completed && state.completionEligible && state.natural >= duration - tolerance) {
      state.completed = true;
      track('portfolio_video_complete', videoParams(video, state, 100));
    }
  }
  function sampleVideo(video, state, ending) {
    var time = Number(video.currentTime);
    var duration = Number(video.duration);
    var wall = now();
    if (!Number.isFinite(time) || !Number.isFinite(duration) || duration <= 0) return;
    var previous = state.lastTime;
    var elapsed = Math.max(0, (wall - state.lastWall) / 1000);
    state.lastTime = time;
    state.lastWall = wall;
    if (previous === null || state.seeking || video.seeking || !state.playing || (!ending && video.paused)) return;
    var delta = time - previous;
    // Native seeking events are primary protection; this plausibility bound also
    // rejects discontinuities lacking seeking events. It is conservative after stalls.
    var plausible = elapsed * Math.max(0, Number(video.playbackRate) || 1) + 0.75;
    if (delta < 0 && video.loop && previous >= duration - plausible && time <= plausible && duration - previous + time <= plausible) {
      if (state.completionEligible) state.natural += duration - previous + time;
      completeVideo(video, state);
      state.completionEligible = true;
      state.natural = time;
      return;
    }
    if (delta < 0 || delta > plausible) {
      state.natural = 0;
      state.completionEligible = time <= 0.05;
      return;
    }
    if (state.completionEligible) state.natural += delta;
    [25, 50, 75].forEach(function (percent) {
      var threshold = duration * percent / 100;
      if (previous < threshold && time >= threshold && !state.progress.has(percent)) {
        state.progress.add(percent);
        track('portfolio_video_progress', videoParams(video, state, percent));
      }
    });
  }
  function loopTailPlayed(video, state) {
    if (state.lastTime === null || !state.playing || state.seeking) return false;
    var duration = Number(video.duration);
    var tail = duration - state.lastTime;
    var elapsed = Math.max(0, (now() - state.lastWall) / 1000) * Math.max(0, Number(video.playbackRate) || 1);
    if (!Number.isFinite(duration) || duration <= 0 || tail < 0 || tail > 0.5 || tail > elapsed + 0.02) return false;
    // HTMLMediaElement.played distinguishes an actual automatic wrap from a
    // manual restart while stalled near the end. Without that API, retain the
    // conservative elapsed-time/sampling checks rather than guessing a long gap.
    if (video.played) {
      try {
        for (var index = 0; index < video.played.length; index++) {
          if (video.played.start(index) <= state.lastTime + 0.02 && video.played.end(index) >= duration - 0.02) return true;
        }
        return false;
      } catch (_) { return false; }
    }
    return true;
  }
  function media(event) {
    try {
      var video = event.target;
      if (!video || String(video.tagName).toLowerCase() !== 'video') return;
      var state = videoState(video);
      var time = Number(video.currentTime) || 0;
      if (event.type === 'playing') {
        state.playing = true;
        if (state.lastTime === null) state.completionEligible = time <= 0.05;
        state.lastTime = time;
        state.lastWall = now();
        if (!state.started) {
          state.started = true;
          track('portfolio_video_start', videoParams(video, state));
        }
      } else if (event.type === 'seeking') {
        // Native looping may seek to zero before another timeupdate. Account
        // for a short unsampled tail only when elapsed playback time supports it
        // and, in browsers exposing played ranges, that tail was actually played.
        // A fixed 0.5s sampling bound also works for the portfolio's short clips;
        // a percentage-only tolerance is smaller than their timeupdate cadence.
        if (video.loop && time <= 0.05 && state.completionEligible && loopTailPlayed(video, state)) {
          state.natural += Number(video.duration) - state.lastTime;
          completeVideo(video, state);
        }
        state.seeking = true;
        state.completionEligible = false;
        state.natural = 0;
        state.lastTime = null;
      } else if (event.type === 'seeked') {
        state.seeking = false;
        state.lastTime = time;
        state.lastWall = now();
        state.natural = 0;
        state.completionEligible = time <= 0.05;
      } else if (event.type === 'timeupdate') sampleVideo(video, state, false);
      else if (event.type === 'ended') {
        sampleVideo(video, state, true);
        if (Number.isFinite(video.duration) && time >= video.duration - 0.05) completeVideo(video, state);
        state.playing = false;
      } else if (event.type === 'pause') {
        sampleVideo(video, state, true);
        state.playing = false;
      }
    } catch (_) {}
  }

  window.PortfolioAnalytics = Object.freeze({ mode: mode, track: track, watchProject: watchProject, pdfPage: pdfPage });
  if (mode !== 'off') {
    document.addEventListener('click', click, true);
    ['playing', 'seeking', 'seeked', 'timeupdate', 'ended', 'pause'].forEach(function (event) {
      document.addEventListener(event, media, true);
    });
  }
})(window, document);
