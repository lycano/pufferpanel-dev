# Frontend fails to mount under the Vite dev server: `i._ is undefined` in hotkeys.js

## Problem

When the frontend runs under the Vite dev server (`yarn vite` in `client/frontend`), the app does not mount and the
page stays empty:

```
Uncaught (in promise) TypeError: can't access property "root", i._ is undefined
    getGroup     src/plugins/hotkeys.js:20
    beforeMount  src/plugins/hotkeys.js:42
    ...
    mountApp     src/main.js:75
```

Production builds (`yarn build`) are not affected.

Seen on `v3` at 48249666, with Vue 3.5.20, @vitejs/plugin-vue 6.0.1 and Vite 7.1.4.

## Cause

`getGroup()` reads Vue's private `_` field from `binding.instance`:

```js
// client/frontend/src/plugins/hotkeys.js
const rootId = i._.root.uid                  // line 20
...
const group = getGroup(binding.instance)     // line 42
```

What `binding.instance` is depends on how the component was compiled:

- **Production build:** plugin-vue compiles `<script setup>` with the template inlined, so `binding.instance` is the
  component's full public proxy. That proxy has `_`, so the code works.
- **Dev server:** the template is compiled separately (for HMR), and the compiler adds an implicit `expose()` to
  `<script setup>`. `binding.instance` is then Vue's `exposeProxy`, which has no `_`.

`App.vue` is `<script setup>` and has `v-hotkey` on `#root`, so the error hits during the first render.

## What should be fixed

Don't use `_` on `binding.instance`. Get the full proxy through `$`, which both proxy types provide:

```diff
-        const group = getGroup(binding.instance)
+        const group = getGroup(binding.instance.$.proxy)
```

With this change the app mounts under the dev server, and production behaves the same as before.

A cleaner follow-up would be to rewrite `getGroup()` to walk the internal instance (`$`, `.root`, `.parent`, `.type`)
instead of `_` and `.ctx`. Neither is a public API.
