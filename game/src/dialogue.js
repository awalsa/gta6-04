// dialogue.js — mission intro / completion dialogue box (Worker C).
// Pure state logic; hud.js renders S.dialogue, input/main route skips.
// The box NEVER pauses gameplay: the game loop keeps running while a
// dialogue is open, and every function here is a no-op if S is missing
// fields, so a broken or absent dialogue.js can never block a mission.

export const DIALOGUE_CHARS_PER_SEC = 42; // typewriter speed
export const DIALOGUE_LINE_HOLD_SEC = 1.4; // pause on a finished line

function ensureDialogue(S) {
  if (!S.dialogue || typeof S.dialogue !== 'object') S.dialogue = null;
  return S.dialogue;
}

/**
 * Open a dialogue box. speaker = name shown, lines = 1-3 strings,
 * onDone = optional callback fired once when the box closes.
 * Safe to call when another dialogue is open (replaces it) or when
 * S has no scene/DOM at all (state-only, hud renders when present).
 */
export function showDialogue(S, speaker, lines, onDone) {
  if (!S || typeof S !== 'object') return null;
  const list = (Array.isArray(lines) ? lines : [String(lines ?? '')])
    .map((l) => String(l)).filter((l) => l.length > 0);
  if (list.length === 0) {
    if (typeof onDone === 'function') { try { onDone(); } catch (e) { /* never throw */ } }
    return null;
  }
  S.dialogue = {
    open: true,
    speaker: String(speaker || 'Rook'),
    lines: list,
    index: 0,
    shown: '',
    hold: 0,
    onDone: typeof onDone === 'function' ? onDone : null,
  };
  return S.dialogue;
}

/** True while a dialogue box is on screen. */
export function isDialogueOpen(S) {
  return !!(S && S.dialogue && S.dialogue.open);
}

/** Advance the typewriter by dt seconds; auto-advances / closes lines. */
export function updateDialogue(S, dt) {
  const d = ensureDialogue(S);
  if (!d || !d.open) return;
  const step = Math.max(0, dt || 0);
  const line = d.lines[d.index] || '';
  if (d.shown.length < line.length) {
    const n = Math.min(line.length, d.shown.length + DIALOGUE_CHARS_PER_SEC * step);
    d.shown = line.slice(0, Math.floor(n));
    d.hold = 0;
    return;
  }
  d.hold += step;
  if (d.hold >= DIALOGUE_LINE_HOLD_SEC) advanceDialogue(S);
}

/** Move to the next line, or close the box (firing onDone once). */
export function advanceDialogue(S) {
  const d = ensureDialogue(S);
  if (!d || !d.open) return false;
  d.index += 1;
  d.shown = '';
  d.hold = 0;
  if (d.index >= d.lines.length) { closeDialogue(S); return false; }
  return true;
}

/**
 * Skip: first press completes the current line instantly, the next
 * press advances to the next line (or closes on the last line).
 * Any key or click may call this — see input.js anyPressed().
 */
export function skipDialogue(S) {
  const d = ensureDialogue(S);
  if (!d || !d.open) return false;
  const line = d.lines[d.index] || '';
  if (d.shown.length < line.length) {
    d.shown = line;
    d.hold = 0;
    return true;
  }
  return advanceDialogue(S);
}

/** Close the box immediately and fire onDone once, if set. */
export function closeDialogue(S) {
  const d = ensureDialogue(S);
  if (!d || !d.open) return;
  d.open = false;
  d.shown = '';
  const cb = d.onDone;
  d.onDone = null;
  if (typeof cb === 'function') { try { cb(); } catch (e) { /* never throw */ } }
}

export default { showDialogue, updateDialogue, skipDialogue, closeDialogue, isDialogueOpen };
