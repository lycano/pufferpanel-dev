# Contributing

This repo is a personal development setup for PufferPanel, built and tested on Linux only (see the
[README](README.md)). Changes to PufferPanel itself belong in the
[PufferPanel repository](https://github.com/PufferPanel/PufferPanel), not here.

## Windows support is welcome

The README describes a WSL2 setup and the script has code paths for native Windows, but neither has been tested on a
real Windows machine. If you get one of them working, a pull request is very welcome, for example:

- confirming that the WSL2 steps in the README work, or correcting them (e.g. whether `networkingMode=mirrored` is
  needed for the browser on Windows to reach `localhost:5173`)
- making `start-puffer-upstream.py` and `air.toml` work on native Windows: starting air and Vite, stopping them with
  Ctrl+C, the first user and the frontend build
- adding a Windows entry to the Troubleshooting table for problems you ran into

Please say in the pull request what you tested on: Windows version, WSL distribution (if any), and the versions of
Python, Go, Node.js, Yarn and air.

## Other changes

Fixes and improvements for Linux (or macOS) are welcome too. Keep the setup's main rule: nothing in the PufferPanel
clones is changed, and the only output written into a clone is gitignored.

Before opening a pull request, run through [Check that it works](README.md#check-that-it-works) with the target you
changed (`pr`, `upstream`, with and without `--watch`).
