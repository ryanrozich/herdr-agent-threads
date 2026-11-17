// bun test: diagram.js, a Mermaid block drawn as text art (beautiful-mermaid's renderer).
import { test, expect } from "bun:test";
import { isDiagram, drawDiagram, spaceArrows } from "../mods/agent-threads/diagram.js";

test("only a mermaid fence is a diagram, in any case", () => {
  expect(["mermaid", "Mermaid", " MERMAID "].map(isDiagram)).toEqual([true, true, true]);
  expect(["", "js", "mermaidx", undefined, null].map(isDiagram)).toEqual([false, false, false, false, false]);
});

test("arrows written without spaces read as Mermaid reads them", () => {
  expect(spaceArrows("graph TD\n  A-->B")).toBe("graph TD\n  A --> B");
  expect(spaceArrows("flowchart LR\n  A[Go]-->|yes|B==>C")).toBe("flowchart LR\n  A[Go] -->|yes| B ==> C");
  expect(spaceArrows("graph TD\n  my-node-->other")).toBe("graph TD\n  my-node --> other");
  expect(spaceArrows("graph TD\n  A --> B")).toBe("graph TD\n  A --> B");
  // Only flowcharts: a sequence diagram's messages keep their own arrows.
  expect(spaceArrows("sequenceDiagram\n  A->>B: hi")).toBe("sequenceDiagram\n  A->>B: hi");
  expect(drawDiagram("graph TD\n  A-->B").art).toMatch(/│ A │[\s\S]*▼[\s\S]*│ B │/);
});

test("each kind the renderer knows draws; others and empty blocks say why", () => {
  const kinds = {
    flowchart: "flowchart TD\n  A --> B",
    state: "stateDiagram-v2\n  [*] --> Idle\n  Idle --> Busy",
    sequence: "sequenceDiagram\n  Cart->>Pay: total\n  Pay-->>Cart: ok",
    class: "classDiagram\n  Cart <|-- Order",
    er: "erDiagram\n  CART ||--o{ ITEM : holds",
    xy: "xychart-beta\n  x-axis [mon, tue]\n  bar [3, 5]",
  };
  for (const [k, src] of Object.entries(kinds)) {
    const d = drawDiagram(src);
    expect([k, typeof d.art, d.error]).toEqual([k, "string", undefined]);
    // No colour codes and no trailing spaces: the viewer shows it as plain text.
    expect(d.art).not.toMatch(/\x1b\[/);
    expect(d.art).not.toMatch(/[ \t]$/m);
  }
  expect(drawDiagram("gantt\n  title Plan").error).toBe('Threads can draw flowchart, state, sequence, class, ER and XY chart diagrams, not "gantt". The source is below.');
  expect(drawDiagram("  \n").error).toBe("The block is empty.");
});
