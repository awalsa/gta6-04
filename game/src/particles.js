// particles.js — Worker B (ISLA BRASA 3D)
// Cheap pooled particles: ONE THREE.Points draw call, a fixed ring buffer
// (no per-frame allocation), capped at a few hundred live particles.
// Effects: explosion, muzzle flash, damage smoke, off-road dust, pickup sparkle.
import * as THREE from 'three';

const DEFAULT_MAX = 400;

export function createParticles(S) {
  const max = S?.config?.PARTICLE_MAX ?? DEFAULT_MAX;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 3);
  for (let i = 0; i < max; i++) positions[i * 3 + 1] = -999; // hidden below ground
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.7, vertexColors: true, transparent: true, opacity: 0.95,
    sizeAttenuation: true, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  if (S.scene) S.scene.add(points);

  const st = {
    max, geo, positions, colors,
    vel: new Float32Array(max * 3),
    life: new Float32Array(max),
    maxLife: new Float32Array(max),
    baseColor: new Float32Array(max * 3),
    grav: new Float32Array(max),
    drag: new Float32Array(max),
    cursor: 0, live: 0,
  };

  function spawn(x, y, z, vx, vy, vz, r, g, b, ttl, gravity, dragK) {
    const i = st.cursor;
    st.cursor = (st.cursor + 1) % max;
    if (st.life[i] <= 0) st.live++;
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    st.vel[i * 3] = vx; st.vel[i * 3 + 1] = vy; st.vel[i * 3 + 2] = vz;
    st.baseColor[i * 3] = r; st.baseColor[i * 3 + 1] = g; st.baseColor[i * 3 + 2] = b;
    colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
    st.life[i] = ttl; st.maxLife[i] = ttl;
    st.grav[i] = gravity; st.drag[i] = dragK;
  }
  function burst(pos, count, colorFn, speed, ttl, up, gravity, dragK) {
    const px = pos?.x ?? 0, py = (pos?.y ?? 0) + 0.8, pz = pos?.z ?? 0;
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const e = (Math.random() - 0.5) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.8);
      const [r, g, b] = colorFn();
      spawn(px, py, pz,
        Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + up, Math.sin(a) * Math.cos(e) * s,
        r, g, b, ttl * (0.6 + Math.random() * 0.7), gravity, dragK);
    }
  }
  const fireColor = () => (Math.random() < 0.5 ? [1, 0.55, 0.1] : [1, 0.15, 0.05]);
  const smokeColor = () => { const v = 0.25 + Math.random() * 0.25; return [v, v, v]; };

  const api = {
    max, _state: st,
    live: () => st.live,
    spawnExplosion(pos) {
      burst(pos, 36, fireColor, 9, 0.9, 3, -4, 1.5);
      burst(pos, 14, smokeColor, 3, 2.2, 2.5, 1.5, 0.8);
    },
    spawnMuzzle(pos, dir) {
      const px = pos?.x ?? 0, py = (pos?.y ?? 0) + 1.4, pz = pos?.z ?? 0;
      const dx = dir?.x ?? 0, dz = dir?.z ?? 0;
      for (let k = 0; k < 6; k++) {
        spawn(px + dx * 0.5, py, pz + dz * 0.5,
          dx * 6 + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, dz * 6 + (Math.random() - 0.5) * 2,
          1, 0.9, 0.4, 0.12, 0, 0);
      }
    },
    spawnSmoke(pos) {
      burst(pos, 3, smokeColor, 0.8, 1.6, 1.8, 1.2, 0.5);
    },
    spawnDust(pos) {
      const px = pos?.x ?? 0, py = 0.3, pz = pos?.z ?? 0;
      for (let k = 0; k < 4; k++) {
        spawn(px + (Math.random() - 0.5), py, pz + (Math.random() - 0.5),
          (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), (Math.random() - 0.5) * 1.5,
          0.76, 0.65, 0.45, 0.9, 0.5, 1);
      }
    },
    spawnSparkle(pos) {
      const px = pos?.x ?? 0, py = (pos?.y ?? 0) + 1, pz = pos?.z ?? 0;
      for (let k = 0; k < 8; k++) {
        spawn(px + (Math.random() - 0.5) * 1.5, py + Math.random(), pz + (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 1.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.5,
          1, 0.84, 0.1, 0.9, 1.5, 0.5);
      }
    },
  };
  S.particles = api;
  return api;
}

export function updateParticles(S, dt) {
  const st = S?.particles?._state;
  if (!st) return;
  dt = Math.min(dt || 0.016, 0.05);
  const { positions, colors, vel, life, maxLife, baseColor, grav, drag, max } = st;
  for (let i = 0; i < max; i++) {
    if (life[i] <= 0) continue;
    life[i] -= dt;
    if (life[i] <= 0) {
      positions[i * 3 + 1] = -999;
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 0;
      st.live = Math.max(0, st.live - 1);
      continue;
    }
    const dk = Math.max(0, 1 - drag[i] * dt);
    vel[i * 3] *= dk; vel[i * 3 + 2] *= dk;
    vel[i * 3 + 1] -= grav[i] * dt;
    positions[i * 3] += vel[i * 3] * dt;
    positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
    positions[i * 3 + 2] += vel[i * 3 + 2] * dt;
    if (positions[i * 3 + 1] < 0.05) { positions[i * 3 + 1] = 0.05; vel[i * 3 + 1] = 0; }
    const f = life[i] / maxLife[i]; // fade to black as life runs out
    colors[i * 3] = baseColor[i * 3] * f;
    colors[i * 3 + 1] = baseColor[i * 3 + 1] * f;
    colors[i * 3 + 2] = baseColor[i * 3 + 2] * f;
  }
  st.geo.attributes.position.needsUpdate = true;
  st.geo.attributes.color.needsUpdate = true;
}
