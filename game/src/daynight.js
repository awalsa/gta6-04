// daynight.js — day/night cycle for ISLA BRASA 3D (Worker A).
// One full cycle takes DAY_LENGTH_SEC (config.js, 360 s = 6 in-game minutes).
// S.timeOfDay is 0..1 (0 = midnight, 0.25 = 06:00 sunrise, 0.5 = noon,
// 0.75 = 18:00 sunset). Day is 06:00–18:00; S.isNight is true outside it.
// Time NEVER gates gameplay: no mission, race or shop is locked to the
// time of day — this is purely visual (lights, sky, fog, lamps, windows).
//
// createDayNight(S) -> { update(dt) } — advances S.timeOfDay, orbits the
// sun/moon lights + meshes main.js created (S.sunLight, S.moonLight,
// S.sunMesh, S.moonMesh, S.hemiLight), lerps scene background / fog / the
// world sky dome, and returns { isNight, dayF } so main.js can call
// world.setNightGlow() on transitions.

import * as THREE from 'three';
import { DAY_LENGTH_SEC } from './config.js';

const DAY_SKY = new THREE.Color(0x87b5d6);
const NIGHT_SKY = new THREE.Color(0x0a0f24);
const DUSK_SKY = new THREE.Color(0xd98a5a);
const DAY_DOME = new THREE.Color(0xffffff); // vertex colours show through
const NIGHT_DOME = new THREE.Color(0x232a4a);
const DAY_FOG = new THREE.Color(0x87b5d6);
const NIGHT_FOG = new THREE.Color(0x0a0f24);
const _sky = new THREE.Color();
const _fog = new THREE.Color();
const _dome = new THREE.Color();

export function createDayNight(S) {
  const dayLength = (typeof DAY_LENGTH_SEC === 'number' && DAY_LENGTH_SEC > 0)
    ? DAY_LENGTH_SEC : 360;
  return {
    update(dt) {
      if (!S) return { isNight: false, dayF: 1 };
      try {
        const tod = (typeof S.timeOfDay === 'number' ? S.timeOfDay : 0.3);
        S.timeOfDay = (tod + (dt || 0) / dayLength) % 1;

        // Sun angle: 0 at 06:00 sunrise (east horizon), PI at noon is wrong
        // — theta = 0 at sunrise, PI/2 at noon, PI at sunset, 3PI/2 midnight.
        const theta = (S.timeOfDay - 0.25) * Math.PI * 2;
        const elev = Math.sin(theta); // -1..1, >0 while the sun is up
        // Smooth day factor: 1 in full daylight, 0 in full night.
        let dayF = THREE.MathUtils.clamp((elev + 0.05) / 0.3, 0, 1);
        dayF = dayF * dayF * (3 - 2 * dayF);
        const isNight = elev < 0.02;
        S.isNight = isNight;

        // Sun + moon orbit (radius 240 for lights, 420 for the sky meshes).
        const sunX = Math.cos(theta) * 240, sunY = Math.sin(theta) * 240;
        if (S.sunLight) {
          S.sunLight.position.set(sunX, sunY, 80);
          S.sunLight.intensity = 1.1 * dayF;
          S.sunLight.color.setHex(dayF > 0.6 ? 0xfff2cc : 0xffb36b);
        }
        if (S.sunMesh) S.sunMesh.position.set(Math.cos(theta) * 420, Math.sin(theta) * 420, -120);
        const moonTheta = theta - Math.PI;
        if (S.moonLight) {
          S.moonLight.position.set(Math.cos(moonTheta) * 240, Math.sin(moonTheta) * 240, -80);
          S.moonLight.intensity = 0.5 * (1 - dayF);
        }
        if (S.moonMesh) S.moonMesh.position.set(Math.cos(moonTheta) * 420, Math.sin(moonTheta) * 420, 120);
        if (S.hemiLight) S.hemiLight.intensity = 0.22 + 0.73 * dayF;

        // Sky / fog: night colour -> day colour, with a dusk tint near the
        // horizon (sun low, either rising or setting).
        const duskF = elev > -0.1 ? Math.max(0, 1 - Math.abs(elev) / 0.3) : 0;
        _sky.copy(NIGHT_SKY).lerp(DAY_SKY, dayF);
        _sky.lerp(DUSK_SKY, duskF * 0.45);
        if (S.scene) {
          if (S.scene.background && S.scene.background.isColor) S.scene.background.copy(_sky);
          if (S.scene.fog && S.scene.fog.color) {
            _fog.copy(NIGHT_FOG).lerp(DAY_FOG, dayF);
            _fog.lerp(DUSK_SKY, duskF * 0.3);
            S.scene.fog.color.copy(_fog);
          }
        }
        // World sky dome (vertex-coloured): tint its material dark at night.
        const skyMat = S.world && S.world.skyMaterial;
        if (skyMat && skyMat.color) {
          _dome.copy(NIGHT_DOME).lerp(DAY_DOME, dayF);
          skyMat.color.copy(_dome);
        }

        return { isNight, dayF };
      } catch (err) {
        console.warn('[daynight] update failed:', err);
        return { isNight: !!S.isNight, dayF: 1 };
      }
    },
  };
}

export default createDayNight;
