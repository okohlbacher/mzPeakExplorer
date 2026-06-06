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
