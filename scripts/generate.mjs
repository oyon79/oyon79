// Usage: node scripts/generate.mjs [--projects] [--stats]   (default: both)
// Reads config/profile.json. Requires Node 18+. Set GITHUB_TOKEN to avoid API rate limits.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(await readFile(path.join(root, "config/profile.json"), "utf8"));
const args = process.argv.slice(2);
const doAll = !args.includes("--projects") && !args.includes("--stats") && !args.includes("--contrib");
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
  for (const [i, p] of cfg.projects.entries()) {
    let url = null;
    if (p.repo) {
      try {
        const r = await api(`/repos/${p.repo}`);
        if (!r.private) url = r.html_url;
      } catch (e) { console.warn(`! not linking ${p.name}: ${e.message}`); }
    }
    const stack = p.stack.map((s) => `\`${s}\``).join(" ");
    cards.push([
      `<details${i === 0 ? " open" : ""}>`,
      `<summary><b>${p.name}</b> &nbsp;·&nbsp; <sub>${p.stack.join(" · ")}</sub></summary>`,
      "",
      p.description + (p.highlight ? `<br>${p.highlight}` : ""),
      "",
      stack + (url ? ` &nbsp; [🔗 View repository](${url})` : ""),
      "",
      "</details>",
    ].join("\n"));
  }
  const body = cards.join("\n\n");
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

  const card = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" role="img" aria-label="GitHub statistics snapshot for ${u}">
<rect width="320" height="180" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="20" y="30" ${font} font-size="15" font-weight="600" fill="#58a6ff">GitHub Stats</text>
${rows.map(([k, v], i) => `<text x="20" y="${58 + i * 21}" ${font} font-size="12" fill="#c9d1d9">${k}</text><text x="300" y="${58 + i * 21}" ${font} font-size="12" font-weight="600" text-anchor="end" fill="${["#a78bfa", "#22d3ee", "#34d399"][i % 3]}">${v}</text>`).join("\n")}
</svg>\n`;

  const bytes = {};
  for (const r of repos) {
    try { for (const [l, b] of Object.entries(await api(`/repos/${u}/${r.name}/languages`))) bytes[l] = (bytes[l] || 0) + b; } catch {}
  }
  const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const langs = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" role="img" aria-label="Most used languages snapshot for ${u}">
<rect width="320" height="180" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="20" y="30" ${font} font-size="15" font-weight="600" fill="#58a6ff">Most Used Languages</text>
${top.map(([l, b], i) => { const pct = (b / total) * 100; const y = 54 + i * 20;
  return `<text x="20" y="${y}" ${font} font-size="11" fill="#c9d1d9">${esc(l)}</text><text x="300" y="${y}" ${font} font-size="11" fill="#8b949e" text-anchor="end">${pct.toFixed(1)}%</text>
<rect x="20" y="${y + 4}" width="280" height="4" rx="2" fill="#21262d"/><rect x="20" y="${y + 4}" width="${Math.max(3, 2.8 * pct).toFixed(1)}" height="4" rx="2" fill="${COLORS[l] || "#58a6ff"}"/>`; }).join("\n")}
</svg>\n`;

  await mkdir(path.join(root, "stats"), { recursive: true });
  await writeFile(path.join(root, "stats/github-stats.svg"), card);
  await writeFile(path.join(root, "stats/top-languages.svg"), langs);
  console.log("stats snapshots written:", Object.fromEntries(rows), top.map(([l, b]) => `${l} ${((b / total) * 100).toFixed(1)}%`).join(", "));
}

// ---------- Streak card + activity chart from the public contributions calendar ----------
async function contrib() {
  const res = await fetch(`https://github.com/users/${cfg.username}/contributions`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`contributions -> HTTP ${res.status}`);
  const html = await res.text();
  const dates = {};
  for (const m of html.matchAll(/data-date="([\d-]+)"[^>]*id="(contribution-day-component-[\d-]+)"/g)) dates[m[2]] = m[1];
  const days = [];
  for (const m of html.matchAll(/for="(contribution-day-component-[\d-]+)"[^>]*>([^<]*)</g)) {
    const n = m[2].match(/^(\d+) contribution/);
    if (dates[m[1]]) days.push({ date: dates[m[1]], n: n ? +n[1] : 0 });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  const today = new Date().toISOString().slice(0, 10);
  const past = days.filter((d) => d.date <= today);
  const total = past.reduce((a, d) => a + d.n, 0);
  let longest = 0, run = 0, longestEnd = "";
  for (const d of past) { run = d.n ? run + 1 : 0; if (run > longest) { longest = run; longestEnd = d.date; } }
  let cur = 0, i = past.length - 1;
  if (i >= 0 && !past[i].n) i--; // today may not have activity yet
  for (; i >= 0 && past[i].n; i--) cur++;
  const fmt = (d) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const col = (x, big, label, color, sub) => `<text x="${x}" y="88" ${font} font-size="28" font-weight="700" fill="${color}" text-anchor="middle">${big}</text>
<text x="${x}" y="114" ${font} font-size="11" fill="#c9d1d9" text-anchor="middle">${label}</text><text x="${x}" y="132" ${font} font-size="10" fill="#8b949e" text-anchor="middle">${sub}</text>`;
  const streak = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180" role="img" aria-label="GitHub streak: ${total} contributions in the last year, current streak ${cur} days, longest streak ${longest} days">
<rect width="320" height="180" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="20" y="30" ${font} font-size="15" font-weight="600" fill="#58a6ff">Contribution Streak</text>
<line x1="107" y1="62" x2="107" y2="142" stroke="#30363d"/><line x1="213" y1="62" x2="213" y2="142" stroke="#30363d"/>
${col(53, total, "Contributions", "#58a6ff", "Last 12 months")}
${col(160, cur, "Current Streak", "#22d3ee", "days")}
${col(267, longest, "Longest Streak", "#34d399", longest ? `ending ${fmt(longestEnd)}` : "days")}
</svg>\n`;

  // line chart of the last 30 days
  const last = past.slice(-30);
  const W = 900, H = 300, L = 46, R = 20, T = 44, B = 44;
  const max = Math.max(4, ...last.map((d) => d.n));
  const top = Math.ceil(max / 4) * 4;
  const x = (k) => L + (k * (W - L - R)) / Math.max(1, last.length - 1);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const pts = last.map((d, k) => [x(k), y(d.n)]);
  // smooth path (Catmull-Rom -> cubic Bezier), clamped to the baseline
  let line = `M${pts[0][0]},${pts[0][1]}`;
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[k - 1] || pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] || p2;
    const c = (v) => Math.min(H - B, Math.max(T, v));
    line += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${c(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${c(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  const area = `${line} L${pts.at(-1)[0]},${H - B} L${pts[0][0]},${H - B} Z`;
  const grid = [0, 1, 2, 3, 4].map((k) => { const v = (top / 4) * k; return `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="#21262d"/><text x="${L - 8}" y="${y(v) + 4}" ${font} font-size="11" fill="#8b949e" text-anchor="end">${v}</text>`; }).join("");
  const xl = last.map((d, k) => (k % 2 === 0 || k === last.length - 1 ? `<text x="${x(k)}" y="${H - B + 18}" ${font} font-size="10" fill="#8b949e" text-anchor="middle">${+d.date.slice(8)}</text>` : "")).join("");
  const dots = pts.map((p, k) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="${["#22d3ee", "#a78bfa", "#f472b6", "#34d399"][k % 4]}"/>`).join("");
  const range = last.length ? `${fmt(last[0].date)} – ${fmt(last.at(-1).date)}` : "";
  const chart = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Contribution activity for the last 30 days, ${range}">
<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a78bfa" stop-opacity=".35"/><stop offset="1" stop-color="#a78bfa" stop-opacity="0"/></linearGradient>
<linearGradient id="l" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22d3ee"/><stop offset=".5" stop-color="#a78bfa"/><stop offset="1" stop-color="#f472b6"/></linearGradient></defs>
<rect width="${W}" height="${H}" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="${W / 2}" y="28" ${font} font-size="16" font-weight="600" fill="#58a6ff" text-anchor="middle">${esc(cfg.username)}'s Contribution Graph</text>
${grid}<path d="${area}" fill="url(#a)"/><path d="${line}" fill="none" stroke="url(#l)" stroke-width="2.5" stroke-linecap="round"/>${dots}${xl}
<text x="${W / 2}" y="${H - 8}" ${font} font-size="11" fill="#8b949e" text-anchor="middle">Day of month (${range})</text>
<text x="14" y="${H / 2}" ${font} font-size="11" fill="#8b949e" text-anchor="middle" transform="rotate(-90 14 ${H / 2})">Contributions</text>
</svg>\n`;
  await mkdir(path.join(root, "stats"), { recursive: true });
  await writeFile(path.join(root, "stats/streak.svg"), streak);
  await writeFile(path.join(root, "stats/activity.svg"), chart);
  console.log(`contrib: total ${total}, current streak ${cur}, longest ${longest}`);
}

if (doAll || args.includes("--projects")) await projects();
if (doAll || args.includes("--stats")) await stats();
if (doAll || args.includes("--contrib")) await contrib();
