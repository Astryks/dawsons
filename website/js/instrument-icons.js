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
};

function instrumentIconSvg(family, extraClass = "") {
  const paths = ICON_PATHS[family] || ICON_PATHS.keys;
  return `<svg class="instrument-icon ${extraClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export { instrumentIconSvg };
