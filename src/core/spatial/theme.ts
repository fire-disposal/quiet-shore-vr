export interface SpatialTheme {
  panel: string;
  panelStrong: string;
  /** Hairline rule colour: ink at 16%. Never the accent — ice is fill only. */
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  success: string;
  fontFamily: string;
  titlePx: number;
  bodyPx: number;
  buttonPx: number;
  /** Corners are square in this variant; kept so callers can pass one scale. */
  radiusPx: number;
  paddingPx: number;
}

/**
 * Variant: cold store — ice / cool / tight / plain / standard / calm.
 *
 * The panel stays light on purpose: a supine patient reads it at arm's length,
 * and a dark card at that distance reads as a hole in the scene. The single
 * accent is ice and is only ever a fill with ink (#161616) on top — 12.6:1; on
 * a light panel ice is never the text, a rule or a 1 px outline. Red is
 * reserved for delete and stop, so nothing here uses it.
 */
export const DEFAULT_SPATIAL_THEME: SpatialTheme = {
  panel: '#F7F7F6',
  panelStrong: '#FFFFFF',
  border: 'rgba(22, 22, 22, 0.16)',
  text: '#161616',
  muted: '#5E655A',
  accent: '#7DE6FF',
  accentText: '#161616',
  // Ink, not green: this variant has one accent and it is ice.
  success: '#161616',
  fontFamily: '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", sans-serif',
  titlePx: 60,
  bodyPx: 34,
  buttonPx: 34,
  radiusPx: 0,
  paddingPx: 30
};
