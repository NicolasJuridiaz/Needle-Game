/**
 * Analytics event catalog + wire format. Pure (no SDK, no DOM, no sim imports).
 *
 * Naming rules (ByteBrew custom events, https://docs.bytebrew.io/sdk/javascript): no spaces, periods or colons
 * in event names or sub-parameters. We use snake_case ASCII everywhere; values are sent as strings.
 * The full list, with triggers and why each event exists, is in docs/ANALYTICS_PRIVACY_NOTES.md.
 */

/** Events forwarded to the remote adapter (ByteBrew). */
export const REMOTE_EVENTS = [
  // consent (first remote event after the player allows analytics; nothing from before is replayed)
  'analytics_consent_granted',
  // session / run
  'game_session_start', 'run_start', 'run_complete',
  // first-session funnel (once per run)
  'first_input', 'first_dig', 'first_hay_processed', 'first_tool_purchase', 'first_tool_upgrade', 'first_worktree_purchase',
  'first_order_completed', 'first_machine', 'first_conveyor', 'first_automation', 'first_needle', 'first_rake',
  'first_robotic_arm', 'first_scanner', 'first_vacuum_collector', 'first_scanner_mk2',
  'scanner_unlock', 'vacuum_collector_unlock', 'scanner_mk2_unlock', 'menu_first_open',
  // gameplay
  'tool_purchase', 'tool_upgrade', 'technology_upgrade', 'hay_value_upgrade', 'worktree_purchase', 'machine_built',
  'needle_found', 'order_started', 'order_completed',
  // progress / time
  'run_progress', 'playtime_checkpoint',
  // welcome back
  'welcome_back_shown', 'welcome_back_continue',
  // health
  'performance_snapshot', 'game_error',
  // QA only (?debug=1 / dev builds)
  'qa_test_event',
] as const;

/** Local-only events: kept in the in-memory buffer (QA / debug), never sent remotely (tab close is best-effort). */
export const LOCAL_EVENTS = ['quit_state', 'session_duration'] as const;

export type RemoteEventName = (typeof REMOTE_EVENTS)[number];
export type LocalEventName = (typeof LOCAL_EVENTS)[number];
export type AnalyticsEventName = RemoteEventName | LocalEventName;

export type AnalyticsValue = string | number | boolean | null | undefined;
export type AnalyticsParams = Record<string, AnalyticsValue>;
/** What the remote adapter receives: snake_case keys, string values. */
export type WireParams = Record<string, string>;

const REMOTE_SET: ReadonlySet<string> = new Set(REMOTE_EVENTS);
const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/;
/** Longest string value sent (ids, categories). */
export const MAX_VALUE_LENGTH = 48;
/** Most sub-parameters per event (common context + event specific). */
export const MAX_PARAMS = 24;

export function isValidName(name: string): boolean { return NAME_RE.test(name); }
export function isRemoteEvent(name: string): name is RemoteEventName { return REMOTE_SET.has(name); }

/** snake_case ASCII: lower case, anything else -> '_', collapsed, trimmed. */
export function toSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * One value -> wire string. Numbers are rounded to integers (the catalog sends seconds, percents and money as
 * integers, so no '.' ever reaches the wire); booleans -> 'true'/'false'; strings -> [a-z0-9_-], capped.
 * null / undefined / NaN are dropped (returns null).
 */
export function toWireValue(v: AnalyticsValue): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    return String(Math.round(v));
  }
  const s = toSnake(String(v)).slice(0, MAX_VALUE_LENGTH);
  return s.length ? s : null;
}

/** Params -> wire params (invalid keys and empty values dropped, at most MAX_PARAMS). */
export function toWireParams(params: AnalyticsParams | undefined): WireParams {
  const out: WireParams = {};
  if (!params) return out;
  let n = 0;
  for (const [k, v] of Object.entries(params)) {
    if (n >= MAX_PARAMS) break;
    const key = toSnake(k);
    if (!isValidName(key)) continue;
    const val = toWireValue(v);
    if (val === null) continue;
    out[key] = val;
    n++;
  }
  return out;
}
