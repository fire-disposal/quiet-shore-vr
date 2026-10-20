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
}
