#!/usr/bin/env python3
"""Starts a local PufferPanel on http://localhost:8080 for testing and development. Expects the clones next to this
repo (see README.md): ../PufferPanel (your fork, remote `upstream` = PufferPanel/PufferPanel) and
../PufferPanel-upstream (created on the first run). Two targets (one at a time: both use port 8080):

  upstream (default)  stock PufferPanel, upstream branch v3, in its own git worktree PufferPanel-upstream/ next to the
                      PR checkout. The PR folder is only touched by `git fetch upstream` and the worktree entry in its
                      .git. First run: creates the worktree, builds the frontend from upstream's lock file, asks for a
                      first admin, starts the panel.
  pr [FOLDER]         a PR checkout on whatever branch it is (e.g. pr/my-feature), as it is: no git commands, no lock
                      file changes. FOLDER defaults to PufferPanel/; give another checkout or worktree of the fork, e.g.
                      `pr PufferPanel-fix-hotkeys` (a bare name is looked up next to this repo, otherwise the path is
                      taken as given). A first run or --rebuild builds client/frontend/dist there; each folder has its
                      own data in out/.
                      If FOLDER does not exist and the upstream folder does, FOLDER is created as a git worktree from
                      it, at the upstream commit it is on, on the branch pr/<FOLDER without "PufferPanel-">
                      (`pr PufferPanel-fix-hotkeys` -> pr/fix-hotkeys) or --branch NAME; an existing branch is checked
                      out instead of created.

  list                lists the worktrees linked to PufferPanel/ (the PR folders and PufferPanel-upstream/): branch,
                      commit, uncommitted changes, a missing folder, a dev instance running in it.
  remove FOLDER       unlinks the worktree FOLDER (looked up like `pr FOLDER`) from PufferPanel/. Default: the files
                      stay as a plain folder without git; --delete-dir deletes the folder too (git refuses when it has
                      uncommitted changes; gitignored files such as out/ with the panel data go with it). A worktree
                      whose folder is already gone just loses its entry. The branch stays in either case.

  ./start-puffer-upstream.py [upstream | pr [FOLDER] [--branch NAME]] [--rebuild] [--update] [--add-user] [--watch]
                             [--force]
  ./start-puffer-upstream.py list
  ./start-puffer-upstream.py remove FOLDER [--delete-dir | -rm]
    --branch     pr FOLDER only, when FOLDER is created: the branch for it (default pr/<FOLDER without "PufferPanel-">)
    --rebuild    rebuild the frontend first
    --update     upstream only: move the worktree to the latest upstream/v3, rebuild
    --add-user   add another user before starting
    --force      first stop a dev instance that is still running (e.g. in another terminal, or left over after the
                 terminal was closed): other start scripts get Ctrl+C, then air and Vite started with the configs here
                 and panels running in a <clone>/out folder next to this repo; whatever still runs after 8 s is killed.
                 Nothing else is touched. Linux only (reads /proc).
    --delete-dir, -rm
                 remove only: delete the worktree folder as well (default: keep the files)
    --watch      hot reload for development, for either target. Open http://localhost:5173 (Vite dev server, HMR for
                 client/frontend and client/api of that folder); it proxies the backend routes to the panel on :8080,
                 which air rebuilds and restarts on every *.go change. Configs: vite.dev.config.mjs and air.toml next
                 to this script (outside the PufferPanel clones). Writes only gitignored output into the folder
                 (out/.air/, node_modules/.vite/). Needs air v1.67.4: go install github.com/air-verse/air@v1.67.4
Yarn runs as `mise exec yarn@1.22.22 -- yarn` (the repo's packageManager; Yarn 4 cannot run its
`yarn workspaces run` scripts, and a plain `yarn` in scripts resolves to mise's latest). Data (SQLite pufferpanel.db,
servers, cache) stays in <folder>/out/. Ctrl+C stops the panel (with --watch: air and Vite).
"""
import argparse
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from contextlib import closing
from pathlib import Path

DEV = Path(__file__).resolve().parent  # this repo: the configs
BASE = DEV.parent                       # the folder that holds this repo and the PufferPanel clones
PR = BASE / "PufferPanel"
UP = BASE / "PufferPanel-upstream"
THEME = BASE / "pufferpanel-theme"      # optional: theme dev server, only hinted at when THEME_DEV exists
THEME_DEV = THEME / "dev.py"
PANEL_PORT = 8080                       # the panel's default bind; vite.dev.config.mjs proxies to it
VITE_PORT = 5173                        # server.port in vite.dev.config.mjs
THEME_PORT = 8100
YARN_VERSION = "1.22.22"
AIR_VERSION = "v1.67.4"
WINDOWS = os.name == "nt"


def say(msg):
    print(f"\n==> {msg}", flush=True)


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def go_env():
    """Environment for go/air: drops GOROOT (and the GOBIN inside it) when it points to a Go that no longer exists,
    e.g. a mise version removed after this shell or editor was started."""
    env = dict(os.environ)
    goroot = env.get("GOROOT")
    if goroot and not Path(goroot).is_dir():
        print(f"note: GOROOT={goroot} does not exist; ignoring it (restart the shell/editor to clear it)", file=sys.stderr)
        del env["GOROOT"]
        if env.get("GOBIN", "").startswith(goroot):
            del env["GOBIN"]
    return env


ENV = go_env()


def run(cmd, cwd=None, check=True, capture=False):
    r = subprocess.run(cmd, cwd=cwd, env=ENV, check=check, text=True,
                       stdout=subprocess.PIPE if capture else None)
    return r.stdout.strip() if capture else r.returncode


def git(d, *args, capture=False):
    return run(["git", "-C", str(d), *args], capture=capture)


def yarn1(*args, cwd):
    run(["mise", "exec", f"yarn@{YARN_VERSION}", "--", "yarn", *args], cwd=cwd)


def port_in_use(port):
    for host in ("127.0.0.1", "::1"):
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            pass
    return False


def has_users(db):
    """False when the SQLite database is missing or has no user yet (e.g. created by a run without `user add`)."""
    if not db.is_file():
        return False
    try:
        with closing(sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)) as con:
            return con.execute("select count(*) from users").fetchone()[0] > 0
    except sqlite3.Error:
        return True  # unknown schema: leave it to the panel


def find_air():
    exe = "air.exe" if WINDOWS else "air"
    candidates = [shutil.which("air")]
    gobin = ENV.get("GOBIN") or str(Path(run(["go", "env", "GOPATH"], capture=True).split(os.pathsep)[0]) / "bin")
    candidates.append(str(Path(gobin) / exe))
    for c in candidates:
        if c and Path(c).is_file():
            out = subprocess.run([c, "-v"], env=ENV, text=True, capture_output=True).stdout
            if AIR_VERSION in out:
                return c
    die(f"air {AIR_VERSION} not found; install it: go install github.com/air-verse/air@{AIR_VERSION}")


def parse_args():
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("target", nargs="?", choices=("upstream", "pr", "list", "remove"), default="upstream")
    p.add_argument("folder", nargs="?")
    p.add_argument("--branch")
    p.add_argument("--rebuild", action="store_true")
    p.add_argument("--update", action="store_true")
    p.add_argument("--add-user", action="store_true")
    p.add_argument("--watch", action="store_true")
    p.add_argument("--force", action="store_true")
    p.add_argument("--delete-dir", "-rm", action="store_true")
    p.add_argument("-h", "--help", action="store_true")
    a, unknown = p.parse_known_args()
    if a.help:
        print(__doc__.strip())
        sys.exit(0)
    if unknown:
        die(f"unknown option: {' '.join(unknown)} (see --help)")
    if a.target in ("list", "remove"):
        start_options = [o for o in ("branch", "rebuild", "update", "add_user", "watch", "force") if getattr(a, o)]
        if start_options:
            die(f"--{start_options[0].replace('_', '-')} does not apply to {a.target}")
        if a.target == "remove" and not a.folder:
            die("remove needs the worktree folder: start-puffer-upstream.py remove FOLDER [--delete-dir | -rm]")
        if a.target == "list" and (a.folder or a.delete_dir):
            die("list takes no folder and no options")
    elif a.delete_dir:
        die("--delete-dir/-rm only applies to remove: start-puffer-upstream.py remove FOLDER -rm")
    if a.folder and a.target not in ("pr", "remove"):
        die("a folder can only be given for the pr target: start-puffer-upstream.py pr FOLDER")
    if a.branch and not a.folder:
        die("--branch only applies when a new pr FOLDER is created: start-puffer-upstream.py pr FOLDER --branch NAME")
    if a.update:
        a.rebuild = True
    return a


def resolve_folder(name):
    """A bare name is looked up next to this repo, any other path is taken as given."""
    p = Path(name).expanduser()
    if len(p.parts) == 1 and not p.is_absolute():
        p = BASE / p
    return p.resolve()


def pr_folder(name, branch=None):
    """The PR checkout to run: PufferPanel/ by default; a bare name is looked up next to this repo, a path as given.
    A folder that does not exist yet is created as a worktree from the upstream folder (see create_pr_worktree)."""
    if not name:
        return PR
    p = resolve_folder(name)
    if not p.exists():
        create_pr_worktree(p, branch)
    elif branch:
        die(f"--branch only applies when {p} is created; it exists already")
    if not (p / ".git").exists() or not (p / "client" / "frontend").is_dir():
        die(f"{p} is not a PufferPanel checkout (no .git or client/frontend)")
    return p


def create_pr_worktree(p, branch):
    """Creates the PR folder p as a git worktree from the upstream folder (PufferPanel-upstream/, itself a worktree of
    the fork), at the upstream commit it is on. Branch: --branch, else pr/<folder name without "PufferPanel-">; an
    existing branch is checked out instead of created."""
    if not (UP / ".git").exists():
        die(f"{p} does not exist and there is no upstream folder {UP} to create it from; "
            f"run `start-puffer-upstream.py upstream` once first, or create the worktree yourself (see README.md)")
    if not p.parent.is_dir():
        die(f"{p.parent} does not exist")
    if not branch:
        stem = p.name[len("PufferPanel-"):] if p.name.startswith("PufferPanel-") else p.name
        branch = f"pr/{stem.lower()}"
    base = git(UP, "rev-parse", "HEAD", capture=True)
    # a folder deleted by hand stays registered as worktree ("prunable"); -f reuses exactly that entry
    registered = f"worktree {p}" in git(UP, "worktree", "list", "--porcelain", capture=True).splitlines()
    force = ["-f"] if registered else []
    if registered:
        say(f"{p} is still registered as a git worktree but the folder is gone; reusing the entry")
    exists = subprocess.run(["git", "-C", str(UP), "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"],
                            env=ENV).returncode == 0
    if exists:
        say(f"creating the worktree {p} on the existing branch {branch}")
        git(UP, "worktree", "add", *force, str(p), branch)
    else:
        say(f"creating the worktree {p}: new branch {branch} from the upstream folder "
            f"({git(UP, 'log', '--oneline', '-1', capture=True)})")
        # from the commit, not from upstream/v3: the branch then tracks nothing, so a later `git push -u origin`
        # sets it to the fork instead of PufferPanel/PufferPanel
        git(UP, "worktree", "add", *force, "-b", branch, str(p), base)


def prepare_upstream(d, a):
    if (not d.is_dir() or a.update) and subprocess.run(["git", "-C", str(PR), "remote", "get-url", "upstream"],
                                                        capture_output=True).returncode != 0:
        die(f"{PR} has no remote `upstream`; add it: "
            f"git -C {PR} remote add upstream https://github.com/PufferPanel/PufferPanel.git")
    if not d.is_dir():
        say(f"creating the upstream worktree {d} (upstream/v3)")
        git(PR, "fetch", "upstream")
        git(PR, "worktree", "add", "--detach", str(d), "upstream/v3")
    elif a.update:
        say(f"updating {d} to the latest upstream/v3")
        git(PR, "fetch", "upstream")
        if git(d, "status", "--porcelain", "--untracked-files=no", "--", ".", ":!client/yarn.lock",
               ":!client/api/package.json", capture=True):
            print(f"local changes in {d}; commit or discard them first:", file=sys.stderr)
            git(d, "status", "--short")
            sys.exit(1)
        git(d, "checkout", "-q", "--", "client/yarn.lock", "client/api/package.json")
        git(d, "checkout", "-q", "--detach", "upstream/v3")
    print(f"upstream: {git(d, 'log', '--oneline', '-1', capture=True)}")
    # a Yarn 4 run rewrites the lock file and leaves .yarn/ and .yarnrc.yml: back to upstream's files
    client = d / "client"
    if (git(d, "status", "--porcelain", "--", "client/yarn.lock", "client/api/package.json", capture=True)
            or (client / ".yarnrc.yml").exists() or (client / ".yarn").is_dir()):
        say("restoring upstream's yarn.lock and removing Yarn 4 leftovers")
        git(d, "checkout", "-q", "--", "client/yarn.lock", "client/api/package.json")
        (client / ".yarnrc.yml").unlink(missing_ok=True)
        for sub in (".yarn", "node_modules", "api/node_modules", "frontend/node_modules"):
            shutil.rmtree(client / sub, ignore_errors=True)
        a.rebuild = True


def start(cmd, cwd, env=ENV):
    """Starts a child in its own process group/session so Ctrl+C is handled here and stop() reaches its children."""
    if WINDOWS:
        return subprocess.Popen(cmd, cwd=cwd, env=env, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
    return subprocess.Popen(cmd, cwd=cwd, env=env, start_new_session=True)


def group_alive(pgid):
    """True while any process of the group still runs (e.g. vite after its parent yarn exited)."""
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def stopped(p, deadline):
    """Waits for the child and, on POSIX, for the rest of its process group."""
    try:
        p.wait(timeout=max(0.1, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        return False
    if WINDOWS:
        return True
    while group_alive(p.pid):
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.1)
    return True


def stop(procs):
    """Stops only the processes this script started (and their process groups)."""
    if not WINDOWS:
        # a second Ctrl+C must not abort the cleanup half way and leave children running
        signal.signal(signal.SIGINT, signal.SIG_IGN)
    for name, p in procs:
        if p.poll() is not None and (WINDOWS or not group_alive(p.pid)):
            continue
        print(f"stopping {name} (pid {p.pid})", flush=True)
        if WINDOWS:
            subprocess.run(["taskkill", "/T", "/PID", str(p.pid)], capture_output=True)
        else:
            os.killpg(p.pid, signal.SIGINT)
    deadline = time.monotonic() + 8
    for name, p in procs:
        if stopped(p, deadline):
            continue
        print(f"{name} (pid {p.pid}) did not stop; killing it", flush=True)
        if WINDOWS:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], capture_output=True)
        elif group_alive(p.pid):
            os.killpg(p.pid, signal.SIGKILL)
        p.wait()


def dev_processes():
    """Running processes of this dev setup, as (pid, kind, command line, working directory); never this process."""
    found = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            args = [x.decode(errors="replace") for x in (entry / "cmdline").read_bytes().split(b"\0") if x]
            cwd = Path(os.readlink(entry / "cwd"))
        except OSError:
            continue
        if not args:
            continue
        kind = None
        if any(Path(x).name == Path(__file__).name for x in args[:2]):
            kind = "start script"
        elif str(DEV / "air.toml") in args:
            kind = "air"
        elif str(DEV / "vite.dev.config.mjs") in args:
            kind = "vite"
        elif args[-1] == "runService" and cwd.name == "out" and cwd.parent.parent == BASE:
            kind = f"panel ({cwd.parent.name})"
        if kind:
            found.append((int(entry.name), kind, " ".join(args), cwd))
    return found


def signal_all(procs, sig):
    for pid, *_ in procs:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            pass


def wait_gone(pids, seconds):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        alive = {pid for pid, *_ in dev_processes()} & pids
        if not alive:
            return set()
        time.sleep(0.2)
    return {pid for pid, *_ in dev_processes()} & pids


def stop_running():
    """--force: stops running dev instances, start scripts first so their own cleanup runs."""
    if not Path("/proc").is_dir():
        die("--force needs /proc (Linux); stop the other instance with Ctrl+C in its terminal")
    procs = dev_processes()
    if not procs:
        return
    for pid, kind, cmd, _ in procs:
        print(f"stopping {kind} (pid {pid}): {cmd}", flush=True)
    scripts = [p for p in procs if p[1] == "start script"]
    signal_all(scripts, signal.SIGINT)
    wait_gone({pid for pid, *_ in scripts}, 12)
    # whatever the scripts did not stop: leftovers of a closed terminal or of an older version of this script
    rest = [p for p in dev_processes() if p[1] != "start script"]
    signal_all(rest, signal.SIGINT)
    left = wait_gone({pid for pid, *_ in dev_processes()}, 8)
    for p in dev_processes():
        if p[0] in left:
            print(f"{p[1]} (pid {p[0]}) did not stop; killing it", flush=True)
            signal_all([p], signal.SIGKILL)
    say("stopped the running dev instance")


def worktrees():
    """The checkouts of the fork from `git worktree list --porcelain`, as dicts with the keys worktree, HEAD and
    branch/detached, prunable, locked where set (value True or git's text) and main (PufferPanel/ itself, first)."""
    trees = []
    for block in git(PR, "worktree", "list", "--porcelain", capture=True).split("\n\n"):
        t = {"main": not trees}
        for line in block.splitlines():
            key, _, value = line.partition(" ")
            t[key] = value or True
        t["path"] = Path(t["worktree"])
        trees.append(t)
    return trees


def running_in(d, procs):
    """The processes of procs (from dev_processes) that work inside the checkout d: air, Vite, the panel."""
    return [p for p in procs if p[3] == d or d in p[3].parents]


def list_worktrees():
    procs = dev_processes() if Path("/proc").is_dir() else []
    rows = []
    for t in worktrees():
        p = t["path"]
        notes = []
        if t["main"]:
            notes.append("main checkout, not removable")
        if p == UP:
            notes.append("upstream target")
        if "prunable" in t:
            notes.append("folder missing")
        else:
            changes = git(p, "status", "--porcelain", capture=True).splitlines()
            if changes:
                notes.append(f"{len(changes)} uncommitted")
        if "locked" in t:
            notes.append("locked")
        if running_in(p, procs):
            notes.append("running")
        rows.append((p.name if p.parent == BASE else str(p),
                     t["branch"].removeprefix("refs/heads/") if "branch" in t else "(detached)",
                     git(PR, "log", "-1", "--format=%h %<(60,trunc)%s", t["HEAD"], capture=True),
                     ", ".join(notes)))
    widths = [max(len(r[i]) for r in rows) for i in range(2)]
    for name, branch, commit, notes in rows:
        print(f"{name:<{widths[0]}}  {branch:<{widths[1]}}  {commit}" + (f"  [{notes}]" if notes else ""))


def remove_worktree(name, delete_dir):
    """Unlinks the worktree name from the fork; keeps its files unless delete_dir. The branch always stays."""
    p = resolve_folder(name)
    t = next((t for t in worktrees() if t["path"] == p), None)
    if not t:
        die(f"{p} is not a worktree of {PR}; see `start-puffer-upstream.py list`")
    if t["main"]:
        die(f"{p} is the main checkout that holds the git data of all worktrees; it cannot be removed")
    if "locked" in t:
        die(f"{p} is locked; unlock it first: git -C {PR} worktree unlock {p}")
    branch = t["branch"].removeprefix("refs/heads/") if "branch" in t else None
    kept = f"; the branch {branch} stays" if branch else ""
    if "prunable" in t:
        git(PR, "worktree", "remove", str(p))
        say(f"removed the entry of {p} (the folder was already gone){kept}")
        return
    running = running_in(p, dev_processes()) if Path("/proc").is_dir() else []
    if running:
        for pid, kind, cmd, _ in running:
            print(f"running in {p}: {kind} (pid {pid}): {cmd}", file=sys.stderr)
        die("stop it first (Ctrl+C in its terminal); nothing was removed")
    changes = git(p, "status", "--porcelain", capture=True)
    if delete_dir:
        if changes:
            print(f"uncommitted changes in {p}:", file=sys.stderr)
            git(p, "status", "--short")
            die("commit, stash or discard them first; nothing was removed")
        data = " and its panel data in out/" if (p / "out").is_dir() else ""
        say(f"deleting {p}{data}")
        git(PR, "worktree", "remove", str(p))
        say(f"removed the worktree {p}{kept}")
        return
    # git has no "remove but keep the files": drop the worktree's entry in the fork's .git and the .git file that
    # points to it, then the folder is plain files
    gitdir = Path(git(p, "rev-parse", "--absolute-git-dir", capture=True))
    if gitdir.parent.name != "worktrees" or not (p / ".git").is_file():
        die(f"unexpected git layout in {p} (git dir {gitdir}); nothing was removed")
    (p / ".git").unlink()
    shutil.rmtree(gitdir)
    say(f"unlinked {p}: no longer a git worktree, the files stay{kept}")
    if changes:
        print(f"note: its {len(changes.splitlines())} uncommitted changes are only in the files now, not in git")
    print(f"delete the folder later with: rm -rf {p}")


def interrupt(signum, frame):
    """Closing the terminal (SIGHUP) or kill (SIGTERM) stops the children like Ctrl+C does."""
    raise KeyboardInterrupt


def watch(d, air):
    vite_config = DEV / "vite.dev.config.mjs"
    air_config = DEV / "air.toml"
    for f in (vite_config, air_config):
        if not f.is_file():
            die(f"missing {f}")
    say(f"starting air ({AIR_VERSION}, Go rebuild on change) and the Vite dev server (HMR)")
    if not WINDOWS:
        signal.signal(signal.SIGTERM, interrupt)
        signal.signal(signal.SIGHUP, interrupt)
    procs = []
    try:
        procs.append(("air", start([air, "-c", str(air_config)], cwd=d)))
        procs.append(("vite", start(["mise", "exec", f"yarn@{YARN_VERSION}", "--", "yarn", "vite",
                                     "--config", str(vite_config)], cwd=d / "client" / "frontend")))
        print(f"\n    open http://localhost:{VITE_PORT}   (Vite, HMR; backend routes proxied to the panel on :{PANEL_PORT})\n"
              "    Ctrl+C stops both\n", flush=True)
        while all(p.poll() is None for _, p in procs):
            time.sleep(0.5)
        for name, p in procs:
            if p.poll() is not None:
                print(f"{name} exited with code {p.returncode}; stopping the rest", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        stop(procs)


def main():
    a = parse_args()
    if not (PR / ".git").exists():
        die(f"{PR} not found: clone your PufferPanel fork there first (see {DEV / 'README.md'})")
    if a.target == "list":
        return list_worktrees()
    if a.target == "remove":
        return remove_worktree(a.folder, a.delete_dir)
    try:
        out = run(["mise", "exec", f"yarn@{YARN_VERSION}", "--", "yarn", "--version"], capture=True, check=False)
    except FileNotFoundError:
        out = ""
    if out != YARN_VERSION:
        die(f"Yarn {YARN_VERSION} is not available through mise; install it: mise install yarn@{YARN_VERSION}")

    if a.target == "pr":
        if a.update:
            die("--update only applies to upstream; the PR folder is not changed by this script")
        d = pr_folder(a.folder, a.branch)
        print(f"PR checkout {d}: {git(d, 'branch', '--show-current', capture=True)} "
              f"{git(d, 'log', '--oneline', '-1', capture=True)}")
        if git(d, "status", "--porcelain", "--", "client/yarn.lock", capture=True):
            print(f"note: client/yarn.lock in {d} has local changes (left as they are)", file=sys.stderr)
    else:
        d = UP
        prepare_upstream(d, a)

    air = find_air() if a.watch else None

    # --- frontend ----------------------------------------------------------------------------------------------------
    # one build is needed in every mode: Go embeds client/frontend/dist (//go:embed)
    if a.rebuild or not (d / "client/frontend/dist/index.html").is_file():
        if a.target == "pr":
            print("note: rebuilding client/frontend/dist in the PR checkout")
        say("building the frontend (yarn install --frozen-lockfile, yarn build)")
        yarn1("install", "--frozen-lockfile", cwd=d / "client")
        yarn1("build", cwd=d / "client")
    elif a.watch and not (d / "client/node_modules").is_dir():
        say("installing the frontend dependencies (yarn install --frozen-lockfile)")
        yarn1("install", "--frozen-lockfile", cwd=d / "client")

    # --- first admin, start ------------------------------------------------------------------------------------------
    if a.force:
        stop_running()
    for port in (PANEL_PORT, VITE_PORT) if a.watch else (PANEL_PORT,):
        if port_in_use(port):
            die(f"port {port} is already in use (the other target or another dev server still running?); stop it first, "
                f"or start with --force to stop it")
    out_dir = d / "out"
    out_dir.mkdir(exist_ok=True)
    if a.add_user or not has_users(out_dir / "pufferpanel.db"):
        say("adding a user (interactive; answer 'admin' with yes for the first one)")
        run(["go", "run", "../cmd", "user", "add"], cwd=out_dir)

    if a.watch:
        sys.exit(watch(d, air))

    say(f"starting PufferPanel ({a.target}, {d}) on http://localhost:{PANEL_PORT}; Ctrl+C stops it")
    if THEME_DEV.is_file():
        print(f"themes: cd {THEME} && ./{THEME_DEV.name} --upstream http://localhost:{PANEL_PORT} --port {THEME_PORT}")
    cmd = ["go", "run", "../cmd", "runService"]
    if WINDOWS:
        try:
            sys.exit(subprocess.run(cmd, cwd=out_dir, env=ENV).returncode)
        except KeyboardInterrupt:
            sys.exit(130)
    os.chdir(out_dir)
    os.execvpe(cmd[0], cmd, ENV)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as e:
        die(f"failed ({e.returncode}): {' '.join(map(str, e.cmd))}")
    except KeyboardInterrupt:
        sys.exit(130)
