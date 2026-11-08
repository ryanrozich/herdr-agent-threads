// Writes agent-threads-chat-look.pen as plain Pen JSON. Run: bun designs/chat-look/gen-pen.mjs
// A design proposal: Agent Threads drawn as a chat, with pins and quote tracking. Nothing here
// is built. Colours are the running panel's (read through its debug report, as for pinning).
// All content is made up, and matches designs/chat-look/make-session.mjs.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), "agent-threads-chat-look.pen");
const c = (d, l) => ({ type: "color", value: [{ value: d, theme: { mode: "dark" } }, { value: l, theme: { mode: "light" } }] });
const variables = {
  bg: c("#17191d", "#ffffff"), fg: c("#eeeeef", "#1b1b1e"), muted: c("#a6a7a9", "#5f5f63"), dim: c("#7c7d80", "#85858a"),
  accent: c("#96b2d7", "#1f62d0"), raised: c("#2c2e31", "#f6f6f6"), selected: c("#ffffff0d", "#0000000a"),
  border: c("#ffffff18", "#00000017"), chrome: c("#101114", "#f1f1ee"), popover: c("#25272b", "#ffffff"),
  bubble: c("#2a2c30", "#efefec"), code: c("#101114", "#f6f6f4"), band: c("#2c2e31", "#efefef"),
  working: c("#e5c07b", "#9a6700"), done: c("#76a8ff", "#2f6fe4"), quoted: c("#96b2d71c", "#1f62d012"),
  flash: c("#e5c07b33", "#e5c07b55"), hit: c("#e5c07b40", "#e5c07b66"),
  ui: { type: "string", value: "Inter" }, mono: { type: "string", value: "JetBrains Mono" },
};

let seq = 0;
const add = (p, n) => { (p.children = p.children || []).push({ id: `n${++seq}`, ...n }); return p.children[p.children.length - 1]; };
const fr = (p, o) => add(p, { type: "frame", name: o.name || "Box", ...o });
const tx = (p, t, sz, fill, o = {}) => {
  const { mono, w, ...r } = o;
  return add(p, { type: "text", name: r.name || String(t).slice(0, 28), content: String(t), fontFamily: mono ? "$mono" : "$ui", fontSize: sz, fill,
    ...(w ? { textGrowth: "fixed-width", width: w } : {}), ...r });
};
const ic = (p, icon, sz, fill, name) => add(p, { type: "icon", name: name || icon, library: "lucide", icon, width: sz, height: sz, fill });
const sp = (p) => fr(p, { name: "Spacer", width: "fill_container", height: 1 });
// Text cut to n lines of a box w px wide at size sz (Inter averages about half its size per character).
const clip = (s, w, sz, n) => {
  const per = Math.floor(w / (sz * 0.48));
  const paras = [];
  let used = 0;
  let cut = false;
  for (const para of s.split("\n")) {
    if (used >= n) { cut = true; break; }
    const need = Math.max(1, Math.ceil(para.length / per));
    if (used + need <= n) { paras.push(para); used += need; continue; }
    const room = (n - used) * per - 2;
    paras.push(`${para.slice(0, para.lastIndexOf(" ", room) > 0 ? para.lastIndexOf(" ", room) : room).replace(/[\s,.;:]+$/, "")}…`);
    used = n;
    cut = true;
    break;
  }
  return { text: cut ? paras.join("\n").replace(/\n+…$/, "…") : s, cut, lines: used };
};
const key = (p, t) => { const k = fr(p, { name: "Key", height: 18, padding: [0, 5], alignItems: "center", justifyContent: "center", cornerRadius: 4, fill: "$raised", stroke: "$border", strokeWidth: 1 }); tx(k, t, 10.5, "$dim", { name: "Key label" }); return k; };

// ---- the session (made up, as in make-session.mjs) ----
const S = {
  1: { when: "Thu 9:05 AM", prompt: "Make the header sticky on mobile", reply: ["The header now sticks to the top below 640 px, with a shadow once you scroll. Desktop is unchanged, and the header tests still pass."], meta: "30s · 1.4k tokens · opus 5.5 · 2 tool calls" },
  2: { when: "Thu 9:20 AM", prompt: "The orders table is cut off on mobile [Image #1]. Can you make it scroll sideways?", img: [["Image #1", 120, 76]], reply: ["Below 640 px the table now sits in a scroll container and the order number column stays pinned, so you can swipe across the rest. Desktop keeps the full table."], meta: "52s · 7.7k tokens · opus 5.5 · 3 tool calls" },
  3: { when: "Fri 9:26 AM", prompt: "Add a loading skeleton to the product grid", reply: ["Added `ProductGridSkeleton`: eight placeholder cards that match the real card height, so the page doesn't jump when products load. It shows only on the first page."], meta: "48s · 2.1k tokens · opus 5.5 · 4 tool calls" },
  4: { when: "Fri 9:41 AM", agent: "general-purpose", prompt: "Accessibility pass on the product pages is done. Three images have no alt text: the product card photo, the hero banner and the brand strip logos.", reply: ["Added alt text to all three: the product name on card photos, the campaign title on the hero banner, and each brand's name on its logo."], meta: "23s · 5.4k tokens · opus 5.5 · 2 tool calls" },
  6: { when: "Sat 8:40 AM", prompt: "Run the checkout e2e tests", reply: ["17 of 18 checkout tests pass in Chromium and WebKit. The one failure is `order total matches cart`: a three-item cart with tax comes out one cent higher than the cart page shows."], meta: "1m 37s · 3.3k tokens · opus 5.5 · 1 tool call" },
  7: { when: "Sat 8:43 AM", prompt: "Fix that one-cent checkout bug, it's ACME-123", reply: ["Found it. Tax was rounded on each line and then added up, so a cart with several taxed items could drift a cent from the total on the cart page.", "- Totals now stay in whole cents until the end", "- Tax is rounded once, on the subtotal", "All 18 checkout tests pass now. The fix is up for review in #42."], meta: "2m 31s · 4.0k tokens · opus 5.5 · 6 tool calls", answered: null },
  8: { when: "Sat 8:58 AM", prompt: "Refunds need the same rounding fix. Support saw these this week:\n\n- A customer returned two of three items and got one cent less than they paid for them\n- A refund on a discounted order showed $10.79 in the email and $10.80 in the admin\n- Store credit for a returned gift card came out one cent high\n\nCan you make refunds use the same helper as the cart, add tests for partial refunds, and tell me if anything else still rounds on its own? I would rather know now than find it in next month's reconciliation.",
    reply: [{ t: "Partial refunds now reuse the cart helper, so a refund is the order's own rounded line amounts and never a fresh calculation. The two-of-three case from support now refunds exactly what was charged.", q: 9 }, "## What changed", "- `refundCents()` takes the charged line amounts from the order instead of recomputing them", "- Discounts are spread over lines once, at checkout, and refunds read that split", "- Nine new cases in `amounts.test.ts`, including the $10.79 order", "```const refund = order.lines.filter(isReturned).reduce((sum, l) => sum + l.chargedCents, 0);", "## Still rounding on its own", { t: "Store credit still rounds per line when a gift card is returned. That is why the credit came out one cent high, and fixing it changes balances customers already hold.", q: 10 }, "The admin's order export also formats amounts with its own rounding. It only affects the CSV, not what anyone is charged."],
    meta: "3m 32s · 4.7k tokens · opus 5.5 · 4 tool calls", cache: "cache read 96,000 · written 4,100 · new input 6" },
  9: { when: "Sat 9:02 AM", quote: { from: 8, t: "Partial refunds now reuse the cart helper, so a refund is the order's own rounded line amounts and never a fresh calculation." }, prompt: "Good. Does that also hold for orders placed before the fix?", reply: ["Yes. Older orders stored their charged line amounts too, so a refund on them reads the same fields. I checked the oldest order in the test data, from 2024."], meta: "41s · 1.4k tokens · opus 5.5" },
  10: { when: "Sat 9:07 AM", quote: { from: 8, t: "Store credit still rounds per line when a gift card is returned." }, prompt: "Leave store credit alone until finance signs off, but add a test that pins today's behaviour so we notice if it changes.", reply: ["Added `credit.test.ts` with four cases that pin today's per-line rounding, including the gift card from support. Nothing else changed. When finance signs off, those four tests are the ones to update."], meta: "3m 08s · 2.9k tokens · opus 5.5 · 14 tool calls", tools: "Read 5 · Edit 2 · Grep 4 · Bash 3" },
  11: { when: "Sat 9:15 AM", prompt: "Now check the order export for the same problem", running: "Working · 1m 04s · 3 tool calls so far" },
};
const T = (n) => S[n].prompt.split("\n")[0];

// ---- pieces ----
const header = (p, w, s) => {
  const nar = w < 320;
  const h = fr(p, { name: "Header", width: "fill_container", height: 40, padding: [0, 10], gap: 8, alignItems: "center", fill: "$chrome", stroke: "$border", strokeWidth: { bottom: s.search || s.tabs ? 0 : 1 } });
  const b = fr(h, { name: "Agent badge", height: 22, padding: [0, nar ? 4 : 6], gap: 4, alignItems: "center", cornerRadius: 5, stroke: "$border", strokeWidth: 1 });
  const o = fr(b, { name: "Agent mark", width: 14, height: 14, cornerRadius: 3, fill: "#d97757", alignItems: "center", justifyContent: "center" });
  ic(o, "asterisk", 11, "#ffffff", "Agent glyph");
  if (!nar) tx(b, "Claude", 12.5, "$fg", { name: "Agent name" });
  if (s.paneTitle) { ic(h, "pin", 13, "$accent", "Pinned mark"); tx(h, s.paneTitle, 12.5, "$fg", { name: "Title", fontWeight: "600" }); }
  else tx(h, nar ? "10 turns" : "10 turns · checkout fixes", 12.5, "$muted", { name: "Title" });
  sp(h);
  // The same buttons as today: search, agent messages (with how many are hidden), pins,
  // newest, settings. Option B adds one that opens the Pinned pane beside.
  const btns = [["search", Boolean(s.search)], ["bot", false, s.agentsShown ? null : "1"], ...(s.paneTitle ? [] : [["pin", s.tabs === "pinned"]]), ...(s.splitBtn ? [["panel-right", false]] : []), ["chevrons-down", false], ["sliders-horizontal", false]];
  for (const [i, on, badge] of btns) {
    const q = fr(h, { name: "Button " + i, width: 24, height: 24, alignItems: "center", justifyContent: "center", cornerRadius: 4, ...(on ? { fill: "$selected" } : {}) });
    ic(q, i, 14, on ? "$fg" : "$dim", i + " icon");
    if (badge) { const d = fr(q, { name: "Badge", layoutPosition: "absolute", x: 14, y: -3, width: 12, height: 12, cornerRadius: 6, fill: "$raised", stroke: "$border", strokeWidth: 1, alignItems: "center", justifyContent: "center" }); tx(d, badge, 8, "$muted", { name: "Badge count" }); }
  }
  if (s.tabs) {
    const f = fr(p, { name: "View switch", width: "fill_container", padding: [0, 10, 8, 10], fill: "$chrome", stroke: "$border", strokeWidth: { bottom: s.search ? 0 : 1 } });
    const g = fr(f, { name: "Segments", width: "fill_container", height: 28, padding: 2, gap: 2, cornerRadius: 7, fill: "$bg", stroke: "$border", strokeWidth: 1 });
    for (const [lab, n, on] of [["All", "10", s.tabs === "all"], ["Pinned", String(s.pinCount ?? 3), s.tabs === "pinned"]]) {
      const seg = fr(g, { name: "Segment " + lab, width: "fill_container", height: "fill_container", gap: 6, alignItems: "center", justifyContent: "center", cornerRadius: 5, ...(on ? { fill: "$raised", stroke: "$border", strokeWidth: 1 } : {}) });
      if (lab === "Pinned") ic(seg, "pin", 11, on ? "$accent" : "$dim", "Pinned mark");
      tx(seg, lab, 12, on ? "$fg" : "$muted", { name: "Segment label", fontWeight: on ? "600" : "400" });
      tx(seg, n, 11, "$dim", { mono: true, name: "Segment count" });
      if (lab === "Pinned" && s.pinNew) add(seg, { type: "ellipse", name: "New dot", width: 6, height: 6, fill: "$accent" });
    }
  }
  if (s.search) {
    const f = fr(p, { name: "Search", width: "fill_container", padding: [0, 10, 8, 10], fill: "$chrome", stroke: "$border", strokeWidth: { bottom: 1 } });
    const g = fr(f, { name: "Search field", width: "fill_container", height: 30, padding: [0, 10], gap: 6, alignItems: "center", cornerRadius: 6, fill: "$bg", stroke: "$accent", strokeWidth: 1 });
    ic(g, "search", 12, "$dim", "Search icon");
    tx(g, s.search, 12.5, "$fg", { name: "Search text" });
    sp(g);
    tx(g, s.count, 11.5, "$dim", { mono: true, name: "Match count" });
    ic(g, "x", 12, "$dim", "Clear");
  }
};

const divider = (p, label) => {
  const d = fr(p, { name: "Day " + label, width: "fill_container", height: 28, padding: [0, 14], gap: 10, alignItems: "center" });
  fr(d, { name: "Rule", width: "fill_container", height: 1, fill: "$border" });
  tx(d, label, 11, "$dim", { name: "Day label", fontWeight: "600" });
  fr(d, { name: "Rule", width: "fill_container", height: 1, fill: "$border" });
};
const pillNote = (p, icon, text) => {
  const d = fr(p, { name: "Note " + text, width: "fill_container", height: 26, justifyContent: "center", alignItems: "center" });
  const q = fr(d, { name: "Pill", height: 22, padding: [0, 10], gap: 6, alignItems: "center", cornerRadius: 11, stroke: "$border", strokeWidth: 1 });
  ic(q, icon, 11, "$dim", "Note icon");
  tx(q, text, 11.5, "$dim", { name: "Note text" });
};

// Inline Markdown-ish text: `code` and *search hits* drawn as runs on one wrapped line are not
// possible in Pen, so code spans are kept as plain text and a hit gets its own frame when short.
const plain = (s) => s.replace(/`/g, "");

// Draws the reply's blocks. With a budget (lines), stops once that many lines are drawn,
// cutting the last block at a line, and returns whether anything was left out.
const replyBlocks = (p, w, it, o, budget = Infinity) => {
  const inner = w - 28;
  let left = budget;
  const fit = (t, wd) => { const c = clip(t, wd, 13, left); left -= c.lines; return c; };
  for (const raw of it.reply) {
    if (left <= 0) return true;
    const b = typeof raw === "string" ? { t: raw } : raw;
    let t = b.t;
    if (t.startsWith("## ")) { left -= 1; tx(p, t.slice(3), 14, "$fg", { name: "Heading", fontWeight: "600" }); continue; }
    if (t.startsWith("```") && left < 3) return true;
    if (t.startsWith("```")) { left -= 3;
      const k = fr(p, { name: "Code block", width: "fill_container", layout: "vertical", padding: [8, 10], gap: 4, cornerRadius: 6, fill: "$code", stroke: "$border", strokeWidth: 1 });
      const hd = fr(k, { name: "Code head", width: "fill_container", alignItems: "center" });
      tx(hd, "ts", 10.5, "$dim", { mono: true, name: "Lang" }); sp(hd); ic(hd, "copy", 11, "$dim", "Copy code");
      tx(k, t.slice(3), 11, "$fg", { mono: true, name: "Code", w: "fill_container", lineHeight: 1.45 });
      continue;
    }
    if (t.startsWith("- ")) {
      const c = fit(plain(t.slice(2)), inner - 20);
      const r = fr(p, { name: "List item", width: "fill_container", gap: 8, padding: [0, 0, 0, 4] });
      tx(r, "•", 13, "$muted", { name: "Bullet" });
      tx(r, c.text, 13, "$fg", { name: "Item text", w: "fill_container", lineHeight: 1.5 });
      if (c.cut) return true;
      continue;
    }
    const cp = fit(plain(t), inner - (b.q && o.marks ? 20 : 0));
    t = cp.text;
    const marked = b.q && o.marks;
    const host = marked ? fr(p, { name: `Quoted part, in #${b.q}`, width: "fill_container", layout: "vertical", gap: 4, padding: [6, 8, 6, 10], cornerRadius: [0, 6, 6, 0], fill: o.flash === b.q ? "$flash" : "$quoted", stroke: "$accent", strokeWidth: { left: 2 } }) : p;
    tx(host, t, 13, "$fg", { name: "Paragraph", w: "fill_container", lineHeight: 1.5 });
    if (cp.cut) return true;
    if (marked) {
      const l = fr(host, { name: "Quote link", gap: 4, alignItems: "center" });
      ic(l, "corner-down-right", 11, "$accent", "Link mark");
      tx(l, w < 320 ? `#${b.q}` : `You replied in #${b.q}`, 11.5, "$accent", { name: "Link text" });
    }
  }
  return false;
};

// One exchange: the meta line, your message as a bubble, the reply as plain text, its meta line
// with the actions, and notes. it: a turn from S plus { n, open, sel, pinned, hit }.
const exchange = (p, w, n, o = {}) => {
  const it = S[n];
  const nar = w < 320;
  const ex = fr(p, { name: `Exchange #${n}`, width: "fill_container", layout: "vertical", gap: 6, padding: [8, 12, 10, 12], ...(o.sel ? { fill: "$selected", stroke: "$accent", strokeWidth: { left: 2 } } : {}), ...(o.dim ? { opacity: 0.45 } : {}) });
  const agent = Boolean(it.agent);
  if (o.from != null) {
    // Opened at a pin's place: the turn's top is above, one line says so.
    const up = fr(ex, { name: "Turn top above", width: "fill_container", gap: 5, alignItems: "center" });
    ic(up, "arrow-up", 11, "$dim", "Up mark");
    if (o.pinned) ic(up, "pin", 11, "$accent", "Pinned mark");
    tx(up, `#${n} · ${it.when} · ${nar ? "top above" : "your message and the start of the reply are above"}`, 11.5, "$dim", { name: "Above text" });
  } else {
  // Meta over the message
  const mt = fr(ex, { name: "Message meta", width: "fill_container", gap: 5, alignItems: "center", justifyContent: agent ? "start" : "end" });
  if (agent) { ic(mt, "bot", 12, "$muted", "Agent mark"); tx(mt, `From ${it.agent}`, 11.5, "$muted", { name: "Sender" }); tx(mt, "·", 11.5, "$dim"); }
  if (o.pinned) ic(mt, "pin", 11, "$accent", "Pinned mark");
  tx(mt, `#${n} · ${it.when}`, 11.5, "$dim", { name: "Number and time" });
  // Your message
  const maxW = Math.round((w - 24) * (nar ? 0.9 : 0.82));
  const lines = o.promptOpen ? 40 : 4;
  const est = Math.min(maxW, Math.max(80, it.prompt.split("\n").reduce((m, l) => Math.max(m, l.length), 0) * 6.7 + 28, it.img ? 150 : 0, it.quote ? maxW : 0));
  const row = fr(ex, { name: "Message row", width: "fill_container", justifyContent: agent ? "start" : "end" });
  const bub = fr(row, { name: agent ? "Agent message" : "Your message", width: est, layout: "vertical", gap: 8, padding: [8, 12], cornerRadius: agent ? [4, 14, 14, 14] : [14, 14, 4, 14], fill: agent ? "$bg" : "$bubble", ...(agent ? { stroke: "$border", strokeWidth: 1 } : {}), ...(o.flashPrompt ? { stroke: "$working", strokeWidth: 1.5 } : {}) });
  if (it.img) {
    const g = fr(bub, { name: "Images", gap: 6 });
    for (const [lab, iw, ih] of it.img) {
      const im = fr(g, { name: lab, width: iw, height: ih, cornerRadius: 6, fill: "$raised", stroke: "$border", strokeWidth: 1, layout: "vertical", padding: 6, gap: 4 });
      for (const k of [0.9, 0.6, 0.75]) fr(im, { name: "Mock line", width: Math.round(iw * k) - 12, height: 6, cornerRadius: 2, fill: "$border" });
    }
  }
  if (it.quote) {
    const q = fr(bub, { name: "Quote", width: "fill_container", layout: "vertical", gap: 3, padding: [2, 0, 2, 9], stroke: o.backFlash ? "$working" : "$accent", strokeWidth: { left: 2 } });
    const qh = fr(q, { name: "Quote source", gap: 4, alignItems: "center" });
    ic(qh, "arrow-up-left", 11, "$accent", "Source mark");
    tx(qh, `From #${it.quote.from}`, 11.5, "$accent", { name: "Source link" });
    tx(q, it.quote.t, 12.5, "$muted", { name: "Quoted text", w: "fill_container", lineHeight: 1.45 });
  }
  let promptText = it.prompt;
  const hp = nar ? null : o.hitPrompt;
  if (hp) {
    const l = fr(bub, { name: "Line with match", gap: 0, alignItems: "center" });
    tx(l, hp[0], 13, "$fg"); const hf = fr(l, { name: "Match", fill: "$hit", cornerRadius: 2 }); tx(hf, hp[1], 13, "$fg"); tx(l, hp[2], 13, "$fg");
    promptText = it.prompt.slice(hp.join("").length).replace(/^\s+/, "");
  }
  const cp = clip(promptText, est - 24, 13, hp ? lines - 1 : lines);
  tx(bub, cp.text, 13, "$fg", { name: "Prompt", w: "fill_container", lineHeight: 1.45 });
  if (cp.cut) { const m = fr(bub, { name: "Show more", gap: 4, alignItems: "center" }); tx(m, "Show more", 12, "$accent", { name: "More label" }); ic(m, "chevron-down", 12, "$accent", "More icon"); }
  }
  // The reply
  if (it.running) {
    const r = fr(ex, { name: "Working", width: "fill_container", gap: 6, alignItems: "center", padding: [2, 0] });
    ic(r, "loader-circle", 13, "$working", "Spinner");
    tx(r, it.running, 12.5, "$working", { name: "Working text" });
  } else {
    const body = fr(ex, { name: "Reply", width: "fill_container", layout: "vertical", gap: 8, padding: [2, 0, 0, 0] });
    const hit = nar ? o.hitN : o.hit;
    if (hit) {
      const [a, h, z] = hit;
      const l = fr(body, { name: "Line with match", gap: 0, alignItems: "center" });
      tx(l, a, 13, "$fg"); const hf = fr(l, { name: "Match", fill: "$hit", cornerRadius: 2 }); tx(hf, h, 13, "$fg"); tx(l, z, 13, "$fg");
    }
    const shown = o.from != null ? { ...it, reply: it.reply.slice(o.from) } : hit ? { ...it, reply: [{ ...it.reply[0], t: it.reply[0].t.slice(hit.join("").length).replace(/^\s+/, "") }, ...it.reply.slice(1)] } : it;
    const cut = replyBlocks(body, w, shown, o, o.open ? Infinity : hit ? 5 : 6);
    if (cut) { const m = fr(body, { name: "Show more", gap: 4, alignItems: "center" }); tx(m, "Show more", 12, "$accent", { name: "More label" }); ic(m, "chevron-down", 12, "$accent", "More icon"); }
    if (o.open && it.reply.length > 2) { const m = fr(body, { name: "Show less", gap: 4, alignItems: "center" }); tx(m, "Show less", 12, "$accent", { name: "Less label" }); ic(m, "chevron-up", 12, "$accent", "Less icon"); }
    // Meta and actions under the reply
    const m = fr(ex, { name: "Reply meta", width: "fill_container", gap: 8, alignItems: "center" });
    const metaText = nar ? it.meta.replace(" tokens", "").replace("opus 5.5 · ", "").replace(" tool calls", " tools").replace(" tool call", " tool") : it.meta;
    tx(m, metaText, 11.5, "$dim", { name: "Stats", mono: true });
    sp(m);
    if (o.sel || o.actions) for (const [i, on] of [["copy", false], ["quote", false], [o.pinned ? "pin-off" : "pin", false], ["ellipsis", false]]) {
      const b = fr(m, { name: "Action " + i, width: 22, height: 22, alignItems: "center", justifyContent: "center", cornerRadius: 4, ...(on ? { fill: "$selected" } : {}) });
      ic(b, i, 13, "$dim", i + " icon");
    }
    if (o.open && it.tools) tx(ex, it.tools, 11, "$dim", { name: "Tools", mono: true });
    if (o.open && it.cache && !nar) tx(ex, it.cache, 11, "$dim", { name: "Cache", mono: true });
    if (o.note) {
      const l = fr(ex, { name: "Reply note", gap: 5, alignItems: "center" });
      ic(l, "corner-down-right", 11, "$accent", "Note mark");
      tx(l, o.note, 11.5, "$accent", { name: "Note text" });
    }
  }
  return ex;
};

const FOOT = {
  wide: [[["↑↓", "move"], ["↵", "expand"], ["c", "copy"], ["q", "quote"], ["p", "pin"], ["/", "search"]], [["v", "pinned"], ["l", "follow quote"], ["i", "details"], ["End", "latest"], ["t", "terminal"]]],
  narrow: [[["↑↓", "move"], ["↵", "expand"], ["p", "pin"]], [["v", "pinned"], ["/", "search"]]],
  pinnedWide: [[["↑↓", "next pin"], ["↵", "open"], ["1-5", "go to pin"], ["p", "unpin"], ["u", "undo"]], [["v", "all turns"], ["q", "quote"], ["l", "follow quote"], ["t", "terminal"]]],
  pinnedNarrow: [[["↑↓", "next pin"], ["↵", "open"], ["p", "unpin"]], [["v", "all turns"], ["u", "undo"]]],
  paneWide: [[["↑↓", "next pin"], ["↵", "open"], ["1-5", "go to pin"], ["p", "unpin"], ["u", "undo"]], [["q", "quote"], ["l", "follow quote"], ["t", "terminal"]]],
};
const footer = (p, w, kind = "") => {
  const f = fr(p, { name: "Footer", width: "fill_container", layout: "vertical", padding: [8, 10], gap: 8, fill: "$chrome", stroke: "$border", strokeWidth: { top: 1 } });
  for (const r of FOOT[kind ? kind + (w < 320 ? "Narrow" : "Wide") : w < 320 ? "narrow" : "wide"] ?? FOOT.paneWide) {
    const l = fr(f, { name: "Hints", gap: 11, alignItems: "center" });
    for (const [k, t] of r) { const h = fr(l, { name: "Hint " + t, gap: 4, alignItems: "center" }); key(h, k); tx(h, t, 11.5, "$dim", { name: "Hint label" }); }
  }
};
const toast = (root, w, h, text, up = null) => {
  const tw = Math.min(w - 24, text.length * 6.4 + 44);
  const f = fr(root, { name: "Toast", layoutPosition: "absolute", x: Math.round((w - tw) / 2), y: h - (up ?? (w < 320 ? 120 : 112)), width: tw, padding: [7, 10], gap: 6, alignItems: "center", cornerRadius: 7, fill: "$popover", stroke: "$border", strokeWidth: 1, effect: { type: "shadow", offset: { x: 0, y: 2 }, blur: 8, color: "#00000040" } });
  ic(f, "pin", 12, "$muted", "Toast mark");
  tx(f, text, 12, "$fg", { name: "Toast text", w: "fill_container" });
};

// The Pinned view: each pin as a compact card with its place and what changed.
const pinCard = (p, w, q) => {
  const nar = w < 320;
  const it = S[q.n];
  const k = fr(p, { name: `Pinned #${q.n}`, width: "fill_container", layout: "vertical", gap: 4, padding: [8, 12], ...(q.cur ? { fill: "$selected", stroke: "$accent", strokeWidth: { left: 2 } } : {}), ...(q.gone ? { opacity: 0.5 } : {}) });
  const h = fr(k, { name: "Pin head", width: "fill_container", gap: 6, alignItems: "center" });
  key(h, String(q.k));
  tx(h, `#${q.n}`, 11.5, "$dim", { mono: true, name: "Number" });
  if (q.st === "new") { add(h, { type: "ellipse", name: "New dot", width: 6, height: 6, fill: "$accent" }); tx(h, "New reply", 11.5, "$accent", { name: "State" }); }
  if (q.st === "live") { ic(h, "loader-circle", 12, "$working", "Spinner"); tx(h, "Working", 11.5, "$working", { name: "State" }); }
  if (q.st === "reading") tx(h, "Reading", 11.5, "$accent", { name: "State", fontWeight: "600" });
  if (q.gone) tx(h, "Gone", 11.5, "$dim", { name: "State" });
  sp(h);
  if (!nar) tx(h, it.when, 11.5, "$dim", { name: "Time" });
  ic(h, "pin-off", 12, "$dim", "Unpin");
  tx(k, clip(T(q.n), w - 24, 13, 2).text, 13, "$fg", { name: "Prompt", w: "fill_container", fontWeight: "500", lineHeight: 1.4 });
  if (q.place) { const l = fr(k, { name: "Place", gap: 5, alignItems: "center" }); ic(l, "bookmark", 11, "$muted", "Place mark"); tx(l, q.place, 11.5, "$muted", { name: "Place text" }); }
  if (q.cover) { const l = fr(k, { name: "Coverage", gap: 5, alignItems: "center" }); ic(l, "corner-down-right", 11, "$accent", "Coverage mark"); tx(l, q.cover, 11.5, "$accent", { name: "Coverage text" }); }
};

const doc = { version: "2.22", themes: { mode: ["dark", "light"] }, variables, children: [] };
// A pane: header, list, footer, an optional toast. s.list is a list of builders (fn(listFrame, w)).
const pane = (parent, w, h, s) => {
  header(parent, w, s);
  const l = fr(parent, { name: s.listName || "Conversation", width: "fill_container", height: "fill_container", layout: "vertical", clip: true, gap: 4, padding: [s.top ?? 4, 0, 0, 0], justifyContent: s.bottom ? "end" : "start" });
  for (const f of s.list) f(l, w);
  if (s.tray) s.tray(parent, w);
  footer(parent, w, s.foot ?? (s.tabs === "pinned" ? "pinned" : ""));
  if (s.toast) toast(parent, w, h, s.toast, s.tray ? (w < 320 ? 236 : 210) : null);
};
const frame = (x, y, w, h, mode, name, s) => {
  const root = { type: "frame", id: name, name, x, y, width: w, height: h, layout: "vertical", fill: "$bg", clip: true, theme: { mode }, stroke: "$border", strokeWidth: 1 };
  pane(root, w, h, s);
  doc.children.push(root);
};
// Two panes side by side in one window frame: Threads on the left, Pinned on the right.
const frame2 = (x, y, ws, h, name, a, b, mode = "dark") => {
  const root = { type: "frame", id: name, name, x, y, width: ws[0] + ws[1] + 6, height: h, gap: 6, fill: "$chrome", clip: true, theme: { mode } };
  for (const [i, s] of [a, b].entries()) {
    const pn = add(root, { type: "frame", name: i ? "Pinned pane" : "Threads pane", width: ws[i], height: "fill_container", layout: "vertical", fill: "$bg", clip: true, stroke: s.focus ? "$accent" : "$border", strokeWidth: 1 });
    pane(pn, ws[i], h, s);
  }
  doc.children.push(root);
};

const E = (n, o) => (l, w) => exchange(l, w, n, o);
const D = (label) => (l) => divider(l, label);
const N = (icon, text) => (l) => pillNote(l, icon, text);
const P = (q) => (l, w) => pinCard(l, w, q);

// ---- 1. The nine states, in dark and light, wide and narrow ----
const STATES = [
  ["01-short", { bottom: true, list: [D("Thursday 5 Nov"), E(1, { sel: true }), E(2, {}), D("Friday 6 Nov"), E(3, {})] }],
  ["02-long-collapsed", { bottom: true, list: [E(6, {}), E(7, {}), E(8, { sel: true })] }],
  ["03-long-expanded", { top: 0, list: [E(8, { sel: true, open: true, promptOpen: true, actions: true })] }],
  ["03b-long-expanded-end", { bottom: true, list: [E(8, { sel: true, open: true, promptOpen: true, actions: true }), E(9, {})] }],
  ["04-tools", { bottom: true, list: [E(8, {}), E(9, {}), E(10, { sel: true, open: true })] }],
  ["05-running", { bottom: true, list: [E(8, {}), E(9, {}), E(10, {}), E(11, { sel: true })] }],
  ["06-agent", { agentsShown: true, bottom: true, list: [E(2, {}), D("Friday 6 Nov"), E(3, {}), E(4, { sel: true }), N("bot", "Agent messages shown · a hides them")] }],
  ["07-image", { bottom: true, list: [D("Thursday 5 Nov"), E(1, {}), E(2, { sel: true })] }],
  ["08-search", { search: "refund", count: "2 of 10", list: [N("chevrons-up-down", "6 turns hidden"), E(8, { sel: true, hitPrompt: ["", "Refunds", " need the same rounding fix. Support saw these"], hit: ["Partial ", "refunds", " now reuse the cart helper, so a refund is the order's own"], hitN: ["Partial ", "refunds", " now reuse the cart"] }), E(9, {}), N("chevrons-up-down", "1 turn hidden")] }],
  ["09-pins", { tabs: "pinned", splitBtn: true, pinCount: 3, list: [P({ k: 1, n: 8, st: "reading", cur: true, place: "Left off at “Still rounding on its own”", cover: "2 of 3 paragraphs answered, in #9 and #10" }), P({ k: 2, n: 7, place: "Left off at the top" }), P({ k: 3, n: 11, st: "live" })] }],
];
const X = { "dark-wide": 0, "dark-narrow": 580, "light-wide": 920, "light-narrow": 1500 };
let y = 0;
for (const [nm, s] of STATES) {
  for (const [v, x] of Object.entries(X)) { const [m, wd] = v.split("-"); frame(x, y, wd === "wide" ? 520 : 280, 760, m, `${v}-${nm}`, s); }
  y += 840;
}

// ---- 2. Three ways to reach pins (dark): A tabs, B a Pinned pane beside, C the tray improved ----
// One story in each: three pins (#8 left at its last heading, #7 at the top, #11 still working);
// open #8, go on to #7, pin #10 from the feed, unpin #11.
const LEFT8 = "Left off at “Still rounding on its own”";
const FEED = (o = {}) => [E(8, { pinned: true }), E(9, {}), E(10, { sel: o.sel, pinned: Boolean(o.pin10), actions: o.sel }), E(11, { pinned: !o.gone11 })];
const PIN = {
  8: (o = {}) => P({ k: 1, n: 8, st: o.cur ? "reading" : undefined, cur: o.cur, place: LEFT8, cover: "2 of 3 paragraphs answered" }),
  7: (o = {}) => P({ k: 2, n: 7, st: o.cur ? "reading" : undefined, cur: o.cur, place: "Left off at the top" }),
  11: (o = {}) => P({ k: 3, n: 11, st: "live" }),
  10: (o = {}) => P({ k: o.k ?? 4, n: 10, place: "Just pinned · left off at the top" }),
};
const READ = (n, o = {}) => [E(n, { sel: true, open: true, pinned: true, actions: true, ...(n === 8 ? { from: 6 } : {}), ...o })];
y += 80;
const A = [
  ["a1-open-pin", { tabs: "pinned", list: [PIN[8]({ cur: true }), ...READ(8), PIN[7](), PIN[11]()], toast: "#8 · back where you left off" }],
  ["a2-next-pin", { tabs: "pinned", list: [PIN[8](), PIN[7]({ cur: true }), ...READ(7), PIN[11]()] }],
  ["a3-pin-from-feed", { tabs: "all", pinCount: 4, pinNew: true, bottom: true, list: FEED({ sel: true, pin10: true }), toast: "Pinned #10 · v shows your 4 pins" }],
  ["a4-unpin", { tabs: "pinned", pinCount: 3, list: [PIN[8](), PIN[7](), PIN[10]({ k: 3 })], toast: "Unpinned #11 · u to undo" }],
];
A.forEach(([nm, s], i) => frame(i * 560, y, 520, 760, "dark", nm, s));
frame(4 * 560, y, 280, 760, "dark", "a5-narrow", { tabs: "pinned", list: [PIN[8]({ cur: true }), ...READ(8), PIN[7](), PIN[11]()] });
y += 840;

// B: Threads stays as it is on the left; a second pane of the same mod, opened with
// pane.split, lists the pins on the right.
const W2 = [600, 440];
const feed = (o = {}) => ({ focus: o.focus, bottom: true, list: FEED(o), foot: "", toast: o.toast });
const pinnedPane = (list, o = {}) => ({ focus: !o.feedFocus, listName: "Pinned", paneTitle: `Pinned · ${o.count ?? 3}`, foot: "pane", list, toast: o.toast });
frame2(0, y, W2, 760, "b1-open-pin", feed(), pinnedPane([PIN[8]({ cur: true }), ...READ(8), PIN[7](), PIN[11]()], { toast: "#8 · back where you left off" }));
frame2(1100, y, W2, 760, "b2-next-pin", feed(), pinnedPane([PIN[8](), PIN[7]({ cur: true }), ...READ(7), PIN[11]()]));
y += 840;
frame2(0, y, W2, 760, "b3-pin-from-feed", feed({ focus: true, sel: true, pin10: true }), pinnedPane([PIN[8](), PIN[7](), PIN[11](), PIN[10]()], { feedFocus: true, count: 4 }));
frame2(1100, y, W2, 760, "b4-unpin", feed({ pin10: true, gone11: true }), pinnedPane([PIN[8](), PIN[7](), PIN[10]({ k: 3 })], { toast: "Unpinned #11 · u to undo" }));
y += 840;
// A narrow window: no room beside, so Pinned opens as a tab in the same pane.
frame(0, y, 280, 760, "dark", "b5-narrow-falls-back", { tabs: "pinned", list: [PIN[8]({ cur: true }), ...READ(8), PIN[7](), PIN[11]()], toast: "No room beside · Pinned shows here" });

// C: the tray, improved: the opened pin says Reading, and the turn is marked in the list.
const tray = (cur, rows) => (p, w) => {
  const b = fr(p, { name: "Pins tray", width: "fill_container", layout: "vertical", padding: [4, 0], fill: "$band", stroke: "$border", strokeWidth: { top: 1 } });
  for (const q of rows) {
    const r = fr(b, { name: "Tray row #" + q.n, width: "fill_container", height: 26, padding: [0, 6, 0, 10], gap: 6, alignItems: "center", ...(q.k === cur ? { fill: "$selected", stroke: "$accent", strokeWidth: { left: 2 } } : {}) });
    key(r, String(q.k));
    tx(r, "#" + q.n, 11.5, "$dim", { mono: true, name: "Number" });
    tx(r, clip(T(q.n), w - (q.k === cur ? 200 : 160), 12.5, 1).text, 12.5, "$fg", { name: "Prompt", w: "fill_container" });
    if (q.k === cur) tx(r, "Reading", 11.5, "$accent", { name: "State", fontWeight: "600" });
    else if (q.st === "live") ic(r, "loader-circle", 12, "$working", "Spinner");
    ic(r, "pin-off", 12, "$dim", "Unpin");
  }
};
const TR = [{ k: 1, n: 8 }, { k: 2, n: 7 }, { k: 3, n: 11, st: "live" }];
const C = [
  ["c1-open-pin", { top: 0, list: READ(8), tray: tray(1, TR), toast: "#8 · back where you left off" }],
  ["c2-next-pin", { top: 0, list: READ(7), tray: tray(2, TR) }],
  ["c3-pin-from-feed", { bottom: true, list: FEED({ sel: true, pin10: true }), tray: tray(0, [...TR, { k: 4, n: 10 }]), toast: "Pinned #10 · press 4 to come back" }],
  ["c4-unpin", { bottom: true, list: FEED({ pin10: true, gone11: true }), tray: tray(0, [...TR.slice(0, 2), { k: 3, n: 10 }]), toast: "Unpinned #11 · u to undo" }],
];
C.forEach(([nm, s], i) => frame(400 + i * 560, y, 520, 760, "dark", nm, s));
frame(400 + 4 * 560, y, 280, 760, "dark", "c5-narrow", { top: 0, list: READ(8), tray: tray(1, TR) });
y += 840;

// ---- 3. Quote tracking ----
const Q = [
  ["q1-reply-marked", 520, "dark", { top: 0, list: [E(8, { sel: true, open: true, marks: true, actions: true, note: "Quoted in #9 and #10 · 2 of 3 paragraphs answered" })] }],
  ["q2-prompt-backlink", 520, "dark", { bottom: true, list: [E(8, {}), E(9, { sel: true, actions: true }), E(10, {})] }],
  ["q3-follow-to-prompt", 520, "dark", { bottom: true, list: [E(8, {}), E(9, { sel: true, flashPrompt: true, actions: true }), E(10, {})], toast: "#9 quoted #8 · l again for #10" }],
  ["q4-follow-to-reply", 520, "dark", { bottom: true, list: [E(8, { sel: true, open: true, marks: true, flash: 10, note: "Quoted in #9 and #10 · 2 of 3 paragraphs answered" })], toast: "From #10 · Esc goes back" }],
  ["q5-pinned-coverage", 520, "dark", { tabs: "pinned", list: [P({ k: 1, n: 8, st: "reading", cur: true, place: "Left off at “Still rounding on its own”", cover: "2 of 3 paragraphs answered, in #9 and #10" }), P({ k: 2, n: 7, place: "Left off at the top", cover: "Not quoted yet" })] }],
  ["q6-narrow-reply", 280, "dark", { top: 0, list: [E(8, { sel: true, open: true, marks: true, note: "Quoted in #9, #10" })] }],
  ["q7-narrow-prompt", 280, "dark", { bottom: true, list: [E(8, {}), E(9, { sel: true }), E(10, {})] }],
  ["q8-light-reply", 520, "light", { top: 0, list: [E(8, { sel: true, open: true, marks: true, note: "Quoted in #9 and #10 · 2 of 3 paragraphs answered" })] }],
];
let qx = 0;
// The reply frames are taller than a pane, so a whole reply with its marks shows at once.
const QH = { "q1-reply-marked": 830, "q6-narrow-reply": 1130, "q8-light-reply": 830 };
for (const [nm, w, m, s] of Q) { frame(qx, y, w, QH[nm] ?? 760, m, nm, s); qx += w + 40; }

writeFileSync(OUT, JSON.stringify(doc, null, 1) + "\n");
console.log(`${OUT}: ${doc.children.length} frames, ${seq} nodes`);
