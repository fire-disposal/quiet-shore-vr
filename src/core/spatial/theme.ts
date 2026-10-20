export interface SpatialTheme {
  panel: string;
  panelStrong: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accentText: string;
  focus: string;
  success: string;
  fontFamily: string;
  titlePx: number;
  bodyPx: number;
  buttonPx: number;
  radiusPx: number;
  paddingPx: number;
}

/** Calm, low-glare palette for the patient-facing spatial UI. */
export const DEFAULT_SPATIAL_THEME: SpatialTheme = {
  panel: 'rgba(14, 26, 24, 0.94)',
  panelStrong: 'rgba(20, 36, 32, 0.97)',
  border: '#41665f',
  text: '#eef4f0',
  muted: '#a8bcb4',
  accent: '#e0bb78',
  accentText: '#1a1408',
  focus: '#9fd8ca',
  success: '#88d3c1',
  fontFamily: '"Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", sans-serif',
  titlePx: 58,
  bodyPx: 34,
  buttonPx: 34,
  radiusPx: 28,
  paddingPx: 36
};
