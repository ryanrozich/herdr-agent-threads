// A Mermaid code block drawn as text art, for "View diagram" under the block in an open turn.
// The renderer is beautiful-mermaid's (vendor/mermaid-ascii.js, MIT). It draws flowchart,
// state, sequence, class, ER and XY chart diagrams; any other kind, or source it cannot
// read, throws, and the viewer then shows the source with a plain note.
import { renderMermaidASCII } from "./vendor/mermaid-ascii.js";

// The fence languages that mean a Mermaid diagram.
export function isDiagram(lang) { return String(lang ?? "").trim().toLowerCase() === "mermaid"; }

// The renderer reads a flowchart node's name up to the next space, hyphens included, so
// "A-->B" would be one node called "A--". Mermaid itself reads it as A, an arrow and B: put
// spaces around each arrow first. Labels in bars ("-->|yes|B") keep theirs.
const ARROW = "<?(?:-->|---|==>|===|-\\.->|-\\.-)";
export function spaceArrows(text) {
  if (!/^\s*(?:graph|flowchart)\b/i.test(text)) return text;
  return text
    .replace(new RegExp(`(?<=[\\w\\p{L}\\])}])(${ARROW})`, "gu"), " $1")
    .replace(new RegExp(`(${ARROW})(\\|[^|\\n]*\\|)?(?=[\\w\\p{L}\\[(])`, "gu"), "$1$2 ");
}

// { art } with the drawing, or { error } with one line saying why there is none.
export function drawDiagram(src) {
  const text = spaceArrows(String(src ?? ""));
  if (!text.trim()) return { error: "The block is empty." };
  try {
    const art = renderMermaidASCII(text, { colorMode: "none", paddingX: 4, paddingY: 2 }).replace(/[ \t]+$/gm, "").replace(/\n+$/, "");
    if (!art.trim()) return { error: "The diagram drew nothing." };
    return { art };
  } catch (e) {
    const msg = String(e?.message ?? e).split("\n")[0];
    if (/^Invalid mermaid header/i.test(msg)) {
      const kind = text.trim().split(/\s/)[0];
      return { error: `Threads can draw flowchart, state, sequence, class, ER and XY chart diagrams, not "${kind}". The source is below.` };
    }
    return { error: `This diagram could not be drawn (${msg.slice(0, 160)}). The source is below.` };
  }
}
