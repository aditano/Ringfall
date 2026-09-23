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
  type PerformanceSettings,
} from './PerformanceProfile';

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
  dispose: () => void;
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

/**
 * WebGL renderer with adaptive post-processing for Chrome + Safari.
 */
export function createRenderer(
  container: HTMLElement,
  options: RendererSetupOptions = {},
): RendererBundle {
  const perf = options.performance ?? detectPerformanceSettings();
  const bloomStrength = options.bloomStrength ?? 0.48;

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

  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
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
  renderer.shadowMap.needsUpdate = true;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  composer.setSize(width, height);
  composer.setPixelRatio(renderer.getPixelRatio());

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

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

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  let currentPerf = { ...perf };
  let autoDowngrade = options.autoDowngrade !== false;
  let frameBudget = 0;
  let badFrames = 0;
  let displayFps = 60;
  let pendingPerf: PerformanceSettings | null = null;
  let shadowStep = 0;
  let contextLost = false;

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
  };

  const onWindowResize = () => resize();
  window.addEventListener('resize', onWindowResize);

  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
  };
  const onContextRestored = () => {
    contextLost = false;
    try {
      composer.reset();
      resize();
      renderer.shadowMap.needsUpdate = true;
    } catch (err) {
      console.error('WebGL context restore failed', err);
    }
  };
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

  const render = (deltaSeconds = 0) => {
    if (contextLost || renderer.getContext().isContextLost()) return;

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
  };

  const setPointerCapture = (enabled: boolean) => {
    renderer.domElement.style.pointerEvents = enabled ? 'auto' : 'none';
  };

  const dispose = () => {
    window.removeEventListener('resize', onWindowResize);
    renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
    renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);
    composer.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };

  return {
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
    isContextLost: () => contextLost || renderer.getContext().isContextLost(),
    dispose,
  };
}
