// GitHub plugin -- owns every /api/github/* route + /api/pull-request.
//
// Registers at absolute paths (not under /api/plugins/github/) so the URL
// contracts the frontend and AI already use keep working after extraction.
// When this plugin is uninstalled / unconfigured, the core route gate 404s
// the same URLs with pluginRequired: 'github'. See the main Cadence
// repo, feature/plugin-first-shell branch.


// ---- Attention: what the Plugins home shows on this app's tile. Reads the plugin's own
// routes over loopback (they carry their caches), never writes, answers within a minute.
const __attention = { value: null, until: 0 };
function __selfGet(req, path, timeoutMs) {
  return new Promise((resolve) => {
    const host = req.headers.host || `127.0.0.1:${process.env.CADENCE_PORT || 3801}`;
    const lib = require('http');
    const r = lib.get({ host: host.split(':')[0], port: Number(host.split(':')[1] || 80), path, headers: { 'x-cadence-internal': '1' } }, (resp) => { let d = ''; resp.on('data', (c) => { d += c; }); resp.on('end', () => { try { resolve(resp.statusCode < 400 ? JSON.parse(d) : null); } catch (_) { resolve(null); } }); });
    r.on('error', () => resolve(null));
    r.setTimeout(timeoutMs || 45000, () => { r.destroy(); resolve(null); });
  });
}
function __attentionOut(items) {
  const rank = { error: 3, warn: 2, warning: 2, info: 1 };
  const list = (items || []).filter((i) => i && i.text).map((i) => ({ level: i.level === 'warning' ? 'warn' : (i.level || 'info'), text: String(i.text) }));
  const level = list.reduce((top, i) => (rank[i.level] > rank[top] ? i.level : top), list.length ? 'info' : 'ok');
  return { count: list.length, level, items: list, readAt: new Date().toISOString() };
}
async function __attentionHandler(req, res, url, compute) {
  if (__attention.value && __attention.until > Date.now() && url.searchParams.get('refresh') !== '1') return __json(res, __attention.value);
  let out;
  try { out = __attentionOut(await compute(req)); } catch (e) { out = { count: 0, level: 'ok', items: [], error: e.message, readAt: new Date().toISOString() }; }
  __attention.value = out; __attention.until = Date.now() + 60000;
  return __json(res, out);
}
function __json(res, data) { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }

module.exports = function register(ctx) {
  // The @gh handle's search: "@gh login bug" in the palette, or an Ask Cadence question about
  // something, arrives here and is answered in the shape every handle shares. A number is a
  // pattern hit and never reaches this; words go to GitHub's search across every configured
  // repository that has a GitHub remote, so the answer says which repository each thing is in.
  // GET /api/plugins/github/search?q=<text>&limit=8&kinds=pull-request,issue
  async function handleSearch(req, res, url) {
    try {
      const q = String(url.searchParams.get('q') || '').trim();
      const limit = Math.max(1, Math.min(25, Number(url.searchParams.get('limit')) || 8));
      const kinds = String(url.searchParams.get('kinds') || '').split(',').map(s => s.trim()).filter(Boolean);
      const wants = (k) => !kinds.length || kinds.includes(k);
      if (!q || /^#?\d+$/.test(q)) return json(res, { items: [] });
      const cfg = ctx.getConfig();
      // Which configured repositories live on GitHub, and under what name here.
      const known = [];
      for (const name of Object.keys(cfg.Repos || {})) {
        const p = getRepoPath(name);
        const gh = p ? parseGitHubRemote(p) : null;
        if (gh) known.push({ name, owner: gh.owner, repo: gh.repo });
      }
      const items = [];
      if (wants('repo')) {
        for (const k of known) {
          if (`${k.name} ${k.owner}/${k.repo}`.toLowerCase().includes(q.toLowerCase())) {
            items.push({ kind: 'repo', id: k.name, label: k.name, detail: `${k.owner}/${k.repo}`, open: { surface: 'github', target: { repo: k.name } }, score: 0.6 });
          }
        }
      }
      if ((wants('pull-request') || wants('issue')) && known.length) {
        const scope = known.slice(0, 10).map(k => `repo:${k.owner}/${k.repo}`).join(' ');
        const only = wants('pull-request') && !wants('issue') ? ' is:pr' : !wants('pull-request') && wants('issue') ? ' is:issue' : '';
        const data = await ghRequest('GET', `/search/issues?q=${encodeURIComponent(`${q} ${scope}${only}`)}&per_page=${limit}&sort=updated`);
        for (const it of (data.items || [])) {
          const full = String(it.repository_url || '').replace(/^.*\/repos\//, '');
          const k = known.find(x => `${x.owner}/${x.repo}`.toLowerCase() === full.toLowerCase());
          const isPr = !!it.pull_request;
          items.push({
            kind: isPr ? 'pull-request' : 'issue',
            id: String(it.number),
            label: `#${it.number} ${it.title}`,
            detail: [k ? k.name : full, it.state, it.user && it.user.login].filter(Boolean).join(' - '),
            open: { surface: 'github', target: { [isPr ? 'pull' : 'issue']: String(it.number), repo: k ? k.name : undefined } },
            score: 0.7,
          });
        }
      }
      json(res, { items: items.slice(0, limit) });
    } catch (e) { json(res, { error: e.message }, /not configured/i.test(e.message) ? 400 : 502); }
  }
  ctx.addRoute('GET', '/search', (req, res, url) => handleSearch(req, res, url));

  ctx.addRoute('GET', '/attention', (req, res, url) => __attentionHandler(req, res, url, async (req) => { const r = await __selfGet(req, '/api/github/review-requests', 60000); const n = r && Array.isArray(r.items) ? r.items.length : 0; return n ? [{ level: 'warn', text: `${n} pull request${n === 1 ? '' : 's'} wait${n === 1 ? 's' : ''} for your review.` }] : []; }));
  const { shell } = ctx;
  const { https, fs, path, gitExec, sanitizeText, permGate, getRepoPath } = shell;
  const { spawnSync } = require('child_process');

  // --- Helpers -------------------------------------------------------------

  // Which GitHub repository a folder is. Asked for every configured repository on every search,
  // so it reads .git/config (a file, not a git process per repository - 41 of those blocked the
  // whole server for over two seconds a question) and remembers the answer for five minutes.
  // A worktree or an unreadable config still asks git.
  const remoteCache = new Map();
  const REMOTE_TTL_MS = 5 * 60 * 1000;
  function originFromConfig(repoPath) {
    const fs = require('fs');
    const path = require('path');
    try {
      const dotGit = path.join(repoPath, '.git');
      if (!fs.statSync(dotGit).isDirectory()) return undefined;
      const cfg = fs.readFileSync(path.join(dotGit, 'config'), 'utf8');
      const section = cfg.match(/\[remote "origin"\]([\s\S]*?)(?=\n\s*\[|$)/);
      const url = section && section[1].match(/^\s*url\s*=\s*(.+)$/m);
      return url ? url[1].trim() : null;
    } catch (_) { return undefined; }
  }
  function parseGitHubRemote(repoPath) {
    const hit = remoteCache.get(repoPath);
    if (hit && Date.now() - hit.at < REMOTE_TTL_MS) return hit.value;
    let url = originFromConfig(repoPath);
    if (url === undefined) { try { url = gitExec(repoPath, 'remote get-url origin'); } catch (_) { url = null; } }
    const m = url ? url.match(/github\.com[:/]([^/]+)\/([^/.]+)/) : null;
    const value = m ? { owner: m[1], repo: m[2] } : null;
    remoteCache.set(repoPath, { at: Date.now(), value });
    return value;
  }

  function resolveGitHub(repoName) {
    const repoPath = getRepoPath(repoName);
    if (!repoPath) return { error: 'Repo not found' };
    const gh = parseGitHubRemote(repoPath);
    if (!gh) return { error: 'Not a GitHub repository' };
    return gh;
  }

  function ghRequest(method, apiPath, body, accept) {
    return new Promise((resolve, reject) => {
      const cfg = ctx.getConfig();
      const pat = cfg.GitHubPAT;
      if (!pat) return reject(new Error('GitHub PAT not configured. Set it in Settings > Plugins > GitHub.'));
      const payload = body ? JSON.stringify(body) : null;
      const options = {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          'Authorization': `token ${pat}`,
          'Accept': accept || 'application/vnd.github+json',
          'User-Agent': 'Cadence',
          'Content-Type': 'application/json',
        },
      };
      if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
      const req = https.request(options, (resp) => {
        let data = '';
        resp.on('data', c => { data += c; });
        resp.on('end', () => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            try { resolve(JSON.parse(data)); } catch (_) { resolve(data); }
          } else {
            const msg = resp.statusCode === 401
              ? 'GitHub auth failed -- PAT may be expired or invalid'
              : `GitHub API error (${resp.statusCode}): ${data.slice(0, 300)}`;
            reject(new Error(msg));
          }
        });
      });
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  }

  // Plain text from GitHub, following the one redirect it uses for logs and archives.
  function ghText(apiPath, hops) {
    return new Promise((resolve, reject) => {
      const pat = ctx.getConfig().GitHubPAT;
      if (!pat) return reject(new Error('GitHub PAT not configured. Set it in Settings > Plugins > GitHub.'));
      const target = /^https:/.test(apiPath) ? new URL(apiPath) : null;
      const options = {
        hostname: target ? target.hostname : 'api.github.com',
        path: target ? target.pathname + target.search : apiPath,
        method: 'GET',
        headers: target ? { 'User-Agent': 'Cadence' } : { 'Authorization': `token ${pat}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'Cadence' },
      };
      const req = https.request(options, (resp) => {
        if ((resp.statusCode === 301 || resp.statusCode === 302 || resp.statusCode === 307) && resp.headers.location && (hops || 0) < 3) {
          resp.resume();
          return ghText(resp.headers.location, (hops || 0) + 1).then(resolve, reject);
        }
        let data = '';
        resp.on('data', (c) => { data += c; });
        resp.on('end', () => (resp.statusCode >= 200 && resp.statusCode < 300) ? resolve(data) : reject(new Error(`GitHub API error (${resp.statusCode}): ${data.slice(0, 300)}`)));
      });
      req.on('error', reject);
      req.end();
    });
  }

  const json = (res, data, status) => {
    res.writeHead(status || 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // --- Route handlers ------------------------------------------------------

  function handleRepoInfo(req, res, url) {
    const gh = resolveGitHub(url.searchParams.get('repo'));
    if (gh.error) return json(res, gh, 400);
    json(res, gh);
  }

  async function handlePulls(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const state = url.searchParams.get('state') || 'open';
      const cacheKey = `github:pulls:${gh.owner}/${gh.repo}:${state}`;
      const result = ctx.cache
        ? await ctx.cache.get(cacheKey, async () => fetchPulls(gh, state))
        : await fetchPulls(gh, state);
      json(res, result);
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function fetchPulls(gh, state) {
    const data = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls?state=${state}&per_page=30&sort=updated&direction=desc`);
    const reviewResults = await Promise.all(data.map(pr =>
      ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${pr.number}/reviews`).catch(() => [])
    ));
    const pulls = data.map((pr, i) => {
      const reviews = reviewResults[i] || [];
      const byUser = {};
      for (const r of reviews) {
        if (r.state && r.state !== 'PENDING' && r.state !== 'COMMENTED') byUser[r.user && r.user.login] = r.state;
      }
      const reviewStates = Object.values(byUser);
      const reviewStatus = reviewStates.includes('CHANGES_REQUESTED') ? 'changes_requested'
        : reviewStates.includes('APPROVED') ? 'approved' : null;
      return {
        number: pr.number, title: pr.title, state: pr.state, draft: pr.draft,
        author: (pr.user && pr.user.login) || '', authorAvatar: (pr.user && pr.user.avatar_url) || '',
        createdAt: pr.created_at, updatedAt: pr.updated_at,
        headRef: (pr.head && pr.head.ref) || '', baseRef: (pr.base && pr.base.ref) || '',
        headSha: (pr.head && pr.head.sha) || '',
        labels: (pr.labels || []).map(l => ({ name: l.name, color: l.color })),
        reviewers: (pr.requested_reviewers || []).map(r => r.login),
        additions: pr.additions, deletions: pr.deletions,
        comments: (pr.comments || 0) + (pr.review_comments || 0),
        reviewStatus,
        htmlUrl: pr.html_url || '',
      };
    });
    return { pulls };
  }

  async function handlePullDetail(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const num = url.searchParams.get('number');
      const [pr, reviews] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}`, null, 'application/vnd.github.html+json'),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}/reviews`).catch(() => []),
      ]);
      const byUser = {};
      for (const r of reviews) {
        if (r.state && r.state !== 'PENDING' && r.state !== 'COMMENTED') byUser[r.user && r.user.login] = r.state;
      }
      const reviewStates = Object.values(byUser);
      const reviewStatus = reviewStates.includes('CHANGES_REQUESTED') ? 'changes_requested'
        : reviewStates.includes('APPROVED') ? 'approved' : null;
      json(res, {
        number: pr.number, title: pr.title, state: pr.state, draft: pr.draft,
        body: pr.body || '', bodyHtml: pr.body_html || '',
        mergeable: pr.mergeable, merged: pr.merged,
        author: (pr.user && pr.user.login) || '', authorAvatar: (pr.user && pr.user.avatar_url) || '',
        createdAt: pr.created_at, updatedAt: pr.updated_at,
        headRef: (pr.head && pr.head.ref) || '', baseRef: (pr.base && pr.base.ref) || '',
        headSha: (pr.head && pr.head.sha) || '',
        mergeableState: pr.mergeable_state || '',
        additions: pr.additions, deletions: pr.deletions,
        changedFiles: pr.changed_files,
        labels: (pr.labels || []).map(l => ({ name: l.name, color: l.color })),
        reviewers: (pr.requested_reviewers || []).map(r => r.login),
        htmlUrl: pr.html_url || '',
        reviewStatus,
        comments: (pr.comments || 0) + (pr.review_comments || 0),
      });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handlePullFiles(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const num = url.searchParams.get('number');
      const data = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}/files?per_page=100`);
      const files = data.map(f => ({
        filename: f.filename, status: f.status,
        additions: f.additions, deletions: f.deletions,
        patch: f.patch || null,
      }));
      json(res, { files });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handlePullComments(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const num = url.searchParams.get('number');
      const [issueComments, reviewComments] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/issues/${num}/comments?per_page=100`),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}/comments?per_page=100`),
      ]);
      const all = [
        ...issueComments.map(c => ({ id: c.id, author: (c.user && c.user.login) || '', avatar: (c.user && c.user.avatar_url) || '', body: c.body, createdAt: c.created_at, type: 'comment' })),
        ...reviewComments.map(c => ({ id: c.id, author: (c.user && c.user.login) || '', avatar: (c.user && c.user.avatar_url) || '', body: c.body, createdAt: c.created_at, type: 'review', path: c.path, line: c.line })),
      ].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      json(res, { comments: all });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handlePullTimeline(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const num = url.searchParams.get('number');
      const [data, reviewComments] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/issues/${num}/timeline?per_page=100`, null, 'application/vnd.github.html+json'),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}/comments?per_page=100`),
      ]);
      const reviewCommentsMap = {};
      for (const c of reviewComments) {
        const rid = c.pull_request_review_id;
        if (!rid) continue;
        if (!reviewCommentsMap[rid]) reviewCommentsMap[rid] = [];
        reviewCommentsMap[rid].push({
          id: c.id, author: (c.user && c.user.login) || '', avatar: (c.user && c.user.avatar_url) || '',
          body: c.body || '', bodyHtml: c.body_html || '',
          path: c.path || '', line: c.line || c.original_line || null,
          createdAt: c.created_at || '',
          diffHunk: c.diff_hunk || '',
        });
      }
      const events = [];
      for (const e of data) {
        const ev = { type: e.event || (e.node_id && e.node_id.split('/')[0]) || 'unknown', createdAt: e.created_at || e.submitted_at || e.timestamp || '' };
        if (e.event === 'commented' || (!e.event && e.body !== undefined)) {
          ev.type = 'commented';
          ev.author = (e.user && e.user.login) || (e.actor && e.actor.login) || '';
          ev.avatar = (e.user && e.user.avatar_url) || (e.actor && e.actor.avatar_url) || '';
          ev.body = e.body || '';
          ev.bodyHtml = e.body_html || '';
        } else if (e.event === 'reviewed') {
          ev.author = (e.user && e.user.login) || '';
          ev.avatar = (e.user && e.user.avatar_url) || '';
          ev.state = e.state;
          ev.body = e.body || '';
          ev.bodyHtml = e.body_html || '';
          const rid = e.id;
          if (rid && reviewCommentsMap[rid]) {
            ev.comments = reviewCommentsMap[rid];
            delete reviewCommentsMap[rid];
          }
        } else if (e.event === 'committed') {
          ev.sha = e.sha;
          ev.message = e.message;
          ev.author = (e.author && e.author.name) || '';
        } else if (e.event === 'review_requested') {
          ev.actor = (e.actor && e.actor.login) || '';
          ev.reviewer = (e.requested_reviewer && e.requested_reviewer.login) || '';
        } else if (e.event === 'assigned' || e.event === 'unassigned') {
          ev.actor = (e.actor && e.actor.login) || '';
          ev.assignee = (e.assignee && e.assignee.login) || '';
        } else if (e.event === 'labeled' || e.event === 'unlabeled') {
          ev.actor = (e.actor && e.actor.login) || '';
          ev.label = (e.label && e.label.name) || '';
          ev.labelColor = (e.label && e.label.color) || '';
        } else if (e.event === 'head_ref_force_pushed' || e.event === 'head_ref_deleted') {
          ev.actor = (e.actor && e.actor.login) || '';
        } else if (e.event === 'merged') {
          ev.actor = (e.actor && e.actor.login) || '';
          ev.commitId = e.commit_id || '';
        } else if (e.event === 'closed' || e.event === 'reopened') {
          ev.actor = (e.actor && e.actor.login) || '';
        } else {
          ev.actor = (e.actor && e.actor.login) || '';
        }
        events.push(ev);
      }
      for (const [, comments] of Object.entries(reviewCommentsMap)) {
        for (const c of comments) {
          events.push({
            type: 'review_comment', createdAt: c.createdAt,
            author: c.author, avatar: c.avatar,
            body: c.body, bodyHtml: c.bodyHtml,
            path: c.path, line: c.line, diffHunk: c.diffHunk,
          });
        }
      }
      events.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      json(res, { events });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handleAddComment(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/pulls/comment', 'Comment on GitHub PR'))) return;
      const { repo, number, body } = await ctx.readBody(req);
      if (!repo || !number || !body) return json(res, { error: 'repo, number, and body are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const result = await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/issues/${number}/comments`, { body: sanitizeText(body) });
      json(res, { ok: true, id: result.id });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handleSubmitReview(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/pulls/review', 'Submit GitHub PR review'))) return;
      const { repo, number, event, body, comments } = await ctx.readBody(req);
      if (!repo || !number || !event) return json(res, { error: 'repo, number, and event are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const payload = { event };
      if (body) payload.body = sanitizeText(body);
      // Inline comments: [{ path, line, side?, body }] on the PR's current head.
      if (Array.isArray(comments) && comments.length) {
        payload.comments = comments.filter((c) => c && c.path && c.body && Number(c.line) > 0).map((c) => ({ path: String(c.path), line: Number(c.line), side: c.side === 'LEFT' ? 'LEFT' : 'RIGHT', body: sanitizeText(String(c.body)) }));
      }
      const result = await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/pulls/${number}/reviews`, payload);
      json(res, { ok: true, state: result.state });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  function handleImageProxy(req, res, url) {
    const imgUrl = url.searchParams.get('url');
    if (!imgUrl || !/^https:\/\/(github\.com\/|[a-z0-9.-]*githubusercontent\.com\/)/i.test(imgUrl)) {
      res.writeHead(400); res.end('Invalid URL'); return;
    }
    const cfg = ctx.getConfig();
    const pat = cfg.GitHubPAT;
    const parsed = new URL(imgUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'Authorization': `token ${pat}`, 'User-Agent': 'Cadence', 'Accept': '*/*' },
    };
    const proxy = https.request(options, (upstream) => {
      if (upstream.statusCode === 301 || upstream.statusCode === 302) {
        const loc = upstream.headers.location;
        if (loc) {
          const redir = new URL(loc);
          const redirOpts = {
            hostname: redir.hostname,
            path: redir.pathname + redir.search,
            method: 'GET',
            headers: { 'User-Agent': 'Cadence', 'Accept': '*/*' },
          };
          const r2 = https.request(redirOpts, (resp2) => {
            res.writeHead(resp2.statusCode, {
              'Content-Type': resp2.headers['content-type'] || 'image/png',
              'Cache-Control': 'public, max-age=3600',
            });
            resp2.pipe(res);
          });
          r2.on('error', () => { res.writeHead(502); res.end(); });
          r2.end();
          return;
        }
      }
      res.writeHead(upstream.statusCode, {
        'Content-Type': upstream.headers['content-type'] || 'image/png',
        'Cache-Control': 'public, max-age=3600',
      });
      upstream.pipe(res);
    });
    proxy.on('error', () => { res.writeHead(502); res.end(); });
    proxy.end();
  }

  async function handleUserRepos(req, res, url) {
    try {
      const query = (url.searchParams.get('q') || '').toLowerCase();
      const page = parseInt(url.searchParams.get('page')) || 1;
      const perPage = 50;
      const repos = await ghRequest('GET', `/user/repos?sort=pushed&per_page=${perPage}&page=${page}&affiliation=owner,collaborator,organization_member`);
      const items = repos.map(r => ({
        name: r.name,
        full_name: r.full_name,
        description: r.description || '',
        private: r.private,
        clone_url: r.clone_url,
        ssh_url: r.ssh_url,
        html_url: r.html_url,
        default_branch: r.default_branch,
        pushed_at: r.pushed_at,
        language: r.language,
      }));
      const filtered = query ? items.filter(r =>
        r.name.toLowerCase().includes(query) || r.full_name.toLowerCase().includes(query)
      ) : items;
      json(res, { repos: filtered, page, hasMore: repos.length === perPage });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleClone(req, res) {
    try {
      const { cloneUrl, destPath } = await ctx.readBody(req);
      if (!cloneUrl || !destPath) return json(res, { error: 'cloneUrl and destPath are required' }, 400);
      if (!fs.existsSync(destPath)) return json(res, { error: `Destination does not exist: ${destPath}` }, 400);
      const match = cloneUrl.match(/\/([^/]+?)(?:\.git)?$/);
      const repoFolder = match ? match[1] : 'repo';
      const fullDest = path.join(destPath, repoFolder);
      if (fs.existsSync(fullDest)) return json(res, { error: `Folder already exists: ${fullDest}` }, 400);
      const cfg = ctx.getConfig();
      let authUrl = cloneUrl;
      if (cfg.GitHubPAT && cloneUrl.startsWith('https://')) {
        authUrl = cloneUrl.replace('https://', `https://${cfg.GitHubPAT}@`);
      }
      const result = spawnSync('git', ['clone', authUrl, fullDest], {
        encoding: 'utf8',
        timeout: 120000,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
      if (result.error || result.status !== 0) {
        throw new Error((result.stderr || result.stdout || (result.error && result.error.message) || 'git clone failed').trim());
      }
      json(res, { ok: true, path: fullDest, name: repoFolder });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  async function handleCreatePullRequest(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/pull-request', 'Create pull request'))) return;
      const { repoName, title, description, sourceBranch, targetBranch, workItemId } = await ctx.readBody(req);
      const cfg = ctx.getConfig();
      if (!repoName) return json(res, { error: 'repoName is required' }, 400);
      if (!title)    return json(res, { error: 'title is required' }, 400);
      const gh = resolveGitHub(repoName);
      if (gh.error) return json(res, gh, 400);
      let source = sourceBranch;
      if (!source) {
        const repoPath = cfg.Repos && cfg.Repos[repoName];
        if (repoPath) { try { source = gitExec(repoPath, 'rev-parse --abbrev-ref HEAD'); } catch (_) {} }
      }
      if (!source) return json(res, { error: 'Could not determine source branch' }, 400);
      const target = targetBranch || 'main';
      let body = description || '';
      if (workItemId) {
        // Cross-plugin soft reference: if the Azure DevOps plugin is configured,
        // link to the work item in ADO. Otherwise just record the AB# text.
        const adoOrg = cfg.AzureDevOpsOrg;
        const adoProject = cfg.AzureDevOpsProject;
        if (adoOrg && adoProject) {
          const adoUrl = `https://dev.azure.com/${adoOrg}/${encodeURIComponent(adoProject)}/_workitems/edit/${workItemId}`;
          body += `${body ? '\n\n' : ''}AB#${workItemId} - [View in Azure DevOps](${adoUrl})`;
        } else {
          body += `${body ? '\n\n' : ''}AB#${workItemId}`;
        }
      }
      const pr = await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/pulls`, {
        title: sanitizeText(title),
        body: sanitizeText(body),
        head: source,
        base: target,
      });
      json(res, { ok: true, pullRequestId: pr.number, url: pr.html_url, title: pr.title });
    } catch (e) { json(res, { error: e.message }, 500); }
  }

  // --- 3.0: what the plugin's own screens and its AI need ------------------

  // Who the PAT belongs to, so "awaiting you" means you.
  let meCache = null;
  async function handleMe(req, res) {
    try {
      if (!meCache) { const u = await ghRequest('GET', '/user'); meCache = { login: u.login, name: u.name || '', avatar: u.avatar_url || '' }; }
      json(res, meCache);
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // Open PRs across every repo that ask for your review.
  async function handleReviewRequests(req, res) {
    try {
      const data = await ghRequest('GET', '/search/issues?q=' + encodeURIComponent('is:pr is:open review-requested:@me') + '&sort=updated&per_page=30');
      const items = (data.items || []).map(i => {
        const m = String(i.repository_url || '').match(/\/repos\/([^/]+)\/([^/]+)$/);
        return { number: i.number, title: i.title, author: (i.user && i.user.login) || '', updatedAt: i.updated_at, htmlUrl: i.html_url, owner: m ? m[1] : '', repo: m ? m[2] : '', draft: !!i.draft };
      });
      json(res, { items, total: data.total_count || items.length });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // Checks and statuses on a PR's head commit, in one list.
  async function handlePullChecks(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const num = url.searchParams.get('number');
      let sha = url.searchParams.get('sha');
      if (!sha) { const pr = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}`); sha = pr.head && pr.head.sha; }
      if (!sha) return json(res, { checks: [] });
      const [runs, status] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/commits/${sha}/check-runs?per_page=100`).catch(() => ({ check_runs: [] })),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/commits/${sha}/status`).catch(() => ({ statuses: [] })),
      ]);
      const checks = [
        ...((runs.check_runs || []).map(c => ({ name: c.name, status: c.status, conclusion: c.conclusion || null, url: c.html_url || c.details_url || '', app: (c.app && c.app.name) || '', startedAt: c.started_at, completedAt: c.completed_at }))),
        ...((status.statuses || []).map(s => ({ name: s.context, status: s.state === 'pending' ? 'in_progress' : 'completed', conclusion: s.state === 'success' ? 'success' : s.state === 'pending' ? null : s.state, url: s.target_url || '', app: 'status', startedAt: s.created_at, completedAt: s.updated_at }))),
      ];
      json(res, { sha, checks });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // The unified diff of a PR, capped, for a reviewer that reads text.
  async function handlePullDiff(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const num = url.searchParams.get('number');
      const cap = Math.min(600000, Math.max(20000, parseInt(url.searchParams.get('cap') || '', 10) || 250000));
      const diff = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${num}`, null, 'application/vnd.github.diff');
      const text = typeof diff === 'string' ? diff : JSON.stringify(diff);
      json(res, { number: Number(num), bytes: text.length, truncated: text.length > cap, diff: text.slice(0, cap) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // Merge a PR. Gated like a review; the method is the user's choice.
  async function handleMerge(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/pulls/merge', 'Merge GitHub PR'))) return;
      const { repo, number, method, title, message } = await ctx.readBody(req);
      if (!repo || !number) return json(res, { error: 'repo and number are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const payload = { merge_method: ['merge', 'squash', 'rebase'].includes(method) ? method : 'squash' };
      if (title) payload.commit_title = sanitizeText(title);
      if (message) payload.commit_message = sanitizeText(message);
      const result = await ghRequest('PUT', `/repos/${gh.owner}/${gh.repo}/pulls/${number}/merge`, payload);
      json(res, { ok: !!result.merged, merged: !!result.merged, sha: result.sha || '', message: result.message || '' });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // Git repositories under a folder (a code folder, a drive), a few levels deep, with their
  // origin, so the Local panel can show what is on disk and not yet in the workspace.
  function handleLocalRepos(req, res, url) {
    try {
      const root = url.searchParams.get('root');
      const depth = Math.min(5, Math.max(1, parseInt(url.searchParams.get('depth') || '', 10) || 3));
      if (!root || !fs.existsSync(root)) return json(res, { error: 'root is required and must exist' }, 400);
      const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.cache', 'coverage', '$recycle.bin', 'system volume information', 'windows', 'program files', 'program files (x86)', 'programdata', 'appdata']);
      const found = [];
      let visited = 0;
      const walk = (dir, level) => {
        if (visited > 4000 || found.length > 400) return;
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
        visited += 1;
        if (entries.some((e) => e.name === '.git')) {
          let origin = '';
          try { origin = gitExec(dir, 'remote get-url origin'); } catch (_) {}
          const m = String(origin).match(/github\.com[:/]([^/]+)\/([^/.]+)/);
          found.push({ name: path.basename(dir), path: dir, origin: String(origin || '').trim(), github: m ? `${m[1]}/${m[2]}` : null });
          return;
        }
        if (level >= depth) return;
        for (const e of entries) {
          if (!e.isDirectory() || e.name.startsWith('.') || SKIP.has(e.name.toLowerCase())) continue;
          walk(path.join(dir, e.name), level + 1);
        }
      };
      walk(root, 0);
      found.sort((a, b) => a.name.localeCompare(b.name));
      json(res, { root, repos: found, visited, truncated: visited > 4000 || found.length > 400 });
    } catch (e) { json(res, { error: e.message }, 500); }
  }
  ctx.addAbsoluteRoute('GET',  '/api/github/local-repos',     handleLocalRepos);

  // --- Issues ---------------------------------------------------------------
  // GitHub's issues API returns pull requests too; everything here keeps the issues only.
  const issueSummary = (i) => ({
    number: i.number, title: i.title, state: i.state, stateReason: i.state_reason || null,
    author: (i.user && i.user.login) || '', authorAvatar: (i.user && i.user.avatar_url) || '',
    assignees: (i.assignees || []).map((a) => a.login),
    labels: (i.labels || []).map((l) => ({ name: l.name, color: l.color })),
    milestone: (i.milestone && i.milestone.title) || null,
    comments: i.comments || 0,
    createdAt: i.created_at, updatedAt: i.updated_at, closedAt: i.closed_at || null,
    htmlUrl: i.html_url || '',
  });

  async function handleIssues(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const state = url.searchParams.get('state') || 'open';
      const labels = url.searchParams.get('labels') || '';
      const assignee = url.searchParams.get('assignee') || '';
      const per = state === 'open' ? 100 : 50;
      const data = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/issues?state=${state}&per_page=${per}&sort=updated&direction=desc${labels ? `&labels=${encodeURIComponent(labels)}` : ''}${assignee ? `&assignee=${encodeURIComponent(assignee)}` : ''}`);
      json(res, { issues: (Array.isArray(data) ? data : []).filter((i) => !i.pull_request).map(issueSummary) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleIssueDetail(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const num = url.searchParams.get('number');
      const [issue, comments, timeline] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/issues/${num}`),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/issues/${num}/comments?per_page=100`).catch(() => []),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/issues/${num}/timeline?per_page=100`).catch(() => []),
      ]);
      // Pull requests that reference or close this issue, from the timeline.
      const linked = [];
      const seen = new Set();
      for (const e of timeline) {
        const src = e.source && e.source.issue;
        if ((e.event === 'cross-referenced' || e.event === 'connected') && src && src.pull_request && !seen.has(src.number)) {
          seen.add(src.number);
          linked.push({ number: src.number, title: src.title, state: src.state, merged: !!(src.pull_request && src.pull_request.merged_at), author: (src.user && src.user.login) || '', htmlUrl: src.html_url || '' });
        }
      }
      const events = timeline.filter((e) => ['closed', 'reopened', 'assigned', 'unassigned', 'labeled', 'unlabeled', 'milestoned', 'renamed'].includes(e.event)).map((e) => ({
        type: e.event, at: e.created_at || '', actor: (e.actor && e.actor.login) || '',
        assignee: (e.assignee && e.assignee.login) || '', label: (e.label && e.label.name) || '', milestone: (e.milestone && e.milestone.title) || '',
        from: (e.rename && e.rename.from) || '', to: (e.rename && e.rename.to) || '', reason: e.state_reason || '',
      }));
      json(res, {
        ...issueSummary(issue), body: issue.body || '',
        comments: comments.map((c) => ({ id: c.id, author: (c.user && c.user.login) || '', avatar: (c.user && c.user.avatar_url) || '', body: c.body || '', createdAt: c.created_at })),
        linkedPulls: linked, events,
      });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleIssueComment(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/issues/comment', 'Comment on GitHub issue'))) return;
      const { repo, number, body } = await ctx.readBody(req);
      if (!repo || !number || !body) return json(res, { error: 'repo, number and body are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const result = await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/issues/${number}/comments`, { body: sanitizeText(body) });
      json(res, { ok: true, id: result.id });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // State, title, labels, assignees, milestone - whatever the body names.
  async function handleIssueUpdate(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/issues/update', 'Update GitHub issue'))) return;
      const { repo, number, state, stateReason, title, body, labels, assignees } = await ctx.readBody(req);
      if (!repo || !number) return json(res, { error: 'repo and number are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const payload = {};
      if (state === 'open' || state === 'closed') { payload.state = state; if (state === 'closed' && stateReason) payload.state_reason = stateReason; }
      if (typeof title === 'string' && title.trim()) payload.title = sanitizeText(title);
      if (typeof body === 'string') payload.body = sanitizeText(body);
      if (Array.isArray(labels)) payload.labels = labels.map(String);
      if (Array.isArray(assignees)) payload.assignees = assignees.map(String);
      const result = await ghRequest('PATCH', `/repos/${gh.owner}/${gh.repo}/issues/${number}`, payload);
      json(res, { ok: true, ...issueSummary(result) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleIssueCreate(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/issues/create', 'Create GitHub issue'))) return;
      const { repo, title, body, labels, assignees } = await ctx.readBody(req);
      if (!repo || !title) return json(res, { error: 'repo and title are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const payload = { title: sanitizeText(title), body: sanitizeText(body || '') };
      if (Array.isArray(labels) && labels.length) payload.labels = labels.map(String);
      if (Array.isArray(assignees) && assignees.length) payload.assignees = assignees.map(String);
      const result = await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/issues`, payload);
      json(res, { ok: true, ...issueSummary(result) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // Start working on an issue: a branch named after it in the local repo, the issue assigned
  // to you. The shell and the AI are the app's part.
  async function handleIssueStart(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/issues/start', 'Start working on GitHub issue'))) return;
      const { repo, number } = await ctx.readBody(req);
      if (!repo || !number) return json(res, { error: 'repo and number are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const repoPath = getRepoPath(repo);
      const issue = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/issues/${number}`);
      const slug = String(issue.title || 'work').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      const isBug = (issue.labels || []).some((l) => /bug/i.test(l.name));
      const branch = `${isBug ? 'fix' : 'feature'}/issue-${number}-${slug}`;
      const steps = [];
      let base = 'main';
      try { gitExec(repoPath, 'checkout main'); } catch (_) { base = 'master'; gitExec(repoPath, 'checkout master'); }
      steps.push(`checked out ${base}`);
      try { gitExec(repoPath, 'pull'); steps.push('pulled'); } catch (e) { steps.push(`pull failed: ${e.message}`); }
      let existed = false;
      try { gitExec(repoPath, `checkout -b ${branch}`); steps.push(`created ${branch}`); } catch (_) { gitExec(repoPath, `checkout ${branch}`); existed = true; steps.push(`switched to existing ${branch}`); }
      let me = null;
      try { me = (await ghRequest('GET', '/user')).login; } catch (_) {}
      if (me && !(issue.assignees || []).some((a) => a.login === me)) {
        try { await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/issues/${number}/assignees`, { assignees: [me] }); steps.push(`assigned to ${me}`); } catch (e) { steps.push(`assign failed: ${e.message}`); }
      }
      json(res, { ok: true, branch, base, existed, steps, assignedTo: me });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleLabels(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const data = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/labels?per_page=100`);
      json(res, { labels: (data || []).map((l) => ({ name: l.name, color: l.color, description: l.description || '' })) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleCollaborators(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const data = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/collaborators?per_page=100&affiliation=all`).catch(() => []);
      json(res, { people: (data || []).map((u) => ({ login: u.login, avatar: u.avatar_url || '' })) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // --- Activity and team -------------------------------------------------------
  // What moved lately on the repository: commits, releases, closed things, opened things.
  async function handleActivity(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days') || 14)));
      const since = new Date(Date.now() - days * 86400000).toISOString();
      const [commits, events] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/commits?since=${since}&per_page=100`).catch(() => []),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/events?per_page=100`).catch(() => []),
      ]);
      const out = {
        days,
        commits: (commits || []).map((c) => ({ sha: c.sha, short: c.sha.slice(0, 7), message: (c.commit.message || '').split('\n')[0], author: (c.author && c.author.login) || (c.commit.author && c.commit.author.name) || '', at: c.commit.author && c.commit.author.date, htmlUrl: c.html_url })),
        events: (events || []).filter((e) => new Date(e.created_at) >= new Date(since)).map((e) => {
          const p = e.payload || {};
          let what = e.type.replace(/Event$/, '');
          let ref = '';
          if (e.type === 'PushEvent') { what = 'pushed'; ref = `${(p.commits || []).length} commit${(p.commits || []).length === 1 ? '' : 's'} to ${String(p.ref || '').replace('refs/heads/', '')}`; }
          else if (e.type === 'PullRequestEvent') { what = `${p.action} PR`; ref = `#${p.number} ${(p.pull_request && p.pull_request.title) || ''}`; }
          else if (e.type === 'IssuesEvent') { what = `${p.action} issue`; ref = `#${p.issue && p.issue.number} ${(p.issue && p.issue.title) || ''}`; }
          else if (e.type === 'IssueCommentEvent') { what = 'commented'; ref = `#${p.issue && p.issue.number} ${(p.issue && p.issue.title) || ''}`; }
          else if (e.type === 'PullRequestReviewEvent') { what = `reviewed (${(p.review && p.review.state) || ''})`; ref = `#${p.pull_request && p.pull_request.number}`; }
          else if (e.type === 'PullRequestReviewCommentEvent') { what = 'commented on diff'; ref = `#${p.pull_request && p.pull_request.number}`; }
          else if (e.type === 'CreateEvent') { what = `created ${p.ref_type}`; ref = p.ref || ''; }
          else if (e.type === 'DeleteEvent') { what = `deleted ${p.ref_type}`; ref = p.ref || ''; }
          else if (e.type === 'ReleaseEvent') { what = `${p.action} release`; ref = (p.release && (p.release.name || p.release.tag_name)) || ''; }
          return { type: e.type, what, ref, actor: (e.actor && e.actor.login) || '', at: e.created_at };
        }),
      };
      json(res, out);
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // Who works on the repository, from its collaborators and its recent history.
  async function handleTeam(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [collab, commits, pulls, issues] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/collaborators?per_page=100&affiliation=all`).catch(() => []),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/commits?since=${since}&per_page=100`).catch(() => []),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls?state=all&per_page=100&sort=updated&direction=desc`).catch(() => []),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/issues?state=open&per_page=100`).catch(() => []),
      ]);
      const people = {};
      const at = (login, avatar) => { if (!login) return null; if (!people[login]) people[login] = { login, avatar: avatar || '', collaborator: false, commits: 0, prsOpen: 0, prsMerged: 0, reviewsAsked: 0, issuesHeld: 0, lastSeen: null }; return people[login]; };
      for (const c of collab || []) { const p = at(c.login, c.avatar_url); if (p) p.collaborator = true; }
      const seen = (p, when) => { if (p && when && (!p.lastSeen || new Date(when) > new Date(p.lastSeen))) p.lastSeen = when; };
      for (const c of commits || []) { const p = at(c.author && c.author.login, c.author && c.author.avatar_url); if (p) { p.commits++; seen(p, c.commit.author && c.commit.author.date); } }
      for (const pr of pulls || []) {
        const p = at(pr.user && pr.user.login, pr.user && pr.user.avatar_url);
        if (p) { if (pr.state === 'open') p.prsOpen++; if (pr.merged_at) p.prsMerged++; seen(p, pr.updated_at); }
        for (const r of pr.requested_reviewers || []) { const q = at(r.login, r.avatar_url); if (q && pr.state === 'open') q.reviewsAsked++; }
      }
      for (const i of issues || []) { if (i.pull_request) continue; for (const a of i.assignees || []) { const p = at(a.login, a.avatar_url); if (p) p.issuesHeld++; } }
      json(res, { people: Object.values(people).sort((a, b) => (b.commits + b.prsOpen + b.prsMerged) - (a.commits + a.prsOpen + a.prsMerged)) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // --- Actions ----------------------------------------------------------------------
  const runSummary = (r) => ({ id: r.id, name: r.name || r.display_title || '', title: r.display_title || '', number: r.run_number, event: r.event, status: r.status, conclusion: r.conclusion, branch: r.head_branch, sha: (r.head_sha || '').slice(0, 7), actor: (r.actor && r.actor.login) || '', createdAt: r.created_at, updatedAt: r.updated_at, htmlUrl: r.html_url, attempt: r.run_attempt || 1 });

  async function handleRuns(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const branch = url.searchParams.get('branch');
      const data = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/actions/runs?per_page=${url.searchParams.get('limit') || 40}${branch ? `&branch=${encodeURIComponent(branch)}` : ''}`);
      const wf = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/actions/workflows?per_page=50`).catch(() => ({ workflows: [] }));
      json(res, { total: data.total_count || 0, runs: (data.workflow_runs || []).map(runSummary), workflows: (wf.workflows || []).map((w) => ({ id: w.id, name: w.name, path: w.path, state: w.state })) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // One run with its jobs and steps; failed jobs bring the tail of their log.
  async function handleRun(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const id = url.searchParams.get('id');
      const [run, jobs] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/actions/runs/${id}`),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/actions/runs/${id}/jobs?per_page=50`).catch(() => ({ jobs: [] })),
      ]);
      const out = { ...runSummary(run), message: (run.head_commit && run.head_commit.message) || '', jobs: [] };
      for (const j of jobs.jobs || []) {
        const job = { id: j.id, name: j.name, status: j.status, conclusion: j.conclusion, startedAt: j.started_at, completedAt: j.completed_at, htmlUrl: j.html_url, steps: (j.steps || []).map((st) => ({ name: st.name, status: st.status, conclusion: st.conclusion, number: st.number })), logTail: '' };
        if (j.conclusion === 'failure' && url.searchParams.get('logs') !== '0') {
          try {
            const text = await ghText(`/repos/${gh.owner}/${gh.repo}/actions/jobs/${j.id}/logs`);
            const lines = text.split('\n');
            // The failing part is near the end; keep the error-looking lines and the last stretch.
            const errIdx = lines.findIndex((l) => /##\[error\]|error:|Error:|FAIL|failed with exit code/i.test(l));
            const from = Math.max(0, Math.min(errIdx >= 0 ? errIdx - 20 : lines.length - 120, lines.length - 120));
            job.logTail = lines.slice(from, from + 160).map((l) => l.replace(/^\S+T\S+Z\s/, '')).join('\n').slice(0, 12000);
          } catch (e) { job.logTail = `(log not available: ${e.message})`; }
        }
        out.jobs.push(job);
      }
      json(res, out);
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleRerun(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/actions/rerun', 'Re-run GitHub Actions workflow'))) return;
      const { repo, id, failedOnly } = await ctx.readBody(req);
      if (!repo || !id) return json(res, { error: 'repo and id are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/actions/runs/${id}/${failedOnly ? 'rerun-failed-jobs' : 'rerun'}`, {});
      json(res, { ok: true });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // --- Releases -----------------------------------------------------------------------
  const releaseSummary = (r) => ({ id: r.id, tag: r.tag_name, name: r.name || r.tag_name, draft: !!r.draft, prerelease: !!r.prerelease, author: (r.author && r.author.login) || '', createdAt: r.created_at, publishedAt: r.published_at, htmlUrl: r.html_url, body: r.body || '', assets: (r.assets || []).map((a) => ({ name: a.name, size: a.size, downloads: a.download_count, url: a.browser_download_url })) });

  async function handleReleases(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const [rel, tags] = await Promise.all([
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/releases?per_page=30`),
        ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/tags?per_page=30`).catch(() => []),
      ]);
      json(res, { releases: (rel || []).map(releaseSummary), tags: (tags || []).map((t) => ({ name: t.name, sha: (t.commit && t.commit.sha || '').slice(0, 7) })) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // What went in since a tag (default: the latest release), for release notes.
  async function handleReleaseDelta(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      let from = url.searchParams.get('from');
      if (!from) { const latest = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/releases/latest`).catch(() => null); from = latest && latest.tag_name; }
      const to = url.searchParams.get('to') || (await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}`)).default_branch;
      if (!from) {
        const commits = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/commits?sha=${encodeURIComponent(to)}&per_page=50`);
        return json(res, { from: null, to, commits: commits.map((c) => ({ sha: c.sha.slice(0, 7), message: (c.commit.message || '').split('\n')[0], author: (c.author && c.author.login) || (c.commit.author && c.commit.author.name) || '' })), pulls: [] });
      }
      const cmp = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/compare/${encodeURIComponent(from)}...${encodeURIComponent(to)}`);
      const commits = (cmp.commits || []).map((c) => ({ sha: c.sha.slice(0, 7), message: (c.commit.message || '').split('\n')[0], author: (c.author && c.author.login) || (c.commit.author && c.commit.author.name) || '' }));
      const nums = new Set();
      for (const c of commits) { const m = c.message.match(/\(#(\d+)\)|Merge pull request #(\d+)/); if (m) nums.add(Number(m[1] || m[2])); }
      const pulls = [];
      for (const n of [...nums].slice(0, 30)) { try { const p = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${n}`); pulls.push({ number: n, title: p.title, author: (p.user && p.user.login) || '', labels: (p.labels || []).map((l) => l.name) }); } catch (_) {} }
      json(res, { from, to, ahead: cmp.ahead_by, commits, pulls });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleReleaseCreate(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/releases/create', 'Create GitHub release'))) return;
      const { repo, tag, name, body, draft, prerelease, target } = await ctx.readBody(req);
      if (!repo || !tag) return json(res, { error: 'repo and tag are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const payload = { tag_name: String(tag), name: sanitizeText(name || tag), body: sanitizeText(body || ''), draft: !!draft, prerelease: !!prerelease };
      if (target) payload.target_commitish = String(target);
      const r = await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/releases`, payload);
      json(res, { ok: true, ...releaseSummary(r) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // --- Inbox (notifications) ---------------------------------------------------------
  async function handleNotifications(req, res, url) {
    try {
      const all = url.searchParams.get('all') === '1';
      const data = await ghRequest('GET', `/notifications?per_page=50${all ? '&all=true' : ''}`);
      json(res, { items: (data || []).map((n) => {
        const m = String(n.subject && n.subject.url || '').match(/\/(pulls|issues|commits|releases)\/([^/]+)$/);
        return { id: n.id, unread: !!n.unread, reason: n.reason, title: (n.subject && n.subject.title) || '', type: (n.subject && n.subject.type) || '', number: m && m[1] !== 'commits' ? Number(m[2]) : null, owner: (n.repository && n.repository.owner && n.repository.owner.login) || '', repo: (n.repository && n.repository.name) || '', updatedAt: n.updated_at, htmlUrl: n.repository ? `${n.repository.html_url}/${m ? (m[1] === 'pulls' ? 'pull' : m[1] === 'issues' ? 'issues' : m[1] === 'releases' ? 'releases/tag' : 'commit') + '/' + m[2] : ''}` : '' };
      }) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handleNotificationsRead(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/notifications/read', 'Mark GitHub notifications read'))) return;
      const { id, all } = await ctx.readBody(req);
      if (all) await ghRequest('PUT', '/notifications', { read: true });
      else if (id) await ghRequest('PATCH', `/notifications/threads/${id}`, {});
      else return json(res, { error: 'id or all is required' }, 400);
      json(res, { ok: true });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // --- Pull requests: more --------------------------------------------------------------
  // Title, body, labels, assignees, reviewers, state, base - whatever the body names.
  async function handlePullUpdate(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/pulls/update', 'Update GitHub pull request'))) return;
      const { repo, number, title, body, state, base, labels, assignees, reviewers } = await ctx.readBody(req);
      if (!repo || !number) return json(res, { error: 'repo and number are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const did = [];
      const pull = {};
      if (typeof title === 'string' && title.trim()) pull.title = sanitizeText(title);
      if (typeof body === 'string') pull.body = sanitizeText(body);
      if (state === 'open' || state === 'closed') pull.state = state;
      if (typeof base === 'string' && base) pull.base = base;
      if (Object.keys(pull).length) { await ghRequest('PATCH', `/repos/${gh.owner}/${gh.repo}/pulls/${number}`, pull); did.push(...Object.keys(pull)); }
      if (Array.isArray(labels)) { await ghRequest('PUT', `/repos/${gh.owner}/${gh.repo}/issues/${number}/labels`, { labels: labels.map(String) }); did.push('labels'); }
      if (Array.isArray(assignees)) { await ghRequest('PATCH', `/repos/${gh.owner}/${gh.repo}/issues/${number}`, { assignees: assignees.map(String) }); did.push('assignees'); }
      if (Array.isArray(reviewers)) {
        const current = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${number}/requested_reviewers`).catch(() => ({ users: [] }));
        const have = (current.users || []).map((u) => u.login);
        const add = reviewers.map(String).filter((r) => !have.includes(r));
        const remove = have.filter((r) => !reviewers.includes(r));
        if (add.length) await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/pulls/${number}/requested_reviewers`, { reviewers: add });
        if (remove.length) await ghRequest('DELETE', `/repos/${gh.owner}/${gh.repo}/pulls/${number}/requested_reviewers`, { reviewers: remove });
        did.push('reviewers');
      }
      json(res, { ok: true, updated: did });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  async function handlePullCommits(req, res, url) {
    try {
      const gh = resolveGitHub(url.searchParams.get('repo'));
      if (gh.error) return json(res, gh, 400);
      const data = await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/pulls/${url.searchParams.get('number')}/commits?per_page=100`);
      json(res, { commits: (data || []).map((c) => ({ sha: c.sha, short: c.sha.slice(0, 7), message: (c.commit.message || '').split('\n')[0], author: (c.author && c.author.login) || (c.commit.author && c.commit.author.name) || '', at: c.commit.author && c.commit.author.date })) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // Branches on GitHub plus the local one, for the new-PR form.
  async function handleBranches(req, res, url) {
    try {
      const name = url.searchParams.get('repo');
      const gh = resolveGitHub(name);
      if (gh.error) return json(res, gh, 400);
      const [info, branches] = await Promise.all([ghRequest('GET', `/repos/${gh.owner}/${gh.repo}`), ghRequest('GET', `/repos/${gh.owner}/${gh.repo}/branches?per_page=100`)]);
      let local = '';
      let ahead = null;
      try { const p = getRepoPath(name); local = gitExec(p, 'rev-parse --abbrev-ref HEAD'); try { ahead = Number(gitExec(p, `rev-list --count origin/${info.default_branch}..HEAD`)); } catch (_) {} } catch (_) {}
      json(res, { default: info.default_branch, local, aheadOfDefault: ahead, branches: (branches || []).map((b) => b.name), pushed: !!local && (branches || []).some((b) => b.name === local) });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // A plain create: repo/title/body/head/base, pushing the local branch first when asked.
  async function handlePullCreate(req, res) {
    try {
      if (permGate && !(await permGate(res, 'api', 'POST /api/github/pulls/create', 'Create GitHub pull request'))) return;
      const { repo, title, body, head, base, draft, push, reviewers, labels } = await ctx.readBody(req);
      if (!repo || !title) return json(res, { error: 'repo and title are required' }, 400);
      const gh = resolveGitHub(repo);
      if (gh.error) return json(res, gh, 400);
      const repoPath = getRepoPath(repo);
      let source = head;
      if (!source) { try { source = gitExec(repoPath, 'rev-parse --abbrev-ref HEAD'); } catch (_) {} }
      if (!source) return json(res, { error: 'Could not determine the source branch' }, 400);
      if (push) { try { gitExec(repoPath, `push -u origin ${source}`); } catch (e) { return json(res, { error: `push failed: ${e.message}` }, 502); } }
      const target = base || (await ghRequest('GET', `/repos/${gh.owner}/${gh.repo}`)).default_branch;
      const pr = await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/pulls`, { title: sanitizeText(title), body: sanitizeText(body || ''), head: source, base: target, draft: !!draft });
      const after = [];
      if (Array.isArray(reviewers) && reviewers.length) { try { await ghRequest('POST', `/repos/${gh.owner}/${gh.repo}/pulls/${pr.number}/requested_reviewers`, { reviewers: reviewers.map(String) }); after.push('reviewers'); } catch (e) { after.push(`reviewers failed: ${e.message}`); } }
      if (Array.isArray(labels) && labels.length) { try { await ghRequest('PUT', `/repos/${gh.owner}/${gh.repo}/issues/${pr.number}/labels`, { labels: labels.map(String) }); after.push('labels'); } catch (e) { after.push(`labels failed: ${e.message}`); } }
      json(res, { ok: true, number: pr.number, url: pr.html_url, title: pr.title, head: source, base: target, after });
    } catch (e) { json(res, { error: e.message }, 502); }
  }

  // Commits on a local branch beyond a base, from the checkout (git, no network).
  function handleBranchCommits(req, res, url) {
    try {
      const repoPath = getRepoPath(url.searchParams.get('repo'));
      if (!repoPath) return json(res, { error: 'Repo not found' }, 400);
      const clean = (v, d) => { const b = String(v || d).replace(/[^\w./#@+-]/g, ''); return b.startsWith('-') ? d : b; };
      const head = clean(url.searchParams.get('head'), 'HEAD');
      const base = clean(url.searchParams.get('base'), 'main');
      // gitExec hands back stderr on failure instead of throwing, so a fatal line means try the next range.
      const tryLog = (range) => { try { const o = String(gitExec(repoPath, `log ${range} --pretty=format:%h|%s|%an|%aI -n 60`) || ''); return /^(fatal|error):/m.test(o) ? null : o; } catch (_) { return null; } };
      const out = tryLog(`origin/${base}..${head}`) ?? tryLog(`${base}..${head}`) ?? '';
      json(res, { commits: out.split('\n').filter((l) => l.includes('|')).map((l) => { const [sha, subject, author, at] = l.split('|'); return { sha, subject, author, at }; }) });
    } catch (e) { json(res, { error: e.message }, 500); }
  }
  ctx.addAbsoluteRoute('GET',  '/api/github/branch-commits',     handleBranchCommits);
  ctx.addAbsoluteRoute('GET',  '/api/github/activity',           handleActivity);
  ctx.addAbsoluteRoute('GET',  '/api/github/team',               handleTeam);
  ctx.addAbsoluteRoute('GET',  '/api/github/actions/runs',       handleRuns);
  ctx.addAbsoluteRoute('GET',  '/api/github/actions/run',        handleRun);
  ctx.addAbsoluteRoute('POST', '/api/github/actions/rerun',      handleRerun);
  ctx.addAbsoluteRoute('GET',  '/api/github/releases',           handleReleases);
  ctx.addAbsoluteRoute('GET',  '/api/github/releases/delta',     handleReleaseDelta);
  ctx.addAbsoluteRoute('POST', '/api/github/releases/create',    handleReleaseCreate);
  ctx.addAbsoluteRoute('GET',  '/api/github/notifications',      handleNotifications);
  ctx.addAbsoluteRoute('POST', '/api/github/notifications/read', handleNotificationsRead);
  ctx.addAbsoluteRoute('POST', '/api/github/pulls/update',       handlePullUpdate);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls/commits',      handlePullCommits);
  ctx.addAbsoluteRoute('GET',  '/api/github/branches',           handleBranches);
  ctx.addAbsoluteRoute('POST', '/api/github/pulls/create',       handlePullCreate);

  ctx.addAbsoluteRoute('GET',  '/api/github/issues',          handleIssues);
  ctx.addAbsoluteRoute('GET',  '/api/github/issues/detail',   handleIssueDetail);
  ctx.addAbsoluteRoute('POST', '/api/github/issues/comment',  handleIssueComment);
  ctx.addAbsoluteRoute('POST', '/api/github/issues/update',   handleIssueUpdate);
  ctx.addAbsoluteRoute('POST', '/api/github/issues/create',   handleIssueCreate);
  ctx.addAbsoluteRoute('POST', '/api/github/issues/start',    handleIssueStart);
  ctx.addAbsoluteRoute('GET',  '/api/github/labels',          handleLabels);
  ctx.addAbsoluteRoute('GET',  '/api/github/collaborators',   handleCollaborators);

  ctx.addAbsoluteRoute('GET',  '/api/github/me',              handleMe);
  ctx.addAbsoluteRoute('GET',  '/api/github/review-requests', handleReviewRequests);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls/checks',    handlePullChecks);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls/diff',      handlePullDiff);
  ctx.addAbsoluteRoute('POST', '/api/github/pulls/merge',     handleMerge);

  // --- Absolute route registration -----------------------------------------

  ctx.addAbsoluteRoute('GET',  '/api/github/repo-info',     handleRepoInfo);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls',         handlePulls);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls/detail',  handlePullDetail);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls/files',   handlePullFiles);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls/comments',handlePullComments);
  ctx.addAbsoluteRoute('GET',  '/api/github/pulls/timeline',handlePullTimeline);
  ctx.addAbsoluteRoute('POST', '/api/github/pulls/comment', handleAddComment);
  ctx.addAbsoluteRoute('POST', '/api/github/pulls/review',  handleSubmitReview);
  ctx.addAbsoluteRoute('GET',  '/api/github/image',         handleImageProxy);
  ctx.addAbsoluteRoute('GET',  '/api/github/user-repos',    handleUserRepos);
  ctx.addAbsoluteRoute('POST', '/api/github/clone',         handleClone);
  ctx.addAbsoluteRoute('POST', '/api/pull-request',         handleCreatePullRequest);
};
