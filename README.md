# XpressiVox helper

A small program that runs on your own computer and passes XpressiVox previews to Synthesizer V Studio 2.

- Listens only on `127.0.0.1:47321` (your own computer; nothing outside can reach it).
- Every request needs a pairing code that only you and the XpressiVox page know.
- Writes only into the XpressiVox bridge folder (`~/Library/Application Support/XpressiVox/bridge` on a Mac) and its own code file.
- No dependencies: `xpressivox-helper.cjs` uses only what Node already includes.

Run it with Node: `node xpressivox-helper.cjs` (`--code` shows the pairing code, `--version` the version).
The build recipe in `.github/workflows/build.yml` packs it into one program per computer type (no Node needed): Mac (Apple chip), Mac (Intel), Windows.
Test: `node test-helper.mjs`.

Licence: MIT.
