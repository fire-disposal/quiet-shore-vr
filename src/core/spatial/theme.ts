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
  panel: 'rgba(247, 243, 234, 0.96)',
  panelStrong: 'rgba(250, 247, 240, 0.98)',
  border: '#b9ae9a',
  text: '#20251f',
  muted: '#5e655a',
  accent: '#8f4634',
  accentText: '#f8f3e9',
  focus: '#8f4634',
  success: '#486b58',
  fontFamily: '"Noto Serif CJK SC", "Source Han Serif SC", "Songti SC", "Noto Sans CJK SC", sans-serif',
  titlePx: 54,
  bodyPx: 30,
  buttonPx: 30,
  radiusPx: 4,
  paddingPx: 30
};
