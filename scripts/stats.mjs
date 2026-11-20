// Renders two themed SVG cards (stats.svg, langs.svg) from the GitHub API.
// Runs inside the Action with the built-in GITHUB_TOKEN. No dependencies, Node 18+.
// Usage: node scripts/stats.mjs <outDir>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const user = process.env.GITHUB_USER;
const token = process.env.GITHUB_TOKEN;
const api = process.env.GITHUB_API_URL || "https://api.github.com";
const outDir = process.argv[2] || "dist";

if (!user) throw new Error("GITHUB_USER is not set");

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "profile-readme-stats",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function get(path) {
  const res = await fetch(`${api}${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function allRepos() {
  const repos = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await get(`/users/${user}/repos?per_page=100&type=owner&page=${page}`);
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

async function contributionsLastYear() {
  try {
    const res = await fetch(`${api}/graphql`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions}}}}`,
        variables: { login: user },
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data?.user?.contributionsCollection?.contributionCalendar?.totalContributions ?? null;
  } catch {
    return null;
  }
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmt = (n) => (n == null ? "n/a" : Number(n).toLocaleString("en-US"));

const font = (w) => readFileSync(join(here, "fonts", `dm-sans-${w}.woff2`)).toString("base64");
const FONT_CSS = `
    @font-face{font-family:"FH Sans";font-weight:700;src:url(data:font/woff2;base64,${font(700)}) format("woff2");}
    @font-face{font-family:"FH Sans";font-weight:500;src:url(data:font/woff2;base64,${font(500)}) format("woff2");}
    text{font-family:"FH Sans","Segoe UI",-apple-system,Helvetica,Arial,sans-serif;}`;

const W = 480, H = 200;
const RED = "#e5533d", YEL = "#f2b632";

const frame = (label, body) => `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
  <style>${FONT_CSS}
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="#0d1117" stroke="#30363d"/>
  <rect x="24" y="24" width="22" height="4" rx="2" fill="${YEL}"/>
  <rect x="24" y="33" width="14" height="4" rx="2" fill="${RED}"/>
${body}
</svg>
`;

function statsCard({ contributions, repos, stars, followers }) {
  const items = [
    [fmt(contributions), "Contributions, last year"],
    [fmt(repos), "Public repositories"],
    [fmt(stars), "Stars earned"],
    [fmt(followers), "Followers"],
  ];
  const cells = items
    .map(([num, label], i) => {
      const x = i % 2 === 0 ? 24 : 252;
      const y = i < 2 ? 90 : 156;
      return `  <text x="${x}" y="${y}" font-size="34" font-weight="700" fill="#f0f6fc" letter-spacing="-0.5">${esc(num)}</text>
  <text x="${x}" y="${y + 20}" font-size="15" font-weight="500" fill="#8b949e">${esc(label)}</text>`;
    })
    .join("\n");
  const label = `GitHub stats for ${user}: ${items.map(([n, l]) => `${n} ${l.toLowerCase()}`).join(", ")}`;
  return frame(label, `  <text x="56" y="38" font-size="17" font-weight="700" fill="#f0f6fc">GitHub stats</text>\n${cells}`);
}

function langsCard(langs) {
  const PALETTE = ["#e5533d", "#f2b632", "#c9d1d9", "#8b949e", "#6e7681", "#484f58"];
  const total = langs.reduce((s, [, b]) => s + b, 0);
  let shown = langs.slice(0, 5);
  const rest = langs.slice(5).reduce((s, [, b]) => s + b, 0);
  if (rest > 0) shown = [...shown, ["Other", rest]];

  const BAR_X = 24, BAR_W = 432;
  let body = `  <text x="56" y="38" font-size="17" font-weight="700" fill="#f0f6fc">Top languages</text>\n`;

  if (total === 0) {
    body += `  <text x="24" y="110" font-size="15" font-weight="500" fill="#8b949e">No language data yet.</text>`;
    return frame(`Top languages for ${user}: no data yet`, body);
  }

  let x = BAR_X;
  const segs = shown.map(([name, bytes], i) => {
    const pct = (bytes / total) * 100;
    const w = (bytes / total) * BAR_W;
    const seg = `    <rect x="${x.toFixed(2)}" y="58" width="${w.toFixed(2)}" height="10" fill="${PALETTE[i]}"/>`;
    x += w;
    return { name, pct, seg, color: PALETTE[i] };
  });
  body += `  <clipPath id="bar"><rect x="${BAR_X}" y="58" width="${BAR_W}" height="10" rx="5"/></clipPath>
  <g clip-path="url(#bar)">
${segs.map((s) => s.seg).join("\n")}
  </g>\n`;

  body += segs
    .map((s, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const lx = col === 0 ? 24 : 252;
      const ly = 110 + row * 32;
      return `  <rect x="${lx}" y="${ly - 10}" width="10" height="10" rx="2" fill="${s.color}"/>
  <text x="${lx + 20}" y="${ly}" font-size="15" font-weight="500" fill="#c9d1d9">${esc(s.name)}</text>
  <text x="${lx + 204}" y="${ly}" font-size="15" font-weight="500" fill="#8b949e" text-anchor="end">${s.pct.toFixed(1)}%</text>`;
    })
    .join("\n");

  const label = `Top languages for ${user}: ${segs.map((s) => `${s.name} ${s.pct.toFixed(1)}%`).join(", ")}`;
  return frame(label, body);
}

const profile = await get(`/users/${user}`);
const repos = await allRepos();
const owned = repos.filter((r) => !r.fork);
const stars = owned.reduce((s, r) => s + (r.stargazers_count || 0), 0);

const totals = new Map();
await Promise.all(
  owned.map(async (r) => {
    try {
      const l = await get(`/repos/${r.full_name}/languages`);
      for (const [name, bytes] of Object.entries(l)) totals.set(name, (totals.get(name) || 0) + bytes);
    } catch {
      /* skip a repo whose languages cannot be read */
    }
  }),
);
const langs = [...totals.entries()].sort((a, b) => b[1] - a[1]);

const contributions = await contributionsLastYear();

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "stats.svg"), statsCard({ contributions, repos: profile.public_repos, stars, followers: profile.followers }));
writeFileSync(join(outDir, "langs.svg"), langsCard(langs));
console.log(`Wrote ${join(outDir, "stats.svg")} and ${join(outDir, "langs.svg")}`);
