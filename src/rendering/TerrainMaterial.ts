import * as THREE from 'three'
import type { TextureSet } from './AssetLibrary'

/**
 * Five-layer PBR terrain. Vertex attribute `splat` is grass, dirt, rock, sand.
 * Whatever weight is left over is Forerunner metal. UVs are world-space meters
 * so the large valley plane does not stretch a single tile.
 */
export function createSplatTerrainMaterial(sets: {
  grass: TextureSet
  dirt: TextureSet
  rock: TextureSet
  sand: TextureSet
  metal: TextureSet
}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    metalness: 1,
    map: sets.grass.map,
    normalMap: sets.grass.normal,
    roughnessMap: sets.grass.rough,
    envMapIntensity: 0.38,
  })
  mat.normalScale.set(0.85, 0.85)
  mat.customProgramCacheKey = () => 'ringfall-splat-terrain-v1'

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDirtMap = { value: sets.dirt.map }
    shader.uniforms.uRockMap = { value: sets.rock.map }
    shader.uniforms.uSandMap = { value: sets.sand.map }
    shader.uniforms.uMetalMap = { value: sets.metal.map }
    shader.uniforms.uDirtNormal = { value: sets.dirt.normal }
    shader.uniforms.uRockNormal = { value: sets.rock.normal }
    shader.uniforms.uDirtRough = { value: sets.dirt.rough }
    shader.uniforms.uRockRough = { value: sets.rock.rough }
    shader.uniforms.uSandRough = { value: sets.sand.rough }
    shader.uniforms.uMetalRough = { value: sets.metal.rough }

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      /* glsl */ `#include <common>
attribute vec4 splat;
varying vec4 vSplat;`,
    )
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      /* glsl */ `#include <uv_vertex>
vSplat = splat;`,
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      /* glsl */ `#include <common>
uniform sampler2D uDirtMap;
uniform sampler2D uRockMap;
uniform sampler2D uSandMap;
uniform sampler2D uMetalMap;
uniform sampler2D uDirtNormal;
uniform sampler2D uRockNormal;
uniform sampler2D uDirtRough;
uniform sampler2D uRockRough;
uniform sampler2D uSandRough;
uniform sampler2D uMetalRough;
varying vec4 vSplat;
float tGrass, tDirt, tRock, tSand, tMetal;
void terrainWeights() {
  vec4 w = max(vSplat, vec4(0.0));
  float metal = clamp(1.0 - w.r - w.g - w.b - w.a, 0.0, 1.0);
  float sum = max(w.r + w.g + w.b + w.a + metal, 0.0001);
  tGrass = w.r / sum;
  tDirt = w.g / sum;
  tRock = w.b / sum;
  tSand = w.a / sum;
  tMetal = metal / sum;
}`,
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      /* glsl */ `terrainWeights();
vec2 tuv = vMapUv;
vec3 grassAlbedo = texture2D(map, tuv).rgb * vec3(0.82, 1.22, 0.58);
vec3 albedo = grassAlbedo * tGrass
  + texture2D(uDirtMap, tuv).rgb * tDirt
  + texture2D(uRockMap, tuv).rgb * tRock
  + texture2D(uSandMap, tuv).rgb * tSand
  + texture2D(uMetalMap, tuv).rgb * tMetal;
diffuseColor *= vec4(albedo, 1.0);`,
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      /* glsl */ `float roughnessFactor =
    texture2D(roughnessMap, vMapUv).g * tGrass
  + texture2D(uDirtRough, vMapUv).g * tDirt
  + texture2D(uRockRough, vMapUv).g * tRock
  + texture2D(uSandRough, vMapUv).g * tSand
  + texture2D(uMetalRough, vMapUv).g * tMetal;
roughnessFactor = clamp(roughnessFactor, 0.04, 1.0);`,
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <metalnessmap_fragment>',
      /* glsl */ `float metalnessFactor = mix(0.02, 0.78, tMetal);`,
    )

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_maps>',
      /* glsl */ `vec3 nGrass = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
vec3 nDirt = texture2D(uDirtNormal, vNormalMapUv).xyz * 2.0 - 1.0;
vec3 nRock = texture2D(uRockNormal, vNormalMapUv).xyz * 2.0 - 1.0;
vec3 mapN = normalize(nGrass * (tGrass + tSand) + nDirt * tDirt + nRock * (tRock + tMetal));
mapN.xy *= normalScale;
normal = normalize(tbn * mapN);`,
    )
  }

  return mat
}
