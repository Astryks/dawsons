# UX & Product Design

This informs how M6 (timeline + AI breakdown UI) gets built, and introduces
a new local-only Voice Notes feature. Grounded in general, well-established
DAW UX conventions (track-based layering, loop libraries, progressive
disclosure of complexity) rather than any single product's exact interface
— Dawsons' actual layout, icon set, and interaction details are original,
not a copy of any existing app.

## Design principles

- **Progressive disclosure**: show what's needed for the task at hand,
  hide advanced controls until asked for. A new user should see "add an
  instrument" and "play," not a wall of routing/automation options.
- **Track-based layering is the default view**: each instrument/stem is a
  horizontal lane in a vertical stack. Adding or removing one is a
  one-click action, never buried in a menu.
- **AI actions live inline on the timeline**, not in a separate disconnected
  panel — a detected chord or an AI-separated stem should feel like part of
  the track it belongs to (with its confidence score visible), not output
  from a bolted-on chatbot.
- A **grid/clip-launching view** (in the spirit of clip-based arrangement
  tools some DAWs offer) is a plausible later addition for loop-based
  arranging, but it's explicitly out of scope for Phase 1 — the timeline
  view above is the only one being built now.

## Track / instrument layer UI (concrete requirement for M6)

- Track header: instrument icon, name, mute/solo, volume fader, and — for
  AI-detected tracks — a small confidence badge (reads directly from the
  Scene Graph's `confidence`/`source` fields, so there's no separate data
  path to keep in sync).
- A persistent "+" add-track control opens an instrument picker (search box
  + categories: Vocals, Drums, Bass, Guitar, Keys, Synth, Other).
- Tracks are drag-to-reorder. Removing a track is instant unless it holds
  unsaved recorded audio, in which case it asks for confirmation once.
- A collapsed/expanded row-height toggle keeps a 10+ track song from
  forcing excessive scrolling.

## Song browser (concrete requirement for M6)

A dropdown in the top toolbar, next to the app title, listing: recently
opened projects, a search field, "Import new song," and "New empty
project." Switching projects swaps the entire Scene Graph and track list
without a reload — another point in favor of Rust holding the Scene Graph
as an in-memory struct it can hot-swap (see ADR 0001), rather than the UI
re-deriving state from scratch per project.

## Voice Notes (new feature — local-only, zero server cost)

Problem: a place to quickly capture a vocal/musical idea, without taking
on any server or cloud storage cost.

Resolution: Voice Notes are captured and stored **entirely on-device**,
using the same `cpal` device I/O path the audio engine already has for
playback (input capture is the mirror operation), encoded as Opus (much
smaller than WAV for spoken/sung ideas, still fully permissive-licensed —
part of the same free-dependency policy as everything else), and recorded
as a row in the existing local SQLite database (title, duration,
created-at, optional linked project). No new infrastructure, no recurring
cost, consistent with the project's local-first principle from day one.

A natural (but not-yet-built) bridge: promoting a voice note into a
project would feed it straight into the existing voice-to-instrument
pipeline planned for Phase 3 — worth keeping in mind so Voice Notes and
that pipeline share primitives instead of becoming two disconnected
features later.

Phase 1 scope for this: a separate flat list UI (its own tab, not on the
timeline) — record, play back, rename, delete. No timeline integration
yet; that's the natural Phase 3 bridge above, not required now.

## Roadmap impact

- **M6** gains concrete UI requirements from this doc: track-header
  add/remove/reorder, the song-browser dropdown, and confidence badges —
  replacing the previously vague "Timeline UI" placeholder.
- **New milestone, M6b — Voice Notes**: sequenced right after M6 since it
  reuses the audio engine's device I/O (capture mirrors playback) and the
  same local SQLite. No sidecar/AI involvement needed for the capture
  mechanism itself.

## Research notes

Current (2026) DAW/GarageBand-alternative products converge on: AI
integration as a differentiator (stem splitting, AI session players),
simplicity via hidden-by-default complexity, strong loop/instrument
libraries, and zero-cost/browser-based accessibility as a major draw for
beginners. This lines up with Dawsons' existing direction — AI-native
analysis plus a genuinely free dependency stack — rather than requiring a
change of course.
