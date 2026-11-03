// Jobs: every player earns XP in the jobs they actually do (team money stays shared), levels give small perks,
// and the end-of-day report card shows who did what. Stored by player NAME so it survives reconnects.
import { G, nameOf } from './state.js';

export const JOBS = {
  cashier: { icon: '🧾', name: 'Cashier', perks: ['', 'Customers have +1 patience with you', 'Tips ×1.5', 'Auto-scan + the card terminal fills the amount', 'Buyers pay you up to 5 % more'] },
  cleaner: { icon: '🧽', name: 'Cleaner', perks: ['', 'Mop 30 % faster', 'Carry 6 trash', 'The mop holds 8 spills before rinsing', 'Carry 8 trash, mop 60 % faster'] },
  stocker: { icon: '📦', name: 'Floor & stock', perks: ['', 'Helping customers: +20 % instead of +15 %', 'Run 15 % faster in the shop', 'Stocking shelves builds a little trust', 'Items you shelve get a quick estimate'] },
  scav: { icon: '🔦', name: 'Scavenger', perks: ['', '+1 bag slot', 'Quieter footsteps', '+1 more bag slot', 'Flashlight batteries last 50 % longer'] },
};
const LV = [0, 100, 300, 600, 1000];
export const levelOf = xp => LV.filter(t => xp >= t).length; // 1..5
export const nextAt = xp => LV.find(t => t > xp) ?? null;

const rec = name => (G.jobs[name] ??= { cashier: 0, cleaner: 0, stocker: 0, scav: 0 });
// Host: credit a player. stat = a counter for today's report card ('sales' adds n, others +1 by default).
export function addJob(pid, job, xp, stat, n = 1) {
  const name = nameOf(pid);
  const before = levelOf(rec(name)[job]);
  rec(name)[job] += Math.round(xp);
  if (stat) { const d = (G.dayStats[name] ??= {}); d[stat] = (d[stat] || 0) + n; }
  const after = levelOf(rec(name)[job]);
  return after > before ? after : 0; // new level reached (0 = none)
}
// Perk level (1..5) for a player in a job. Works on every machine (jobs are part of the synced state).
export const perk = (pid, job) => levelOf(G.jobs[nameOf(pid)]?.[job] || 0);
export const myPerk = job => perk(G.me, job);

export const bagCap = pid => G.up.bag + (perk(pid, 'scav') >= 2 ? 1 : 0) + (perk(pid, 'scav') >= 4 ? 1 : 0);
export const trashCap = pid => perk(pid, 'cleaner') >= 5 ? 8 : perk(pid, 'cleaner') >= 3 ? 6 : 4;
export const mopCap = pid => perk(pid, 'cleaner') >= 4 ? 8 : 5;
export const mopSpeed = pid => perk(pid, 'cleaner') >= 5 ? 1.6 : perk(pid, 'cleaner') >= 2 ? 1.3 : 1;

const LABELS = { sales: ['🧾', 'sales', v => '$' + v.toLocaleString('en-US')], sold: ['🛍️', 'items sold'], bought: ['💰', 'bought from customers'],
  trash: ['🗑️', 'trash picked up'], bags: ['🚮', 'bags taken out'], spills: ['🧽', 'spills cleaned'], placed: ['📦', 'items shelved'],
  tagged: ['🏷️', 'prices set'], helped: ['🙋', 'customers helped'], caught: ['🚨', 'shoplifters caught'], eggs: ['🥚', 'egg jobs'],
  repaired: ['🔧', 'repairs'], orders: ['📋', 'orders delivered'] };

// Report card HTML for the day summary. report = { name: { stat: n } }
export function reportCard(report) {
  const names = Object.keys(report || {});
  if (!names.length) return '';
  const rows = names.map(n => {
    const d = report[n];
    const parts = Object.entries(d).filter(([k]) => LABELS[k]).map(([k, v]) => `${LABELS[k][0]} ${LABELS[k][2] ? LABELS[k][2](v) : v} ${LABELS[k][1]}`);
    const j = G.jobs[n] || {};
    const lv = Object.entries(JOBS).map(([k, J]) => `${J.icon}${levelOf(j[k] || 0)}`).join(' ');
    return `<div class="report-row"><b>${n}</b><small class="dim">${lv}</small><div>${parts.join(' · ') || '<span class="dim">took it easy today</span>'}</div></div>`;
  }).join('');
  return `<h3>👥 Team report</h3><div class="report">${rows}</div>`;
}
