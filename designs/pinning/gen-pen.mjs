// Writes agent-threads-pinning.pen as plain Pen JSON. Run: bun designs/pinning/gen-pen.mjs
// Colours and sizes come from the running panel (theme tokens read through its debug report).
// All content is made up. The frames are a design proposal, not the feature.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "agent-threads-pinning.pen");
const c = (d, l) => ({ type: "color", value: [{ value: d, theme: { mode: "dark" } }, { value: l, theme: { mode: "light" } }] });
const variables = {
  bg: c("#17191d", "#ffffff"), fg: c("#eeeeef", "#1b1b1e"), muted: c("#98999b", "#69696b"), dim: c("#696a6d", "#969698"),
  accent: c("#96b2d7", "#1f62d0"), raised: c("#2c2e31", "#f6f6f6"), selected: c("#ffffff17", "#00000012"),
  border: c("#ffffff18", "#00000017"), chrome: c("#101114", "#f1f1ee"), popover: c("#25272b", "#ffffff"),
  band: c("#2c2e31", "#efefef"), working: c("#e5c07b", "#9a6700"), done: c("#76a8ff", "#2f6fe4"),
  hit: c("#e5c07b40", "#e5c07b66"), ui: { type: "string", value: "Inter" }, mono: { type: "string", value: "JetBrains Mono" },
};

let seq = 0;
const add = (p, n) => { (p.children = p.children || []).push({ id: `n${++seq}`, ...n }); return p.children[p.children.length - 1]; };
const fr = (p, o) => add(p, { type: "frame", name: o.name || "Box", ...o });
const tx = (p, t, sz, fill, o = {}) => {
  const { mono, w, h, ...r } = o;
  return add(p, { type: "text", name: r.name || String(t).slice(0, 28), content: String(t), fontFamily: mono ? "$mono" : "$ui", fontSize: sz, fill,
    ...(w ? { textGrowth: h ? "fixed-width-height" : "fixed-width", width: w } : {}), ...(h ? { height: h } : {}), ...r });
};
const ic = (p, icon, sz, fill, name) => add(p, { type: "icon", name: name || icon, library: "lucide", icon, width: sz, height: sz, fill });
const dot = (p, fill) => add(p, { type: "ellipse", name: "New dot", width: 6, height: 6, fill });
const cut = (s, px, sz) => { const n = Math.floor(px / (sz * 0.5)); return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; };
const key = (p, t) => { const k = fr(p, { name: "Key", height: 18, padding: [0, 5], alignItems: "center", justifyContent: "center", cornerRadius: 4, fill: "$raised", stroke: "$border", strokeWidth: 1 }); tx(k, t, 10.5, "$dim", { name: "Key label" }); return k; };

const header = (p, w, s) => {
  const nar = w < 300;
  const h = fr(p, { name: "Header", width: "fill_container", height: 40, padding: [0, 10], gap: 8, alignItems: "center", fill: "$chrome", stroke: "$border", strokeWidth: { bottom: s.search ? 0 : 1 } });
  const b = fr(h, { name: "Agent badge", height: 22, padding: [0, nar ? 4 : 6], gap: 4, alignItems: "center", cornerRadius: 5, stroke: "$border", strokeWidth: 1 });
  const o = fr(b, { name: "Agent mark", width: 14, height: 14, cornerRadius: 3, fill: "#d97757", alignItems: "center", justifyContent: "center" });
  ic(o, "asterisk", 11, "#ffffff", "Agent glyph");
  if (!nar) tx(b, "Claude", 12.5, "$fg", { name: "Agent name" });
  tx(h, "12 turns", 12.5, "$muted", { name: "Turn count" });
  fr(h, { name: "Spacer", width: "fill_container", height: 1 });
  for (const [i, on] of [["search", !!s.search], ["pin", !!s.sel_pinned], ["chevrons-down", false], ["sliders-horizontal", false]]) {
    const q = fr(h, { name: "Button " + i, width: 24, height: 24, alignItems: "center", justifyContent: "center", cornerRadius: 4, ...(on ? { fill: "$selected" } : {}) });
    ic(q, i, 14, on ? "$fg" : "$dim", i + " icon");
  }
  if (s.search) {
    const f = fr(p, { name: "Filter", width: "fill_container", padding: [0, 10, 8, 10], fill: "$chrome", stroke: "$border", strokeWidth: { bottom: 1 } });
    const g = fr(f, { name: "Filter field", width: "fill_container", height: 30, padding: [0, 10], gap: 6, alignItems: "center", cornerRadius: 6, fill: "$bg", stroke: "$accent", strokeWidth: 1 });
    ic(g, "search", 12, "$dim", "Filter icon");
    tx(g, s.search, 12.5, "$fg", { name: "Filter text" });
    fr(g, { name: "Spacer", width: "fill_container", height: 1 });
    tx(g, s.count, 11.5, "$dim", { mono: true, name: "Match count" });
    ic(g, "x", 12, "$dim", "Clear");
  }
};

const STATE = { new: ["$accent", "New reply"], live: ["$working", "Working"], gone: ["$dim", "Gone"] };
const tray = (p, w, s) => {
  const nar = w < 300;
  if (!s.pins || !s.pins.length) return;
  const edge = s.place === "top" ? { bottom: 1 } : { top: 1 };
  if (s.fold) {
    const f = fr(p, { name: "Pins, folded", width: "fill_container", height: 34, padding: [0, 8], gap: 5, alignItems: "center", fill: "$band", stroke: "$border", strokeWidth: edge });
    ic(f, "pin", 12, "$dim", "Pins mark");
    for (const q of s.pins) {
      const chip = fr(f, { name: "Pin chip " + q.n, height: 22, padding: [0, 6], gap: 4, alignItems: "center", cornerRadius: 5, stroke: "$border", strokeWidth: 1, ...(q.cur ? { fill: "$selected" } : {}) });
      tx(chip, q.k, 11, "$fg", { mono: true, name: "Chip key" });
      tx(chip, "#" + q.n, 11.5, "$muted", { mono: true, name: "Chip number" });
      if (q.st === "new") dot(chip, "$accent");
    }
    return;
  }
  const b = fr(p, { name: "Pins", width: "fill_container", layout: "vertical", padding: [4, 0], fill: "$band", stroke: "$border", strokeWidth: edge });
  for (const q of s.pins) {
    const gone = q.st === "gone";
    const r = fr(b, { name: "Pin row #" + q.n, width: "fill_container", height: 26, padding: [0, 6, 0, 10], gap: 6, alignItems: "center", ...(q.cur ? { fill: "$selected" } : {}) });
    key(r, q.k);
    tx(r, "#" + q.n, 11.5, "$dim", { mono: true, name: "Pin number" });
    const st = STATE[q.st];
    const right = st ? (nar ? (gone ? 32 : q.st === "new" ? 12 : 18) : st[1].length * 6.2 + (gone ? 0 : 14)) : (nar ? 0 : Math.max(44, q.when.length * 5.9));
    const room = w - 10 - 22 - 6 - (String(q.n).length * 7 + 7) - 6 - 6 - right - 6 - 20 - 6;
    tx(r, cut(q.t, room, 12.5), 12.5, gone ? "$dim" : "$fg", { name: "Pin prompt", w: "fill_container", h: 16 });
    if (st) {
      if (q.st === "new") dot(r, "$accent");
      if (q.st === "live") ic(r, "loader-circle", 12, "$working", "Running");
      if (!nar || gone) tx(r, st[1], 11.5, st[0], { name: "Pin state" });
    } else if (!nar) tx(r, q.when, 11.5, "$dim", { name: "Pin time" });
    const u = fr(r, { name: "Unpin button", width: 20, height: 20, alignItems: "center", justifyContent: "center", cornerRadius: 4 });
    ic(u, "pin-off", 12, "$dim", "Unpin icon");
  }
};

const matched = (p, parts, sz, fill) => {
  const l = fr(p, { name: "Text with match", gap: 0, alignItems: "center" });
  for (const a of parts) {
    if (a.startsWith("*")) { const h = fr(l, { name: "Match", fill: "$hit", cornerRadius: 2 }); tx(h, a.slice(1), sz, fill, { name: "Match text" }); }
    else tx(l, a, sz, fill, { name: "Text part" });
  }
};
const row = (p, w, it) => {
  const outer = fr(p, { name: "Row #" + it.n, width: "fill_container", padding: [0, 6] });
  const b = fr(outer, { name: "Row box", width: "fill_container", layout: "vertical", padding: [8, 10], gap: 3, cornerRadius: 6 });
  const m = fr(b, { name: "Meta", width: "fill_container", gap: 6, alignItems: "center", height: 16 });
  tx(m, "#" + it.n, 11.5, "$dim", { mono: true, name: "Number" });
  if (it.pin) ic(m, "pin", 11, "$accent", "Pinned mark");
  ic(m, it.icon || "circle-check", 12, it.iconFill || "$done", "Status");
  tx(m, it.when, 11.5, "$dim", { name: "Time" });
  fr(m, { name: "Spacer", width: "fill_container", height: 1 });
  if (w >= 300 && it.stats) tx(m, it.stats, 11.5, "$dim", { mono: true, name: "Stats" });
  if (Array.isArray(it.prompt) && w >= 300) matched(b, it.prompt, 13, "$fg");
  else tx(b, Array.isArray(it.prompt) ? it.prompt.join("").replace("*", "") : it.prompt, 13, "$fg", { name: "Prompt", w: "fill_container" });
  if (it.reply) {
    const r = fr(b, { name: "Reply line", width: "fill_container", gap: 6 });
    ic(r, "corner-down-right", 12, "$dim", "Reply mark");
    tx(r, it.reply, 12.5, "$muted", { name: "Reply", w: "fill_container", lineHeight: 1.36 });
  }
};
const band = (p, it) => {
  const b = fr(p, { name: "Day band " + it.label, width: "fill_container", height: 26, padding: [0, 16], alignItems: "center", justifyContent: "space_between", fill: "$band", stroke: "$border", strokeWidth: { top: 1, bottom: 1 } });
  const d = fr(b, { name: "Day", gap: 6, alignItems: "center" });
  ic(d, "calendar", 12, "$muted", "Day mark");
  tx(d, it.label, 11.5, "$fg", { name: "Day name", fontWeight: "600" });
  tx(d, it.date, 11.5, "$dim", { name: "Date" });
  tx(b, it.count, 11.5, "$dim", { name: "Turn count" });
};
const card = (p, w, it) => {
  const o = fr(p, { name: "Open card #" + it.n, width: "fill_container", padding: [0, 6] });
  const k = fr(o, { name: "Card", width: "fill_container", layout: "vertical", padding: [it.mid ? 10 : 6, 10, 10, 10], gap: 8, cornerRadius: it.mid ? [0, 0, 8, 8] : 8, fill: "$raised", stroke: "$border", strokeWidth: 1 });
  if (!it.mid) {
    const h = fr(k, { name: "Card head", width: "fill_container", height: 24, gap: w < 300 ? 4 : 6, alignItems: "center" });
    tx(h, "#" + it.n, 11.5, "$dim", { mono: true, name: "Number" });
    ic(h, "circle-check", 12, "$done", "Status");
    tx(h, it.when, 11.5, "$dim", { name: "Time" });
    fr(h, { name: "Spacer", width: "fill_container", height: 1 });
    const pb = fr(h, { name: "Pin button", width: w < 300 ? 16 : 20, height: 20, alignItems: "center", justifyContent: "center" });
    ic(pb, "pin", 13, it.pin ? "$accent" : "$dim", "Pin icon");
    ic(h, "chevron-up", 13, "$dim", "Fold");
    const y = fr(k, { name: "You", width: "fill_container", layout: "vertical", padding: [8, 10], gap: 4, cornerRadius: 6, fill: "$bg" });
    tx(y, "YOU", 10.5, "$muted", { name: "You label" });
    tx(y, it.you, 13, "$fg", { name: "Prompt", w: "fill_container" });
    tx(k, "FINAL REPLY", 10.5, "$muted", { name: "Reply label" });
  }
  for (const a of it.body) {
    if (a.startsWith("# ")) tx(k, a.slice(2), 15, "$fg", { name: "Heading", fontWeight: "500" });
    else tx(k, a, 12.5, "$fg", { name: "Paragraph", w: "fill_container", lineHeight: 1.5 });
  }
};
const footer = (p, w, s) => {
  const lab = s.sel_pinned ? "unpin" : "pin";
  const rows = w < 300
    ? [[["↑↓", "move"], ["↵", "open"], ["c", "copy"]], [["/", "filter"], ["p", lab]]]
    : [[["↑↓", "move"], ["↵", "open"], ["c", "copy reply"], ["q", "quote"], ["/", "filter"], ["p", lab], ["s", "select"]], [["i", "explain"], ["g", "jump"], ["End", "latest"], ["t", "terminal"], ["[ ]", "day"]]];
  const f = fr(p, { name: "Footer", width: "fill_container", layout: "vertical", padding: [8, 10], gap: 8, fill: "$chrome", stroke: "$border", strokeWidth: { top: 1 } });
  for (const r of rows) {
    const l = fr(f, { name: "Hints", gap: 11, alignItems: "center" });
    for (const [k, t] of r) { const h = fr(l, { name: "Hint " + t, gap: 4, alignItems: "center" }); key(h, k); tx(h, t, 11.5, "$dim", { name: "Hint label" }); }
  }
};
const toast = (root, w, y, text, big) => {
  const f = fr(root, { name: "Toast", layoutPosition: "absolute", x: w < 300 ? 6 : Math.round(w / 2 - (text.length * 3 + 16)), y, height: big ? 44 : 28, padding: [0, 10], gap: 6, alignItems: "center", cornerRadius: 6, fill: "$popover", stroke: "$border", strokeWidth: 1, effect: { type: "shadow", offset: { x: 0, y: 2 }, blur: 8, color: "#00000040" } });
  ic(f, "pin", 12, "$muted", "Toast mark");
  tx(f, text, 12, "$fg", { name: "Toast text", ...(big ? { w: 210 } : {}) });
};

const doc = { version: "2.22", themes: { mode: ["dark", "light"] }, variables, children: [] };
const panel = (x, y, w, h, mode, name, s) => {
  const root = { type: "frame", id: name, name, x, y, width: w, height: h, layout: "vertical", fill: "$bg", clip: true, theme: { mode }, stroke: "$border", strokeWidth: 1 };
  header(root, w, s);
  if (s.place === "top") tray(root, w, s);
  const l = fr(root, { name: "List", width: "fill_container", height: "fill_container", layout: "vertical", clip: true, gap: 2, padding: [s.listTop == null ? 6 : s.listTop, 0, 0, 0] });
  for (const it of s.list) {
    if (it.kind === "band") band(l, it);
    if (it.kind === "row") row(l, w, it);
    if (it.kind === "card") card(l, w, it);
    if (it.kind === "hidden") { const n = fr(l, { name: "Hidden turns", width: "fill_container", height: 26, padding: [0, 16], gap: 6, alignItems: "center" }); ic(n, "chevrons-up-down", 12, "$dim", "Hidden mark"); tx(n, it.text, 12, "$dim", { name: "Hidden text" }); }
    if (it.kind === "note") { const n = fr(l, { name: "Pin note", width: "fill_container", height: 22, padding: [0, 16], gap: 6, alignItems: "center" }); ic(n, "pin", 11, "$accent", "Note mark"); tx(n, it.text, 11.5, "$muted", { name: "Note text" }); }
  }
  if (s.place !== "top") tray(root, w, s);
  footer(root, w, s);
  if (s.toast) {
    const big = w < 300 && s.toast.length > 38;
    const th = s.pins && s.pins.length && s.place !== "top" ? (s.fold ? 34 : s.pins.length * 26 + 9) : 0;
    toast(root, w, h - 62 - th - (big ? 50 : 34), s.toast, big);
  }
  doc.children.push(root);
};

const R5 = { kind: "row", n: 5, when: "5:37 AM", stats: "2.2k · 1m 06s", prompt: "Remove it from all three", reply: "Removed the script tag from all three pages. Nothing else imports it, so the file can go too." };
const R6 = { kind: "row", n: 6, when: "5:47 AM", stats: "2.2k · 1m 15s", prompt: "Run the checkout e2e tests", reply: "17 of 18 checkout tests pass in Chromium and WebKit. The one failure is order total matches cart." };
const C7 = (pin) => ({ kind: "card", n: 7, when: "Yesterday 5:54 AM · 2m 31s", pin, you: "Fix that one-cent checkout bug, it's ACME-123", body: ["Found it. Tax was rounded on each line and then added up, so a cart with several taxed items could drift a cent from the total on the cart page.", "# What changed", "Totals now stay in whole cents until the end, and the cart and the receipt share one helper."] });
const R10 = (pin, hl) => ({ kind: "row", n: 10, pin, when: "6:09 AM", stats: "2.2k · 52s", prompt: hl ? ["Make the ", "*checkout", " button full width on phones"] : "Make the checkout button full width on phones", reply: hl ? undefined : "Added a phone rule to checkout.module.css. The button keeps its width on tablets and up." });
const R11 = (pin) => ({ kind: "row", n: 11, pin, when: "6:13 AM", stats: "2.2k · 1m 04s", prompt: "Why is search slow on the orders page?", reply: "Every keystroke runs a full table scan, because the status filter wraps the column in a function." });
const C12 = (pin) => ({ kind: "card", n: 12, when: "4:10 PM · 1m 00s", pin, you: "Add a test for the refund rounding", body: ["Added a refund case: three items at $3.33 refund to $10.79. It fails on the old code and passes on the new helper."] });
const Y = { kind: "band", label: "Yesterday", date: "Thu 5 Nov", count: "6 turns" }, TD = { kind: "band", label: "Today", date: "Fri 6 Nov", count: "3 turns" };
const p = (k, n, t, when, st, cur) => ({ k: String(k), n, t, when, st, cur });
const T7 = "Fix that one-cent checkout bug, it's ACME-123", T3 = "Add a loading skeleton to the product grid", T10 = "Make the checkout button full width on phones", T5 = "Remove it from all three", T9 = "Does the receipt email still show the right total?", T11 = "Why is search slow on the orders page?", T12 = "Add a test for the refund rounding";

const STATES = [
  ["01-no-pins", { pins: [], sel_pinned: false, list: [Y, R5, R6, C7(false)] }],
  ["02-one-pin", { pins: [p(1, 7, T7, "Yesterday", 0, true)], sel_pinned: true, toast: "Pinned #7 · press 1 to come back", list: [Y, R5, R6, C7(true)] }],
  ["03-several-pins", { pins: [p(1, 7, T7, "Yesterday"), p(2, 3, T3, "4 Nov"), p(3, 10, T10, "6:09 AM")], sel_pinned: false, list: [TD, R10(true), C12(false)] }],
  ["04-at-limit", { pins: [p(1, 7, T7, "Yesterday"), p(2, 3, T3, "4 Nov"), p(3, 10, T10, "6:09 AM"), p(4, 5, T5, "Yesterday"), p(5, 9, T9, "Yesterday")], sel_pinned: false, toast: "Pins are full (5). Unpin one first.", list: [TD, R10(true), C12(false)] }],
  ["05-new-reply", { pins: [p(1, 7, T7, "Yesterday", 0, true), p(2, 11, T11, "6:13 AM", "new")], sel_pinned: true, list: [Y, R6, C7(true), TD, R11(true)] }],
  ["06-running", { pins: [p(1, 7, T7, "Yesterday", 0, true), p(2, 12, T12, "4:10 PM", "live")], sel_pinned: true, list: [Y, R6, C7(true), TD, { kind: "row", n: 12, pin: true, when: "4:10 PM", icon: "loader-circle", iconFill: "$working", prompt: T12 }] }],
  ["07-during-search", { search: "checkout", count: "4 of 12", pins: [p(1, 7, T7, "Yesterday"), p(2, 3, T3, "4 Nov", 0, true)], sel_pinned: true, list: [{ kind: "row", n: 7, pin: true, when: "5:54 AM", stats: "2.2k · 2m 31s", prompt: ["Fix that one-cent ", "*checkout", " bug, it's ACME-123"] }, { kind: "hidden", text: "3 turns hidden" }, { kind: "note", text: "Pinned, not in this search" }, { kind: "card", n: 3, when: "4 Nov 9:26 AM · 48s", pin: true, you: T3, body: ["Added a skeleton that matches the card height, so the grid no longer jumps when the images load."] }, { kind: "hidden", text: "2 turns hidden" }, R10(false, true)] }],
  ["08-turn-gone", { pins: [p(1, 7, T7, "Yesterday", 0, true), p(2, 5, T5, "", "gone")], sel_pinned: true, toast: "#5 is no longer in this session. Unpin to clear it.", list: [Y, R6, C7(true)] }],
];

const X = [0, 560, 860, 1420];
let y = 0;
const four = (nm, s, hh) => {
  for (const [i, m, w, n] of [[0, "dark", 500, "wide"], [1, "dark", 260, "narrow"], [2, "light", 500, "wide"], [3, "light", 260, "narrow"]]) panel(X[i], y, w, hh, m, `${m}-${n}-${nm}`, s);
  y += hh + 80;
};
for (const [nm, s] of STATES) four(nm, { ...s, place: "bottom" }, 640);

const MID = ["The cart page and the receipt disagree because they do not share a helper, and order history loads the old script in its own head tag.", "That tag is safe to remove, since nothing on the page reads the globals the script sets. The help pages are harder.", "# Help pages", "The help pages load it through a template, and the template is generated, so the change belongs in the generator and not in the page.", "The generator lives in tools/help, and its output is not checked in.", "# What I would do next", "Remove the tag from the shared layout first, since that one change covers checkout and the order confirmation page at once.", "Then remove the tag from order history, and change the help generator last, because its output only appears after the next docs build.", "Once all three are gone, nothing imports the file and it can be deleted."];
const CM = { kind: "card", n: 4, mid: true, body: MID };
const T4 = "Which pages still load the old analytics script?";
const STORY = [
  ["story-1-reading", { pins: [], sel_pinned: false, listTop: 0, list: [CM] }],
  ["story-2-pinned", { pins: [p(1, 4, T4, "Yesterday", 0, true)], sel_pinned: true, listTop: 0, toast: "Pinned #4 · press 1 to come back", list: [CM] }],
  ["story-3-newer-reply", { pins: [p(1, 4, T4, "Yesterday")], sel_pinned: false, list: [TD, R10(false), { kind: "card", n: 11, when: "6:13 AM · 1m 04s", pin: false, you: T11, body: ["Every keystroke runs a full table scan, because the status filter wraps the column in a function and the index cannot help.", "Moving the filter into a generated column brings it from 900 ms to 12 ms on the test data."] }] }],
  ["story-4-back", { pins: [p(1, 4, T4, "Yesterday", 0, true)], sel_pinned: true, listTop: 0, list: [CM] }],
];
STORY.forEach(([nm, s], i) => panel(i * 540, y, 500, 600, "dark", nm, { ...s, place: "bottom" }));
y += 680;

const SEVERAL = { pins: [p(1, 7, T7, "Yesterday"), p(2, 3, T3, "4 Nov"), p(3, 10, T10, "6:09 AM")], sel_pinned: false, list: [TD, R10(true), C12(false)] };
four("layout-b-top", { ...SEVERAL, place: "top" }, 640);
four("short-folded", { ...SEVERAL, place: "bottom", fold: true }, 320);

writeFileSync(OUT, JSON.stringify(doc, null, 1) + "\n");
console.log(`${OUT}: ${doc.children.length} frames, ${seq} nodes`);
