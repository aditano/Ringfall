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
  float horizonBlend = smoothstep(-0.02, 0.22, h);
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

  const zenith = new THREE.Color(0x1a6ec8);
  const horizon = new THREE.Color(0x9ecff2);
  const ground = new THREE.Color(0x6f9a62);
  const fogColor = new THREE.Color(0xa9c6df);

  const sunDirection = new THREE.Vector3(22, 58, 46).normalize();

  const uniforms = {
    uZenith: { value: zenith },
    uHorizon: { value: horizon },
    uGround: { value: ground },
    uSunDirection: { value: sunDirection.clone() },
    uSunIntensity: { value: 0.55 },
    uGlowPower: { value: 28.0 },
  };

  const skyMat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: skyVertexShader,
    fragmentShader: skyFragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
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
  sunDisc.position.copy(sunDirection).multiplyScalar(radius * 0.86);
  sunDisc.lookAt(0, 0, 0);
  sunDisc.renderOrder = -9;
  scene.add(sunDisc);

  // The ring arcs across the sky in front of the valley, not in the camera plane.
  const ringBand = createRingWorldBand();
  const farArc = createFarArc();
  scene.add(ringBand);
  scene.add(farArc);

  scene.fog = new THREE.FogExp2(0xa9c6df, 0.00095);
  scene.background = new THREE.Color(0x7eb6e4);

  return {
    sky,
    sunDisc,
    ringBand,
    fogColor,
    update(camera: THREE.Camera) {
      sky.position.copy(camera.position);
      sunDisc.position.copy(camera.position).addScaledVector(sunDirection, radius * 0.86);
      sunDisc.lookAt(camera.position);
      ringBand.position.set(camera.position.x + 520, -740, camera.position.z);
      farArc.position.set(camera.position.x + 520, -740, camera.position.z);
    },
    dispose() {
      scene.remove(sky);
      scene.remove(sunDisc);
      scene.remove(ringBand);
      scene.remove(farArc);
      sky.geometry.dispose();
      skyMat.dispose();
      sunDisc.geometry.dispose();
      (sunDisc.material as THREE.Material).dispose();
      disposeObject3D(ringBand);
      disposeObject3D(farArc);
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
  float rim = smoothstep(0.0, 0.07, across) * smoothstep(1.0, 0.9, across);
  float n = fract(sin(dot(vec2(along * 48.0, across * 6.0), vec2(12.9898, 78.233))) * 43758.5453);
  vec3 land = mix(vec3(0.18, 0.5, 0.16), vec3(0.45, 0.38, 0.18), n);
  land = mix(land, vec3(0.22, 0.36, 0.18), smoothstep(0.55, 0.85, n));
  float shade = 0.82 + 0.18 * sin(along * 30.0 + across * 8.0);
  vec3 col = mix(vec3(0.07, 0.09, 0.11), land * shade, rim);
  gl_FragColor = vec4(col, 1.0);
}
`;

function createRingWorldBand(): THREE.Mesh {
  // Upper arc. After a 90° yaw the ring stands in the YZ plane, ahead of the camera.
  const geo = new THREE.RingGeometry(900, 1120, 180, 1, 0.02, Math.PI - 0.04);
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
  mesh.renderOrder = -8;
  mesh.frustumCulled = false;
  return mesh;
}

function createFarArc(): THREE.Mesh {
  const geo = new THREE.RingGeometry(180, 230, 96, 1, Math.PI * 0.18, Math.PI * 0.64);
  const mat = new THREE.ShaderMaterial({
    vertexShader: ringVertex,
    fragmentShader: ringFragment,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
    transparent: true,
    opacity: 0.22,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'RingWorldFarArc';
  mesh.rotation.y = Math.PI / 2;
  mesh.renderOrder = -8;
  mesh.frustumCulled = false;
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
