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

  ./start-puffer-upstream.py [upstream | pr [FOLDER]] [--rebuild] [--update] [--add-user] [--watch]
    --rebuild    rebuild the frontend first
    --update     upstream only: move the worktree to the latest upstream/v3, rebuild
    --add-user   add another user before starting
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
    p.add_argument("target", nargs="?", choices=("upstream", "pr"), default="upstream")
    p.add_argument("folder", nargs="?")
    p.add_argument("--rebuild", action="store_true")
    p.add_argument("--update", action="store_true")
    p.add_argument("--add-user", action="store_true")
    p.add_argument("--watch", action="store_true")
    p.add_argument("-h", "--help", action="store_true")
    a, unknown = p.parse_known_args()
    if a.help:
        print(__doc__.strip())
        sys.exit(0)
    if unknown:
        die(f"unknown option: {' '.join(unknown)} (see --help)")
    if a.folder and a.target != "pr":
        die("a folder can only be given for the pr target: start-puffer-upstream.py pr FOLDER")
    if a.update:
        a.rebuild = True
    return a


def pr_folder(name):
    """The PR checkout to run: PufferPanel/ by default; a bare name is looked up next to this repo, a path as given."""
    if not name:
        return PR
    p = Path(name).expanduser()
    if len(p.parts) == 1 and not p.is_absolute() and (BASE / p).is_dir():
        p = BASE / p
    p = p.resolve()
    if not (p / ".git").exists() or not (p / "client" / "frontend").is_dir():
        die(f"{p} is not a PufferPanel checkout (no .git or client/frontend)")
    return p


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


def stop(procs):
    """Stops only the processes this script started (and their process groups)."""
    for name, p in procs:
        if p.poll() is not None:
            continue
        print(f"stopping {name} (pid {p.pid})", flush=True)
        if WINDOWS:
            subprocess.run(["taskkill", "/T", "/PID", str(p.pid)], capture_output=True)
        else:
            os.killpg(p.pid, signal.SIGINT)
    deadline = time.monotonic() + 8
    for name, p in procs:
        try:
            p.wait(timeout=max(0.1, deadline - time.monotonic()))
        except subprocess.TimeoutExpired:
            print(f"{name} (pid {p.pid}) did not stop; killing it", flush=True)
            if WINDOWS:
                subprocess.run(["taskkill", "/F", "/T", "/PID", str(p.pid)], capture_output=True)
            else:
                os.killpg(p.pid, signal.SIGKILL)
            p.wait()


def watch(d, air):
    vite_config = DEV / "vite.dev.config.mjs"
    air_config = DEV / "air.toml"
    for f in (vite_config, air_config):
        if not f.is_file():
            die(f"missing {f}")
    say(f"starting air ({AIR_VERSION}, Go rebuild on change) and the Vite dev server (HMR)")
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
    try:
        out = run(["mise", "exec", f"yarn@{YARN_VERSION}", "--", "yarn", "--version"], capture=True, check=False)
    except FileNotFoundError:
        out = ""
    if out != YARN_VERSION:
        die(f"Yarn {YARN_VERSION} is not available through mise; install it: mise install yarn@{YARN_VERSION}")
    if not (PR / ".git").exists():
        die(f"{PR} not found: clone your PufferPanel fork there first (see {DEV / 'README.md'})")

    if a.target == "pr":
        if a.update:
            die("--update only applies to upstream; the PR folder is not changed by this script")
        d = pr_folder(a.folder)
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
    for port in (PANEL_PORT, VITE_PORT) if a.watch else (PANEL_PORT,):
        if port_in_use(port):
            die(f"port {port} is already in use (the other target or another dev server still running?); stop it first")
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
