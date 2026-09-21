// A small, original set of line-art instrument icons — one consistent
// visual style (rounded strokes, no fill except a few note-head dots)
// instead of mismatched emoji, colored via `currentColor` so each
// instrument can carry its own accent color from the pastel palette
// while staying visually unified as one icon family. Hand-drawn simple
// geometric shapes, not traced from any icon library or product.

const ICON_PATHS = {
  drums: `<ellipse cx="12" cy="7" rx="7" ry="3"/><path d="M5 7v7c0 1.7 3.1 3 7 3s7-1.3 7-3V7"/><path d="M9 6.5l7-4"/><circle cx="16.3" cy="2.3" r="1" fill="currentColor" stroke="none"/>`,
  keys: `<rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="M8 6v13M13 6v13M18 6v13"/><path d="M5.5 6v6M10.5 6v6M15.5 6v6" stroke-width="3"/>`,
  guitar: `<path d="M11 2v10.5"/><rect x="9.3" y="2" width="3.4" height="2.4" rx="0.6"/><circle cx="9.8" cy="15.8" r="2.8"/><circle cx="14" cy="18.2" r="4"/>`,
  bass: `<path d="M10 2v9"/><rect x="8.3" y="2" width="3.4" height="2.2" rx="0.6"/><path d="M6 14.5a4.5 4.5 0 0 1 8 0 5 6 0 0 1 -4 7 5 6 0 0 1 -4 -7z"/>`,
  lead: `<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5v3.5"/><path d="M8.5 21h7"/>`,
  pad: `<path d="M7 16a4 4 0 0 1 .3-8 5 5 0 0 1 9.6 1.3A3.5 3.5 0 0 1 17 16z"/>`,
  brass: `<path d="M3 10.2h4l3-2.2v6.4l-3-2.2H3z"/><path d="M10 9.4h6M10 12.6h6"/><path d="M16 9.4v3.2"/><path d="M18 8.6v4.8M20 9v4"/><circle cx="20.5" cy="14.5" r="2" />`,
  bell: `<path d="M12 3a5 5 0 0 0-5 5c0 5-2 6-2 7h14c0-1-2-2-2-7a5 5 0 0 0-5-5z"/><path d="M10 18a2 2 0 0 0 4 0"/>`,
  flute: `<path d="M3 15.5l16-9"/><circle cx="6.3" cy="13.8" r="0.7" fill="currentColor" stroke="none"/><circle cx="9.1" cy="12.2" r="0.7" fill="currentColor" stroke="none"/><circle cx="11.9" cy="10.6" r="0.7" fill="currentColor" stroke="none"/>`,
  saxophone: `<path d="M9 3l7 4"/><path d="M9 3v9.5a3.5 3.5 0 1 0 3.5 3.5V9"/><circle cx="17.5" cy="8.5" r="1.3"/><path d="M12.5 12.5h4"/>`,
  clarinet: `<path d="M8 2h5v3H8z"/><path d="M9.5 5v15.5a1.5 1.5 0 0 0 3 0V5"/><path d="M9.5 8h3M9.5 11h3M9.5 14h3M9.5 17h3"/>`,
  strings: `<path d="M12 2v7"/><path d="M9.5 2.5h5" stroke-width="1.2"/><path d="M7 14a5 6 0 1 0 10 0 5 6 0 1 0 -10 0z"/><path d="M9.5 12.5c.5 1.5 1 1.5 1.5 1M14.5 12.5c-.5 1.5 -1 1.5 -1.5 1" stroke-width="1"/>`,
  organ: `<path d="M4 20V11M8 20V6M12 20V9M16 20V5M20 20V12"/>`,
  epiano: `<rect x="3" y="7" width="15" height="11" rx="1.5"/><path d="M6.5 7v11M10 7v11M13.5 7v11"/><path d="M19.5 8l-2.5 4h2l-2.5 4" stroke-width="1.4"/>`,
  choir: `<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/>`,
  synthbass: `<rect x="3" y="4" width="18" height="8" rx="1"/><path d="M3 16h3l2-4 2 8 2-8 2 4h3l2-4 2 4h2" stroke-width="1.2"/>`,
  marimba: `<rect x="3" y="14" width="4" height="7" rx="1"/><rect x="8.5" y="12" width="4" height="9" rx="1"/><rect x="14" y="10" width="4" height="11" rx="1"/><path d="M19 4l-4 6" stroke-width="1.6"/><circle cx="19.3" cy="3.3" r="1.3" fill="currentColor" stroke="none"/>`,
  trumpet: `<path d="M3 11h5l2-2 2 2h2"/><rect x="12" y="9.5" width="1.6" height="3" rx="0.4"/><rect x="14.5" y="9.5" width="1.6" height="3" rx="0.4"/><rect x="17" y="9.5" width="1.6" height="3" rx="0.4"/><path d="M19 11c2 0 3 1.5 3 2.5s-1 2.5-3 2.5-3-1-3-2.5"/>`,
};

function instrumentIconSvg(family, extraClass = "") {
  const paths = ICON_PATHS[family] || ICON_PATHS.keys;
  return `<svg class="instrument-icon ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

// The same hand-drawn, stroke-based house style, extended to the
// non-instrument icons the UI needs (mic, any-sound speaker, upload,
// transport play/stop) — replacing plain keyboard emoji so the whole
// interface reads as one consistent, custom-drawn icon set rather than
// instrument icons plus assorted emoji everywhere else.
const UI_ICON_PATHS = {
  mic: `<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M9 5.5h6M9 8.5h6" stroke-width="1.2"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5v3.5"/><path d="M8.5 21h7"/>`,
  speaker: `<path d="M4 9v6h3.5l5 4V5l-5 4z"/><path d="M15.3 8.7a5 5 0 0 1 0 6.6"/><path d="M18 6a8.5 8.5 0 0 1 0 12"/>`,
  upload: `<path d="M12 3v11"/><path d="M8 7l4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>`,
  play: `<path d="M6 4.5v15l13-7.5z" fill="currentColor" stroke="none"/>`,
  stop: `<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>`,
  pause: `<rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none"/>`,
  note: `<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`,
  undo: `<path d="M7 8L3 12l4 4"/><path d="M3 12h10.5a5.5 5.5 0 0 1 0 11H11"/>`,
  redo: `<path d="M17 8l4 4-4 4"/><path d="M21 12H10.5a5.5 5.5 0 0 0 0 11H13"/>`,
  mixer: `<path d="M6 21V13M6 9V3"/><circle cx="6" cy="11" r="2"/><path d="M12 21V15M12 11V3"/><circle cx="12" cy="13" r="2"/><path d="M18 21V17M18 13V3"/><circle cx="18" cy="15" r="2"/>`,
  save: `<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3"/><rect x="8" y="14" width="8" height="7"/>`,
  folder: `<path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v2H3z"/><path d="M3 9l1.5 10a1 1 0 0 0 1 .9h13a1 1 0 0 0 1-.9L21 9"/>`,
  share: `<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.3 10.7l7.4-4.4M8.3 13.3l7.4 4.4"/>`,
};

function uiIconSvg(name, extraClass = "") {
  const paths = UI_ICON_PATHS[name];
  return `<svg class="ui-icon ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export { instrumentIconSvg, uiIconSvg };
