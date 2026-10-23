# pufferpanel-dev

> **Not an official PufferPanel project.** This is the personal setup I use to work on PufferPanel pull requests
> under Linux, shared as-is. It is not maintained or supported by the PufferPanel team; for the official ways to
> build and contribute, see the [PufferPanel repository](https://github.com/PufferPanel/PufferPanel).

Development setup for PufferPanel v3 with hot reload, for working on a pull request:

- **Frontend** (`client/frontend`, `client/api`): the Vite dev server serves the source files unbundled. A change to a
  `.vue` or `.js` file updates the open page in place, without a reload.
- **Backend** (Go): air rebuilds the binary and restarts the panel on every `*.go` change.

The start script runs either your PR branch or stock upstream (`v3`) side by side, e.g. to compare behaviour.
Nothing in the PufferPanel clones is changed: the configs live in this repo, and the only output written into a
clone is gitignored (`out/`, `node_modules/.vite/`).

```
browser ──> http://localhost:5173   Vite dev server: index.html, client-side routes, /src, public/
                │ proxy for /api (incl. WebSocket), /auth POST/PUT, /oauth2, /daemon, /swagger, /manifest.json, /theme
                └─> http://localhost:8080   PufferPanel, run by air from out/
```

## Files

| File | Purpose |
|---|---|
| `start-puffer-upstream.py` | Start script: picks the clone (`upstream` or `pr`), builds the frontend once, asks for a first admin, starts the panel; with `--watch` runs air and the Vite dev server together |
| `vite.dev.config.mjs` | Loads the clone's `client/frontend/vite.config.js` unchanged and adds the dev server on :5173, the proxy to :8080 and two dev-only fixes (see [Known issues](#known-issues)) |
| `air.toml` | Builds `./cmd` into `out/.air/pufferpanel` and runs `runService` with working directory `out/`; watches `*.go` only |
| `hotkeys-dev-server-bug.md` | Upstream bug report for the `hotkeys.js` issue below |
| `CONTRIBUTING.md` | How to contribute, especially a tested Windows setup |

## Setup

### 1. Folder layout

This repo and both PufferPanel folders sit side by side in one parent folder:

```
<parent>/
├── pufferpanel-dev/          this repo
├── PufferPanel/              your fork, on your PR branch (e.g. pr/my-feature)
└── PufferPanel-upstream/     stock upstream v3, a git worktree of PufferPanel/ (created by the script)
```

### 2. Tools

| Tool | Version | Install / note |
|---|---|---|
| Python | 3.9+ | runs the start script |
| Go | as in `go.mod` (1.26 or newer) | |
| Node.js | 20.19+ or 22.12+ | required by Vite 7 |
| mise | any | the script runs Yarn as `mise exec yarn@1.22.22 -- yarn` |
| Yarn | 1.22.22 | `mise install yarn@1.22.22`. The repo's `packageManager`; Yarn 2+ cannot run its workspace scripts |
| air | v1.67.4 | `go install github.com/air-verse/air@v1.67.4` (lands in `$(go env GOPATH)/bin`; the script also looks there) |

### 3. Clone your fork and add upstream

Fork https://github.com/PufferPanel/PufferPanel on GitHub first, then in `<parent>`:

```bash
git clone git@github.com:<your-user>/PufferPanel.git PufferPanel
git -C PufferPanel remote add upstream https://github.com/PufferPanel/PufferPanel.git
git -C PufferPanel fetch upstream
```

### 4. Create the branch for your PR

PRs go against upstream's `v3`, so branch off `upstream/v3`:

```bash
git -C PufferPanel switch -c pr/my-feature upstream/v3
```

### 5. First start

```bash
cd pufferpanel-dev
./start-puffer-upstream.py pr --watch     # your branch in PufferPanel/
```

The first run installs the frontend dependencies (`yarn install --frozen-lockfile`), builds the frontend once (Go
embeds `client/frontend/dist` and does not compile without it) and asks for a first user: answer "admin" with yes.
Then it starts air and the Vite dev server. Open **http://localhost:5173**.

For stock upstream to compare against:

```bash
./start-puffer-upstream.py --watch        # PufferPanel-upstream/ (v3)
```

Its first run creates the worktree `../PufferPanel-upstream` from `upstream/v3`, builds there and asks for a first
user. Each folder has its own data (`out/pufferpanel.db`, servers), so accounts are separate.

## Windows (WSL2)

On Windows, run everything inside WSL2. There it is plain Linux, and the setup above applies unchanged:

- Install the tools from step 2 inside the WSL distribution (Go, Node.js, mise, Yarn, air), not on Windows. A Windows
  `go.exe` or `node.exe` on the `PATH` does not help here.
- Put `<parent>` in the Linux filesystem, e.g. `~/git/`, not under `/mnt/c/...`. File changes made from the Windows
  side under `/mnt/c` send no inotify events into WSL, so neither Vite HMR nor air notices them, and `yarn install`
  and `go build` are much slower there.
- Edit the files from the Linux side, e.g. VS Code with the WSL extension (`code .` inside WSL), so the editor works
  on the same filesystem.
- Open http://localhost:5173 in the Windows browser; WSL2 forwards `localhost` to Windows. If the page does not load,
  Vite is probably listening on `::1` only (see [Usage](#usage)). Switch WSL to mirrored networking in
  `%UserProfile%\.wslconfig` and restart WSL with `wsl --shutdown`:

  ```ini
  [wsl2]
  networkingMode=mirrored
  ```

The script and `air.toml` also contain code for native Windows (without WSL), but nobody has tested it. If you get
WSL2 or native Windows working, a pull request is welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Usage

```
./start-puffer-upstream.py [upstream|pr] [--rebuild] [--update] [--add-user] [--watch]
```

| Option | Effect |
|---|---|
| `upstream` (default) / `pr` | which clone: `../PufferPanel-upstream` or `../PufferPanel` |
| `--watch` | hot reload: Vite on :5173 + air on :8080. Without it, the panel runs once on :8080 from the embedded build |
| `--rebuild` | build the frontend again first (needed without `--watch` to see frontend changes on :8080) |
| `--update` | upstream only: move the worktree to the latest `upstream/v3`, rebuild |
| `--add-user` | add another user before starting |

Only one target runs at a time: both use ports 8080 and 5173. Ctrl+C stops everything the script started.

Open http://localhost:5173 in watch mode, not :8080: port 8080 serves the frontend embedded in the Go binary, without
hot reload. Vite listens on `localhost` only; depending on the system that is `::1`, so `127.0.0.1:5173` may not
answer.

### Keeping your branch current

```bash
git -C ../PufferPanel fetch upstream
git -C ../PufferPanel rebase upstream/v3        # on pr/my-feature
./start-puffer-upstream.py --update             # moves PufferPanel-upstream to the same upstream/v3
```

## Check that it works

1. The login page loads on http://localhost:5173 and the browser console shows `[vite] connected.`
2. Log in with the admin from the first start; the server list loads.
3. Change a visible text in a component of the clone you started, e.g. `client/frontend/src/views/Login.vue`. The
   page updates without a reload and the console shows `[vite] hot updated: /src/views/Login.vue`. air stays quiet.
4. Change a log message in a `.go` file, e.g. `cmd/run.go` (`"Listening for HTTP requests on %s"`). The terminal
   shows `building...`, `running...` and the new message. After a page reload you are still logged in.
   A visible alternative: change `"background_color"` in `webManifest` in `web/loader.go`, then open
   http://localhost:5173/manifest.json.
5. Revert both changes (`git checkout -- <files>`); `git status` is clean.

## Without the script

Any PufferPanel v3 clone works with the two config files alone. These are the steps the script runs, in order.
Run Yarn through mise as Yarn 1.22.22, like the script does (a plain `yarn` resolves to mise's latest, and Yarn 2+
cannot run the repo's workspace scripts). Set these in every terminal you use:

```bash
DEV=/path/to/pufferpanel-dev                     # this repo
alias yarn1='mise exec yarn@1.22.22 -- yarn'
```

### Upstream worktree (only for stock upstream)

Skip this for your PR branch. From `<parent>`, the first time:

```bash
git -C PufferPanel fetch upstream
git -C PufferPanel worktree add --detach ../PufferPanel-upstream upstream/v3
```

To move it to the latest `upstream/v3` later (what `--update` does), check for local changes first, then rebuild the
frontend (next step):

```bash
git -C PufferPanel fetch upstream
git -C PufferPanel-upstream status --short       # must be clean apart from client/yarn.lock
git -C PufferPanel-upstream checkout -- client/yarn.lock client/api/package.json
git -C PufferPanel-upstream checkout --detach upstream/v3
```

### Frontend build

Run this from the root of the clone, on the first start and whenever the frontend changed outside watch mode (what
`--rebuild` does). Go embeds `client/frontend/dist` and does not compile without it.

```bash
cd client && yarn1 install --frozen-lockfile && yarn1 build && cd ..
```

If Yarn 4 ever ran in the clone (`client/.yarnrc.yml` or `client/.yarn/` exists, or `client/yarn.lock` shows as
changed), undo its changes before building:

```bash
git checkout -- client/yarn.lock client/api/package.json
rm -rf client/.yarnrc.yml client/.yarn client/node_modules client/api/node_modules client/frontend/node_modules
```

### Users

Add the first admin from the root of the clone (answer "admin" with yes). Run the same command again for each extra
user (what `--add-user` does):

```bash
mkdir -p out && cd out && go run ../cmd user add && cd ..
```

### Start

Check that ports 8080 and 5173 are free first. The script refuses to start otherwise; done by hand, the second
panel fails to bind or Vite exits (`strictPort`).

Without hot reload, from the root of the clone (the panel on :8080 serves the embedded build):

```bash
cd out && go run ../cmd runService
```

With hot reload (what `--watch` does), in two terminals from the root of the clone, then open http://localhost:5173:

```bash
air -c "$DEV/air.toml"                                                # backend on :8080
```

```bash
cd client/frontend && yarn1 vite --config "$DEV/vite.dev.config.mjs"  # frontend on :5173
```

`air -v` must show v1.67.4. If `go` or `air` fail with a missing `GOROOT`, run `unset GOROOT GOBIN` or open a new
shell (the script drops a stale `GOROOT` on its own).

## How the routing works

The SPA and the Go backend share some paths, so the proxy is split:

- **Vite** serves `index.html` for every client-side route (`/servers`, `/auth/login`, ...), the source modules
  (`/src`, `/@vite`, `/node_modules`) and everything in `client/frontend/public` (fonts, images, Ace, favicons).
- **Go** gets `/api` (including the server console WebSocket `/api/servers/<id>/socket`), `/oauth2`, `/daemon`,
  `/swagger`, `/manifest.json` and `/theme`.
- **`/auth`** is shared: a browser page load (`GET` with `Accept: text/html`) goes to Vite, everything else (login,
  logout, OTP, passkey, register, `publickey`) goes to Go.

`changeOrigin` stays off, so Go sees `Host: localhost:5173` and its session cookies (`puffer_auth`, host-only) are
set for the page you are on.

If your PR adds a new top-level backend route, add it to `server.proxy` in `vite.dev.config.mjs`.

## Known issues

Both are handled in `vite.dev.config.mjs` and only affect the dev server; production builds work without them.

- **App does not mount: `TypeError: ... i._ is undefined` in `hotkeys.js:20`.** Upstream bug in
  `client/frontend/src/plugins/hotkeys.js`: it reads Vue's private `_` from `binding.instance`, which under the dev
  server is Vue's `exposeProxy` without `_`. The config rewrites line 42 while serving it, from
  `getGroup(binding.instance)` to `getGroup(binding.instance.$.proxy)`. The file itself is not changed. If upstream
  changes that line, Vite prints `pufferpanel-dev: "getGroup(binding.instance)" not found in hotkeys.js`; check whether
  the bug is fixed upstream and drop the plugin. Details: `hotkeys-dev-server-bug.md`.
- **WebAssembly errors (`expected magic word 00 61 73 6d`).** `pufferpanel-conditions` loads its `.wasm` relative to
  its own module. Vite's dependency pre-bundling moves the module but not the `.wasm`, so the request returned
  `index.html`. The config excludes the package from pre-bundling.

Harmless warnings:

- air: `build.bin is deprecated; set build.entrypoint instead` (the config uses `full_bin`, which needs `cd out`).
- Node: `MODULE_TYPELESS_PACKAGE_JSON` for `client/frontend/vite.config.js` (the package has no `"type"` field).
- Vue: `Invalid prop: type check failed for prop "name"` from `<Icon>` inside `<TextField>` on the login page
  (upstream; production builds hide Vue warnings).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `port 8080/5173 is already in use` | the other target or another dev server still runs; stop it first |
| `.../PufferPanel not found` | step 3 of the setup; the clone must be named `PufferPanel` and sit next to this repo |
| `has no remote upstream` | `git -C ../PufferPanel remote add upstream https://github.com/PufferPanel/PufferPanel.git` |
| `air v1.67.4 not found` | `go install github.com/air-verse/air@v1.67.4` |
| `Yarn 1.22.22 is not available through mise` | `mise install yarn@1.22.22` |
| `note: GOROOT=... does not exist; ignoring it` | your shell has a `GOROOT` from a removed Go version (e.g. after a mise update); the script works around it, a new shell clears it |
| Go errors about `client/frontend/dist` | the frontend was never built: `--rebuild` |
| Login works on :8080 but not on :5173 | open the app only on :5173 so the cookie belongs to that origin |
| Changes do not appear | you are editing the other clone: `pr` serves `PufferPanel/`, `upstream` serves `PufferPanel-upstream/` |
| WSL2: changes do not appear, or everything is slow | the clones are under `/mnt/c`; move them into the Linux filesystem (see [Windows (WSL2)](#windows-wsl2)) |
| WSL2: `localhost:5173` does not load in the Windows browser | Vite listens on `::1`; use `networkingMode=mirrored` (see [Windows (WSL2)](#windows-wsl2)) |

Tested on Linux (Fedora) with Python 3.15, Go 1.27.3, Node 25.6.1, Yarn 1.22.22, Vite 7.1.4 and air v1.67.4 against
upstream `v3` (48249666). On Windows use WSL2 (see [Windows (WSL2)](#windows-wsl2)); WSL2 and native Windows are
both untested.
