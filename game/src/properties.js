// properties.js — Worker G (ISLA BRASA 3D)
// Buyable properties: safehouse $5,000 (+$100/day), shop $12,000
// (+$300/day), nightclub $25,000 (+$800/day). Owned ids live in
// S.properties (persisted by state.js). Daily income is paid by
// collectDailyIncome(S), which main.js calls once per in-game day rollover
// (S.timeOfDay wrapping past midnight).

import { PROPERTIES } from './config.js';

export function ensureProperties(S) {
  if (!Array.isArray(S.properties)) S.properties = [];
  if (typeof S.cash !== 'number') S.cash = 0;
  return S.properties;
}

export function ownedProperties(S) {
  ensureProperties(S);
  return S.properties.map((id) => PROPERTIES[id]).filter(Boolean);
}

export function dailyIncome(S) {
  ensureProperties(S);
  return S.properties.reduce((sum, id) => sum + (PROPERTIES[id]?.dailyIncome || 0), 0);
}

export function openProperties(S) {
  ensureProperties(S);
  S.overlay = 'properties';
  return S.overlay;
}

// Buy a property: deduct price, add to S.properties, save. Returns
// { ok, error?, id, name, cash }.
export function buyProperty(S, id) {
  ensureProperties(S);
  const p = PROPERTIES[id];
  if (!p) return { ok: false, error: 'unknown property' };
  if (S.properties.includes(id)) return { ok: false, error: p.name + ' already owned' };
  if (S.cash < p.price) return { ok: false, error: `need $${p.price.toLocaleString()}` };
  S.cash -= p.price;
  S.properties.push(id);
  if (typeof S.save === 'function') { try { S.save(); } catch { /* ignore */ } }
  if (S.audio) { try { S.audio.playSfx('purchase'); } catch { /* ignore */ } }
  return { ok: true, id, name: p.name, price: p.price, dailyIncome: p.dailyIncome, cash: S.cash };
}

// Pay one day of passive income into S.cash. Called by main.js on the
// day rollover; also safe to call directly (e.g. from a test) — it just
// pays once per call. Returns { ok, amount, cash }.
export function collectDailyIncome(S) {
  ensureProperties(S);
  const amount = dailyIncome(S);
  if (amount > 0) {
    S.cash += amount;
    S.lastIncome = { amount, at: Date.now(), day: S.dayCount || 0 };
    if (typeof S.save === 'function') { try { S.save(); } catch { /* ignore */ } }
  }
  return { ok: true, amount, cash: S.cash };
}
