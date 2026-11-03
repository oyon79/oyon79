# Publishing

1. On GitHub create a **public** repo named exactly `oyon79` (it already exists: https://github.com/oyon79/oyon79).
2. Copy `README.md` and the `assets/` folder into that repo (relative paths `./assets/...` must keep working).
3. Commit and push. The README appears on https://github.com/oyon79.

## Notes
- Stats, streak and activity graph come from third-party services. The public instances
  (`github-readme-stats.vercel.app`, `github-readme-activity-graph.vercel.app`) are often rate-limited
  (503 / 402). If cards are blank, self-host them on your own Vercel with a GitHub PAT, then replace the host in the URLs.
- Private contributions only count if "Private contributions" is enabled in your GitHub profile settings.

## Maintenance
- `config/profile.json` holds the email, LinkedIn and project list. Set a project's `"repo"` to `"owner/name"`
  (or `null` for no link), then run `node scripts/generate.mjs --projects`. A link is added only if the repo exists and is public.
- `node scripts/generate.mjs --stats` regenerates the static fallback cards in `stats/` from real GitHub API data.
  `.github/workflows/refresh-stats.yml` does this weekly once the repo is on GitHub.
- Local preview: `python -m http.server 8765` in the project folder, then open http://localhost:8765/preview/index.html
