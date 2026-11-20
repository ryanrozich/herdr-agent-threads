"""What Harbor accepts in our ATIF exports and what it sees (TRD-42). Run by test/harbor/run.sh.

Usage: python -I report.py <folder>, where the folder holds nest-claude.json, nest-codex.json
and codex.json. Prints a Markdown report. Exits 1 when Harbor's checker rejects a file, when a
file does not load in Harbor's model, when a file's helpers or helper links are not what the
synthetic session holds, or when a control does not come out as expected. A Harbor tool that
reads only the main step list is reported, not failed.
"""
import json, subprocess, sys, tempfile
from importlib.metadata import version
from pathlib import Path

from harbor.agents.installed.claude_code import ClaudeCode
from harbor.agents.installed.codex import Codex
from harbor.models.trajectories import Trajectory
from harbor.utils.trajectory_utils import compute_model_usage
from harbor.utils.traces_utils import extract_conversations_from_trajectory

FLAT_TICKET = "TRD-59"
SESSION = "00000000-0000-4000-8000-000000000000"
# file, title, agent, Harbor's loader class, helpers expected anywhere in the tree
INPUTS = [
    ("nest-claude.json", "Claude session with two helpers", "claude", ClaudeCode, 2),
    ("nest-codex.json", "Codex session with a child and a grandchild", "codex", Codex, 2),
    ("codex.json", "Codex session with no helpers", "codex", Codex, 0),
]
failures = []

def fail(why):
    failures.append(why)

def checker(path):
    r = subprocess.run([sys.executable, "-I", "-m", "harbor.utils.trajectory_validator", str(path)], capture_output=True, text=True)
    return r.returncode, ((r.stdout or r.stderr).strip().splitlines() or [""])[0].split(": ", 1)[0]

def tree(t):
    yield t
    for s in t.subagent_trajectories or []:
        yield from tree(s)

def n(k, word):
    return f"{k} {word}" if k == 1 else f"{k} {word}s"

def words(items):
    items = [x for x in items if x]
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]

def calls(t):
    return sum(len(s.tool_calls or []) for s in t.steps)

def last_reply(t):
    said = [s.message for s in t.steps if s.source == "agent" and isinstance(s.message, str) and s.message.strip()]
    return said[-1] if said else None

def what_tools_see(path, t, agent, loader):
    with tempfile.TemporaryDirectory() as d:
        native = json.dumps(loader(logs_dir=Path(d)).atif_to_native_trajectory(t, SESSION))
    meta = {"agent_name": agent, "model_name": t.agent.model_name or "", "model_provider": "", "start_time": "", "run_id": "", "trial_name": "", "task_name": ""}
    conv = extract_conversations_from_trajectory(path, meta)
    return native, json.dumps(conv), len(conv)

def report(folder, name, title, agent, loader, want):
    path = folder / name
    print(f"## {title} (`{name}`)\n")
    if not path.exists():
        fail(f"{name}: missing")
        print("- missing: the export was not written\n")
        return
    code, line = checker(path)
    print(f"- Harbor's checker: exit {code}, \"{line}\"")
    if code != 0:
        fail(f"{name}: the checker rejected it")
    try:
        t = Trajectory.model_validate_json(path.read_text())
    except Exception as e:
        fail(f"{name}: does not load in Harbor's model")
        print(f"- Harbor's model: does not load ({type(e).__name__})\n")
        return
    trees = list(tree(t))
    helpers = trees[1:]
    total = sum(len(x.steps) for x in trees)
    total_calls = sum(calls(x) for x in trees)
    print(f"- Harbor's model, the main step list: {n(len(t.steps), 'step')}, {n(calls(t), 'tool call')}. `final_metrics.total_steps`: {t.final_metrics.total_steps if t.final_metrics else 'none'}.")
    print(f"- Harbor's model, every trajectory in the file: {n(total, 'step')}, {n(total_calls, 'tool call')}.")
    print(f"- Nested helpers: {len(helpers)}" + "".join(f"; `{h.trajectory_id}` {n(len(h.steps), 'step')}, {n(calls(h), 'tool call')}" for h in helpers) + ".")
    ids = {h.trajectory_id for h in helpers}
    refs = [ref.trajectory_id for x in trees for s in x.steps if s.observation for r in s.observation.results for ref in (r.subagent_trajectory_ref or [])]
    resolved = sum(1 for i in refs if i in ids)
    print(f"- Helper links: {len(refs)}, of which {resolved} name a helper the file holds.")
    if len(helpers) != want:
        fail(f"{name}: {len(helpers)} nested helpers, expected {want}")
    if resolved != len(refs) or len(refs) != want:
        fail(f"{name}: {resolved} of {len(refs)} helper links resolve, expected {want} of {want}")
    out = sum(u.n_output_tokens for u in compute_model_usage(t).values())
    print(f"- Harbor's usage summary: {out} output tokens. `final_metrics.total_completion_tokens`: {t.final_metrics.total_completion_tokens}.")
    native, conv, episodes = what_tools_see(path, t, agent, loader)
    main = last_reply(t)
    main_seen = (main in native, main in conv)
    print(f"- Control, the main session's last reply: session loader {'found' if main_seen[0] else 'MISSING'}, trace exporter {'found' if main_seen[1] else 'MISSING'}.")
    if not all(main_seen):
        fail(f"{name}: the main reply is missing from a tool's output, so the search is broken")
    own = [m for m in (last_reply(h) for h in helpers) if m and m not in json.dumps(t.model_dump(exclude={'subagent_trajectories'}))]
    loader_n = sum(m in native for m in own)
    conv_n = sum(m in conv for m in own)
    if helpers:
        print(f"- Each helper's last reply: session loader `{loader.__name__}.atif_to_native_trajectory` {loader_n} of {len(own)}; trace exporter `extract_conversations_from_trajectory` ({episodes} conversations) {conv_n} of {len(own)}.")
        readers = ["its checker", "its usage summary" if out == t.final_metrics.total_completion_tokens else None, "its session loader" if loader_n == len(own) else None, "its trace exporter" if conv_n == len(own) else None]
        skips = [None if out == t.final_metrics.total_completion_tokens else "its usage summary (in part)", None if loader_n == len(own) else "its session loader", None if conv_n == len(own) else "its trace exporter"]
        print(f"\nDoes Harbor's count include both helpers' steps? Its main step list ({n(len(t.steps), 'step')}, {n(calls(t), 'tool call')}) and `final_metrics.total_steps` do not. Its model's full tree ({n(total, 'step')}, {n(total_calls, 'tool call')}) does. Harbor reads the helpers in {words(readers)}, and not in {words(skips)}.", end="")
        if loader_n < len(own) or conv_n < len(own):
            print(f" A flat export option, with the helpers' steps inline, is {FLAT_TICKET}.", end="")
        if out != t.final_metrics.total_completion_tokens:
            print(f" The usage summary counts {out} output tokens of {t.final_metrics.total_completion_tokens}: it skips a helper's steps when the helper names no model.", end="")
        print()
    print()

def controls(folder):
    print("## Controls\n")
    src = json.loads((folder / "nest-claude.json").read_text())
    with tempfile.TemporaryDirectory() as d:
        bad = Path(d) / "bad-helper-step.json"
        c = json.loads(json.dumps(src)); c["subagent_trajectories"][0]["steps"][1]["step_id"] = 9
        bad.write_text(json.dumps(c))
        code, line = checker(bad)
        print(f"- The Claude export with its first helper's second step renumbered to 9: Harbor's checker exit {code} (expected 1, so the checker reads inside helpers).")
        if code != 1:
            fail("control: the checker accepted a helper with a broken step id")
        gone = Path(d) / "no-helpers.json"
        c = json.loads(json.dumps(src)); del c["subagent_trajectories"]
        gone.write_text(json.dumps(c))
        code, _ = checker(gone)
        t = Trajectory.model_validate_json(gone.read_text())
        print(f"- The Claude export with its helpers deleted: Harbor's checker exit {code}; this report's helper check finds {len(list(tree(t))) - 1} helpers (expected 0 of 2, so this report, not the checker, notices lost helpers).")
        if len(list(tree(t))) - 1 == 2:
            fail("control: the helper check did not notice deleted helpers")
    print()

folder = Path(sys.argv[1])
print(f"# What Harbor accepts and sees in our ATIF exports\n\nHarbor {version('harbor')} at 110c71b32c268e1d113c3856869202842f8e37a6, Python {sys.version.split()[0]}.\n")
for args in INPUTS:
    report(folder, *args)
claude = folder / "nest-claude.json"
if claude.exists() and len(json.loads(claude.read_text()).get("subagent_trajectories") or []) == 2:
    controls(folder)
else:
    print("## Controls\n\n- Skipped: the Claude export does not hold its two helpers.\n")
print("Result: " + ("pass" if not failures else "FAIL, " + "; ".join(failures)))
sys.exit(1 if failures else 0)
