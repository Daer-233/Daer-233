import { mkdir, writeFile } from 'node:fs/promises';

const owner = process.env.PROFILE_USER || process.env.GITHUB_REPOSITORY_OWNER;
if (!owner || !process.env.GITHUB_TOKEN) throw new Error('PROFILE_USER and GITHUB_TOKEN are required');

const query = `query Profile($login: String!, $cursor: String) {
  user(login: $login) {
    login createdAt
    followers { totalCount }
    following { totalCount }
    contributionsCollection {
      totalCommitContributions totalIssueContributions
      totalPullRequestContributions totalPullRequestReviewContributions
      contributionCalendar { totalContributions }
    }
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, privacy: PUBLIC, isFork: false) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        stargazerCount forkCount
        languages(first: 100) { edges { size node { name color } } }
      }
    }
  }
}`;

let cursor = null;
let user;
const repositories = [];
do {
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'github-profile-stats',
    },
    body: JSON.stringify({ query, variables: { login: owner, cursor } }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);
  const body = await response.json();
  if (body.errors?.length || !body.data?.user) {
    throw new Error(body.errors?.map(error => error.message).join('; ') || 'User not found');
  }
  user = body.data.user;
  repositories.push(...user.repositories.nodes);
  cursor = user.repositories.pageInfo.hasNextPage ? user.repositories.pageInfo.endCursor : null;
} while (cursor);

const languages = new Map();
for (const repository of repositories) {
  for (const { size, node } of repository.languages.edges) {
    const item = languages.get(node.name) || { name: node.name, color: node.color || '#8b949e', size: 0 };
    item.size += size;
    languages.set(node.name, item);
  }
}
const ordered = [...languages.values()].sort((a, b) => b.size - a.size);
const totalBytes = ordered.reduce((sum, item) => sum + item.size, 0);
const displayed = ordered.slice(0, 5);
if (ordered.length > 5) displayed.push({ name: 'Other', color: '#8b949e', size: ordered.slice(5).reduce((sum, item) => sum + item.size, 0) });

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const number = value => Number(value).toLocaleString('en-US');
const contributions = user.contributionsCollection;
const updated = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const joined = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short' }).format(new Date(user.createdAt));

function render(dark) {
  const c = dark
    ? { bg: '#0d1117', border: '#30363d', text: '#e6edf3', muted: '#9198a1', accent: '#58a6ff', track: '#21262d' }
    : { bg: '#ffffff', border: '#d1d9e0', text: '#1f2328', muted: '#59636e', accent: '#0969da', track: '#eff2f5' };
  const text = (x, y, content, size = 14, fill = c.text, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" ${extra}>${escape(content)}</text>`;
  const summary = [
    ['Public source repos', repositories.length],
    ['Stars earned', repositories.reduce((sum, repo) => sum + repo.stargazerCount, 0)],
    ['Followers', user.followers.totalCount],
    ['Following', user.following.totalCount],
  ];
  const activity = [
    ['Commits', contributions.totalCommitContributions],
    ['Pull requests', contributions.totalPullRequestContributions],
    ['Issues', contributions.totalIssueContributions],
    ['Code reviews', contributions.totalPullRequestReviewContributions],
  ];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="438" viewBox="0 0 900 438" role="img" aria-labelledby="title desc">
    <title id="title">${escape(owner)} GitHub statistics</title>
    <desc id="desc">Public source repository statistics, contribution counts for the past year, and languages by code bytes.</desc>
    <rect x="0.5" y="0.5" width="899" height="437" rx="14" fill="${c.bg}" stroke="${c.border}"/>
    <g font-family="-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif">`;
  svg += text(28, 40, user.login, 23, c.accent, 'font-weight="650"');
  svg += text(28, 64, `GitHub overview · Joined ${joined}`, 13, c.muted);
  svg += text(872, 40, `${number(contributions.contributionCalendar.totalContributions)} contributions`, 15, c.text, 'text-anchor="end"');
  svg += text(872, 64, 'Past year', 12, c.muted, 'text-anchor="end"');
  summary.forEach(([label, value], index) => {
    const x = 28 + index * 216;
    svg += text(x, 112, number(value), 27, c.text, 'font-weight="600"');
    svg += text(x, 136, label, 13, c.muted);
  });
  svg += `<path d="M28 158H872" stroke="${c.border}"/>`;
  svg += text(28, 188, 'Activity · past year', 15, c.accent, 'font-weight="600"');
  activity.forEach(([label, value], index) => {
    const x = 28 + index * 216;
    svg += text(x, 225, number(value), 24, c.text, 'font-weight="600"');
    svg += text(x, 248, label, 13, c.muted);
  });
  svg += text(28, 290, 'Most used languages', 15, c.accent, 'font-weight="600"');
  svg += `<defs><clipPath id="bar"><rect x="28" y="308" width="844" height="10" rx="5"/></clipPath></defs><rect x="28" y="308" width="844" height="10" rx="5" fill="${c.track}"/><g clip-path="url(#bar)">`;
  let position = 28;
  for (const item of displayed) {
    const width = item.size / totalBytes * 844;
    svg += `<rect x="${position}" y="308" width="${width}" height="10" fill="${escape(item.color)}"/>`;
    position += width;
  }
  svg += '</g>';
  displayed.forEach((item, index) => {
    const x = 34 + index % 3 * 285;
    const y = 344 + Math.floor(index / 3) * 25;
    svg += `<circle cx="${x}" cy="${y - 4}" r="4" fill="${escape(item.color)}"/>`;
    svg += text(x + 12, y, `${item.name} ${(item.size / totalBytes * 100).toFixed(1)}%`, 13, c.muted);
  });
  if (!totalBytes) svg += text(28, 344, 'No language data yet', 13, c.muted);
  svg += `<path d="M28 390H872" stroke="${c.border}"/>`;
  svg += text(28, 416, 'Languages: public, owned, non-fork repositories · code bytes', 11, c.muted);
  svg += text(872, 416, `Updated ${updated} · Asia/Shanghai`, 11, c.muted, 'text-anchor="end"');
  return `${svg}</g></svg>\n`;
}

await mkdir('assets', { recursive: true });
await writeFile('assets/github-stats.svg', render(false));
await writeFile('assets/github-stats-dark.svg', render(true));
console.log(`Generated profile statistics for ${owner}: ${repositories.length} public source repositories.`);
