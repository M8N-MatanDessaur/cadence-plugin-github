/**
 * Overview: the repository as a bento. Open pull requests and what blocks them, issues,
 * the last workflow runs, the latest release, who is active, and the doors to every screen.
 */
import { Panel, Stat, Health, Bars, List, ListRow, FILL } from './kit.js';

const days = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : 0);
const ago = (iso) => { const d = days(iso); return !iso ? '' : d < 1 ? 'today' : d < 2 ? 'yesterday' : `${Math.round(d)}d ago`; };
export const prRow = (host, p, onOpen, meta) => ListRow(host, { key: p.number, lead: host.h('span', { className: 'mind-dot', style: { background: p.draft ? 'var(--sy-text-3)' : p.reviewStatus === 'changes_requested' ? 'var(--sy-rosin)' : p.reviewStatus === 'approved' ? 'var(--sy-moss)' : 'var(--sy-brass)' } }), label: `#${p.number} ${p.title}`, sub: `${p.author}${p.draft ? ' - draft' : ''}${p.reviewStatus ? ` - ${String(p.reviewStatus).replace(/_/g, ' ')}` : ''}${(p.reviewers || []).length ? ` - ${p.reviewers.join(', ')}` : ' - no reviewer'}`, meta: meta !== undefined ? meta : ago(p.updatedAt), onClick: () => onOpen(p.number) });
export const issueRow = (host, i, onOpen, meta) => ListRow(host, { key: i.number, lead: host.h('span', { className: 'mind-dot', style: { background: (i.assignees || []).length ? 'var(--sy-moss)' : 'var(--sy-brass)' } }), label: `#${i.number} ${i.title}`, sub: `${(i.assignees || []).join(', ') || 'unassigned'}${(i.labels || []).length ? ` - ${i.labels.map((l) => l.name).join(', ')}` : ''}`, meta: meta !== undefined ? meta : ago(i.updatedAt), onClick: () => onOpen(i.number) });

export function findings({ pulls, issues, runs, me }) {
  const open = pulls || []; const iss = issues || []; const rs = runs || [];
  return {
    stalePulls: open.filter((p) => !p.draft && days(p.updatedAt) > 14),
    noReviewer: open.filter((p) => !p.draft && !(p.reviewers || []).length),
    changesRequested: open.filter((p) => p.reviewStatus === 'changes_requested'),
    bigPulls: open.filter((p) => (Number(p.additions) || 0) + (Number(p.deletions) || 0) > 500),
    oldDrafts: open.filter((p) => p.draft && days(p.updatedAt) > 7),
    forMe: me ? open.filter((p) => (p.reviewers || []).includes(me.login)) : [],
    oldIssues: iss.filter((i) => days(i.updatedAt) > 30),
    unassignedIssues: iss.filter((i) => !(i.assignees || []).length),
    unlabeledIssues: iss.filter((i) => !(i.labels || []).length),
    failedRuns: rs.filter((r) => r.conclusion === 'failure').slice(0, 10),
  };
}

export function Overview({ host, repo, me, pulls, closed, issues, requests, runs, releases, activity, onOpenPull, onOpenIssue, onOpenRun, onAction }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const loading = pulls === null;
  const open = pulls || [];
  const runList = runs.data ? runs.data.runs || [] : null;
  const f = findings({ pulls: open, issues: issues || [], runs: runList || [], me });
  const latestRun = runList && runList[0];
  const latest = releases.data ? (releases.data.releases || releases.data)[0] : null;
  const mergedWeek = (closed || []).filter((p) => p.state === 'merged' || p.mergedAt).filter((p) => days(p.mergedAt || p.updatedAt) <= 7).length;
  const byAuthor = {}; for (const p of open) byAuthor[p.author] = (byAuthor[p.author] || 0) + 1;
  const labels = {}; for (const i of issues || []) for (const l of i.labels || []) labels[l.name] = (labels[l.name] || 0) + 1;
  const issuesList = [];
  if (f.failedRuns.length) issuesList.push({ level: 'error', text: `${f.failedRuns.length} workflow run${f.failedRuns.length === 1 ? '' : 's'} failed lately.`, action: 'actions' });
  if (f.changesRequested.length) issuesList.push({ level: 'warn', text: `${f.changesRequested.length} pull request${f.changesRequested.length === 1 ? ' has' : 's have'} changes requested.`, action: 'insights' });
  if (f.noReviewer.length) issuesList.push({ level: 'warn', text: `${f.noReviewer.length} pull request${f.noReviewer.length === 1 ? ' has' : 's have'} no reviewer.`, action: 'insights' });
  if (f.stalePulls.length) issuesList.push({ level: 'warn', text: `${f.stalePulls.length} pull request${f.stalePulls.length === 1 ? '' : 's'} untouched for two weeks.`, action: 'insights' });
  if (f.forMe.length) issuesList.push({ level: 'info', text: `${f.forMe.length} pull request${f.forMe.length === 1 ? '' : 's'} on this repository wait for your review.`, action: 'review' });
  if (f.unassignedIssues.length) issuesList.push({ level: 'info', text: `${f.unassignedIssues.length} open issue${f.unassignedIssues.length === 1 ? ' has' : 's have'} nobody assigned.`, action: 'insights' });
  const keep = async () => { if (!host.writeNote) return; const md = [`# ${repo} - status ${new Date().toISOString().slice(0, 10)}`, '', `**Open pull requests:** ${open.length} (${open.filter((p) => p.draft).length} draft, ${f.forMe.length} for you). **Merged this week:** ${mergedWeek}. **Open issues:** ${(issues || []).length}. **Last run:** ${latestRun ? `${latestRun.name} ${latestRun.conclusion || latestRun.status}` : 'none'}. **Latest release:** ${latest ? latest.tagName || latest.name : 'none'}.`, '', '## Needs attention', ...(issuesList.length ? issuesList.map((i) => `- ${i.text}`) : ['- Nothing.']), '', '## Pull requests', ...(open.length ? open.map((p) => `- #${p.number} ${p.title} - ${p.author}${p.draft ? ' - draft' : ''}${p.reviewStatus ? ` - ${String(p.reviewStatus).replace(/_/g, ' ')}` : ''}${(p.reviewers || []).length ? ` - ${p.reviewers.join(', ')}` : ' - no reviewer'}`) : ['- None.']), '', '## Issues', ...((issues || []).length ? issues.map((i) => `- #${i.number} ${i.title} - ${(i.assignees || []).join(', ') || 'unassigned'}`) : ['- None.'])].join('\n'); if (await host.writeNote(`${repo} status ${new Date().toISOString().slice(0, 10)}`, md)) host.notify('Saved as a note', 'moss'); };
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Open pull requests', value: loading ? '...' : open.length, tone: 'brass', hint: loading ? undefined : `${open.filter((p) => p.draft).length} draft, ${f.forMe.length} for you` }),
      Stat(host, { label: 'Merged this week', value: closed === null ? '...' : mergedWeek, tone: 'moss' }),
      Stat(host, { label: 'Open issues', value: issues === null ? '...' : issues.length, tone: 'muted', hint: issues === null ? undefined : `${f.unassignedIssues.length} unassigned` }),
      Stat(host, { label: 'Last run', value: !runList ? '...' : latestRun ? (latestRun.conclusion || latestRun.status) : 'none', tone: latestRun && latestRun.conclusion === 'failure' ? 'rosin' : latestRun && latestRun.conclusion === 'success' ? 'moss' : 'muted', hint: latestRun ? `${latestRun.name} - ${ago(latestRun.updatedAt)}` : undefined })),
    h('div', { className: 'mhealth' },
      Health(host, { label: 'awaiting you', value: requests ? `${requests.length} across repos` : '...' }),
      Health(host, { label: 'latest release', value: releases.data ? (latest ? latest.tagName || latest.name : 'none') : '...' }),
      Health(host, { label: 'changes requested', value: loading ? '...' : f.changesRequested.length, tone: f.changesRequested.length ? 'rosin' : undefined }),
      Health(host, { label: 'no reviewer', value: loading ? '...' : f.noReviewer.length, tone: f.noReviewer.length ? 'brass' : undefined })),
    Panel(host, { title: 'Do', wide: true, action: h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, host.writeNote && !loading ? h(ui.Button, { className: 'sy-btn--sm', onClick: keep }, 'Save status as note') : null, meta('everything GitHub, from here')) },
      h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
        h(ui.Button, { variant: 'primary', onClick: () => onAction('pulls') }, 'Pull requests'),
        h(ui.Button, { onClick: () => onAction('review') }, 'Awaiting you'),
        h(ui.Button, { onClick: () => onAction('issues') }, 'Issues'),
        h(ui.Button, { onClick: () => onAction('actions') }, 'Workflow runs'),
        h(ui.Button, { onClick: () => onAction('releases') }, 'Releases'),
        h(ui.Button, { onClick: () => onAction('insights') }, 'What to fix'),
        h(ui.Button, { onClick: () => onAction('inbox') }, 'Inbox'),
        h(ui.Button, { onClick: () => onAction('ask') }, 'Ask the AI'))),
    Panel(host, { title: 'Needs attention', wide: true, action: meta(loading ? '' : `${issuesList.length}`) },
      loading ? h(ui.Skeleton, { count: 3, height: 18 }) : issuesList.length ? List(host, issuesList.map((i, k) => ListRow(host, { key: k, lead: h('span', { className: 'mind-dot', style: { background: i.level === 'error' ? 'var(--sy-rosin)' : i.level === 'warn' ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: i.text, sub: i.action === 'actions' ? 'Actions' : i.action === 'review' ? 'Awaiting you' : 'Insights', onClick: () => onAction(i.action) }))) : empty('Nothing waiting, nothing failing.')),
    h('div', { className: 'gh-row2' },
      Panel(host, { title: 'Pull requests', action: meta(loading ? '' : `${open.length} open`), bodyStyle: { maxHeight: 400, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
        loading ? h(ui.Skeleton, { count: 6, height: 18 }) : open.length ? List(host, open.slice(0, 10).map((p) => prRow(host, p, onOpenPull))) : empty('No open pull request.')),
      Panel(host, { title: 'Issues', action: meta(issues === null ? '' : `${issues.length} open`), bodyStyle: { maxHeight: 400, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
        issues === null ? h(ui.Skeleton, { count: 6, height: 18 }) : issues.length ? List(host, issues.slice(0, 10).map((i) => issueRow(host, i, onOpenIssue))) : empty('No open issue.'))),
    h('div', { className: 'gh-row2' },
      Panel(host, { title: 'Workflow runs', action: meta(runList ? `latest ${Math.min(runList.length, 8)}` : ''), bodyStyle: { maxHeight: 340, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
        !runList ? h(ui.Skeleton, { count: 5, height: 18 }) : runList.length ? List(host, runList.slice(0, 8).map((r) => ListRow(host, { key: r.id, lead: h('span', { className: 'mind-dot', style: { background: r.conclusion === 'success' ? 'var(--sy-moss)' : r.conclusion === 'failure' ? 'var(--sy-rosin)' : 'var(--sy-brass)' } }), label: `${r.name} ${r.number ? `#${r.number}` : ''}`, sub: `${r.branch || ''}${r.actor ? ` - ${r.actor}` : ''} - ${r.conclusion || r.status}`, meta: ago(r.updatedAt), onClick: () => onOpenRun(r.id) }))) : empty('No workflow run.')),
      Panel(host, { title: 'Open, by author', action: meta('pull requests') },
        loading ? h(ui.Skeleton, { count: 4, height: 14 }) : Object.keys(byAuthor).length ? Bars(host, { rows: Object.entries(byAuthor).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value, color: 'var(--sy-brass)' })) }) : empty('Nobody has an open pull request.'))));
}

export function OverviewAside({ host, me, pulls, issues, requests, runs, onOpenPull, onOpenIssue, onAction }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const f = findings({ pulls: pulls || [], issues: issues || [], runs: runs.data ? runs.data.runs || [] : [], me });
  const labels = {}; for (const i of issues || []) for (const l of i.labels || []) labels[l.name] = (labels[l.name] || 0) + 1;
  const first = [...f.changesRequested, ...f.noReviewer, ...f.stalePulls].filter((x, k, arr) => arr.findIndex((y) => y.number === x.number) === k).slice(0, 6);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'Awaiting you', action: meta(requests ? `${requests.length}` : '...'), bodyStyle: { maxHeight: 260, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
      !requests ? h(ui.Skeleton, { count: 3, height: 18 }) : requests.length ? List(host, requests.slice(0, 6).map((p) => ListRow(host, { key: `${p.repoName || p.repo}-${p.number}`, lead: h('span', { className: 'mind-dot', style: { background: p.draft ? 'var(--sy-text-3)' : 'var(--sy-brass)' } }), label: `#${p.number} ${p.title}`, sub: `${p.repoName || p.repo || ''} - ${p.author}`, onClick: () => onOpenPull(p.number, p.repoName || p.repo) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nobody is waiting on your review.')),
    Object.keys(labels).length ? Panel(host, { title: 'Issues by label' }, Bars(host, { rows: Object.entries(labels).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => ({ label, value, color: 'var(--sy-text-3)' })) })) : null,
    Panel(host, { title: 'Fix first', ...FILL, action: h('button', { type: 'button', className: 'mpanel__meta', style: { background: 'none', border: 0, cursor: 'pointer', padding: 0 }, onClick: () => onAction('insights') }, 'all findings') },
      pulls === null ? h(ui.Skeleton, { count: 4, height: 18 }) : first.length ? List(host, first.map((p) => prRow(host, p, onOpenPull, f.changesRequested.includes(p) ? 'changes requested' : f.noReviewer.includes(p) ? 'no reviewer' : 'stale'))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Every pull request has a reviewer and moved this fortnight.')));
}
