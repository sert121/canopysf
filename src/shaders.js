import * as THREE from 'three'

// Colours are authored as sRGB hex; shaders convert to linear, light in linear HDR,
// then apply aerial perspective, ACES filmic tone mapping and sRGB encoding themselves.
THREE.ColorManagement.enabled = false

export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.5, 0.6, 0.2).normalize() },
  uSunColor: { value: new THREE.Color('#fff1df') },
  uSunI: { value: 3.2 },
  uSkyAmb: { value: new THREE.Color('#9db7d8') },
  uGroundAmb: { value: new THREE.Color('#8a7a64') },
  uAmbI: { value: 0.9 },
  uZenith: { value: new THREE.Color('#3f6ea8') },
  uHorizon: { value: new THREE.Color('#c4d6e6') },
  uHaze: { value: 0.35 },
  uFogDensity: { value: 0.00018 },
  uFogFalloff: { value: 0.0025 },
  uExposure: { value: 1.0 },
  uCamPos: { value: new THREE.Vector3() },
  uNight: { value: 0.0 },
  uCloud: { value: 0.35 },
  // shadows
  uShadowMap: { value: null },
  uShadowMatrix: { value: new THREE.Matrix4() },
  uShadowOn: { value: 0 },
  uShadowTexel: { value: 1 / 4096 },
  // compatibility with older code paths
  uFogColor: { value: new THREE.Color('#c4d6e6') },
  uFogSun: { value: new THREE.Color('#ffe2b8') },
  uSaturate: { value: 1.0 },
}

export const COMMON = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunI;
uniform vec3 uSkyAmb; uniform vec3 uGroundAmb; uniform float uAmbI;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform float uHaze;
uniform float uFogDensity; uniform float uFogFalloff; uniform float uExposure;
uniform vec3 uCamPos; uniform float uNight; uniform float uCloud;
uniform highp sampler2DShadow uShadowMap; uniform mat4 uShadowMatrix; uniform float uShadowOn; uniform float uShadowTexel;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm2(vec2 p){ return vnoise(p)*0.5 + vnoise(p*2.03+7.1)*0.3 + vnoise(p*4.11-3.7)*0.2; }

vec3 lin(vec3 c){ return pow(max(c, 0.0), vec3(2.2)); }

// analytic sky radiance (linear) for a view direction
vec3 skyLin(vec3 d){
  float h = clamp(d.y, -0.2, 1.0);
  float mu = max(dot(d, uSunDir), 0.0);
  vec3 zen = lin(uZenith), hor = lin(uHorizon);
  vec3 c = mix(hor, zen, pow(smoothstep(-0.02, 1.0, h), 0.42));
  // horizon brightening + Mie forward scattering around the sun
  c += lin(uSunColor) * (pow(mu, 6.0) * 0.35 * uHaze + pow(mu, 48.0) * 0.6 * uHaze + pow(mu, 400.0) * 1.2);
  c *= 1.0 + 0.6 * (1.0 - smoothstep(0.0, 0.25, abs(h))) * uHaze;
  // below the horizon: haze-coloured ground glow
  c = mix(c, hor * 0.75, smoothstep(0.0, -0.12, d.y));
  return c * 1.25 * (1.0 - uNight * 0.75);
}

// aerial perspective: exponential height fog toward the sky colour along the ray
vec3 fogIt(vec3 c, vec3 wpos){
  vec3 v = wpos - uCamPos; float dist = length(v); vec3 dir = v / max(dist, 1e-3);
  float k = uFogFalloff, h0 = max(uCamPos.y, -5.0), dy = v.y;
  float integ = abs(dy * k) > 1e-3 ? (1.0 - exp(-dy * k)) / (dy * k) : 1.0;
  float amt = 1.0 - exp(-uFogDensity * exp(-h0 * k) * dist * integ);
  vec3 sd = normalize(vec3(dir.x, max(dir.y, 0.02), dir.z));
  vec3 fc = skyLin(sd) * 0.92;
  return mix(c, fc, clamp(amt, 0.0, 1.0));
}

vec3 aces(vec3 x){ const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
vec3 finish(vec3 c){ c = aces(c * uExposure); return pow(c, vec3(1.0 / 2.2)); }

float shadowAt(vec3 wpos, vec3 n){
  if (uShadowOn < 0.5) return 1.0;
  float ndl = dot(n, uSunDir);
  // normal-offset: push the lookup off the surface by ~2 texels, more at grazing angles
  float texW = uShadowTexel * 280.0;
  vec3 off = n * texW * (1.5 + 2.5 * (1.0 - clamp(abs(ndl), 0.0, 1.0))) + uSunDir * texW * 0.5;
  vec4 sp = uShadowMatrix * vec4(wpos + off, 1.0);
  vec3 p = sp.xyz / sp.w * 0.5 + 0.5;
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 1.0;
  if (ndl <= 0.0) return 0.0;
  float bias = 0.00015;
  float s = 0.0;
  for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++)
    s += texture(uShadowMap, vec3(p.xy + vec2(float(i), float(j)) * uShadowTexel * 1.1, p.z - bias));
  s /= 9.0;
  float edge = smoothstep(0.0, 0.06, min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)));
  return mix(1.0, s, edge);
}

// linear lighting: sun (with shadow) + hemispheric sky/ground ambient
vec3 lightIt(vec3 albedoLin, vec3 n, float ao, float shadow){
  float ndl = max(dot(n, uSunDir), 0.0);
  vec3 sun = lin(uSunColor) * uSunI * ndl * shadow;
  float up = n.y * 0.5 + 0.5;
  vec3 amb = (lin(uSkyAmb) * up + lin(uGroundAmb) * (1.0 - up) * 0.6) * uAmbI;
  return albedoLin * (sun + amb * ao);
}

// legacy helper (display-space albedo)
vec3 shade(vec3 albedo, vec3 n, float ao){ return lightIt(lin(albedo), n, ao, 1.0); }
`
