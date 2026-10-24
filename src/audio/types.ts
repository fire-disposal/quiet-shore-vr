export type AudioTrack = 'lake' | 'stream' | 'rain';

/**
 * Scene-owned audio declaration. Scenes describe the ambience they need;
 * the audio engine decides how to load, crossfade and mix it. Volume is
 * relative to the global ambience level, not the device volume.
 */
export interface SceneAudio {
  track: AudioTrack;
  volume?: number;
  fadeMs?: number;
  loop?: boolean;
  /**
   * Stereo width 0..1. The bed plays from two decorrelated copies of the same
   * loop, panned apart; 0 is a centred mono source. Not object-based audio:
   * with a 3DoF head there is no head-relative positioning to gain from.
   */
  width?: number;
}
