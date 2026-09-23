import * as THREE from 'three';

export interface SkyAtmosphere {
  sky: THREE.Mesh;
  sunDisc: THREE.Mesh;
  ringBand: THREE.Mesh;
  fogColor: THREE.Color;
  /** Sync fog / uniforms if time-of-day ever animates. */
  update: (camera: THREE.Camera) => void;
  dispose: () => void;
}

export interface SkyAtmosphereOptions {
  /** Outer sky dome radius. Default 900. */
  radius?: number;
  /** Fog near / far distances matching arena scale. */
  fogNear?: number;
  fogFar?: number;
}

const skyVertexShader = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position.z = gl_Position.w;
}
`;

const skyFragmentShader = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunDirection;
uniform float uSunIntensity;
uniform float uGlowPower;

varying vec3 vWorldPosition;

void main() {
  vec3 dir = normalize(vWorldPosition);
  float h = dir.y;

  // Combat Evolved daytime: blue zenith, pale horizon.
  float horizonBlend = smoothstep(-0.05, 0.35, h);
  float groundBlend = smoothstep(-0.25, 0.02, h);
  vec3 col = mix(uGround, uHorizon, groundBlend);
  col = mix(col, uZenith, horizonBlend);

  // Soft solar bloom toward the key light.
  float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
  float sunGlow = pow(sunDot, uGlowPower) * uSunIntensity;
  col += vec3(1.0, 0.92, 0.72) * sunGlow;

  // Subtle atmospheric haze brightening near horizon.
  float haze = exp(-abs(h) * 4.5) * 0.06;
  col += uHorizon * haze;

  gl_FragColor = vec4(col, 1.0);
}
`;

/**
 * Procedural teal→gold sky dome, distant ring-world curvature band,
 * and matching scene fog for a bright outdoor Halo look.
 */
export function createSkyAtmosphere(
  scene: THREE.Scene,
  options: SkyAtmosphereOptions = {},
): SkyAtmosphere {
  const radius = options.radius ?? 900;

  const zenith = new THREE.Color(0x3c86d4);
  const horizon = new THREE.Color(0xc5e4f6);
  const ground = new THREE.Color(0x7eae78);
  const fogColor = new THREE.Color(0xb7d4ea);

  const sunDirection = new THREE.Vector3(42, 85, 22).normalize();

  const uniforms = {
    uZenith: { value: zenith },
    uHorizon: { value: horizon },
    uGround: { value: ground },
    uSunDirection: { value: sunDirection.clone() },
    uSunIntensity: { value: 0.52 },
    uGlowPower: { value: 32.0 },
  };

  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
  });

  const sky = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 24), skyMat);
  sky.name = 'SkyDome';
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  scene.add(sky);

  // Soft sun disc for silhouette read against structures.
  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(28, 32),
    new THREE.MeshBasicMaterial({
      color: 0xfff0c8,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      fog: false,
    }),
  );
  sunDisc.name = 'SunDisc';
  sunDisc.position.copy(sunDirection).multiplyScalar(radius * 0.92);
  sunDisc.lookAt(0, 0, 0);
  sunDisc.renderOrder = -9;
  scene.add(sunDisc);

  // Distant ring-world curvature — suggests the Halo arc on the horizon.
  const ringBand = createRingWorldBand(radius * 0.88);
  scene.add(ringBand);

  scene.fog = new THREE.FogExp2(0xb7d4ea, 0.00145);
  scene.background = new THREE.Color(0x7eb6de);

  return {
    sky,
    sunDisc,
    ringBand,
    fogColor,
    update(camera: THREE.Camera) {
      sky.position.copy(camera.position);
      // Keep band locked to camera XZ so it always reads as distant horizon.
      ringBand.position.x = camera.position.x;
      ringBand.position.z = camera.position.z;
    },
    dispose() {
      scene.remove(sky);
      scene.remove(sunDisc);
      scene.remove(ringBand);
      sky.geometry.dispose();
      skyMat.dispose();
      sunDisc.geometry.dispose();
      (sunDisc.material as THREE.Material).dispose();
      disposeObject3D(ringBand);
      scene.fog = null;
    },
  };
}

const ringVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ringFragment = /* glsl */ `
varying vec2 vUv;
void main() {
  float across = vUv.y;
  float along = vUv.x;
  float landBand = smoothstep(0.08, 0.22, across) * smoothstep(0.96, 0.72, across);
  float n = fract(sin(dot(vec2(along * 40.0, across * 8.0), vec2(12.9898, 78.233))) * 43758.5453);
  vec3 land = mix(vec3(0.28, 0.46, 0.24), vec3(0.48, 0.42, 0.26), n);
  land = mix(land, vec3(0.22, 0.34, 0.22), smoothstep(0.45, 0.7, n));
  vec3 rim = vec3(0.62, 0.68, 0.72);
  vec3 edge = vec3(0.12, 0.16, 0.2);
  vec3 col = mix(edge, rim, smoothstep(0.0, 0.12, across));
  col = mix(col, land, landBand);
  float streak = smoothstep(0.72, 1.0, sin(along * 90.0) * 0.5 + 0.5);
  col += vec3(0.15, 0.18, 0.12) * streak * landBand * 0.35;
  gl_FragColor = vec4(col, 1.0);
}
`;

function createRingWorldBand(_radius: number): THREE.Mesh {
  // Upper arc of Installation 04, locked to the camera like the CE skybox.
  // The ring lies in the YZ plane so it spans left-right when looking down the valley (+X).
  const geo = new THREE.RingGeometry(820, 1280, 96, 1, Math.PI * 0.02, Math.PI * 0.96);
  const mat = new THREE.ShaderMaterial({
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'RingWorldBand';
  mesh.rotation.y = Math.PI / 2;
  mesh.rotation.z = 0.08;
  mesh.position.y = -40;
  mesh.renderOrder = -8;
  return mesh;
}

function disposeObject3D(root: THREE.Object3D): void {
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        for (const m of mesh.material) m.dispose();
      } else {
        mesh.material.dispose();
      }
    }
  });
  root.parent?.remove(root);
}
