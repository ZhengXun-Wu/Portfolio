# Portfolio interaction analytics

Both HTML entry points load `analytics.js`; the existing measurement ID remains
`G-SBQJQKZJ2C`. The generated `support.js` runtime is not modified. No GA4 admin
configuration is changed by this code.

## Events and interpretation

- `project_open`: actual modal opening or selected-work panel activation, with
  stable `project_id`, public `project_title`, and `entry_point` (`work_grid`,
  `selected_panel`, or `selected_modal`). Renders and gallery changes are not
  opens. Closing a modal back to its selected panel is not another open.
- `project_engagement`: 10/30-second foreground-visible project exposure
- `description_engagement`: 10/30-second foreground-visible description exposure
- `description_end_visible`: the description's bottom marker was on screen
- `pdf_page_view`: a successfully rendered PDF canvas page was visible, once per
  distinct page per viewer document lifetime; resizing and revisiting a page do
  not inflate the count. Thumbnail rendering and navigation requests do not count.
- `portfolio_video_start`, `portfolio_video_progress`,
  `portfolio_video_complete`: native HTML video playback, with autoplay separated
  from non-autoplay players. This is the element’s configured playback mode, not
  proof of user intent. Events dedupe per mounted video/source; reopening a player
  starts a new playback instance. Actual playback can include background/offscreen
  autoplay; it is not foreground attention. Native loops may have an unsampled
  final tail of up to 0.5 seconds: elapsed playback must support it, and native
  played ranges must cover it when available. Completion still requires a natural
  near-full pass, with a conservative smaller-of-0.5s-or-2% coverage tolerance.
  If played ranges are unavailable, a near-end restart after sufficient elapsed
  time can be indistinguishable from a native loop.
  These do not measure external-platform viewing.
- `external_video_click`: opening a YouTube or Bilibili link, with platform metadata
- `portfolio_download_click`: download intent; never a second custom `file_download`
- `contact_click`: email/phone link intent, never a claim that contact was completed

Exposure events cannot establish whether someone read or understood the text.
Only visible time in a foreground tab counts. Exposure windows reset on closing
or changing a project (including returning from a modal to its selected panel).
Repeated opens are intentional separate interactions, not unique visitors.
Downloads and external-link clicks do not establish completion or playback.

Custom event parameters use an allowlist: no email address, phone number, link
text, complete URL, query string, or visitor identifier is included. Public
project IDs/titles describe the work, not the visitor. Standard Google-tag
collection remains subject to GA's own behavior and any existing site settings.
Property-level Enhanced Measurement may independently collect outbound/download
events and link URLs; this code does not alter those settings.

## Testing and opt-out

Use `?analytics=test` for captured local events without loading Google's tag or
sending pageviews/events to GA. `window.__portfolioAnalyticsEvents` contains the
captured events, also logged with the `[PortfolioAnalytics:test]` console prefix.
Test/off mode persists in session storage across page navigation. To exit, remove
`sessionStorage['portfolio-analytics-mode']` and the URL parameter, then reload.
Test mode also propagates to internal page links if storage is blocked.
Localhost also uses test mode. Use `?analytics=off` to disable
collection. Persistent opt-out: set `localStorage['portfolio-analytics']='off'`
and reload; remove that key to restore normal behavior.

Run deterministic tests from the repository root:

```sh
node --test tests/*.test.cjs
```

These cover analytics logic and component integration, including interrupted and
repeated flows. They do not prove that a particular GA4 property receives events.
For browser QA, use test mode before interacting and inspect only captured events;
never generate production traffic as a test. Do not navigate to an unguarded
production page during QA.

## GA4 reporting setup (optional, in the existing property's Admin)

For breakdowns in reports or Explore, add **event-scoped custom dimensions** for
`project_id`, `project_title`, `entry_point`, `threshold_seconds`, `document_id`,
`page_number`, `page_count`, `media_context`, `playback_type`, `media_id`,
`video_percent`, `platform`, and `contact_method` as needed. Prefer the dimensions
you will actually analyze; registration is not retroactive. Count events with
GA's built-in event count rather than inventing visitor/read totals.

Confirm that the existing measurement ID belongs to the intended web data stream.
After real visitors use the site, verify event receipt in Realtime and later in
reports. Code tests and successful deployment do not verify ingestion, consent,
ad-blocker behavior, filters, or the property's stream configuration.
