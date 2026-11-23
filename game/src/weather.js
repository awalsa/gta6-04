// weather.js — Worker E (ISLA BRASA 3D)
// Mostly clear, with occasional rain: random every few in-game minutes,
// lasting ~1-2 in-game minutes, plus a manual V toggle for testing.
// Rain = visible streaks (cheap Points field around the camera), a wet-road
// look (darker, less rough ground via world.setWetGround), slightly reduced
// car handling (grip multiplier read by cars.js), and a HUD weather icon.
// Rain is cosmetic + handling only: no mission is ever locked to weather.
//
// API: createWeather(S) -> { updateWeather(S, dt), setWeather(S, kind),
//   isRaining(), kind }. Standalone updateWeather(S, dt) delegates to
// S.weather (main.js can call either). kind is 'clear' | 'cloudy' | 'rain'.
import * as THREE from 'three';
import { WEATHER } from './config.js';

const RAIN_COUNT = 600;
const RAIN_AREA = 60; // streak field half-size around the camera
const RAIN_HEIGHT = 28;
const RAIN_SPEED = 26;

export function createWeather(S) {
  const cfg = (S && S.config && S.config.WEATHER) || WEATHER;
  let kind = 'clear';
  let rainLeft = 0;
  let nextRainIn = (cfg.rainChanceIntervalMin || 150) + Math.random() * 60;
  let field = null; // { points, update(cameraPos, dt) } from world.js, or own fallback
  let wetApplied = false;

  function makeOwnField() {
    try {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(RAIN_COUNT * 3);
      for (let i = 0; i < RAIN_COUNT; i++) {
        pos[i * 3] = (Math.random() - 0.5) * RAIN_AREA * 2;
        pos[i * 3 + 1] = Math.random() * RAIN_HEIGHT;
        pos[i * 3 + 2] = (Math.random() - 0.5) * RAIN_AREA * 2;
      }
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color: 0x9fc8ff, size: 0.18, transparent: true, opacity: 0.65 });
      const points = new THREE.Points(geo, mat);
      points.visible = false;
      points.frustumCulled = false;
      if (S && S.scene) S.scene.add(points);
      return {
        points,
        update(cameraPos, dt) {
          if (!cameraPos) return;
          const arr = geo.attributes.position.array;
          for (let i = 0; i < RAIN_COUNT; i++) {
            arr[i * 3 + 1] -= RAIN_SPEED * dt;
            arr[i * 3] += RAIN_SPEED * 0.12 * dt; // slight wind slant
            if (arr[i * 3 + 1] < 0) {
              arr[i * 3 + 1] = RAIN_HEIGHT;
              arr[i * 3] = cameraPos.x + (Math.random() - 0.5) * RAIN_AREA * 2;
              arr[i * 3 + 2] = cameraPos.z + (Math.random() - 0.5) * RAIN_AREA * 2;
            }
          }
          points.position.set(0, 0, 0);
          geo.attributes.position.needsUpdate = true;
        },
      };
    } catch { return null; }
  }

  function ensureField() {
    if (field) return field;
    try {
      // world.js owns the rain field when it provides one.
      const w = S && S.world;
      if (w && typeof w.createRainField === 'function') field = w.createRainField(S.scene);
      else if (typeof window !== 'undefined' && window.ISLA_BRASA && window.ISLA_BRASA.world && typeof window.ISLA_BRASA.world.createRainField === 'function') field = window.ISLA_BRASA.world.createRainField(S.scene);
    } catch { field = null; }
    if (!field) field = makeOwnField();
    return field;
  }

  function applyWet(wet) {
    if (wet === wetApplied) return;
    wetApplied = wet;
    try {
      if (S && S.world && typeof S.world.setWetGround === 'function') S.world.setWetGround(S, wet);
    } catch { /* wet look is cosmetic */ }
  }

  function setKind(next) {
    if (next !== 'clear' && next !== 'cloudy' && next !== 'rain') next = 'clear';
    kind = next;
    if (S) S.weatherKind = kind;
    if (kind === 'rain') {
      const f = ensureField();
      if (f && f.points) f.points.visible = true;
      applyWet(true);
    } else {
      if (field && field.points) field.points.visible = false;
      applyWet(false);
    }
    return kind;
  }

  const api = {
    get kind() { return kind; },
    isRaining() { return kind === 'rain'; },
    get grip() { return kind === 'rain' ? (cfg.gripMultiplier ?? 0.75) : 1; },
    setWeather(_S, next) {
      const k = setKind(next);
      if (k === 'rain') {
        rainLeft = (cfg.rainDurationMin || 60) + Math.random() * Math.max(0, (cfg.rainDurationMax || 120) - (cfg.rainDurationMin || 60));
      } else {
        nextRainIn = (cfg.rainChanceIntervalMin || 150) + Math.random() * Math.max(0, (cfg.rainChanceIntervalMax || 300) - (cfg.rainChanceIntervalMin || 150));
      }
      return k;
    },
    updateWeather(_S, dt) {
      try {
        dt = Math.min(dt || 0.016, 0.05);
        if (kind === 'rain') {
          rainLeft -= dt;
          const f = ensureField();
          if (f && f.points && f.points.visible && typeof f.update === 'function') {
            f.update(S && S.camera ? S.camera.position : null, dt);
          }
          if (rainLeft <= 0) setKind('cloudy');
          else if (rainLeft < -20) setKind('clear');
          // After a short cloudy tail, go clear and re-roll.
          if (kind === 'cloudy') {
            nextRainIn = (cfg.rainChanceIntervalMin || 150) + Math.random() * 60;
            // stay cloudy briefly, then clear on the next update pass
            if (rainLeft < -8) setKind('clear');
          }
        } else {
          nextRainIn -= dt;
          if (nextRainIn <= 0) {
            setKind('rain');
            rainLeft = (cfg.rainDurationMin || 60) + Math.random() * Math.max(0, (cfg.rainDurationMax || 120) - (cfg.rainDurationMin || 60));
          }
        }
      } catch { /* weather must never break the game loop */ }
    },
  };
  return api;
}

export function updateWeather(S, dt) {
  try { if (S && S.weather && typeof S.weather.updateWeather === 'function') S.weather.updateWeather(S, dt); } catch { /* ignore */ }
}

export default createWeather;
