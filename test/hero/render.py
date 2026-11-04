# Renders the Claude Code stand-in's screen for the acme-web stage (synthetic text only):
# the end of the session, then the prompt box holding whatever was typed or pasted.
# Usage: python3 test/hero/render.py <cols> <rows> <screen.txt> <input.txt> [--light] [--once]
# It loops and rebuilds on change, unless --once. Run it after the terminal exists, with that
# terminal's size.
import sys, time, os, re
COLS, ROWS, OUT, INP = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3], sys.argv[4]
E = "\033["
R, B, G, GR, CY, OR, INV = E+"0m", E+"1m", E+"38;5;114m", E+"38;5;245m", E+"38;5;180m", E+"38;5;209m", E+"7m"
PB = E+"48;5;236m"
if "--light" in sys.argv:
    PB, CY, GR = E+"48;5;254m", E+"38;5;130m", E+"38;5;243m"
def tool(name, arg, out, more=None):
    l = [f"{G}●{R} {B}{name}{R}({arg})", f"  {GR}⎿{R}  {out}"]
    if more: l.append(f"     {GR}{more}{R}")
    return l + [""]
def you(text):
    return [f"{PB}{GR}>{R}{PB} {text}{' ' * (COLS - len(text) - 2)}{R}", ""]
H = []
H += you("Run the checkout e2e tests")
H += tool("Bash", "bun run e2e --grep checkout", "17 passed, 1 failed (Chromium, WebKit)", "… +31 lines (ctrl+o to expand)")
H += [f"●{R} 17 of 18 checkout tests pass in Chromium and WebKit. The one failure",
      f"  is {CY}order total matches cart{R}: a three-item cart with tax comes out one",
      "  cent higher than the cart page shows.", ""]
H += you("Fix that one-cent checkout bug, it's ACME-123")
H += tool("Read", "src/cart/totals.ts", "Read 84 lines")
H += tool("Update", "src/cart/totals.ts", "Updated src/cart/totals.ts with 4 additions and 6 removals")
H += tool("Update", "src/cart/totals.test.ts", "Updated src/cart/totals.test.ts with 38 additions")
H += tool("Bash", "bun run test src/cart && bun run e2e --grep checkout", "42 pass, 0 fail", "… +18 lines (ctrl+o to expand)")
H += tool("Bash", "gh pr create --fill", "https://github.com/acme/acme-web/pull/42")
H += ["● Found it. Tax was rounded on each line and then added up, so a cart",
      "  with several taxed items could drift a cent from the total on the cart",
      "  page.", "",
      "  - Totals now stay in whole cents until the end",
      "  - Tax is rounded once, on the subtotal",
      f"  - Six new cases in {CY}totals.test.ts{R}, including the cart from ACME-123", "",
      f"    {E}38;5;176mconst{R} taxCents = Math.{E}38;5;110mround{R}(subtotalCents * taxRate);",
      f"    {E}38;5;176mreturn{R} subtotalCents + taxCents + shippingCents;", "",
      "  All 18 checkout tests pass now. The fix is up for review in #42.", ""]
def wrap(line, width):
    out = []
    while len(line) > width:
        cut = line.rfind(" ", 0, width + 1)
        if cut <= 0: cut = width
        out.append(line[:cut]); line = line[cut:].lstrip(" ")
    out.append(line)
    return out
def typed(raw):
    s = raw.decode("utf-8", "replace").replace("\x1b[200~", "").replace("\x1b[201~", "")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", s)
    return "".join(ch for ch in s if ch == "\n" or ch >= " ")
def build(text):
    box = []
    for i, line in enumerate(text.split("\n")):
        for j, part in enumerate(wrap(line, COLS - 4) if line else [""]):
            box.append(part)
    if not box: box = [""]
    rows = [(f"{B}❯{R} " if k == 0 else "  ") + l for k, l in enumerate(box)]
    rows[-1] += f"{INV} {R}"
    tag = " acme-web ─"
    bottom = [f"{GR}{'─' * (COLS - len(tag))}{tag}{R}"] + rows + [f"{GR}{'─' * COLS}{R}", f"  {OR}⏵⏵ accept edits on{R}{GR} (shift+tab to cycle){R}"]
    room = ROWS - len(bottom)
    body = H[-room:] if room > 0 else []
    body += [""] * (room - len(body))
    return "\033]0;Claude Code\007" + "\r\n".join(body + bottom)
last = None
while True:
    try: raw = open(INP, "rb").read()
    except FileNotFoundError: raw = b""
    if raw != last:
        last = raw
        tmp = OUT + ".tmp"; open(tmp, "w").write(build(typed(raw))); os.replace(tmp, OUT)
    if "--once" in sys.argv: break
    time.sleep(0.2)
