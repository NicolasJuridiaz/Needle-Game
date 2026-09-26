import type { MachineStatus } from '../sim/types';

/**
 * Original inline SVG icon set (24x24, stroke = currentColor). Covers every icon key used in src/config
 * (tools, buildables, tech nodes, needle buffs, items, branches) plus UI glyphs and machine statuses.
 * Unknown keys render a neutral fallback glyph, so new config entries never break the UI.
 */

const F = 'fill="currentColor" stroke="none"';
const T = 'fill="currentColor" fill-opacity=".22"';

const ICONS: Record<string, string> = {
  // ----- resources / UI ------------------------------------------------------------------
  money: `<circle cx="12" cy="12" r="8.6" ${T}/><path d="M14.9 9.3c-.5-1-1.6-1.6-2.9-1.6-1.6 0-2.8.8-2.8 2.1 0 3 5.9 1.6 5.9 4.5 0 1.3-1.2 2.1-3 2.1-1.4 0-2.6-.6-3.1-1.7M12 5.9v1.8M12 16.4v1.8"/>`,
  wp: `<path d="M12 2.8l2.4 5 5.4.6-4 3.7 1.1 5.4L12 14.8l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" ${T}/><path d="M9.5 21h5"/>`,
  needle: `<path d="M3.8 20.2 15.3 8.7" stroke-width="2.1"/><path d="M14.6 9.4l3.6-3.6a2 2 0 0 1 2.9 2.9l-3.6 3.6a2 2 0 0 1-2.9-2.9z"/><path d="M21 3.4c-1.6-1.4-4.4-.4-4.2 1.6" opacity=".55"/>`,
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2.2" ${T}/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.4" ${F}/>`,
  check: `<path d="M5 12.6l4.3 4.3L19 7.2" stroke-width="2.4"/>`,
  close: `<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" stroke-width="2.2"/>`,
  plus: `<path d="M12 5v14M5 12h14" stroke-width="2.2"/>`,
  power: `<path d="M13.6 2.6 5.4 13.4h6.1l-1.1 8 8.2-10.9h-6.1z" ${T}/>`,
  bolt: `<path d="M13.6 2.6 5.4 13.4h6.1l-1.1 8 8.2-10.9h-6.1z" ${T}/>`,
  order: `<rect x="5" y="4" width="14" height="17" rx="2" ${T}/><path d="M9 4V2.8h6V4"/><path d="M8.5 9.5h7M8.5 13.5h7M8.5 17.5h4"/>`,
  info: `<circle cx="12" cy="12" r="9" ${T}/><path d="M12 11v6"/><circle cx="12" cy="7.6" r="1.2" ${F}/>`,
  warn: `<path d="M12 3.2 22 20H2z" ${T}/><path d="M12 9.5v5"/><circle cx="12" cy="17.2" r="1.1" ${F}/>`,
  good: `<circle cx="12" cy="12" r="9" ${T}/><path d="M7.6 12.4l3 3 5.8-6.2"/>`,
  bad: `<circle cx="12" cy="12" r="9" ${T}/><path d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4"/>`,
  clock: `<circle cx="12" cy="12" r="9" ${T}/><path d="M12 7v5.2l3.4 2"/>`,
  save: `<path d="M4 4h12.5L20 7.5V20H4z" ${T}/><path d="M8 4v5h7V4M7.5 20v-6h9v6"/>`,
  cart: `<path d="M2.5 4h3l2.4 11h10.3l2-8H7"/><circle cx="9.5" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>`,
  trophy: `<path d="M7 3.5h10v5a5 5 0 0 1-10 0z" ${T}/><path d="M7 5.5H3.8a3 3 0 0 0 3.4 4M17 5.5h3.2a3 3 0 0 1-3.4 4M12 13.5v3.5M8 20.5h8M9.5 17h5v3.5h-5z"/>`,
  star: `<path d="M12 2.8l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.2l-5.3 3 1.2-6-4.5-4.1 6-.7z" ${T}/>`,
  arrow: `<path d="M12 3.5 19 20l-7-3.8L5 20z" ${F}/>`,
  chevron: `<path d="M9 5.5l6.5 6.5L9 18.5" stroke-width="2.2"/>`,
  tree: `<circle cx="12" cy="5" r="2.3" ${T}/><circle cx="5.5" cy="18.5" r="2.3" ${T}/><circle cx="18.5" cy="18.5" r="2.3" ${T}/><path d="M12 7.3v4.2M12 11.5c-4 0-6.5 1.6-6.5 4.7M12 11.5c4 0 6.5 1.6 6.5 4.7M12 11.5v4.7"/>`,
  shop: `<path d="M3.5 9.5 5 4h14l1.5 5.5" /><path d="M3.5 9.5a2.8 2.8 0 0 0 5.7 0 2.8 2.8 0 0 0 5.6 0 2.8 2.8 0 0 0 5.7 0"/><path d="M5 12v8.5h14V12M10 20.5v-5h4v5"/>`,
  pause: `<rect x="6.5" y="5" width="4" height="14" rx="1" ${T}/><rect x="13.5" y="5" width="4" height="14" rx="1" ${T}/>`,
  play: `<path d="M7.5 4.5v15L19.5 12z" ${T}/>`,
  settings: `<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/><circle cx="12" cy="12" r="6.4" ${T}/>`,
  keyboard: `<rect x="2.5" y="6" width="19" height="12" rx="2" ${T}/><path d="M6 9.5h1M9.5 9.5h1M13 9.5h1M16.5 9.5h1M6 13h1M17 13h1M9 15.5h6"/>`,
  mouse: `<rect x="6" y="3" width="12" height="18" rx="6" ${T}/><path d="M12 3v6.5M6 9.5h12"/>`,
  restart: `<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.5v4.8h4.8"/>`,
  move: `<path d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>`,
  remove: `<path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5l1 14h9l1-14" ${T}/><path d="M10 10.5v6.5M14 10.5v6.5"/>`,
  place: `<rect x="3.5" y="3.5" width="17" height="17" rx="3" ${T}/><path d="M12 8v8M8 12h8"/>`,
  grid: `<path d="M3 8h18M3 16h18M8 3v18M16 3v18" opacity=".8"/>`,
  eye: `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" ${T}/><circle cx="12" cy="12" r="3"/>`,

  // ----- items ---------------------------------------------------------------------------
  hay: `<path d="M12 21V9.5M12 21 7 7.8M12 21l5-13.2M12 21 3.8 11.6M12 21l8.2-9.4M12 21 9.4 5M12 21l2.6-16"/><path d="M8 21h8"/>`,
  bale: `<rect x="3" y="7" width="18" height="11" rx="1.6" ${T}/><path d="M8.2 7v11M15.8 7v11"/><path d="M5 10h1.2M5 13.5h1.6M18 10.5h1.2M18 14h.8M11 10.5h2M11.5 14h1.5" opacity=".75"/>`,
  wrapped: `<ellipse cx="12" cy="7.5" rx="8" ry="3" ${T}/><path d="M4 7.5v9c0 1.7 3.6 3 8 3s8-1.3 8-3v-9"/><path d="M4.5 11.5c2 1.5 5 2.2 8.5 1.8M4.5 15c2.6 1.7 7.8 2 11.5.6" opacity=".7"/>`,

  // ----- tools ---------------------------------------------------------------------------
  hands: `<path d="M7.2 11.5V6.7a1.5 1.5 0 0 1 3 0v4.3M10.2 10.5V5a1.5 1.5 0 0 1 3 0v5.5M13.2 10.5V6.2a1.5 1.5 0 0 1 3 0v6M16.2 11.4V9.2a1.5 1.5 0 0 1 3 0v5.3c0 3.9-2.6 6.8-6.5 6.8h-1.1c-2.4 0-3.8-1.1-5-3L4.3 14.9a1.6 1.6 0 0 1 2.6-1.9L8.2 14.6"/>`,
  shovel: `<path d="M17.6 2.6l3.8 3.8M19.5 4.5l-7.4 7.4"/><path d="M13.1 10.9l-2-2-5.5 5.5a3.3 3.3 0 0 0 0 4.6l.4.4a3.3 3.3 0 0 0 4.6 0l5.5-5.5z" ${T}/>`,
  bucket: `<path d="M5 9h14l-1.7 11.2a1 1 0 0 1-1 .8H7.7a1 1 0 0 1-1-.8z" ${T}/><path d="M5.5 9C5.5 3.5 18.5 3.5 18.5 9"/><path d="M7.5 9c1-1.4 2-2 3-1.2 1-1.3 2.3-1.3 3.2 0 1-.9 2-.6 2.8 1.2" opacity=".7"/>`,
  pitchfork: `<path d="M12 21.5V11"/><path d="M6.5 2.8v5a5.5 5.5 0 0 0 11 0v-5M12 2.8V11"/>`,
  vacuum: `<rect x="3" y="3.5" width="7.5" height="11.5" rx="3" ${T}/><path d="M6.8 15v2.6a3 3 0 0 0 3 3h3.4a3 3 0 0 0 3-3v-6.4l4.3-4.6"/><path d="M18.2 4.2l3.4 3.2M5.8 7h2"/>`,
  detector: `<ellipse cx="7" cy="18.6" rx="4.6" ry="2" ${T}/><path d="M8.7 17 17.2 4.6M16.4 3.3l3.8 2.6"/><rect x="11.2" y="9.2" width="3.6" height="2.6" rx=".6" transform="rotate(-55 13 10.5)"/><path d="M2.5 13.2c.8-1.1 2-1.8 3.2-2M3.6 10.4c1.2-1.4 2.7-2.2 4.4-2.3" opacity=".6"/>`,
  wheelbarrow: `<path d="M2.5 7.5h14.2l-3 6.6H6.4z" ${T}/><circle cx="17.2" cy="17.3" r="2.4"/><path d="M13.7 14.1l1.9 1.6M6.8 14.1 5.3 19.5M2.5 7.5 1.5 5"/>`,

  // ----- buildables ----------------------------------------------------------------------
  sell: `<path d="M3.5 12.2V4.6a1.1 1.1 0 0 1 1.1-1.1h7.6l8.5 8.5-8.7 8.7z" ${T}/><circle cx="8.3" cy="8.3" r="1.7"/><path d="M11.5 14.8l3.3-3.3" opacity=".7"/>`,
  hopper: `<path d="M3 4h18l-5.2 8.3H8.2z" ${T}/><path d="M8.2 12.3v3.7h7.6v-3.7M8.4 16 6.9 21M15.6 16l1.5 5M6.2 7h11.6" />`,
  rake: `<rect x="2.5" y="5" width="6" height="14" rx="1.5" ${T}/><path d="M8.5 9h7.5M8.5 15h7.5M16 4.5v15M16 6h4.5M16 9.3h4.5M16 12.6h4.5M16 15.9h4.5M16 19h4.5"/>`,
  arm: `<path d="M3.5 21h9M8 21v-3.8"/><circle cx="8" cy="15.2" r="2"/><path d="M9.2 13.6 13.8 7.4"/><circle cx="15" cy="6" r="1.8" ${T}/><path d="M16.5 7 19.8 10.8M18.4 12.2l1.4-1.4 2 .6M19.8 10.8l.3-2.1"/>`,
  collector: `<circle cx="12" cy="12" r="8.6" ${T}/><path d="M12 12c0-3.1 1.1-5.1 3.3-5.7M12 12c3.1 0 5.1 1.1 5.7 3.3M12 12c0 3.1-1.1 5.1-3.3 5.7M12 12c-3.1 0-5.1-1.1-5.7-3.3"/><circle cx="12" cy="12" r="1.5" ${F}/>`,
  conveyor: `<rect x="2.5" y="9" width="19" height="6" rx="3" ${T}/><circle cx="6.2" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="17.8" cy="12" r="1.1"/><path d="M7 5.5h8.5M13.2 3.5l2.3 2-2.3 2M6.2 15v5M17.8 15v5"/>`,
  ramp: `<path d="M3 19.5h18V7z" ${T}/><path d="M7.5 15.8l9-6.3M13.6 9.4l2.9.1-.9 2.8"/>`,
  splitter: `<rect x="9.5" y="9.5" width="5" height="5" rx="1" ${T}/><path d="M2.5 12h7M14.5 12h7M12 9.5V2.5M12 14.5v7M19 9.5l2.5 2.5-2.5 2.5M9.5 5 12 2.5 14.5 5M9.5 19l2.5 2.5 2.5-2.5"/>`,
  merger: `<rect x="9.5" y="9.5" width="5" height="5" rx="1" ${T}/><path d="M2.5 12h7M14.5 12h7M12 2.5v7M12 21.5v-7M19 9.5l2.5 2.5-2.5 2.5M9.5 7 12 9.5 14.5 7M9.5 17l2.5-2.5 2.5 2.5M7 9.5 9.5 12 7 14.5"/>`,
  usplitter: `<path d="M2.5 12h6c3 0 4-5 7-5h6M8.5 12c3 0 4 5 7 5h6M19 4.5 21.5 7 19 9.5M19 14.5l2.5 2.5-2.5 2.5"/>`,
  umerger: `<path d="M2.5 7h6c3 0 4 5 7 5h6M2.5 17h6c3 0 4-5 7-5M19 9.5l2.5 2.5-2.5 2.5"/>`,
  lift: `<rect x="6.5" y="2.5" width="11" height="19" rx="2" ${T}/><path d="M12 16.5v-9M9 10.5l3-3 3 3M9 21.5v-2M15 21.5v-2"/>`,
  scanner: `<path d="M4.5 17v-6a7.5 7.5 0 0 1 15 0v6" ${T}/><path d="M2.5 17h19M2.5 20h19M12 7.5v6" /><path d="M9 14.5h6" opacity=".6"/>`,
  scanner2: `<path d="M3.5 17v-6.5a8.5 8.5 0 0 1 17 0V17" ${T}/><path d="M2 17h20M2 20h20M9.5 7.5v6.5M14.5 7.5v6.5"/><path d="M7 11.5a5 5 0 0 1 10 0" opacity=".6"/>`,
  compressor: `<path d="M4 3h16M12 3v4.5"/><rect x="6" y="7.5" width="12" height="4" rx="1" ${T}/><rect x="5" y="15" width="14" height="6" rx="1.5"/><path d="M9 15v6M15 15v6M8.5 12.8l1.5 1.4M15.5 12.8 14 14.2" opacity=".75"/>`,
  wrapper: `<rect x="6" y="8.5" width="12" height="9" rx="1.6" ${T}/><ellipse cx="12" cy="13" rx="10" ry="3.6" transform="rotate(-18 12 13)"/><path d="M10 8.5v9M14 8.5v9" opacity=".6"/>`,
  silo: `<path d="M5.5 7.5a6.5 3.2 0 0 1 13 0V21h-13z" ${T}/><path d="M5.5 11.5h13M5.5 15.5h13M12 4.3V21"/><path d="M4 21h16"/>`,
  generator: `<rect x="2.5" y="8" width="12.5" height="12.5" rx="2.4" ${T}/><rect x="16.5" y="3" width="4" height="17.5" rx="1"/><path d="M9.8 10.4 7 14.6h3l-.9 3.4 3-4.4h-3z" ${F}/>`,
  pole: `<path d="M12 2.5v19M6 6h12M7.5 10h9M8.5 21.5h7"/><circle cx="6.2" cy="6" r="1.1" ${F}/><circle cx="17.8" cy="6" r="1.1" ${F}/><circle cx="7.8" cy="10" r="1" ${F}/><circle cx="16.2" cy="10" r="1" ${F}/>`,
  platform: `<path d="M2.5 8.5h19v3.5h-19z" ${T}/><path d="M5 12v8.5M19 12v8.5M12 12v8.5M5 20.5 12 12l7 8.5"/>`,
  stairs: `<path d="M3 20.5h5v-5h5v-5h5v-5h3" /><path d="M3 20.5V17h2" opacity=".6"/>`,

  // ----- tech node / buff glyphs ---------------------------------------------------------
  speed: `<path d="M4.5 5.5l6.5 6.5-6.5 6.5M12 5.5l6.5 6.5-6.5 6.5" stroke-width="2.1"/>`,
  range: `<circle cx="5.5" cy="18.5" r="1.8" ${F}/><path d="M5.5 12.6a5.9 5.9 0 0 1 5.9 5.9M5.5 7.6a10.9 10.9 0 0 1 10.9 10.9M5.5 2.6a15.9 15.9 0 0 1 15.9 15.9"/>`,
  capacity: `<path d="M3.5 8 12 3.8 20.5 8 12 12.2z" ${T}/><path d="M3.5 8v8.2L12 20.5l8.5-4.3V8M12 12.2v8.3"/>`,
  industrial: `<path d="M2.5 20.5v-10l5 3.2v-3.2l5 3.2v-3.2l5 3.2V3.5h4v17z" ${T}/><path d="M6 17.2h2M10.5 17.2h2M15 17.2h2"/>`,
  output: `<rect x="3" y="6" width="10" height="12" rx="2" ${T}/><path d="M9.5 12h11.5M17.5 8.5 21 12l-3.5 3.5"/>`,
  input: `<rect x="11" y="6" width="10" height="12" rx="2" ${T}/><path d="M3 12h11.5M11 8.5l3.5 3.5-3.5 3.5"/>`,
  efficiency: `<path d="M3.5 16.5a8.5 8.5 0 1 1 17 0" ${T}/><path d="M12 16.5l4.6-5.6M3.5 16.5h2.5M18 16.5h2.5M6.3 9.8l1.6 1.4M12 7.5v2"/><circle cx="12" cy="16.5" r="1.6" ${F}/>`,
  split: `<path d="M3 12h6.5l4.5-5.5h7M9.5 12l4.5 5.5h7M18.5 4l2.5 2.5-2.5 2.5M18.5 15l2.5 2.5-2.5 2.5"/>`,
  dual: `<path d="M3 8h16M16 5l3 3-3 3M3 16h16M16 13l3 3-3 3"/>`,
  claw: `<path d="M12 2.5v6"/><circle cx="12" cy="10.2" r="1.9" ${T}/><path d="M10.4 11.6 6 14.8l1.6 5.2M13.6 11.6l4.4 3.2-1.6 5.2"/>`,
  carry: `<path d="M4.5 9.5h15l-1.2 11h-12.6z" ${T}/><path d="M8.5 9.5V7a3.5 3.5 0 0 1 7 0v2.5M9 13.5h6"/>`,
  boots: `<path d="M8.5 3h5v9l5.6 2.8c1.3.7 1.9 1.7 1.9 3.1v2.6H4.5v-3.2l2-2 2-1.2z" ${T}/><path d="M4.5 20.5H21M1.5 8h3.5M1.5 11.5h3"/>`,
  width: `<path d="M3.5 12h17M6.5 9l-3 3 3 3M17.5 9l3 3-3 3M3.5 4.5v15M20.5 4.5v15"/>`,
  target: `<circle cx="12" cy="12" r="8.4" ${T}/><circle cx="12" cy="12" r="4.4"/><circle cx="12" cy="12" r="1.3" ${F}/>`,
  strength: `<path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" stroke-width="2.2"/>`,
  route: `<circle cx="5" cy="18.5" r="2.1" ${T}/><circle cx="19" cy="5.5" r="2.1" ${T}/><path d="M7.1 18.5h6.4a3.2 3.2 0 0 0 0-6.4h-3a3.2 3.2 0 0 1 0-6.4h6.4"/>`,
  rotate: `<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.2 3.6v5h-5"/>`,
  priority: `<path d="M12 18V5M7 10l5-5 5 5"/><path d="M4.5 21h15" /><path d="M9 14.5h6" opacity=".6"/>`,
  premium: `<path d="M6 4h12l3.2 5L12 20.5 2.8 9z" ${T}/><path d="M2.8 9h18.4M9 4 7.8 9 12 20.5 16.2 9 15 4"/>`,
  precision: `<circle cx="12" cy="12" r="7.2" ${T}/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.3" ${F}/>`,
  overflow: `<path d="M3 8.5h12.5M13 5.5l3 3-3 3M19.5 5v7"/><path d="M8 8.5v6a3 3 0 0 0 3 3h7.5M16 14.5l3 3-3 3"/>`,
  links: `<path d="M10.2 13.8a4 4 0 0 1 0-5.6l2.1-2.1a4 4 0 0 1 5.6 5.6l-1.3 1.3"/><path d="M13.8 10.2a4 4 0 0 1 0 5.6l-2.1 2.1a4 4 0 0 1-5.6-5.6l1.3-1.3"/>`,
  gear: `<path d="M10.3 2.8h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9-2.6-.5v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8z" ${T}/><circle cx="12" cy="12" r="3.1"/>`,
  fire: `<path d="M12 21.2c-4 0-6.6-2.6-6.6-6.3 0-3.4 2.4-5.4 3.9-8.3.5 2 1.6 3 2.7 3.5.2-2.8 1.3-5 3.2-7 .4 3.4 4.3 5.7 4.3 11.3 0 3.9-3 6.8-7.5 6.8z" ${T}/><path d="M12 21.2c-1.7 0-2.8-1.2-2.8-2.8 0-1.8 1.5-2.7 2.3-4.4.9 1.4 3.3 2.4 3.3 4.4 0 1.6-1.1 2.8-2.8 2.8z"/>`,
  filter: `<path d="M3 4.5h18l-7 8.6v6.2l-4 2.2v-8.4z" ${T}/>`,
  expand: `<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><rect x="9" y="9" width="6" height="6" rx="1" ${T}/>`,
  eject: `<path d="M12 4l7.5 8.5h-15z" ${T}/><path d="M4.5 17.5h15"/>`,
  dump: `<path d="M3.5 4.5c6.5 0 10.5 3 11.6 9"/><path d="M12.4 11.4l2.7 2.4 2.4-2.6"/><path d="M12 16h9v4.5h-9z" ${T}/>`,
  depth: `<path d="M3 7.5h18M3 12.5h5M16 12.5h5M3 17.5h6.5M14.5 17.5H21" opacity=".7"/><path d="M12 3v15M8.5 14.5 12 18l3.5-3.5"/>`,
  compass: `<circle cx="12" cy="12" r="9" ${T}/><path d="M15.6 8.4l-2.1 5.1-5.1 2.1 2.1-5.1z"/>`,
  buffer: `<path d="M4 7l8-3.5L20 7l-8 3.5z" ${T}/><path d="M4 12l8 3.5 8-3.5M4 17l8 3.5 8-3.5"/>`,
  alternate: `<path d="M4 8h15M16 5l3 3-3 3M20 16H5M8 13l-3 3 3 3"/>`,

  // ----- machine statuses ----------------------------------------------------------------
  st_running: `<circle cx="12" cy="12" r="9" ${T}/><path d="M10 8.3v7.4l5.8-3.7z" ${F}/>`,
  st_processing: `<path d="M10.3 2.8h3.4l.5 2.6 1.9.8 2.2-1.5 2.4 2.4-1.5 2.2.8 1.9 2.6.5v3.4l-2.6.5-.8 1.9 1.5 2.2-2.4 2.4-2.2-1.5-1.9.8-.5 2.6h-3.4l-.5-2.6-1.9-.8-2.2 1.5-2.4-2.4 1.5-2.2-.8-1.9-2.6-.5v-3.4l2.6-.5.8-1.9-1.5-2.2 2.4-2.4 2.2 1.5 1.9-.8z" ${T}/><circle cx="12" cy="12" r="3.1"/>`,
  st_idle: `<circle cx="12" cy="12" r="9" ${T}/><path d="M9.6 8.8v6.4M14.4 8.8v6.4"/>`,
  st_noInput: `<path d="M3 13l3-8h12l3 8v6.5H3z" ${T}/><path d="M3 13h5l1.5 2.5h5L16 13h5"/>`,
  st_noHay: `<path d="M12 21V10M12 21 7.5 8.5M12 21l4.5-12.5M12 21 9.5 5.5M12 21l2.5-15.5" opacity=".7"/><path d="M4 4l16 16" stroke-width="2.2"/>`,
  st_outputBlocked: `<path d="M2.5 12h11.5M11 8.5l3.5 3.5-3.5 3.5"/><path d="M18.5 4.5v15" stroke-width="2.6"/>`,
  st_full: `<rect x="4" y="4" width="16" height="16" rx="2.2"/><rect x="6.5" y="7.5" width="11" height="10" rx="1" ${F} opacity=".55"/>`,
  st_noPower: `<path d="M13.6 2.6 5.4 13.4h6.1l-1.1 8 8.2-10.9h-6.1z" ${T}/><path d="M3.5 3.5l17 17" stroke-width="2.2"/>`,
  st_lowPower: `<rect x="2.5" y="7" width="16.5" height="10" rx="2" ${T}/><path d="M19 10.3h2.2v3.4H19"/><rect x="4.6" y="9.1" width="4" height="5.8" rx=".6" ${F}/>`,
  st_noFuel: `<path d="M12 21.2c-4 0-6.6-2.6-6.6-6.3 0-3.4 2.4-5.4 3.9-8.3.5 2 1.6 3 2.7 3.5.2-2.8 1.3-5 3.2-7 .4 3.4 4.3 5.7 4.3 11.3 0 3.9-3 6.8-7.5 6.8z" ${T}/><path d="M3.5 3.5l17 17" stroke-width="2.2"/>`,
  st_disabled: `<path d="M12 3v8.5"/><path d="M6.5 6.4a8 8 0 1 0 11 0"/>`,
  st_needleAlarm: `<path d="M6 16.5v-5.2a6 6 0 0 1 12 0v5.2l2 2H4z" ${T}/><path d="M10 20.8a2 2 0 0 0 4 0M3 7.5l2 1M21 7.5l-2 1M12 2.2v1.6"/>`,
};

const FALLBACK = `<path d="M12 2.8 20 7.4v9.2L12 21.2 4 16.6V7.4z" ${T}/><circle cx="12" cy="12" r="2.4"/>`;

/** True when a dedicated glyph exists for `key`. */
export function hasIcon(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(ICONS, key);
}

/** All defined icon keys (dev gallery / tests). */
export function iconKeys(): string[] {
  return Object.keys(ICONS);
}

/** SVG markup for an icon. `cls` is appended to the base `pn-ic` class. */
export function icon(key: string, cls = ''): string {
  const body = hasIcon(key) ? ICONS[key] : FALLBACK;
  return `<svg class="pn-ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Create a detached SVG icon element. */
export function iconEl(key: string, cls = ''): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = icon(key, cls);
  return t.content.firstElementChild as SVGElement;
}

/** Replace an element's content with an icon (only when the key changes). */
export function setIcon(host: HTMLElement, key: string, cls = ''): void {
  if (host.dataset.icon === key) return;
  host.dataset.icon = key;
  host.innerHTML = icon(key, cls);
}

/** Icon key for a machine status. */
export function statusIcon(s: MachineStatus): string {
  return 'st_' + s;
}
