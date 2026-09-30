'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../analytics.js'), 'utf8');

class Hub {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, callback) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(callback);
  }
  removeEventListener(name, callback) { this.listeners.get(name)?.delete(callback); }
  fire(name, extra = {}) {
    for (const callback of [...(this.listeners.get(name) || [])]) callback({ type: name, ...extra });
  }
}
class Element {
  constructor(tagName = 'div', attrs = {}) {
    this.tagName = tagName.toUpperCase(); this.attrs = { ...attrs }; this.children = [];
    this.parentElement = null; this.isConnected = true; this.nodeType = 1;
  }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  matches(selector) {
    if (selector === 'a[href]') return this.tagName === 'A' && this.hasAttribute('href');
    const attribute = /^\[([^\]]+)\]$/.exec(selector);
    return attribute ? this.hasAttribute(attribute[1]) : false;
  }
  closest(selector) {
    let node = this;
    while (node) { if (node.matches(selector)) return node; node = node.parentElement; }
    return null;
  }
  querySelector(selector) {
    for (const child of this.children) {
      if (child.matches(selector)) return child;
      const result = child.querySelector(selector); if (result) return result;
    }
    return null;
  }
}
function environment(options = {}) {
  let time = 0; let sequence = 0; let focused = options.focused ?? true;
  const timers = new Map(); const observers = []; const logs = [];
  const document = new Hub(); const window = new Hub();
  const location = new URL(options.url || 'https://portfolio.example/index.html?analytics=test');
  const session = options.session || new Map();
  const local = new Map(options.local || []);
  function storage(values) {
    return {
      getItem(key) { if (options.storageBlocked) throw new Error('Blocked'); return values.get(key) ?? null; },
      setItem(key, value) { if (options.storageBlocked) throw new Error('Blocked'); values.set(key, value); }
    };
  }
  Object.assign(document, {
    visibilityState: options.hidden ? 'hidden' : 'visible', hasFocus: () => focused,
    head: new Element('head'), documentElement: new Element('html'),
    referrer: options.referrer || '', createElement: tag => new Element(tag)
  });
  Object.assign(window, {
    location, localStorage: storage(local), sessionStorage: storage(session),
    performance: { now: () => time }, console: { debug: (...args) => logs.push(args) },
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, at: time + delay }); return id; },
    clearTimeout: id => timers.delete(id)
  });
  if (options.intersection !== false) window.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); this.disconnected = false; observers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
  };
  const context = vm.createContext({ window, document, URL, URLSearchParams, console, Date, Set, Map, WeakMap });
  const run = () => vm.runInContext(source, context, { filename: 'analytics.js' });
  run();
  const api = window.PortfolioAnalytics;
  function advance(ms) {
    const target = time + ms; let guard = 10000;
    while (guard--) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      time = next[1].at; timers.delete(next[0]); next[1].callback();
    }
    assert.ok(guard > 0, 'Timer should not spin'); time = target;
  }
  function intersect(target, visible = true, ratio = visible ? 1 : 0) {
    for (const observer of observers) if (!observer.disconnected && observer.targets.has(target)) {
      observer.callback([{ target, isIntersecting: visible, intersectionRatio: ratio }]);
    }
  }
  function visibility(visible) { document.visibilityState = visible ? 'visible' : 'hidden'; document.fire('visibilitychange'); }
  function focus(value) { focused = value; window.fire(value ? 'focus' : 'blur'); }
  function events(name) {
    const result = window.__portfolioAnalyticsEvents || [];
    return JSON.parse(JSON.stringify(name ? result.filter(event => event.name === name) : result));
  }
  function video(attrs = {}) {
    return Object.assign(new Element('video', { src: '/media/demo.mp4', ...attrs }), {
      currentTime: 0, currentSrc: '/media/demo.mp4', duration: 100, autoplay: false,
      playbackRate: 1, paused: false, seeking: false, loop: false
    });
  }
  function media(video, type) { document.fire(type, { target: video }); }
  function playTo(video, until, step = 1) {
    while (video.currentTime < until) {
      const delta = Math.min(step, until - video.currentTime);
      advance(delta * 1000 / video.playbackRate); video.currentTime += delta; media(video, 'timeupdate');
    }
  }
  return { window, document, api, advance, intersect, visibility, focus, events, session, observers, timers, logs, run, video, media, playTo };
}
function project() {
  const root = new Element('div', { 'data-analytics-project-id': 'short-film', 'data-analytics-project-title': 'Short Film', 'data-analytics-entry': 'project_grid' });
  const description = root.appendChild(new Element('p', { 'data-analytics-description': '1' }));
  const end = description.appendChild(new Element('span', { 'data-analytics-description-end': '1' }));
  return { root, description, end };
}
const meta = { project_id: 'short-film', project_title: 'Short Film', entry_point: 'project_grid' };

test('test mode never boots production; event payloads are explicitly allowlisted', () => {
  const env = environment();
  assert.equal(env.api.mode, 'test'); assert.equal(env.window.gtag, undefined);
  assert.equal(env.window.dataLayer, undefined); assert.equal(env.document.head.children.length, 0);
  assert.equal(env.window['ga-disable-G-SBQJQKZJ2C'], true);
  assert.equal(env.api.track('project_open', { ...meta, email: 'private@example.com', link_url: 'https://example.com/?secret', project_title: 'A\nB' }), true);
  assert.deepEqual(env.events(), [{ name: 'project_open', params: { ...meta, project_title: 'AB' } }]);
  assert.equal(env.api.track('file_download', {}), false);
  assert.equal(env.logs.length, 1); assert.equal(env.logs[0][0], '[PortfolioAnalytics:test]');
});
test('production bootstraps exactly once, strips query/fragment metadata, and does not log', () => {
  const env = environment({ url: 'https://portfolio.example/index.html?email=private@example.com#secret', referrer: 'https://ref.example/path?q=private#token' });
  assert.equal(env.api.mode, 'production'); assert.equal(env.document.head.children.length, 1);
  assert.equal(env.document.head.children[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-SBQJQKZJ2C');
  const config = env.window.dataLayer[1];
  assert.equal(config[0], 'config'); assert.equal(config[1], 'G-SBQJQKZJ2C');
  assert.equal(config[2].page_location, 'https://portfolio.example/index.html');
  assert.equal(config[2].page_referrer, 'https://ref.example/path');
  env.api.track('project_open', meta); assert.equal(env.window.dataLayer[2][0], 'event');
  assert.equal(env.logs.length, 0); assert.equal(env.window.__portfolioAnalyticsEvents, undefined);
  env.run(); assert.equal(env.document.head.children.length, 1);
});
test('query/local opt-out and localhost are safe; denied storage never breaks loading', () => {
  for (const options of [
    { url: 'https://portfolio.example/?analytics=off' },
    { local: [['portfolio-analytics', 'off']] },
    { url: 'https://portfolio.example/?analytics=off', storageBlocked: true }
  ]) {
    const env = environment(options); assert.equal(env.api.mode, 'off');
    env.api.track('project_open', meta); assert.deepEqual(env.events(), []);
    assert.equal(env.document.head.children.length, 0); assert.equal(env.window.gtag, undefined);
    assert.equal(env.document.listeners.size, 0);
  }
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.equal(environment({ url: `http://${host}:8000/index.html` }).api.mode, 'test');
  }
  assert.equal(environment({ storageBlocked: true }).api.mode, 'test');
});
test('test/off survive same-origin navigation; test link rewriting never touches files or external links', () => {
  for (const mode of ['test', 'off']) {
    const first = environment({ url: `https://portfolio.example/?analytics=${mode}` });
    const next = environment({ url: 'https://portfolio.example/portfolio-2026.html', session: first.session });
    assert.equal(next.api.mode, mode); assert.equal(next.document.head.children.length, 0);
    const unknown = environment({ url: 'https://portfolio.example/?analytics=unknown', session: first.session });
    assert.equal(unknown.api.mode, mode);
  }
  const env = environment({ storageBlocked: true });
  const page = new Element('a', { href: 'portfolio-2026.html#page' });
  env.document.fire('click', { target: page });
  assert.equal(new URL(page.getAttribute('href')).searchParams.get('analytics'), 'test');
  const file = new Element('a', { href: 'uploads/portfolio.pdf', download: '' });
  env.document.fire('click', { target: file }); assert.equal(file.getAttribute('href'), 'uploads/portfolio.pdf');
  const external = new Element('a', { href: 'https://example.com/index.html' });
  env.document.fire('click', { target: external }); assert.equal(external.getAttribute('href'), 'https://example.com/index.html');
});
test('project/description count foreground exposure at 10 and 30 seconds, once each', () => {
  const env = environment(); const { root, description, end } = project();
  const stop = env.api.watchProject(root, meta);
  assert.equal(env.observers[0].options.root, null);
  env.intersect(root); env.intersect(description); env.advance(9999); assert.deepEqual(env.events(), []);
  env.advance(1); assert.deepEqual(env.events().map(event => [event.name, event.params.threshold_seconds]), [['project_engagement', 10], ['description_engagement', 10]]);
  env.intersect(end); env.intersect(end, false); env.intersect(end);
  assert.equal(env.events('description_end_visible').length, 1);
  env.advance(20000);
  assert.deepEqual(env.events('project_engagement').map(event => event.params.threshold_seconds), [10, 30]);
  assert.deepEqual(env.events('description_engagement').map(event => event.params.threshold_seconds), [10, 30]);
  stop(); stop(); env.advance(50000); assert.equal(env.timers.size, 0); assert.equal(env.observers[0].disconnected, true);
});
test('hidden tabs and unfocused windows pause accumulated engagement exactly', () => {
  const env = environment(); const { root, description, end } = project();
  env.api.watchProject(root, meta); env.intersect(root); env.intersect(description);
  env.advance(9500); env.visibility(false); env.advance(100000); env.intersect(end);
  assert.deepEqual(env.events(), []);
  env.visibility(true); assert.equal(env.events('description_end_visible').length, 1);
  env.advance(500); assert.equal(env.events('project_engagement').length, 1);
  env.focus(false); env.advance(100000); assert.equal(env.events('project_engagement').length, 1);
  env.focus(true); env.advance(20000); assert.equal(env.events('project_engagement').length, 2);
});
test('clipped description accumulates separately; an offscreen project overrides child intersections', () => {
  const env = environment(); const { root, description, end } = project();
  const stop = env.api.watchProject(root, meta);
  env.intersect(description); env.intersect(end); env.advance(30000); assert.deepEqual(env.events(), []);
  env.intersect(root); env.advance(5000); env.intersect(description, false); env.advance(20000);
  assert.equal(env.events('description_engagement').length, 0);
  env.intersect(description); env.advance(5000);
  assert.deepEqual(env.events('description_engagement').map(event => event.params.threshold_seconds), [10]);
  assert.deepEqual(env.events('project_engagement').map(event => event.params.threshold_seconds), [10, 30]);
  stop(); const count = env.events().length; env.advance(100000); assert.equal(env.events().length, count);
});
test('missing IntersectionObserver omits unmeasurable exposure without affecting click tracking', () => {
  const env = environment({ intersection: false });
  assert.doesNotThrow(() => env.api.watchProject(project().root, meta)());
  assert.doesNotThrow(() => env.api.pdfPage(new Element('canvas'), 1, 20)());
  env.document.fire('click', { target: new Element('a', { href: 'mailto:hidden@example.com' }) });
  assert.deepEqual(env.events(), [{ name: 'contact_click', params: { contact_method: 'email' } }]);
});
test('PDF pages emit only after accepted canvas intersects in foreground, deduped across resize/revisit', () => {
  const env = environment({ hidden: true });
  const canvas = new Element('canvas', { 'data-analytics-document-id': 'portfolio-2026' });
  env.api.pdfPage(canvas, 1, 30); env.intersect(canvas); assert.deepEqual(env.events(), []);
  env.visibility(true); assert.deepEqual(env.events(), [{ name: 'pdf_page_view', params: { document_id: 'portfolio-2026', page_number: 1, page_count: 30 } }]);
  env.api.pdfPage(canvas, 1, 30); env.intersect(canvas); assert.equal(env.events().length, 1);
  env.api.pdfPage(canvas, 2, 30); env.intersect(canvas); assert.equal(env.events().length, 2);
  env.api.pdfPage(new Element('canvas', { 'data-analytics-document-id': 'portfolio-2026' }), 1, 30);
  assert.equal(env.events().length, 2);
});
test('PDF replacement cancels stale pending pages, including when replacement was already counted', () => {
  const env = environment(); const first = new Element('canvas'); const second = new Element('canvas');
  env.api.pdfPage(first, 1, 3); env.intersect(first);
  env.visibility(false); env.api.pdfPage(first, 2, 3); env.intersect(first);
  const stale = env.observers.at(-1);
  env.api.pdfPage(second, 3, 3); env.intersect(second);
  env.visibility(true); stale.callback([{ target: first, isIntersecting: true, intersectionRatio: 1 }]);
  assert.deepEqual(env.events().map(event => event.params.page_number), [1, 3]);
  env.visibility(false); env.api.pdfPage(first, 2, 3); env.intersect(first);
  env.api.pdfPage(first, 1, 3); env.visibility(true);
  assert.deepEqual(env.events().map(event => event.params.page_number), [1, 3]);
});
test('PDF cleanup, detached canvases, invalid pages and zero-size intersections never emit', () => {
  const env = environment(); const canvas = new Element('canvas');
  const stop = env.api.pdfPage(canvas, 1, 10); stop(); env.intersect(canvas);
  env.api.pdfPage(canvas, 2, 10); env.intersect(canvas, true, 0);
  canvas.isConnected = false; env.intersect(canvas);
  for (const page of [0, -1, 11, NaN, '1']) env.api.pdfPage(canvas, page, 10);
  assert.deepEqual(env.events(), []);
});
test('delegated contacts/outbound/downloads never send addresses, URLs or duplicate file_download', () => {
  const env = environment(); const { root } = project();
  const email = new Element('a', { href: 'mailto:private@example.com?body=sensitive' });
  const child = email.appendChild(new Element('span')); env.document.fire('click', { target: child });
  env.document.fire('click', { target: new Element('a', { href: 'tel:+15551234567' }) });
  const youtube = root.appendChild(new Element('a', { href: 'https://youtu.be/abc?private=secret' }));
  const bili = root.appendChild(new Element('a', { href: 'https://www.bilibili.com/video/BV123?token=secret' }));
  env.document.fire('click', { target: youtube }); env.document.fire('click', { target: bili });
  env.document.fire('click', { target: new Element('a', { href: 'https://youtube.com.attacker.example/video' }) });
  env.document.fire('click', { target: new Element('a', { href: 'uploads/private-file.pdf', download: 'Private Filename' }) });
  assert.deepEqual(env.events('contact_click').map(event => event.params), [{ contact_method: 'email' }, { contact_method: 'phone' }]);
  assert.deepEqual(env.events('external_video_click').map(event => event.params), [{ ...meta, platform: 'youtube' }, { ...meta, platform: 'bilibili' }]);
  assert.deepEqual(env.events('portfolio_download_click')[0].params, { document_id: 'portfolio-2026', entry_point: 'pdf_viewer' });
  assert.ok(!/private|secret|mailto|tel:|https|file_download/.test(JSON.stringify(env.events())));
});
test('native actual playing emits once per source, records autoplay and project context, natural milestones once', () => {
  const env = environment(); const { root } = project(); const video = root.appendChild(env.video()); video.autoplay = true;
  env.media(video, 'playing'); env.media(video, 'playing'); env.playTo(video, 80);
  assert.equal(env.events('portfolio_video_start').length, 1);
  assert.equal(env.events('portfolio_video_start')[0].params.playback_type, 'autoplay');
  assert.equal(env.events('portfolio_video_start')[0].params.project_id, meta.project_id);
  assert.deepEqual(env.events('portfolio_video_progress').map(event => event.params.video_percent), [25, 50, 75]);
  env.playTo(video, 100); video.paused = true; env.media(video, 'ended'); env.media(video, 'ended');
  assert.equal(env.events('portfolio_video_complete').length, 1);
  assert.ok(!JSON.stringify(env.events()).includes('/media/'));
});
test('seeking over thresholds or to the end never invents progress/completion; a fresh full pass may complete', () => {
  const env = environment(); const video = env.video(); env.media(video, 'playing'); env.playTo(video, 5);
  video.seeking = true; video.currentTime = 90; env.media(video, 'seeking'); env.media(video, 'timeupdate');
  video.seeking = false; env.media(video, 'seeked'); env.playTo(video, 100); env.media(video, 'ended');
  assert.equal(env.events('portfolio_video_progress').length, 0); assert.equal(env.events('portfolio_video_complete').length, 0);
  video.currentTime = 0; env.media(video, 'seeking'); env.media(video, 'seeked'); env.media(video, 'playing');
  env.playTo(video, 100); env.media(video, 'ended');
  assert.deepEqual(env.events('portfolio_video_progress').map(event => event.params.video_percent), [25, 50, 75]);
  assert.equal(env.events('portfolio_video_complete').length, 1);
});
test('a discontinuous jump without seeking events cannot mint skipped thresholds or completion', () => {
  const env = environment(); const video = env.video(); env.media(video, 'playing');
  env.advance(50); video.currentTime = 95; env.media(video, 'timeupdate');
  env.playTo(video, 100); env.media(video, 'ended');
  assert.equal(env.events('portfolio_video_progress').length, 0); assert.equal(env.events('portfolio_video_complete').length, 0);
});
test('loop time wraps complete once; source changes get independent event state', () => {
  const env = environment(); const video = env.video(); video.loop = true; env.media(video, 'playing');
  env.playTo(video, 99.8); env.advance(400); video.currentTime = 0.2; env.media(video, 'timeupdate');
  assert.equal(env.events('portfolio_video_complete').length, 1);
  env.playTo(video, 99.8); env.advance(400); video.currentTime = 0.2; env.media(video, 'timeupdate');
  assert.equal(env.events('portfolio_video_complete').length, 1); assert.equal(env.events('portfolio_video_progress').length, 3);
  video.currentSrc = '/media/other.mp4'; video.currentTime = 0; env.media(video, 'playing');
  assert.equal(env.events('portfolio_video_start').length, 2);
  video.currentSrc = '/media/demo.mp4'; env.media(video, 'playing'); assert.equal(env.events('portfolio_video_start').length, 2);
});
test('native loop seeking-to-zero completes only after a near-full natural pass, once', () => {
  const env = environment(); const video = env.video(); video.loop = true; env.media(video, 'playing');
  env.playTo(video, 99.8); env.advance(200); video.currentTime = 0; env.media(video, 'seeking'); env.media(video, 'seeked');
  assert.equal(env.events('portfolio_video_complete').length, 1);
  env.playTo(video, 99.8); env.advance(200); video.currentTime = 0; env.media(video, 'seeking'); env.media(video, 'seeked');
  assert.equal(env.events('portfolio_video_complete').length, 1);
  const skipped = env.video(); skipped.loop = true; env.media(skipped, 'playing');
  skipped.currentTime = 99.9; env.media(skipped, 'seeking'); env.media(skipped, 'seeked');
  skipped.currentTime = 0; env.media(skipped, 'seeking'); env.media(skipped, 'seeked');
  assert.equal(env.events('portfolio_video_complete').length, 1);
});
test('paused playback, non-video targets and invalid duration cannot emit progress', () => {
  const env = environment(); const video = env.video(); env.media(video, 'playing');
  env.media(video, 'pause'); video.paused = true; env.advance(50000); video.currentTime = 50; env.media(video, 'timeupdate');
  video.duration = NaN; env.media(video, 'ended'); env.media(new Element('iframe'), 'playing');
  assert.equal(env.events('portfolio_video_start').length, 1);
  assert.equal(env.events('portfolio_video_start')[0].params.media_context, 'hero');
  assert.equal(env.events('portfolio_video_start')[0].params.playback_type, 'user_initiated');
  assert.equal(env.events('portfolio_video_progress').length, 0); assert.equal(env.events('portfolio_video_complete').length, 0);
});

test('short native loops account for the proven final timeupdate gap (10s and 7.37s clips)', () => {
  for (const duration of [10, 7.37]) {
    const env = environment(); const video = env.video(); video.duration = duration; video.loop = true;
    env.media(video, 'playing'); env.playTo(video, duration - 0.25, 0.25);
    env.advance(250); video.currentTime = 0;
    // The browser retains the played range through the automatic loop seek.
    video.played = { length: 1, start: () => 0, end: () => duration };
    env.media(video, 'seeking'); env.media(video, 'seeked');
    assert.equal(env.events('portfolio_video_complete').length, 1, `${duration}s loop must complete`);
    env.playTo(video, duration - 0.25, 0.25); env.advance(250); video.currentTime = 0;
    env.media(video, 'seeking'); env.media(video, 'seeked');
    assert.equal(env.events('portfolio_video_complete').length, 1, 'Subsequent loops remain deduped');
  }
});
test('short-loop tail fallback supports missing played API but rejects premature restarts', () => {
  for (const elapsed of [0, 100, 250]) {
    const env = environment(); const video = env.video(); video.duration = 10; video.loop = true;
    env.media(video, 'playing'); env.playTo(video, 9.75, 0.25); env.advance(elapsed);
    video.currentTime = 0; env.media(video, 'seeking'); env.media(video, 'seeked');
    assert.equal(env.events('portfolio_video_complete').length, elapsed === 250 ? 1 : 0);
  }
});
test('native played ranges prevent stalled/manual near-end restarts from claiming a completed loop', () => {
  for (const playedEnd of [0, 9.75]) {
    const env = environment(); const video = env.video(); video.duration = 10; video.loop = true;
    env.media(video, 'playing'); env.playTo(video, 9.75, 0.25); env.advance(1000);
    video.played = { length: playedEnd ? 1 : 0, start: () => 0, end: () => playedEnd };
    video.currentTime = 0; env.media(video, 'seeking'); env.media(video, 'seeked');
    assert.equal(env.events('portfolio_video_complete').length, 0);
  }
});
