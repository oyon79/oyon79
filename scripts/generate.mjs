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
  if (!re.test(md)) { console.log("projects section not in README, skipping"); return; }
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

  const card = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="210" viewBox="0 0 320 210" role="img" aria-label="GitHub statistics snapshot for ${u}">
<rect width="320" height="210" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="20" y="34" ${font} font-size="20" font-weight="700" fill="#58a6ff">GitHub Stats</text>
${rows.map(([k, v], i) => `<text x="20" y="${68 + i * 25}" ${font} font-size="15" fill="#c9d1d9">${k}</text><text x="300" y="${68 + i * 25}" ${font} font-size="15" font-weight="700" text-anchor="end" fill="${["#a78bfa", "#22d3ee", "#34d399"][i % 3]}">${v}</text>`).join("\n")}
</svg>\n`;

  const bytes = {};
  for (const r of repos) {
    try { for (const [l, b] of Object.entries(await api(`/repos/${u}/${r.name}/languages`))) bytes[l] = (bytes[l] || 0) + b; } catch {}
  }
  const total = Object.values(bytes).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(bytes).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const langs = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="210" viewBox="0 0 320 210" role="img" aria-label="Most used languages snapshot for ${u}">
<rect width="320" height="210" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="20" y="34" ${font} font-size="20" font-weight="700" fill="#58a6ff">Most Used Languages</text>
${top.map(([l, b], i) => { const pct = (b / total) * 100; const y = 66 + i * 25;
  return `<text x="20" y="${y}" ${font} font-size="14" fill="#c9d1d9">${esc(l)}</text><text x="300" y="${y}" ${font} font-size="14" fill="#8b949e" text-anchor="end">${pct.toFixed(1)}%</text>
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
  const streakSvg = (SW) => {
    const row = (i, big, label, color, sub) => { const t = 52 + i * 52;
      return `<text x="20" y="${t + 24}" ${font} font-size="28" font-weight="700" fill="${color}">${big}</text>
<text x="${SW - 20}" y="${t + 24}" ${font} font-size="12" fill="#8b949e" text-anchor="end">${sub}</text>
<text x="20" y="${t + 42}" ${font} font-size="13" fill="#c9d1d9">${label}</text>`; };
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="210" viewBox="0 0 ${SW} 210" role="img" aria-label="GitHub streak: ${total} contributions in the last year, current streak ${cur} days, longest streak ${longest} days">
<rect width="${SW}" height="210" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="20" y="34" ${font} font-size="20" font-weight="700" fill="#58a6ff">Streak</text>
<line x1="20" y1="102" x2="${SW - 20}" y2="102" stroke="#30363d"/><line x1="20" y1="154" x2="${SW - 20}" y2="154" stroke="#30363d"/>
${row(0, total, "Contributions", "#58a6ff", "Last 12 months")}
${row(1, cur, "Current Streak", "#22d3ee", "days")}
${row(2, longest, "Longest Streak", "#34d399", longest ? `ending ${fmt(longestEnd)}` : "days")}
</svg>
`; };
  const streak = streakSvg(240), streakMobile = streakSvg(320);

  // animated bar chart of the last N days (30 on desktop, 14 on the mobile variant)
  const chartSvg = (W, H, count) => {
  const last = past.slice(-count);
  const L = 44, R = 20, T = 58, B = 32;
  const max = Math.max(4, ...last.map((d) => d.n));
  const top = Math.ceil(max / 4) * 4;
  const slot = (W - L - R) / Math.max(1, last.length), bw = Math.min(18, slot * 0.58);
  const y = (v) => T + (H - T - B) * (1 - v / top);
  const sum = last.reduce((a, d) => a + d.n, 0);
  const grid = [0, 1, 2, 3, 4].map((k) => { const v = (top / 4) * k; return `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="#21262d"${k ? ' stroke-dasharray="3 4"' : ""}/><text x="${L - 8}" y="${y(v) + 4}" ${font} font-size="10" fill="#8b949e" text-anchor="end">${v}</text>`; }).join("");
  const bars = last.map((d, k) => {
    const cx = L + slot * k + slot / 2, h = d.n ? Math.max(4, y(0) - y(d.n)) : 3, by = y(0) - h;
    const bar = `<rect class="bar" style="animation-delay:${(k * 0.035).toFixed(2)}s" x="${(cx - bw / 2).toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(4, bw / 2)}" fill="${d.n ? "url(#g)" : "#21262d"}"/>`;
    const val = d.n ? `<text class="val" style="animation-delay:${(k * 0.035 + 0.5).toFixed(2)}s" x="${cx.toFixed(1)}" y="${(by - 6).toFixed(1)}" ${font} font-size="11" font-weight="600" fill="#c9d1d9" text-anchor="middle">${d.n}</text>` : "";
    const lab = k % 2 === 0 || k === last.length - 1 ? `<text x="${cx.toFixed(1)}" y="${H - B + 16}" ${font} font-size="10" fill="#8b949e" text-anchor="middle">${+d.date.slice(8)}</text>` : "";
    return bar + val + lab;
  }).join("");
  const range = last.length ? `${fmt(last[0].date)} – ${fmt(last.at(-1).date)}` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Contribution activity for the last ${count} days, ${range}: ${sum} contributions">
<style>.bar{transform-box:fill-box;transform-origin:50% 100%;animation:grow .7s cubic-bezier(.22,1,.36,1) both}.val{animation:fade .4s ease-out both}@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}@keyframes fade{from{opacity:0}to{opacity:1}}</style>
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a78bfa"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs>
<rect width="${W}" height="${H}" rx="10" fill="#0d1117" stroke="#30363d"/>
<text x="${L}" y="32" ${font} font-size="15" font-weight="600" fill="#58a6ff">Contribution Activity</text>
<text x="${L}" y="49" ${font} font-size="11" fill="#8b949e">${range} · last ${count} days</text>
<text x="${W - R}" y="32" ${font} font-size="15" font-weight="600" fill="#34d399" text-anchor="end">${sum}</text>
<text x="${W - R}" y="49" ${font} font-size="11" fill="#8b949e" text-anchor="end">contributions</text>
${grid}${bars}
</svg>\n`;
  };
  const chart = chartSvg(900, 205, 30), chartMobile = chartSvg(360, 230, 14);
  await mkdir(path.join(root, "stats"), { recursive: true });
  await writeFile(path.join(root, "stats/streak.svg"), streak);
  await writeFile(path.join(root, "stats/streak-mobile.svg"), streakMobile);
  await writeFile(path.join(root, "stats/contribution-activity-mobile.svg"), chartMobile);
  await writeFile(path.join(root, "stats/contribution-activity.svg"), chart);
  console.log(`contrib: total ${total}, current streak ${cur}, longest ${longest}`);
}

// ---------- Overview: the three stat cards as one image (row on desktop, stack on mobile) ----------
async function compose() {
  const read = (f) => readFile(path.join(root, "stats", f), "utf8");
  const place = (svg, x, y) => svg.replace("<svg ", `<svg x="${x}" y="${y}" `);
  const [c, l, st, stm] = await Promise.all(["github-stats.svg", "top-languages.svg", "streak.svg", "streak-mobile.svg"].map(read));
  const wrap = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${body}\n</svg>\n`;
  await writeFile(path.join(root, "stats/overview.svg"), wrap(908, 210, [place(c, 0, 0), place(l, 294, 0), place(st, 588, 0)].join("\n")));
  await writeFile(path.join(root, "stats/overview-mobile.svg"), wrap(320, 654, [place(c, 0, 0), place(l, 0, 222), place(stm, 0, 444)].join("\n")));
  console.log("overview images composed");
}

if (doAll || args.includes("--projects")) await projects();
if (doAll || args.includes("--stats")) await stats();
if (doAll || args.includes("--contrib")) await contrib();
if (doAll || args.includes("--contrib")) await compose();
