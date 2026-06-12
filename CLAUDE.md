# Project memory — mzPeak Explorer

## ⛔ Push safety (HARD RULE)

**NEVER `git push` to any remote other than `github.com/okohlbacher/mzPeakExplorer`.**

- The only authorized push target is `origin` → `https://github.com/okohlbacher/mzPeakExplorer.git`.
- Do **not** push to any fork, mirror, other owner, or newly-added remote — ever — unless the user **explicitly and interactively authorizes that specific push in the current conversation**.
- Even when such authorization is given, **show a warning first** that names the exact remote URL and branch, and proceed only after the user confirms.
- Before any `git push`, verify the destination with `git remote -v` (and the explicit `git push <remote> <branch>` arguments) and abort if it is not the authorized repo.
- This applies to all push-like operations (`git push`, force-push, pushing tags, `gh` commands that push, PR creation against a non-authorized repo).

## Project basics

- Vite + React + TypeScript SPA; zustand store; uPlot charts; vendored `mzpeakts` reader; deployed to GitHub Pages via `.github/workflows/deploy.yml`.
- Standard pre-push validation: `tsc -p tsconfig.app.json --noEmit`, then a fresh-checkout `npm ci` + `VITE_BASE=/mzPeakExplorer/ npm run build`.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.

## Standard deployment (two targets)

A "deploy" of the Explorer now publishes to **both** targets:

1. **GitHub Pages** — `git push origin main` (authorized repo only; see Push safety) triggers `.github/workflows/deploy.yml` → https://okohlbacher.github.io/mzPeakExplorer/.
2. **mzpeak.org** — run `~/Claude/mzPeak Website/deploy.sh`. This rebuilds the combined site via `build-site.sh` (marketing `/`, spec `/spec/`, Explorer `/view/` built with `VITE_BASE=/view/` from this repo, mzPeakIV `/IV/`) and **rsyncs `_site/` over SSH** (alias `mzpeak-web`) to the StackIT server `/var/www/mzpeak/`, atomic symlink swap, 5 releases kept. NOTE: it is **not** a git push, and it republishes marketing + spec + `/IV/` from their current local state too (broader blast radius) — surface that before running it.
