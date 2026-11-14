import * as THREE from 'three';

type XRContextAttributes = WebGLContextAttributes & { xrCompatible: boolean };

/**
 * One renderer profile, for one headset.
 *
 * The system ships on a single PICO G2 4K (Adreno 540), so there is no
 * quality tier to select, no stored scale to ratchet down, and no adaptive
 * step to fight the vsync of a device the app cannot measure at build time.
 * If this device is ever replaced, this constant and the scene budget move
 * together — that is the whole tuning surface.
 */

/**
 * XR framebuffer scale.
 *
 * The G2 panel is 4K and the Adreno 540 is fill-rate bound: rendering above
 * 1.0 doubled the eye buffers at 1.25× (1.56× the pixels) for an anti-aliasing
 * benefit the optics mostly hide. Keep native XR resolution and spend the
 * budget on a stable frame; the room geometry is already tiny.
 */
export const XR_FRAMEBUFFER_SCALE = 1.0;

/**
 * Chromium 67 / Gecko 78 both require the context itself to be marked
 * XR-compatible. Gecko 78's makeXRCompatible() resolves without effect,
 * so the attribute must be set at creation time.
 */
export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  const attributes: XRContextAttributes = {
    xrCompatible: true,
    // Gecko 78's XR path does not get MSAA through WebXR Layers, and asking
    // the GL context for it still risks a multisampled back buffer on a
    // fill-bound Adreno 540. The lens is the low-pass filter here.
    antialias: false,
    alpha: false,
    depth: true
  };

  let gl: WebGL2RenderingContext | WebGLRenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', attributes) as WebGL2RenderingContext | null;
    if (!gl) {
      gl = canvas.getContext('webgl', attributes) as WebGLRenderingContext | null;
    }
  } catch {
    gl = null;
  }

  const renderer = gl
    ? new THREE.WebGLRenderer({ canvas, context: gl, antialias: false })
    : new THREE.WebGLRenderer({ antialias: false });

  // Declared, not inherited: the whole look is authored in sRGB textures with
  // lights that stay below clipping, so a tone map would only compress the
  // mid-tones of a deliberately low-contrast room.
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  // 2D preview only; the XR compositor owns the presented resolution.
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');

  const xrManager: unknown = renderer.xr;
  if (xrManager && typeof xrManager === 'object' && 'setFramebufferScaleFactor' in xrManager) {
    const setScale = xrManager.setFramebufferScaleFactor;
    if (typeof setScale === 'function') {
      setScale.call(xrManager, XR_FRAMEBUFFER_SCALE);
    }
  }

  container.appendChild(renderer.domElement);
  return renderer;
}
