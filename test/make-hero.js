// Writes the synthetic Claude Code session staged for the README screenshots: a made-up
// storefront project, acme-web. Same line shapes as test/make-fixture.js. Nothing here
// comes from a real session, and both pasted images are drawn below, with no text in them.
// docs/develop.md has the steps that turn this into the screenshots.
// Usage: bun test/make-hero.js <out.jsonl> <cwd> <startISO> [days] [wake] [pair] [long] [many]
// With "days", turns 3 and 5 start a day after the turn before, so the pane shows day bands.
// With "wake", a background update follows the last turn: a task notification woke the agent
// 95 s before the script ran and it is still working, so with the terminal reporting working the
// last turn shows its "Updating" line. Its times are relative to now, so write it just before the shot.
// With "pair", turn 5 has two pasted images, so the image viewer has one to step to.
// With "long", turn 7's reply goes on after the code block with a write-up of about 6,000
// characters and no code fence, longer than Herdr draws as one Markdown block.
// With "many", fourteen short turns come first, 25 minutes apart from startISO, and turn 1
// (then #15) starts the next day: a long session for the outline (o).
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const [out, cwd, start, ...flags] = process.argv.slice(2);
const DAY = flags.includes("days") ? 86400 - 3600 : 0;
const sessionId = "00000000-0000-4000-8000-000000000042";
const version = "2.1.316";
const model = "claude-opus-5-5";
let clock = Date.parse(start);
let n = 0;
let parent = null;
const lines = [];
const uid = () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
const tick = (s) => new Date((clock += s * 1000)).toISOString();
const base = () => ({ parentUuid: parent, isSidechain: false, userType: "external", cwd, sessionId, version, gitBranch: "main" });
function push(obj) { lines.push(JSON.stringify(obj)); if (obj.uuid) parent = obj.uuid; }
let promptIndex = 0;
let turnIndex = 0;
function prompt(content, gap, extra = {}) {
  const promptId = uid();
  push({ ...base(), type: "user", promptId, origin: { kind: "human" }, promptSource: "typed", ...extra,
    turnPosition: { promptIndex: ++promptIndex, turnIndex: ++turnIndex },
    message: { role: "user", content }, uuid: uid(), timestamp: tick(gap) });
  return promptId;
}
let msg = 0;
function assistant(blocks, { stop = "end_turn", out = 120, read = 42000, write = 1800, secs = 4 } = {}) {
  const id = `msg_01${String(++msg).padStart(6, "0")}`;
  const usage = { input_tokens: 6, output_tokens: out, cache_read_input_tokens: read, cache_creation_input_tokens: write };
  blocks.forEach((b, i) => push({ ...base(), type: "assistant", requestId: `req_01${msg}`, apiBlockIndex: i, effort: "high",
    message: { id, model, role: "assistant", type: "message", content: [b], stop_reason: stop, usage },
    uuid: uid(), timestamp: tick(i === 0 ? secs : 0) }));
}
function tool(name, input, result, promptId, secs = 6) {
  const id = `toolu_01${String(msg).padStart(6, "0")}${name}`;
  assistant([{ type: "tool_use", id, name, input }], { stop: "tool_use", out: 60, secs });
  push({ ...base(), type: "user", promptId, toolUseResult: { stdout: result }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: result }] }, uuid: uid(), timestamp: tick(2) });
}
function end(ms) {
  push({ ...base(), type: "system", subtype: "stop_hook_summary", hookCount: 1, uuid: uid(), timestamp: tick(0) });
  push({ ...base(), type: "system", subtype: "turn_duration", durationMs: ms, messageCount: 9, uuid: uid(), timestamp: tick(0) });
}

// A blank RGB canvas: fill() draws a rectangle, png() encodes the result.
function canvas(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, k) => { let c = k; for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const px = new Uint8Array(w * h * 3);
  const fill = (x0, y0, x1, y1, [r, g, b], radius = 0) => {
    for (let y = Math.max(0, y0); y < Math.min(h, y1); y++) for (let x = Math.max(0, x0); x < Math.min(w, x1); x++) {
      if (radius) {
        const cx = x < x0 + radius ? x0 + radius : x >= x1 - radius ? x1 - radius - 1 : x;
        const cy = y < y0 + radius ? y0 + radius : y >= y1 - radius ? y1 - radius - 1 : y;
        if ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius) continue;
      }
      const i = (y * w + x) * 3; px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  };
  const png = () => {
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(px.buffer, y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  };
  return { fill, png };
}

// A simple UI mock with no text: a header bar, a search field, filter chips that wrap
// under it, and a grid of product cards.
function mockPng(w, h) {
  const { fill, png } = canvas(w, h);
  fill(0, 0, w, h, [246, 247, 249]);
  fill(0, 0, w, 64, [255, 255, 255]);
  fill(0, 63, w, 64, [226, 229, 234]);
  fill(24, 20, 60, 44, [79, 70, 229], 6);                 // logo
  fill(80, 26, 150, 38, [203, 208, 216], 6);              // nav
  fill(166, 26, 226, 38, [203, 208, 216], 6);
  fill(w - 64, 18, w - 24, 46, [79, 70, 229], 14);        // cart button
  fill(24, 88, w - 24, 128, [255, 255, 255], 10);         // search field
  fill(24, 88, w - 24, 89, [209, 213, 219]);
  fill(40, 103, 220, 113, [214, 218, 224], 5);
  // filter chips: three on the search row's right edge, two wrapped below (the bug)
  const chip = (x, y, wd, col) => fill(x, y, x + wd, y + 28, col, 14);
  chip(w - 300, 94, 80, [224, 231, 255]); chip(w - 210, 94, 90, [224, 231, 255]); chip(w - 110, 94, 80, [224, 231, 255]);
  chip(24, 140, 96, [254, 226, 226]); chip(130, 140, 70, [254, 226, 226]);
  fill(24, 178, w - 24, 180, [239, 68, 68]);              // the overlap marker
  // product cards
  const cols = 4, gap = 20, cw = Math.floor((w - 48 - gap * (cols - 1)) / cols);
  const tints = [[253, 230, 138], [167, 243, 208], [191, 219, 254], [251, 207, 232], [221, 214, 254], [254, 215, 170], [187, 247, 208], [199, 210, 254]];
  for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
    const x = 24 + c * (cw + gap), y = 200 + r * 200;
    fill(x, y, x + cw, y + 180, [255, 255, 255], 10);
    fill(x + 10, y + 10, x + cw - 10, y + 110, tints[r * cols + c], 8);
    fill(x + 10, y + 124, x + cw - 40, y + 134, [203, 208, 216], 5);
    fill(x + 10, y + 146, x + 70, y + 158, [107, 114, 128], 5);
    fill(x + cw - 46, y + 140, x + cw - 10, y + 166, [79, 70, 229], 8);
  }
  return png();
}

// A phone-width orders page with no text: a header, a title bar, and a table whose
// columns run past the right edge (the bug in turn 2).
function phonePng(w, h) {
  const { fill, png } = canvas(w, h);
  fill(0, 0, w, h, [246, 247, 249]);
  fill(0, 0, w, 56, [255, 255, 255]);
  fill(0, 55, w, 56, [226, 229, 234]);
  fill(16, 18, 44, 38, [79, 70, 229], 6);
  fill(w - 40, 20, w - 16, 36, [156, 163, 175], 4);
  fill(16, 76, 170, 92, [55, 65, 81], 6);               // page title
  fill(16, 102, 120, 112, [156, 163, 175], 5);
  fill(w - 116, 76, w - 16, 104, [79, 70, 229], 8);      // button
  // the table: wider than the screen, cut off at the right edge
  const colW = [70, 120, 110, 90, 100];
  const x0 = 16, y0 = 132, rowH = 44;
  fill(x0, y0, w + 40, y0 + 10 * rowH, [255, 255, 255], 0);
  fill(x0, y0, w, y0 + rowH, [243, 244, 246]);
  let x = x0;
  colW.forEach((cw, c) => {
    fill(x + 10, y0 + 17, x + cw - 24, y0 + 27, [107, 114, 128], 4);
    for (let r = 1; r < 10; r++) {
      const y = y0 + r * rowH;
      fill(x0, y, w, y + 1, [229, 231, 235]);
      const col = c === 3 ? (r % 3 === 0 ? [254, 243, 199] : [209, 250, 229]) : [209, 213, 219];
      fill(x + 10, y + 16, x + cw - (c === 0 ? 20 : 30), y + 28, col, c === 3 ? 6 : 4);
    }
    x += cw;
  });
  fill(w - 3, y0, w, y0 + 10 * rowH, [239, 68, 68]);    // the cut edge
  fill(16, y0 + 10 * rowH + 24, w - 16, y0 + 10 * rowH + 64, [255, 255, 255], 8);
  return png();
}

const mock = mockPng(820, 600);
const phone = phonePng(390, 760);

push({ type: "mode", mode: "normal", sessionId });

const EARLY = [
  ["Set up the acme-web repo with Vite and TypeScript", "Set it up with Vite, strict TypeScript and a src/ layout. `bun run dev` serves it on port 5173.", 4],
  ["Add ESLint and Prettier", "Added both with the recommended rules and a lint script. The codebase passes with no changes.", 3],
  ["Create the product card component", "Added ProductCard with the image, name, price and an Add to cart button, and a story for it.", 5],
  ["Why is the price showing NaN for sale items?", "Sale items have no listPrice, so the discount divided by undefined. It now falls back to the price.", 3],
  ["Add a cart drawer that slides in from the right", "The drawer opens from the cart icon, traps focus, and closes on Esc or a click outside.", 6],
  ["Store the cart in localStorage", "The cart now survives a reload. It is read once at start and written on every change.", 2],
  ["Write tests for the cart reducer", "Added 12 tests for add, remove, quantity and clear. All pass.", 3],
  ["The search box loses focus after each keystroke", "The results list remounted the header on every render. Moving the key fixed it.", 4],
  ["Add sorting by price and by newest to the catalog", "Added a sort menu; the choice is kept in the URL, so a shared link sorts the same way.", 4],
  ["Make the product images lazy-load", "Images below the fold now load lazily with a fixed aspect ratio, so the grid no longer jumps.", 2],
  ["Add a 404 page", "Added a 404 page with a search box and a link back to the catalog.", 2],
  ["Set up the staging deploy", "Staging now deploys from main on every merge, with a preview link on each pull request.", 5],
  ["Is the checkout page accessible with a keyboard?", "Mostly. The quantity stepper skipped its buttons; they are in the tab order now.", 3],
  ["Add order confirmation emails", "Orders now send a confirmation email with the items, total and a link to the order page.", 5],
];
if (flags.includes("many")) {
  EARLY.forEach(([q, a, tools], i) => {
    const ep = prompt(q, i ? 1500 : 0);
    for (let k = 0; k < tools; k++) tool(["Read", "Edit", "Bash", "Grep"][k % 4], {}, "…", ep);
    assistant([{ type: "text", text: a }], { out: 90 + tools * 30, read: 24000 + tools * 4000, write: 900 });
    end(9000 + tools * 8000);
  });
}

// Turn 1
let p = prompt("Make the header sticky on mobile", flags.includes("many") ? 86400 - EARLY.length * 1500 : 0);
tool("Read", { file_path: `${cwd}/src/components/SiteHeader.tsx` }, "…", p);
tool("Edit", { file_path: `${cwd}/src/components/SiteHeader.tsx` }, "…", p);
tool("Bash", { command: "bun run test src/components" }, "…", p);
assistant([{ type: "text", text: "The header now sticks to the top below 640 px, with a shadow once you scroll. Desktop is unchanged, and the header tests still pass." }], { out: 140, read: 38000, write: 1600 });
end(41000);

// Turn 2: a pasted image of a phone page
p = prompt([{ type: "text", text: "The orders table is cut off on mobile [Image #1]. Can you make it scroll sideways?" },
  { type: "image", source: { type: "base64", media_type: "image/png", data: phone.toString("base64") } }], 300, { imagePasteIds: [1] });
tool("Read", { file_path: `${cwd}/src/pages/orders/OrdersTable.tsx` }, "…", p);
tool("Edit", { file_path: `${cwd}/src/pages/orders/OrdersTable.tsx` }, "…", p);
tool("Edit", { file_path: `${cwd}/src/styles/table.css` }, "…", p);
assistant([{ type: "text", text: "Below 640 px the table now sits in a scroll container and the order number column stays pinned, so you can swipe across the rest. Desktop keeps the full table." }], { out: 180, read: 41000, write: 1900 });
end(52000);

// Turn 3
p = prompt("Add a loading skeleton to the product grid", 260 + DAY);
tool("Grep", { pattern: "ProductGrid" }, "…", p);
tool("Read", { file_path: `${cwd}/src/components/ProductGrid.tsx` }, "…", p);
tool("Write", { file_path: `${cwd}/src/components/ProductGridSkeleton.tsx` }, "…", p);
tool("Edit", { file_path: `${cwd}/src/components/ProductGrid.tsx` }, "…", p);
assistant([{ type: "text", text: "Added `ProductGridSkeleton`: eight placeholder cards that match the real card height, so the page doesn't jump when products load. It shows only on the first page; later pages keep the current spinner." }], { out: 210, read: 46000, write: 2400 });
end(64000);

// Turn 4: a subagent's report, shown only with agent messages on
push({ ...base(), type: "user", isMeta: true, promptSource: "system", turnOrigin: "peer",
  origin: { kind: "peer", from: "a3c9e1f07b2d4e58", senderTaskId: "task-0003", name: "general-purpose" },
  message: { role: "user", content: [{ type: "text", text: 'Another Claude session sent a message: <agent-message from="a3c9e1f07b2d4e58">Accessibility pass on the product pages is done. Three images have no alt text: the product card photo, the hero banner and the brand strip logos. Contrast and focus order look fine.</agent-message>' }] },
  uuid: uid(), timestamp: tick(240) });
tool("Edit", { file_path: `${cwd}/src/components/ProductCard.tsx` }, "…", null);
tool("Edit", { file_path: `${cwd}/src/components/HeroBanner.tsx` }, "…", null);
assistant([{ type: "text", text: "Added alt text to all three: the product name on card photos, the campaign title on the hero banner, and each brand's name on its logo." }], { out: 120, read: 47000, write: 1500 });
end(33000);

// Turn 5: a pasted image of a tablet page
p = flags.includes("pair")
  ? prompt([{ type: "text", text: "[Image #2] [Image #3] The filter chips wrap under the search box on tablet, in both orientations. Can you fix it?" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: mock.toString("base64") } },
    { type: "image", source: { type: "base64", media_type: "image/png", data: phone.toString("base64") } }], 300, { imagePasteIds: [2, 3] })
  : prompt([{ type: "text", text: "[Image #2] The filter chips wrap under the search box on tablet. Can you fix it?" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: mock.toString("base64") } }], 300, { imagePasteIds: [2] });
tool("Read", { file_path: `${cwd}/src/components/FilterBar.tsx` }, "…", p);
tool("Edit", { file_path: `${cwd}/src/components/FilterBar.tsx` }, "…", p);
tool("Edit", { file_path: `${cwd}/src/styles/filters.css` }, "…", p);
assistant([{ type: "text", text: "The chips had a fixed `min-width`, so at tablet widths two of them spilled onto a second line under the search box. Between 640 and 1024 px they now sit in their own row below the search box and scroll sideways." }], { out: 230, read: 52000, write: 2100 });
end(58000);

// Turn 6
p = prompt("Run the checkout e2e tests", 520 + DAY);
tool("Bash", { command: "bun run e2e --grep checkout" }, "…", p, 40);
assistant([{ type: "text", text: "17 of 18 checkout tests pass in Chromium and WebKit. The one failure is `order total matches cart`: a three-item cart with tax comes out one cent higher than the cart page shows." }], { out: 190, read: 61000, write: 1900 });
end(97000);

// The write-up "long" adds to turn 7: prose, a list and a table, with no code fence.
const LONG_NOTES = [
  "",
  "## What went wrong",
  "",
  "The cart page and the checkout service each worked out the total on their own. The cart page added up the line prices and applied tax once, at the end, to the subtotal. The checkout service applied tax to each line as it was added, rounded that line's tax to a cent, and then added the lines up. For most carts the two agree, because the rounding on each line is as likely to go up as down and the errors cancel. For a cart with several taxed items whose tax lands near half a cent, they all round the same way, and the checkout total ends up a cent higher than the cart page showed. That is the cart in ACME-123: three items at 8.25% tax, each with a tax of x.xx5 before rounding.",
  "",
  "Nothing about this was new. The per-line rounding has been in the checkout service since the first version of `totals.ts`, and the cart page has always rounded once. What changed last week was the tax rate in the test region, from 8% to 8.25%, which moved more carts onto the half-cent boundary. The e2e test `order total matches cart` was written for exactly this, and it started failing on the first run after the rate change.",
  "",
  "## What the fix does",
  "",
  "The checkout service now works in whole cents from start to finish. Each line's price is turned into cents once, when the line is added, and every sum after that is a sum of integers. Tax is worked out once, on the subtotal in cents, and rounded once, half away from zero, which is what the cart page and the payment provider both do. Shipping is added after tax, because shipping is not taxed in any region we sell to today. If that changes, the order of these steps is the one place to look.",
  "",
  "The rounding helper is shared now. The cart page imports it from the same module as the checkout service, so the two cannot drift apart again without a test noticing. The helper has its own tests for the boundary cases: a tax of exactly half a cent, a negative line from a discount code, and a cart of one item at zero tax.",
  "",
  "## Why not round each line the other way",
  "",
  "Rounding each line down, or to even, would have made this cart agree, but another cart would then come out a cent low. The only way the two totals always agree is for both to do the same sum in the same order, so the fix moves the checkout service to the cart page's order rather than nudging the rounding. The payment provider rounds once on the total as well, so this also matches what the customer's bank statement shows.",
  "",
  "## What I checked",
  "",
  "- The six new cases in `totals.test.ts` pass, and so do the 41 cases that were already there",
  "- All 18 checkout e2e tests pass in Chromium and WebKit, three runs in a row",
  "- The cart from ACME-123 now totals the same on the cart page, at checkout and on the receipt",
  "- A cart with a discount code that takes a line below zero still totals correctly",
  "",
  "| Cart | Cart page | Checkout before | Checkout now |",
  "|---|---|---|---|",
  "| ACME-123, three items | 64.93 | 64.94 | 64.93 |",
  "| One item, no tax | 12.00 | 12.00 | 12.00 |",
  "| Five items, discount code | 88.41 | 88.42 | 88.41 |",
  "",
  "## What I did not change",
  "",
  "Orders placed before the fix keep the total they were charged. A few of them were charged a cent more than the cart page showed; the support team can refund those from the orders page if anyone asks, and the query in the PR description lists them. I did not touch the receipt template, which already reads the total from the order and so shows whatever the checkout service charged.",
  "",
  "The currency formatting on the cart page still uses the browser's locale, while the receipt uses the store's. They show the same digits for every store we have today, but a store with a different decimal mark would see them differ. That is a separate change, and I left a note on ACME-131 about it rather than fold it into this fix.",
  "",
  "## What to watch after the deploy",
  "",
  "The checkout service logs a warning when the total it charges differs from the total the cart page sent with the order. Before the fix that warning fired a few times a day in the test region. After the deploy it should not fire at all. If it does, the log line has the cart id and both totals, which is enough to replay the cart in the totals tests and see which step disagrees.",
];

// Turn 7: the open card
p = prompt("Fix that one-cent checkout bug, it's ACME-123", 180);
tool("Read", { file_path: `${cwd}/src/cart/totals.ts` }, "…", p);
tool("Grep", { pattern: "Math.round" }, "…", p);
tool("Edit", { file_path: `${cwd}/src/cart/totals.ts` }, "…", p);
tool("Edit", { file_path: `${cwd}/src/cart/totals.test.ts` }, "…", p);
tool("Bash", { command: "bun run test src/cart && bun run e2e --grep checkout" }, "…", p, 30);
tool("Bash", { command: "gh pr create --fill" }, "…", p);
assistant([{ type: "text", text: [
  "Found it. Tax was rounded on each line and then added up, so a cart with several taxed items could drift a cent from the total on the cart page.",
  "",
  "- Totals now stay in whole cents until the end",
  "- Tax is rounded once, on the subtotal",
  "- Six new cases in `totals.test.ts`, including the cart from ACME-123",
  "",
  "```ts",
  "const taxCents = Math.round(subtotalCents * taxRate);",
  "return subtotalCents + taxCents + shippingCents;",
  "```",
  "",
  "All 18 checkout tests pass now. The fix is up for review in #42.",
  ...(flags.includes("long") ? LONG_NOTES : []),
].join("\n") }], { out: 420, read: 88000, write: 3600 });
end(151000);

// A background update after the turn ended, still running (only with "wake").
if (flags.includes("wake")) {
  const now = Date.now();
  const at = (ago) => new Date(now - ago * 1000).toISOString();
  push({ ...base(), type: "user", origin: { kind: "task-notification" }, promptSource: "system",
    message: { role: "user", content: "<task-notification>the nightly checkout run finished</task-notification>" }, uuid: uid(), timestamp: at(95) });
  const wake = (block, ago) => push({ ...base(), type: "assistant", message: { id: `msg_01w${++msg}`, model, role: "assistant", type: "message",
    content: [block], stop_reason: "tool_use", usage: { input_tokens: 5, output_tokens: 40, cache_read_input_tokens: 90000, cache_creation_input_tokens: 0 } }, uuid: uid(), timestamp: at(ago) });
  wake({ type: "text", text: "The nightly run finished. Checking its log for the checkout tests." }, 92);
  for (const [i, [name, ago]] of [["Bash", 80], ["Read", 60], ["Bash", 35]].entries()) {
    wake({ type: "tool_use", id: `toolu_w${i}`, name, input: {} }, ago);
    push({ ...base(), type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `toolu_w${i}`, content: "…" }] }, uuid: uid(), timestamp: at(ago - 3) });
  }
  wake({ type: "text", text: "All 18 checkout tests passed in the nightly run, three runs in a row." }, 20);
}

push({ type: "custom-title", customTitle: "checkout fixes", sessionId });
push({ type: "last-prompt", lastPrompt: "Fix that one-cent checkout bug, it's ACME-123", sessionId });
push({ type: "agent-name", agentName: "checkout-agent", sessionId });
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`${out}: ${lines.length} lines`);
