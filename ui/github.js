/**
 * GitHub in Cadence 3.0, built the way the Azure DevOps plugin and the app's own screens
 * are built: three regions and a header.
 *
 *   The sidebar is the plugin's own: a tracked title, a stats line, nav rows with counts
 *   (Pull requests, Awaiting you, Recently closed, Ask, Repositories), and the filters at the
 *   bottom - the repository this screen is on, the state, a search.
 *
 *   The main area is panels: the pull requests as a bento, one pull request as a dashboard
 *   with the AI's review beside the humans', Ask over any period, repos to clone.
 *
 *   The right pane is what is waiting on you, or - on a pull request - its files and checks.
 *
 * Everything GitHub is here rather than in the shell; the shell should not know what a pull
 * request is. The repository this screen is on starts as the repo the active shell is on.
 */
import { Pulls, PullsAside } from './pulls.js';
import { usePr, PrPage, PrAside } from './pr.js';
import { Ask, rememberAnswer } from './ask.js';
import { Repos } from './repos.js';
import { Issues, IssuesAside } from './issues.js';
import { useIssue, IssuePage, IssueAside, NewIssue } from './issue.js';
import { useActivity, Activity, ActivityAside } from './activity.js';
import { useRuns, Runs, RunsAside, useRun, RunPage, RunAside } from './actions.js';
import { useReleases, Releases, ReleasesAside, NewRelease } from './releases.js';
import { useInbox, Inbox, InboxAside } from './inbox.js';
import { NewPullRequest } from './newpr.js';
import { Overview, OverviewAside } from './overview.js';
import { Insights, InsightsAside } from './insights.js';
import { Panel, NavItem, Section } from './kit.js';
import { waitForTask } from './helpers.js';

const NAV = [
  { id: 'overview', label: 'Overview', icon: 'chart', hint: 'The repository at a glance: pull requests and what blocks them, issues, the last runs, the latest release.' },
  { id: 'pulls', label: 'Pull requests', icon: 'branch', hint: 'Open pull requests on the repository this screen is on. Click one to read it, review it, merge it.' },
  { id: 'review', label: 'Awaiting you', icon: 'check', hint: 'Every pull request across your repositories that asks for your review.' },
  { id: 'issues', label: 'Issues', icon: 'bug', hint: 'Open issues on the repository this screen is on. Click one to read it, comment, start working on it.' },
  { id: 'activity', label: 'Activity', icon: 'history', hint: 'What moved on this repository lately, and who moved it.' },
  { id: 'actions', label: 'Actions', icon: 'run', hint: 'Workflow runs on this repository. A failed one explains itself.' },
  { id: 'releases', label: 'Releases', icon: 'tag', hint: 'What shipped, what is waiting to ship, and the next release.' },
  { id: 'insights', label: 'Insights', icon: 'warning', hint: 'Pull requests with changes requested or no reviewer, stale ones, big diffs, old issues, failed runs.' },
  { id: 'inbox', label: 'Inbox', icon: 'comment', hint: 'Your GitHub notifications across every repository.' },
  { id: 'ask', label: 'Ask', icon: 'search', hint: 'A question about the pull requests, over any period. The AI reads GitHub for you.' },
  { id: 'repos', label: 'Repositories', icon: 'list', hint: 'Your GitHub repositories. Clone one and it joins the workspace.' },
];

function GitHub({ host }) {
  const { h, ui, react, api, notify, context } = host;
  const { useState, useEffect, useCallback, useRef } = react;

  const [tab, setTab] = useState('overview');
  const [repos, setRepos] = useState([]);
  const [repo, setRepo] = useState(() => { try { return localStorage.getItem('sy.gh.repo') || ''; } catch { return ''; } });
  const [state, setState] = useState('open');
  const [q, setQ] = useState('');
  const [me, setMe] = useState(null);
  const [pulls, setPulls] = useState(null);
  const [closed, setClosed] = useState(null);
  const [error, setError] = useState(null);
  const [requests, setRequests] = useState(null);
  const [openNumber, setOpenNumber] = useState(null);
  const [issues, setIssues] = useState(null);
  const [closedIssues, setClosedIssues] = useState(null);
  const [openIssue, setOpenIssue] = useState(null);
  const [newIssue, setNewIssue] = useState(false);
  const [openRun, setOpenRun] = useState(null);
  const [newPr, setNewPr] = useState(false);
  const [newRelease, setNewRelease] = useState(null);
  const [repoInfos, setRepoInfos] = useState({});

  // The repositories the workspace knows; the screen starts on the repo the active shell is on.
  useEffect(() => {
    api('/api/repos').then((d) => {
      const names = Object.keys(d || {}).sort((a, b) => a.localeCompare(b));
      setRepos(names.map((name) => ({ name, path: d[name] })));
      const focused = ((context && context()) || {}).focused;
      setRepo((cur) => (cur && names.includes(cur) ? cur : (focused && names.includes(focused.repo) ? focused.repo : names[0] || '')));
    }).catch(() => {});
    api('/api/github/me').then(setMe).catch(() => setMe(null));
    api('/api/github/review-requests').then((d) => setRequests(d.items || [])).catch(() => setRequests([]));
  }, []);
  useEffect(() => { try { if (repo) localStorage.setItem('sy.gh.repo', repo); } catch {} }, [repo]);

  const request = useRef(0);
  const load = useCallback(async (opts = {}) => {
    if (!repo) return;
    const mine = ++request.current;
    setError(null);
    if (!opts.quiet) { setPulls(null); setClosed(null); setIssues(null); setClosedIssues(null); }
    try {
      const [open, done, iss, issDone] = await Promise.all([
        api(`/api/github/pulls?repo=${encodeURIComponent(repo)}&state=open`),
        api(`/api/github/pulls?repo=${encodeURIComponent(repo)}&state=closed`),
        api(`/api/github/issues?repo=${encodeURIComponent(repo)}&state=open`).catch(() => ({ issues: [] })),
        api(`/api/github/issues?repo=${encodeURIComponent(repo)}&state=closed`).catch(() => ({ issues: [] })),
      ]);
      if (mine !== request.current) return;
      setPulls(open.pulls || []);
      setClosed(done.pulls || []);
      setIssues(iss.issues || []);
      setClosedIssues(issDone.issues || []);
    } catch (e) { if (mine === request.current) { setError(e.message); setPulls([]); setClosed([]); } }
  }, [repo]);
  useEffect(() => { load(); }, [load]);
  const refresh = () => { load(); api('/api/github/review-requests').then((d) => setRequests(d.items || [])).catch(() => {}); };

  // ---------------------------------------------------------------- one pull request
  const pr = usePr(host, repo, openNumber);
  const issue = useIssue(host, repo, openIssue);
  const activityData = useActivity(host, repo, tab === 'activity');
  const runs = useRuns(host, repo, tab === 'actions' || tab === 'overview' || tab === 'insights');
  const runData = useRun(host, repo, openRun);
  const releases = useReleases(host, repo, tab === 'releases' || tab === 'overview');
  const inbox = useInbox(host, tab === 'inbox');
  // Which workspace repo is which GitHub repo, so the inbox can open things in place.
  useEffect(() => {
    let alive = true;
    Promise.all((repos || []).map((r) => api(`/api/github/repo-info?repo=${encodeURIComponent(r.name)}`).then((i) => [r.name, i && !i.error ? i : null]).catch(() => [r.name, null])))
      .then((pairs) => { if (alive) setRepoInfos(Object.fromEntries(pairs)); });
    return () => { alive = false; };
  }, [repos]);
  const reposWithGithub = (repos || []).map((r) => ({ ...r, github: repoInfos[r.name] || null }));

  // ---------------------------------------------------------------- ask
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [asking, setAsking] = useState(false);
  const ask = async (text) => {
    const asked = String(typeof text === 'string' ? text : question).trim();
    if (!asked) return;
    const started = Date.now();
    setQuestion(asked); setAsking(true); setAnswer(null);
    const finish = (out) => setAnswer(rememberAnswer({ question: asked, answer: String(out).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').replace(/\n[^\n]*(save-result|bootstrap)[^\n]*$/i, '').trim(), seconds: Math.round((Date.now() - started) / 1000), at: Date.now() }));
    try {
      const cfg = await api('/api/config').catch(() => ({}));
      const base = window.location.origin;
      const prompt = [
        `You are answering a question about GitHub pull requests for the repository "${repo}" (a local repo whose origin is on GitHub). Today is ${new Date().toISOString().slice(0, 10)}.${me ? ` The user is GitHub login "${me.login}".` : ''}`,
        '',
        'Read what you need from these READ-ONLY routes on the local Cadence server (plain GET with curl, JSON back). Never call POST, PUT, PATCH or DELETE.',
        `  ${base}/api/github/pulls?repo=${encodeURIComponent(repo)}&state=open|closed|all   the pull requests: number, title, author, draft, headRef, baseRef, labels, reviewers, additions, deletions, comments, reviewStatus, createdAt, updatedAt`,
        `  ${base}/api/github/pulls/detail?repo=${encodeURIComponent(repo)}&number=N       one PR with its body`,
        `  ${base}/api/github/pulls/files?repo=${encodeURIComponent(repo)}&number=N        its changed files with patches`,
        `  ${base}/api/github/pulls/timeline?repo=${encodeURIComponent(repo)}&number=N     reviews, comments, commits, events`,
        `  ${base}/api/github/pulls/checks?repo=${encodeURIComponent(repo)}&number=N       CI checks on its head`,
        `  ${base}/api/github/review-requests                                                PRs across all repos asking for the user's review`,
        '',
        `Question: ${asked}`,
        '',
        'Answer in Markdown from what you read only: a short lead, then bold labels, bullets or a table where they help. Write every pull request as #N so it can be opened. Say plainly if the data does not cover it.',
        'This is a one-off answer, not a session: do not run any bootstrap, do not save to Mind or any memory, do not mention either. Reply with the answer only.',
      ].join('\n');
      const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'github-ask', timeout: 240000, prompt }) });
      if (result.handledLocally) finish(result.answer || '(no answer)');
      else if (result.id) finish(await waitForTask(api, result.id, 240000));
      else finish(result.error || 'No answer came back.');
    } catch (e) { finish(e.message); } finally { setAsking(false); }
  };

  // ---------------------------------------------------------------- derived
  const current = NAV.find((n) => n.id === tab) || NAV[0];
  const open = pulls || [];
  const drafts = open.filter((p) => p.draft).length;
  const forMe = me ? open.filter((p) => (p.reviewers || []).includes(me.login)).length : 0;
  const matches = (p) => !q.trim() || `${p.number} ${p.title} ${p.author} ${p.headRef} ${(p.labels || []).map((l) => l.name).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase());
  const shown = (tab === 'activity' ? (closed || []) : open).filter(matches);
  const issueMatches = (i) => !q.trim() || `${i.number} ${i.title} ${i.author} ${(i.assignees || []).join(' ')} ${(i.labels || []).map((l) => l.name).join(' ')}`.toLowerCase().includes(q.trim().toLowerCase());
  const shownIssues = (issues || []).filter(issueMatches);
  const leave = () => { setOpenNumber(null); setOpenIssue(null); setNewIssue(false); setOpenRun(null); setNewPr(false); setNewRelease(null); };
  const repoPath = (repos.find((r) => r.name === repo) || {}).path || null;

  // ---------------------------------------------------------------- sidebar
  const left = h('div', { className: 'sb' },
    h('div', { className: 'sb__head' }, h('span', { className: 'sb__title' }, 'GitHub')),
    h('div', { className: 'mind-stats' },
      pulls === null && repo
        ? h('span', null, 'reading the pull requests...')
        : [h('span', { key: 'o' }, `${open.length} open`), h('span', { key: 'd' }, `${drafts} draft${drafts === 1 ? '' : 's'}`), h('span', { key: 'm' }, requests ? `${requests.length} for you` : '...')]),
    h('ul', { className: 'sb__list', role: 'list' },
      NAV.map((n) => NavItem(host, {
        key: n.id, icon: host.icons[n.icon], label: n.label, active: tab === n.id && !openNumber && !openIssue && !openRun, title: n.hint,
        badge: n.id === 'pulls' ? (pulls ? open.length : undefined) : n.id === 'review' ? (requests ? requests.length : undefined) : n.id === 'activity' ? (closed ? closed.length : undefined) : n.id === 'issues' ? (issues ? issues.length : undefined) : n.id === 'actions' ? (runs.data ? (runs.data.runs || []).filter((r) => r.conclusion === 'failure').length || undefined : undefined) : n.id === 'inbox' ? (inbox.items ? inbox.items.length || undefined : undefined) : undefined,
        onClick: () => { setTab(n.id); leave(); },
      }))),
    h('div', { style: { flex: 1 } }),
    tab === 'pulls' || tab === 'activity' || tab === 'ask' || tab === 'issues' || tab === 'actions' || tab === 'releases' || tab === 'overview' || tab === 'insights'
      ? h('div', null,
        Section(host, 'Filters'),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, padding: '0 var(--sy-s3) var(--sy-s2)' } },
          h(ui.Select, { value: repo, onChange: (e) => { setRepo(e.target.value); leave(); }, 'aria-label': 'Repository' },
            !repo ? h('option', { value: '' }, 'Choose a repository') : null,
            repos.map((r) => h('option', { key: r.name, value: r.name }, r.name))),
          tab === 'pulls' || tab === 'activity' || tab === 'issues' || tab === 'insights' ? h(ui.Input, { value: q, placeholder: tab === 'issues' ? 'Search title, number, label, assignee' : 'Search title, number, author, branch', onChange: (e) => setQ(e.target.value), 'aria-label': tab === 'issues' ? 'Search issues' : 'Search pull requests' }) : null))
      : null,
    h('div', { className: 'sb__foot' }, openNumber ? 'One pull request. Back to the list from the header.' : openIssue ? 'One issue. Back to the list from the header.' : openRun ? 'One workflow run. Back to the list from the header.' : current.hint));

  // ---------------------------------------------------------------- header
  const header = h('div', { className: 'mind-view__head' },
    h('div', null,
      h('h1', { className: 'stage-title' }, openNumber ? `#${openNumber}` : openIssue ? `#${openIssue}` : newIssue ? 'New issue' : openRun ? (runData.run ? `${runData.run.name} ${runData.run.number}` : 'Run') : newPr ? 'New pull request' : newRelease !== null ? 'New release' : current.label),
      h('p', { style: { margin: 0, color: 'var(--sy-text-3)', fontSize: 'var(--sy-fs-sm)' } },
        openNumber ? (pr.detail ? pr.detail.title : 'reading the pull request...') : openIssue ? (issue.detail ? issue.detail.title : 'reading the issue...') : newIssue ? `An issue on ${repo}.` : openRun ? (runData.run ? `${runData.run.title || runData.run.branch} - ${runData.run.conclusion || runData.run.status}` : 'reading the run...') : newPr ? `From your branch on ${repo}.` : newRelease !== null ? `On ${repo}.` : tab === 'inbox' ? 'Everything GitHub sent you, across every repository.' : repo ? `${current.hint.split('.')[0]}. ${tab === 'review' || tab === 'repos' ? '' : `On ${repo}.`}` : 'Choose a repository in the sidebar.')),
    h('div', { className: 'mind-view__actions' },
      !openNumber && !openIssue && !newIssue && !newPr && tab === 'pulls' && pulls ? h('span', { className: 'mpanel__meta' }, `${shown.length} shown`) : null,
      !openIssue && !newIssue && tab === 'issues' && issues ? h('span', { className: 'mpanel__meta' }, `${shownIssues.length} shown`) : null,
      !openNumber && !newPr && tab === 'pulls' && repo ? h(ui.Button, { variant: 'primary', onClick: () => setNewPr(true) }, 'New pull request') : null,
      !newRelease && tab === 'releases' && repo ? h(ui.Button, { variant: 'primary', onClick: () => setNewRelease('') }, 'New release') : null,
      !openIssue && !newIssue && tab === 'issues' && repo ? h(ui.Button, { variant: 'primary', onClick: () => setNewIssue(true) }, 'New issue') : null,
      openNumber || openIssue || newIssue || openRun || newPr || newRelease !== null ? h(ui.Button, { onClick: leave }, 'Back to the list') : h(ui.Button, { onClick: () => { refresh(); activityData.reload(); runs.reload(); releases.reload(); inbox.reload(); } }, 'Refresh')));

  // ---------------------------------------------------------------- main
  const openPr = (n) => { setOpenNumber(n); };
  const main = h('div', { style: { padding: '12px 16px 48px' } },
    error ? h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, `GitHub: ${error}`) : null,
    openNumber
      ? h(PrPage, { host, repo, repoPath, number: openNumber, pr, me, onBack: () => setOpenNumber(null), onChanged: () => { pr.reload(); load({ quiet: true }); } })
      : openIssue
        ? h(IssuePage, { host, repo, repoPath, number: openIssue, issue, me, onChanged: () => { issue.reload(); load({ quiet: true }); }, onOpenPull: (n) => { setOpenIssue(null); setOpenNumber(n); } })
      : newIssue
        ? h(NewIssue, { host, repo, labels: issue.labels, onCreated: (n) => { setNewIssue(false); load({ quiet: true }); setOpenIssue(n); }, onCancel: () => setNewIssue(false) })
      : openRun
        ? h(RunPage, { host, repo, repoPath, id: openRun, data: runData, onChanged: () => { runData.reload(); runs.reload(); } })
      : newPr
        ? h(NewPullRequest, { host, repo, repoPath, onCreated: (n) => { setNewPr(false); load({ quiet: true }); setOpenNumber(n); }, onCancel: () => setNewPr(false) })
      : newRelease !== null
        ? h(NewRelease, { host, repo, repoPath, releases, initialTag: newRelease, onCreated: () => { setNewRelease(null); releases.reload(); }, onCancel: () => setNewRelease(null) })
      : tab === 'overview'
        ? h(Overview, { host, repo, me, pulls, closed, issues, requests, runs, releases, activity: activityData, onOpenPull: (n, r) => { if (r && r !== repo && repos.some((x) => x.name === r)) setRepo(r); openPr(n); }, onOpenIssue: (n) => setOpenIssue(n), onOpenRun: (id) => setOpenRun(id), onAction: (a) => { setTab(a); leave(); } })
      : tab === 'insights'
        ? h(Insights, { host, repo, me, pulls, issues, runs, q: q.trim().toLowerCase(), onOpenPull: openPr, onOpenIssue: (n) => setOpenIssue(n), onOpenRun: (id) => setOpenRun(id) })
      : tab === 'activity'
        ? h(Activity, { host, me, repo, data: activityData, closed, onOpen: (n) => setOpenNumber(n) })
      : tab === 'actions'
        ? h(Runs, { host, repo, runs, onOpen: (id) => setOpenRun(id) })
      : tab === 'releases'
        ? h(Releases, { host, repo, releases, onNew: () => setNewRelease('') })
      : tab === 'inbox'
        ? h(Inbox, { host, inbox, repos: reposWithGithub, onOpen: (name, n) => { setRepo(name); setOpenNumber(n); }, onOpenIssue: (name, n) => { setRepo(name); setOpenIssue(n); } })
      : tab === 'issues'
        ? h(Issues, { host, me, repo, mode: 'open', issues: shownIssues, loading: issues === null, onOpen: (n) => setOpenIssue(n), onNew: () => setNewIssue(true) })
      : tab === 'pulls'
        ? h(Pulls, { host, me, repo, mode: tab, pulls: shown, loading: pulls === null, onOpen: openPr })
        : tab === 'review'
          ? h(Pulls, { host, me, repo, mode: 'review', pulls: requests, loading: requests === null, onOpen: (n, r) => { if (r && repos.some((x) => x.name === r)) { setRepo(r); } openPr(n); }, repos })
          : tab === 'ask'
            ? h(Ask, { host, api, repo, me, question, setQuestion, ask, asking, answer, setAnswer, pulls: open, requests, onOpen: openPr })
            : h(Repos, { host, repos, onCloned: () => api('/api/repos').then((d) => setRepos(Object.keys(d || {}).sort().map((name) => ({ name, path: d[name] })))).catch(() => {}) }));

  // ---------------------------------------------------------------- aside
  const right = openNumber
    ? h(PrAside, { host, pr, repo })
    : openIssue
      ? h(IssueAside, { host, issue, onOpenPull: (n) => { setOpenIssue(null); setOpenNumber(n); } })
    : openRun
      ? h(RunAside, { host, data: runData })
    : tab === 'overview'
      ? h(OverviewAside, { host, me, pulls, issues, requests, runs, onOpenPull: (n, r) => { if (r && r !== repo && repos.some((x) => x.name === r)) setRepo(r); openPr(n); }, onOpenIssue: (n) => setOpenIssue(n), onAction: (a) => { setTab(a); leave(); } })
    : tab === 'insights'
      ? h(InsightsAside, { host, me, pulls, issues, runs })
    : tab === 'activity'
      ? h(ActivityAside, { host, me, data: activityData, onOpen: (n) => setOpenNumber(n) })
    : tab === 'actions'
      ? h(RunsAside, { host, runs, onOpen: (id) => setOpenRun(id) })
    : tab === 'releases'
      ? h(ReleasesAside, { host, releases, onNew: (tag) => setNewRelease(tag || '') })
    : tab === 'inbox'
      ? h(InboxAside, { host, inbox, repos: reposWithGithub })
    : tab === 'issues' || newIssue
      ? h(IssuesAside, { host, me, repo, issues, closed: closedIssues, onOpen: (n) => { setNewIssue(false); setOpenIssue(n); }, onNew: () => setNewIssue(true) })
    : h(PullsAside, { host, me, repo, pulls: open, closed: closed || [], requests, onOpen: (n, r) => { if (r && r !== repo && repos.some((x) => x.name === r)) setRepo(r); openPr(n); } });

  return h(ui.Regions, { left, right, paneId: `github-${tab}`, paneLabel: openNumber ? 'This pull request' : openIssue ? 'This issue' : openRun ? 'This run' : tab === 'overview' ? 'Attention' : tab === 'insights' ? 'By kind' : tab === 'issues' ? 'Issues' : tab === 'activity' ? 'Team' : tab === 'actions' ? 'Workflows' : tab === 'releases' ? 'Next release' : tab === 'inbox' ? 'By repository' : 'Waiting on you' },
    h('div', { className: 'gh-main' }, h('div', { style: { padding: '32px 16px 0' } }, header), main));
}

GitHub.cadenceComponent = true;
export default GitHub;
