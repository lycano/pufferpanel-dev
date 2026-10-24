# Testing

UI tests for a running dev instance, written with Playwright. They click through every page, tab and action of the
panel on http://localhost:5173 (the Vite dev server, so Vue's development build reports problems production only
logs), and collect every browser console problem per section into one report.

The tests run against the clone you started: `pr FOLDER` tests your PR branch, `upstream` tests stock `v3`.

## Before the first run

1. Pin Yarn 1.22.22 for this folder. In `pufferpanel-dev/`:

   ```bash
   mise use yarn@1.22.22
   ```

   This creates `pufferpanel-dev/mise.toml` (`[tools] yarn = "1.22.22"`), so `yarn` in this folder is Yarn 1.22.22
   instead of the latest Yarn (Yarn 2+ cannot run these scripts). The file is local to your checkout. If a parent
   folder already has a `mise.toml`, `mise use` writes there instead; then run `mise use --path mise.toml yarn@1.22.22`.

2. Install this repo's dependencies (Playwright is one of them) and the browser Playwright drives:

   ```bash
   yarn install
   yarn playwright install chromium
   ```

3. Start a dev instance with hot reload and leave it running in its own terminal:

   ```bash
   ./start-puffer-upstream.py pr PufferPanel-my-fix --watch
   ```

The test admin `e2etest@example.com` is created in that instance on the first run. Its password is generated once
and kept outside the repo in `~/.config/pufferpanel-dev/e2e-user.json`; every worktree gets the same user.

All commands below run in `pufferpanel-dev/`. They assume a shell with mise activated (`mise activate` in your shell
config); without it, put `mise exec --` in front (`mise exec -- yarn test`), which reads the same `mise.toml`.

## Running the tests

### Headless (no window)

```bash
yarn test                                      # every section, ~1.5 min
yarn test tests/06-templates.spec.js           # one section
yarn test tests/03-server.spec.js -g "files:"  # tests whose name matches
```

### Playwright UI

```bash
yarn test:ui
yarn test:ui tests/05-users.spec.js
```

Opens Playwright's own window: the list of all tests, a live view of the browser, and every step of a finished test
to click through (DOM, network, console at that moment). The play button at the top runs everything in order.

### Visible browser, slowed down

```bash
yarn test:headed tests/08-account.spec.js
SLOWMO=1000 yarn test:headed  # 1 s between steps (default 500 ms)
```

### Step by step

```bash
yarn test:debug tests/09-auth.spec.js
```

Opens the Playwright inspector; each action waits for "step over".

### Switches

| Variable | Effect |
|---|---|
| `PP_SLOW=1` | also runs install, start and stop of the test server in 03 (downloads Java and the server jar, several minutes) |
| `SLOWMO=<ms>` | pause between browser actions; `test:headed` sets 500 |
| `PP_URL=<url>` | another panel than `http://localhost:5173` |

```bash
PP_SLOW=1 yarn test tests/02-create-server.spec.js tests/03-server.spec.js
```

## Sections

The files run in order, one at a time; later sections use what earlier ones created.

| File | What it does |
|---|---|
| `00-translations` | static, no browser: every literal `t('...')` key and every backend error code has an English (`en_US`) text |
| `01-navigation` | every list, create and detail page and every tab once, changing nothing |
| `02-create-server` | creates a Minecraft server step by step; saves its id for 03 |
| `03-server` | the server from 02: console, files, settings, users, backups, admin, then deletes it |
| `04-nodes` | the local node; creates, edits and deletes a node on an unreachable host |
| `05-users` | creates, edits and deletes a user; logs in as that user to check its permissions |
| `06-templates` | local templates (create, edit, copy from the community repo, delete), adding and removing repositories |
| `07-settings` | panel and email settings; puts every value back afterwards |
| `08-account` | `/self` as a throwaway user: password change and back, account details, language; 2FA and OAuth2 tabs only |
| `09-auth` | login, redirects after login, self registration |

03 needs the server from 02: run 02 first when you run 03 alone.

## Results

| Where | What |
|---|---|
| terminal | pass/fail per test |
| `tests/test-results/console-report.md` | browser console problems per section (errors, Vue warnings, missing translations, failed requests), grouped, with page and test |
| `tests/test-results/artifacts/<test>/` | screenshot and trace of a failed test |

Open a trace to step through a failed test:

```bash
yarn playwright show-trace tests/test-results/artifacts/<test>/trace.zip
```

A console problem never fails a test; a test fails only when the flow itself breaks. Responses that mean "not found
= free" or "unreachable" by design are listed in `EXPECTED` in `tests/fixtures.js` and left out of the report.

Expected red until upstream adds the texts: `00-translations` lists the keys without an English text. A test marked
with `test.fail()` documents a known bug; it counts as passed while the bug is there and turns red once it is fixed.

## What the tests change

- Everything a test creates is named `e2e-*` (servers, nodes, users, templates, repositories) and is deleted again.
  Sections 05, 06 and 08 first delete their own leftovers of an earlier run that failed halfway.
- Global settings (07) are put back to the values found.
- The test admin's password is never changed; 08 changes the password of its own throwaway user.

## Attaching to the panel's browser

`start-puffer-upstream.py` can start a Chromium next to the panel that scripts (or an AI agent) can drive through the
DevTools port 9222 with Playwright's `connectOverCDP`:

| Option | Effect |
|---|---|
| `--browser` | with `--watch`: once Vite answers, opens a Chromium window (the newest one Playwright downloaded) on :5173 with its own profile `~/.cache/pufferpanel-dev-browser` (login stays) and the DevTools debug port 9222 on localhost. Closing the window keeps air and Vite running; Ctrl+C closes it too. Whoever reaches port 9222 controls that browser: dev panel only |
| `--debug` | like `--browser` but headless: no window, only the debug port 9222, while you keep your own browser. Same profile, so a login done once in a `--browser` window carries over (if the panel's login cookie survives a browser restart) |

The test suite does not need either: it starts its own browser.

## Writing tests

Shared helpers live in `tests/fixtures.js` (`field`, `openTab`, `pickDropdown`, `confirmDialog`, `expectToast`,
`createUser`, `deleteUser`, `grantScopes`, `logout`, `saveState`/`loadState`, ...) and `tests/env.js` (`login`,
`submitLogin`, `testUser`). Look there before writing a new one. Selectors come from the component markup in the
clone, not from guessing. Button names start with the icon glyph, so match them with a substring or
`/^\W*Text$/`, not `exact: true`.
