import * as THREE from 'three';

export interface Quality {
  high: boolean;
  aa: boolean;
  xrScale: number;
}

type XRContextAttributes = WebGLContextAttributes & { xrCompatible: boolean };

/**
 * Chromium 67 / Gecko 78 both require the context itself to be marked
 * XR-compatible. Gecko 78's makeXRCompatible() resolves without effect,
 * so the attribute must be set at creation time.
 */
export function createRenderer(container: HTMLElement, quality: Quality): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  const attributes: XRContextAttributes = {
    xrCompatible: true,
    antialias: quality.aa,
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
    ? new THREE.WebGLRenderer({ canvas, context: gl, antialias: quality.aa })
    : new THREE.WebGLRenderer({ antialias: quality.aa });

  renderer.setPixelRatio(quality.high ? Math.min(window.devicePixelRatio || 1, 2) : 1);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');

  // Lower framebuffer scale is the cheap AA/quality lever on Adreno 540.
  const xrManager: unknown = renderer.xr;
  if (xrManager && typeof xrManager === 'object' && 'setFramebufferScaleFactor' in xrManager) {
    const setScale = xrManager.setFramebufferScaleFactor;
    if (typeof setScale === 'function') {
      setScale.call(xrManager, quality.xrScale);
    }
  }

  container.appendChild(renderer.domElement);
  return renderer;
}
