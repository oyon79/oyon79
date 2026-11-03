// Usage: node scripts/generate.mjs [--projects] [--stats]   (default: both)
// Reads config/profile.json. Requires Node 18+. Set GITHUB_TOKEN to avoid API rate limits.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(await readFile(path.join(root, "config/profile.json"), "utf8"));
const args = process.argv.slice(2);
const doAll = !args.includes("--projects") && !args.includes("--stats");
const headers = { "User-Agent": "profile-readme-generator", Accept: "application/vnd.github+json" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
const api = async (p) => {
  const r = await fetch(`https://api.github.com${p}`, { headers });
  if (!r.ok) throw new Error(`${p} -> HTTP ${r.status}`);
  return r.json();
};

// ---------- Projects: link only repos that exist and are public ----------
async function projects() {
  const cards = [];
  for (const p of cfg.projects) {
    let url = null;
    if (p.repo) {
      try {
        const r = await api(`/repos/${p.repo}`);
        if (!r.private) url = r.html_url;
      } catch (e) { console.warn(`! not linking ${p.name}: ${e.message}`); }
    }
    const title = url ? `### [${p.name}](${url})` : `### ${p.name}`;
    const stack = p.stack.map((s) => `\`${s}\``).join(" ");
    cards.push([title, "", p.description + (p.highlight ? `<br>${p.highlight}` : ""), "", stack].join("\n"));
  }
  const body = cards.join("\n\n<br>\n\n");
  const file = path.join(root, "README.md");
  const md = await readFile(file, "utf8");
  const re = /<!-- PROJECTS:START -->[\s\S]*?<!-- PROJECTS:END -->/;
  if (!re.test(md)) throw new Error("PROJECTS markers missing in README.md");
  await writeFile(file, md.replace(re, `<!-- PROJECTS:START -->\n\n${body}\n\n<!-- PROJECTS:END -->`));
  console.log("projects section updated");
}

// ---------- Stats: static SVG fallback built from real API data ----------
const COLORS = { JavaScript: "#f1e05a", TypeScript: "#3178c6", Python: "#3572a5", Java: "#b07219", PHP: "#4f5d95",
  Dart: "#00b4ab", HTML: "#e34c26", CSS: "#a855f7", C: "#8b949e", "C++": "#f34b7d", Kotlin: "#a97bff" };
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const font = `font-family="'Segoe UI', Ubuntu, Arial, sans-serif"`;

async function stats() {
  const u = cfg.username;
  const user = await api(`/users/${u}`);
  const repos = (await api(`/users/${u}/repos?per_page=100&type=owner`)).filter((r) => !r.fork);
  const count = async (p) => { try { return (await api(p)).total_count; } catch { return "n/a"; } };
  const [prs, issues, commits] = await Promise.all([
    count(`/search/issues?q=author:${u}+type:pr&per_page=1`),
    count(`/search/issues?q=author:${u}+type:issue&per_page=1`),
    count(`/search/commits?q=author:${u}&per_page=1`),
  ]);
  const stars = repos.reduce((n, r) => n + r.stargazers_count, 0);
  const rows = [["Total Stars", stars], ["Public Repositories", user.public_repos], ["Public Commits", commits],
    ["Pull Requests", prs], ["Issues", issues], ["Followers", user.followers]];
  const date = new Date().toISOString().slice(0, 10);

  const card = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="210" viewBox="0 0 440 210" role="img" aria-label="GitHub statistics snapshot for ${u}">
<rect width="440" height="210" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="24" y="34" ${font} font-size="17" font-weight="600" fill="#58a6ff">${esc(cfg.name)}'s GitHub Stats</text>
${rows.map(([k, v], i) => `<text x="24" y="${66 + i * 22}" ${font} font-size="13" fill="#c9d1d9">${k}</text><text x="260" y="${66 + i * 22}" ${font} font-size="13" font-weight="600" fill="${["#a78bfa", "#22d3ee", "#34d399"][i % 3]}">${v}</text>`).join("\n")}
<text x="416" y="196" ${font} font-size="9" fill="#6e7681" text-anchor="end">snapshot ${date}</text>
</svg>\n`;

  const bytes = {};
  for (const r of repos) {
    try { for (const [l, b] of Object.entries(await api(`/repos/${u}/${r.name}/languages`))) bytes[l] = (bytes[l] || 0) + b; } catch {}
  }
  const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const langs = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="210" viewBox="0 0 300 210" role="img" aria-label="Most used languages snapshot for ${u}">
<rect width="300" height="210" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="24" y="34" ${font} font-size="17" font-weight="600" fill="#58a6ff">Most Used Languages</text>
${top.map(([l, b], i) => { const pct = (b / total) * 100; const y = 56 + i * 24;
  return `<text x="24" y="${y}" ${font} font-size="12" fill="#c9d1d9">${esc(l)}</text><text x="276" y="${y}" ${font} font-size="12" fill="#8b949e" text-anchor="end">${pct.toFixed(1)}%</text>
<rect x="24" y="${y + 5}" width="252" height="6" rx="3" fill="#21262d"/><rect x="24" y="${y + 5}" width="${Math.max(3, 2.52 * pct).toFixed(1)}" height="6" rx="3" fill="${COLORS[l] || "#58a6ff"}"/>`; }).join("\n")}
</svg>\n`;

  await mkdir(path.join(root, "stats"), { recursive: true });
  await writeFile(path.join(root, "stats/github-stats.svg"), card);
  await writeFile(path.join(root, "stats/top-languages.svg"), langs);
  console.log("stats snapshots written:", Object.fromEntries(rows), top.map(([l, b]) => `${l} ${((b / total) * 100).toFixed(1)}%`).join(", "));
}

if (doAll || args.includes("--projects")) await projects();
if (doAll || args.includes("--stats")) await stats();
