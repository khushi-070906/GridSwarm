/* ==========================================================================
   utils.js — formatting + tiny DOM helpers. No API calls, no rendering logic.
   ========================================================================== */

export const $ = (id) => document.getElementById(id);
export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function el(tag, attrs = {}, ns = null) {
  const e = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const svgEl = (tag, attrs) => el(tag, attrs, SVG_NS);

export function fmtKw(n) {
  return (n == null ? '—' : `${n.toFixed(1)} kW`);
}
export function fmtInr(n) {
  return (n == null ? '₹0.00' : `₹${n.toFixed(2)}`);
}
export function fmtPct(n) {
  return (n == null ? '—' : `${n.toFixed(1)}%`);
}
export function fmtMinutes(mins) {
  if (mins == null) return '—';
  if (mins < 60) return `${Math.round(mins)} min`;
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
export function fmtTime(d = new Date()) {
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
export function fmtClock(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Grid status band from utilization %, used consistently everywhere. */
export function gridStatus(utilizationPercent) {
  if (utilizationPercent == null) return { key: 'normal', label: 'Unknown' };
  if (utilizationPercent >= 98) return { key: 'critical', label: 'Critical' };
  if (utilizationPercent >= 92) return { key: 'constrained', label: 'Constrained' };
  if (utilizationPercent >= 82) return { key: 'watch', label: 'Watch' };
  return { key: 'normal', label: 'Normal' };
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
