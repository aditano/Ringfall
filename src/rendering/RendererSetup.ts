import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  detectPerformanceSettings,
  downgradeSettings,
  isMobile,
  type PerformanceSettings,
} from './PerformanceProfile';
import { watchVisualViewport } from '../ui/viewport';

export interface RendererBundle {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  bloomPass: UnrealBloomPass;
  bloom: UnrealBloomPass;
  smaaPass: SMAAPass;
  vignettePass: ShaderPass;
  performance: PerformanceSettings;
  resize: (width?: number, height?: number) => void;
  render: (deltaSeconds?: number) => void;
  setBloom: (strength: number) => void;
  setPointerCapture: (enabled: boolean) => void;
  applyPerformance: (perf: PerformanceSettings) => void;
  setAutoDowngrade: (enabled: boolean) => void;
  getFps: () => number;
  isContextLost: () => boolean;
  /** Returns false while the context is lost. Attempts restore or a canvas rebuild. */
  serviceContext: () => boolean;
  noteRenderFailure: (err: unknown) => void;
  dispose: () => void;
}

export interface ContextRecovery {
  canvas: HTMLCanvasElement;
  performance: PerformanceSettings;
  rebuilt: boolean;
}

export interface RendererSetupOptions {
  maxPixelRatio?: number;
  fov?: number;
  vignette?: boolean;
  bloomStrength?: number;
  near?: number;
  far?: number;
  performance?: PerformanceSettings;
  autoDowngrade?: boolean;
  onResize?: () => void;
  onRecover?: (info: ContextRecovery) => void;
}

interface GlPipeline {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  smaaPass: SMAAPass;
  vignettePass: ShaderPass;
}

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    offset: { value: 0.42 },
    darkness: { value: 0.48 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * 2.0;
      float vignette = smoothstep(0.65, offset * 0.22, length(uv));
      texel.rgb = mix(texel.rgb, texel.rgb * (1.0 - darkness), vignette * 0.72);
      gl_FragColor = texel;
    }
  `,
};

export function isGlFailure(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /context|webgl|gpu|lost/i.test(msg);
}

function createGlPipeline(
  container: HTMLElement,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  perf: PerformanceSettings,
  bloomStrength: number,
): GlPipeline {
  const width = Math.max(1, container.clientWidth || window.innerWidth);
  const height = Math.max(1, container.clientHeight || window.innerHeight);

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: isMobile() ? 'default' : 'high-performance',
    stencil: false,
    alpha: false,
  });
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, perf.maxPixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = perf.toneMappingExposure ?? 0.92;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Shadows are a full extra scene pass. Render them every other frame unless
  // something explicitly asks (resize, quality change, context restore).
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = perf.shadowMapSize > 0;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);
  composer.setPixelRatio(renderer.getPixelRatio());

  composer.addPass(new RenderPass(scene, camera));

  const bw = Math.max(1, Math.floor(width * perf.bloomScale));
  const bh = Math.max(1, Math.floor(height * perf.bloomScale));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(bw, bh), bloomStrength, 0.75, 0.58);
  bloomPass.enabled = perf.enableBloom;
  composer.addPass(bloomPass);

  const smaaPass = new SMAAPass();
  smaaPass.enabled = perf.enableSMAA;
  composer.addPass(smaaPass);

  const vignettePass = new ShaderPass(VignetteShader);
  vignettePass.enabled = perf.enableVignette;
  composer.addPass(vignettePass);

  composer.addPass(new OutputPass());

  return { renderer, composer, bloomPass, smaaPass, vignettePass };
}

/**
 * WebGL renderer with adaptive post-processing for Chrome + Safari.
 * A lost context is restored in place, or the canvas is rebuilt at a lower budget
 * if the browser never fires webglcontextrestored.
 */
export function createRenderer(
  container: HTMLElement,
  options: RendererSetupOptions = {},
): RendererBundle {
  const perf = options.performance ?? detectPerformanceSettings();
  let bloomStrength = options.bloomStrength ?? 0.48;

  const width = Math.max(1, container.clientWidth || window.innerWidth);
  const height = Math.max(1, container.clientHeight || window.innerHeight);

  const scene = new THREE.Scene();
  scene.name = 'HaloArenaScene';

  const camera = new THREE.PerspectiveCamera(
    options.fov ?? 75,
    width / height,
    options.near ?? 0.1,
    options.far ?? 1200,
  );
  camera.position.set(0, 1.7, 8);
  camera.rotation.order = 'YXZ';

  const bundle = {} as RendererBundle;
  let { renderer, composer, bloomPass, smaaPass, vignettePass } = createGlPipeline(
    container,
    scene,
    camera,
    perf,
    bloomStrength,
  );

  let currentPerf = { ...perf };
  let autoDowngrade = options.autoDowngrade !== false;
  let frameBudget = 0;
  let badFrames = 0;
  let displayFps = 60;
  let pendingPerf: PerformanceSettings | null = null;
  let shadowStep = 0;
  let contextLost = false;
  let lostAt = 0;
  let rebuilding = false;
  let rebuilds = 0;
  let rebuildWindowStart = 0;
  let detachCanvas: (() => void) | null = null;

  const resizeBloom = (nextW: number, nextH: number) => {
    const bloomW = Math.max(1, Math.floor(nextW * currentPerf.bloomScale));
    const bloomH = Math.max(1, Math.floor(nextH * currentPerf.bloomScale));
    bloomPass.resolution.set(bloomW, bloomH);
    bloomPass.setSize(bloomW, bloomH);
  };

  const resize = (w?: number, h?: number) => {
    const nextW = Math.max(1, w ?? (container.clientWidth || window.innerWidth));
    const nextH = Math.max(1, h ?? (container.clientHeight || window.innerHeight));
    camera.aspect = nextW / nextH;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, currentPerf.maxPixelRatio));
    renderer.setSize(nextW, nextH, false);
    composer.setSize(nextW, nextH);
    composer.setPixelRatio(renderer.getPixelRatio());
    resizeBloom(nextW, nextH);
    const pixelRatio = renderer.getPixelRatio();
    smaaPass.setSize(nextW * pixelRatio, nextH * pixelRatio);
  };

  const needsComposer = () =>
    currentPerf.enableBloom || currentPerf.enableSMAA || currentPerf.enableVignette;

  const applyPerformance = (next: PerformanceSettings) => {
    currentPerf = { ...next };
    renderer.toneMappingExposure = currentPerf.toneMappingExposure ?? 0.92;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, currentPerf.maxPixelRatio));
    bloomPass.enabled = currentPerf.enableBloom;
    smaaPass.enabled = currentPerf.enableSMAA;
    vignettePass.enabled = currentPerf.enableVignette;
    renderer.shadowMap.needsUpdate = currentPerf.shadowMapSize > 0;
    const w = Math.max(1, container.clientWidth || window.innerWidth);
    const h = Math.max(1, container.clientHeight || window.innerHeight);
    resizeBloom(w, h);
    resize();
    bundle.performance = { ...currentPerf };
  };

  const publish = () => {
    bundle.renderer = renderer;
    bundle.composer = composer;
    bundle.bloomPass = bloomPass;
    bundle.bloom = bloomPass;
    bundle.smaaPass = smaaPass;
    bundle.vignettePass = vignettePass;
    bundle.performance = { ...currentPerf };
  };

  const soften = (): PerformanceSettings => ({
    ...currentPerf,
    tier: 'low',
    maxPixelRatio: Math.min(1, currentPerf.maxPixelRatio),
    shadowMapSize: 0,
    enableBloom: false,
    bloomScale: 0.35,
    enableSMAA: false,
    enableVignette: false,
    lightShafts: false,
    environmentMap: false,
    crosshairRayInterval: 8,
    hudSyncInterval: 1 / 12,
  });

  const markLost = () => {
    if (!contextLost) lostAt = performance.now();
    contextLost = true;
    container.dataset.glState = 'lost';
  };

  const canRebuild = () => {
    const now = performance.now();
    if (now - rebuildWindowStart > 30_000) {
      rebuildWindowStart = now;
      rebuilds = 0;
    }
    if (rebuilds >= 3) return false;
    rebuilds += 1;
    return true;
  };

  const bindCanvas = (canvas: HTMLCanvasElement) => {
    detachCanvas?.();
    const onContextLost = (event: Event) => {
      event.preventDefault();
      markLost();
    };
    const onContextRestored = () => {
      try {
        currentPerf = soften();
        applyPerformance(currentPerf);
        composer.reset();
        resize();
        renderer.shadowMap.needsUpdate = currentPerf.shadowMapSize > 0;
        contextLost = false;
        container.dataset.glState = 'ok';
        options.onRecover?.({ canvas, performance: { ...currentPerf }, rebuilt: false });
      } catch (err) {
        console.error('WebGL context restore failed', err);
        markLost();
        lostAt = 0;
      }
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);
    detachCanvas = () => {
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
    };
  };

  const adoptPipeline = (next: GlPipeline) => {
    renderer = next.renderer;
    composer = next.composer;
    bloomPass = next.bloomPass;
    smaaPass = next.smaaPass;
    vignettePass = next.vignettePass;
    bloomPass.strength = bloomStrength;
  };

  const rebuildRenderer = () => {
    const oldRenderer = renderer;
    const oldComposer = composer;
    const oldCanvas = oldRenderer.domElement;
    detachCanvas?.();
    detachCanvas = null;
    let gl: WebGLRenderingContext | null = null;
    try {
      gl = oldRenderer.getContext();
    } catch {
      gl = null;
    }
    try {
      oldComposer.dispose();
    } catch {
      // A lost context rejects resource deletes.
    }
    try {
      oldRenderer.dispose();
    } catch {
      // Same as above.
    }
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      // Already lost.
    }
    oldCanvas.remove();

    currentPerf = soften();
    adoptPipeline(createGlPipeline(container, scene, camera, currentPerf, bloomStrength));
    bindCanvas(renderer.domElement);
    contextLost = false;
    resize();
    container.dataset.glState = 'rebuilt';
    publish();
    options.onRecover?.({
      canvas: renderer.domElement,
      performance: { ...currentPerf },
      rebuilt: true,
    });
  };

  const pumpRecovery = () => {
    if (!contextLost || rebuilding || document.hidden) return;
    if (performance.now() - lostAt < 1200) return;
    if (!canRebuild()) return;
    rebuilding = true;
    try {
      rebuildRenderer();
    } catch (err) {
      console.error('WebGL rebuild failed', err);
      markLost();
    } finally {
      rebuilding = false;
    }
  };

  const glIsLost = () => {
    try {
      const gl = renderer.getContext();
      return !gl || gl.isContextLost();
    } catch {
      return true;
    }
  };

  const serviceContext = () => {
    if (contextLost || glIsLost()) {
      markLost();
      pumpRecovery();
      return false;
    }
    return true;
  };

  const noteRenderFailure = (err: unknown) => {
    if (!isGlFailure(err)) return;
    markLost();
    lostAt = performance.now() - 1200;
  };

  bindCanvas(renderer.domElement);
  container.dataset.glState = 'ok';

  const stopViewport = watchVisualViewport(container, () => {
    resize();
    options.onResize?.();
  });

  const render = (deltaSeconds = 0) => {
    if (!serviceContext()) return;

    try {
      if (pendingPerf) {
        const next = pendingPerf;
        pendingPerf = null;
        applyPerformance(next);
      }

      if (deltaSeconds > 0) {
        displayFps = displayFps * 0.9 + (1 / deltaSeconds) * 0.1;
        if (autoDowngrade) {
          frameBudget += deltaSeconds;
          if (frameBudget >= 0.75) {
            const fps = 1 / deltaSeconds;
            if (fps < 50) badFrames += 1;
            else badFrames = Math.max(0, badFrames - 1);
            frameBudget = 0;
            if (badFrames >= 2) {
              const prevTier = currentPerf.tier;
              const next = downgradeSettings(currentPerf);
              if (next.tier !== prevTier || next.maxPixelRatio !== currentPerf.maxPixelRatio) {
                pendingPerf = next;
              }
              badFrames = 0;
            }
          }
        }
      }

      if (currentPerf.shadowMapSize > 0) {
        shadowStep = (shadowStep + 1) % 2;
        if (shadowStep === 0) renderer.shadowMap.needsUpdate = true;
      }

      if (needsComposer()) {
        composer.render();
      } else {
        renderer.render(scene, camera);
      }
    } catch (err) {
      noteRenderFailure(err);
      if (!isGlFailure(err)) throw err;
    }
  };

  const setPointerCapture = (enabled: boolean) => {
    renderer.domElement.style.pointerEvents = enabled ? 'auto' : 'none';
  };

  const dispose = () => {
    stopViewport();
    detachCanvas?.();
    try {
      composer.dispose();
    } catch {
      // Ignore a context that is already gone.
    }
    try {
      renderer.dispose();
    } catch {
      // Ignore a context that is already gone.
    }
    renderer.domElement.remove();
  };

  Object.assign(bundle, {
    renderer,
    composer,
    camera,
    scene,
    bloomPass,
    bloom: bloomPass,
    smaaPass,
    vignettePass,
    performance: currentPerf,
    resize,
    render,
    setBloom: (strength: number) => {
      bloomStrength = strength;
      bloomPass.strength = strength;
    },
    setPointerCapture,
    applyPerformance,
    setAutoDowngrade: (enabled: boolean) => {
      autoDowngrade = enabled;
      badFrames = 0;
      frameBudget = 0;
    },
    getFps: () => displayFps,
    isContextLost: () => contextLost || glIsLost(),
    serviceContext,
    noteRenderFailure,
    dispose,
  });

  return bundle;
}
