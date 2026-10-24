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
 * XR framebuffer scale: supersampling is the only anti-aliasing lever WebXR
 * leaves us on this generation (Gecko 78 exposes no MSAA layer), so the scene
 * budget buys pixels instead of geometry. 1.25 costs 1.56× the fill of 1.0 and
 * is affordable only because the scene draws six calls and one full-screen
 * dome; raising it further needs a new measurement on the device.
 */
const XR_FRAMEBUFFER_SCALE = 1.25;

/**
 * Chromium 67 / Gecko 78 both require the context itself to be marked
 * XR-compatible. Gecko 78's makeXRCompatible() resolves without effect,
 * so the attribute must be set at creation time.
 */
export function createRenderer(container: HTMLElement): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  const attributes: XRContextAttributes = {
    xrCompatible: true,
    antialias: true,
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
    ? new THREE.WebGLRenderer({ canvas, context: gl, antialias: true })
    : new THREE.WebGLRenderer({ antialias: true });

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
