// casino.js — Worker G (ISLA BRASA 3D)
// Coral Room Casino mini-games: slots, blackjack, roulette. Pure state
// logic on S (cash moves via economy.casinoBet/casinoPayout, imported
// lazily through S where needed — this module only touches S.cash directly
// so it has no import cycle with economy.js).
// S.casino state: { game, slots:{reels,last,lastWin}, bj:{phase,bet,player,dealer,message}, roulette:{lastNumber,lastColor,lastBet,message} }

import { CASINO } from './config.js';

export function ensureCasino(S) {
  if (!S.casino || typeof S.casino !== 'object') {
    S.casino = {
      game: 'slots',
      slots: { reels: ['🍒', '🍋', '🔔'], last: '', lastWin: 0 },
      bj: { phase: 'idle', bet: 0, player: [], dealer: [], message: 'Place a $50 bet to deal.' },
      roulette: { lastNumber: null, lastColor: null, lastBet: 0, message: 'Pick red or black and a bet.' },
    };
  }
  return S.casino;
}

export function openCasino(S) {
  ensureCasino(S);
  S.overlay = 'casino';
  return S.overlay;
}

export function closeCasino(S) {
  S.overlay = null;
  return null;
}

function randSymbol() {
  const syms = CASINO.slotsSymbols;
  return syms[Math.floor(Math.random() * syms.length)];
}

// --- slots: $20/spin. Three 7s = $500 jackpot, three of a kind = $100,
// a pair = $40, otherwise nothing. Returns { ok, reels, win, cash }.
export function spinSlots(S) {
  ensureCasino(S);
  if (typeof S.cash !== 'number') S.cash = 0;
  if (S.cash < CASINO.slotsCost) return { ok: false, error: `need $${CASINO.slotsCost} to spin` };
  S.cash -= CASINO.slotsCost;
  const reels = [randSymbol(), randSymbol(), randSymbol()];
  let win = 0;
  if (reels[0] === '7️⃣' && reels[1] === '7️⃣' && reels[2] === '7️⃣') win = CASINO.slotsJackpot;
  else if (reels[0] === reels[1] && reels[1] === reels[2]) win = CASINO.slotsThreeKind;
  else if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) win = CASINO.slotsTwoKind;
  S.cash += win;
  const st = S.casino.slots;
  st.reels = reels;
  st.lastWin = win;
  st.last = win >= CASINO.slotsJackpot ? '🎉 JACKPOT! +$' + win
    : win > 0 ? 'You won $' + win + '!' : 'No win — spin again.';
  if (typeof S.save === 'function') { try { S.save(); } catch { /* ignore */ } }
  return { ok: true, reels, win, cash: S.cash };
}

// --- blackjack: $50/hand, dealer stands on 17, win pays 2x total,
// blackjack (21 on the first two cards) pays 3:2 (2.5x total), push refunds.
function drawCard() {
  const r = Math.floor(Math.random() * 13) + 1; // 1..13
  if (r === 1) return 11; // ace
  if (r >= 11) return 10; // face cards
  return r;
}

export function handValue(hand) {
  let total = hand.reduce((a, b) => a + b, 0);
  let aces = hand.filter((c) => c === 11).length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function settleBlackjack(S) {
  const bj = S.casino.bj;
  const pv = handValue(bj.player);
  const dv = handValue(bj.dealer);
  let msg;
  if (pv > 21) { msg = `Bust (${pv}) — dealer takes $${bj.bet}.`; }
  else if (dv > 21) { S.cash += bj.bet * 2; msg = `Dealer busts (${dv}) — you win $${bj.bet * 2}!`; }
  else if (pv > dv) { S.cash += bj.bet * 2; msg = `You win ${pv} vs ${dv} — +$${bj.bet * 2}!`; }
  else if (pv < dv) { msg = `Dealer wins ${dv} vs ${pv} — you lose $${bj.bet}.`; }
  else { S.cash += bj.bet; msg = `Push (${pv} vs ${dv}) — bet refunded.`; }
  bj.phase = 'done';
  bj.message = msg;
  if (typeof S.save === 'function') { try { S.save(); } catch { /* ignore */ } }
  return { ok: true, message: msg, cash: S.cash, player: pv, dealer: dv };
}

export function dealBlackjack(S, bet) {
  ensureCasino(S);
  const amount = bet || CASINO.blackjackBet;
  if (typeof S.cash !== 'number') S.cash = 0;
  if (S.cash < amount) return { ok: false, error: `need $${amount} to play blackjack` };
  S.cash -= amount;
  const bj = S.casino.bj;
  bj.bet = amount;
  bj.player = [drawCard(), drawCard()];
  bj.dealer = [drawCard(), drawCard()];
  bj.phase = 'playing';
  const pv = handValue(bj.player);
  if (pv === 21) {
    // Natural blackjack pays 3:2 — total back is 2.5x the bet.
    S.cash += Math.round(amount * 2.5);
    bj.phase = 'done';
    bj.message = `BLACKJACK! 21 — pays 3:2, +$${Math.round(amount * 2.5)}!`;
    if (typeof S.save === 'function') { try { S.save(); } catch { /* ignore */ } }
    return { ok: true, blackjack: true, message: bj.message, cash: S.cash };
  }
  bj.message = `Your ${pv} vs dealer ${bj.dealer[0]} + ?. Hit or stand?`;
  return { ok: true, player: pv, dealerUp: bj.dealer[0], cash: S.cash };
}

export function hitBlackjack(S) {
  ensureCasino(S);
  const bj = S.casino.bj;
  if (bj.phase !== 'playing') return { ok: false, error: 'deal a hand first' };
  bj.player.push(drawCard());
  const pv = handValue(bj.player);
  if (pv > 21) return settleBlackjack(S);
  if (pv === 21) return standBlackjack(S);
  bj.message = `Your ${pv} vs dealer ${bj.dealer[0]} + ?. Hit or stand?`;
  return { ok: true, player: pv, cash: S.cash };
}

export function standBlackjack(S) {
  ensureCasino(S);
  const bj = S.casino.bj;
  if (bj.phase !== 'playing') return { ok: false, error: 'deal a hand first' };
  while (handValue(bj.dealer) < 17) bj.dealer.push(drawCard());
  return settleBlackjack(S);
}

// --- roulette: bet red/black ($25/$50/$100), win pays 2x total.
// 0 is green — both colours lose.
export function spinRoulette(S, color, amount) {
  ensureCasino(S);
  const bet = amount || 50;
  if (color !== 'red' && color !== 'black') return { ok: false, error: 'pick red or black' };
  if (!CASINO.rouletteBets.includes(bet)) return { ok: false, error: 'bet $25, $50 or $100' };
  if (typeof S.cash !== 'number') S.cash = 0;
  if (S.cash < bet) return { ok: false, error: `need $${bet} to bet` };
  S.cash -= bet;
  const n = Math.floor(Math.random() * 37); // 0..36
  const landed = n === 0 ? 'green' : (CASINO.rouletteRed.includes(n) ? 'red' : 'black');
  const won = landed === color;
  if (won) S.cash += bet * 2;
  const r = S.casino.roulette;
  r.lastNumber = n;
  r.lastColor = landed;
  r.lastBet = bet;
  r.message = won
    ? `🎉 ${n} ${landed} — you bet ${color} $${bet}, win $${bet * 2}!`
    : `${n} ${landed} — you bet ${color} $${bet}, lost $${bet}.`;
  if (typeof S.save === 'function') { try { S.save(); } catch { /* ignore */ } }
  return { ok: true, number: n, color: landed, won, win: won ? bet * 2 : 0, cash: S.cash };
}
