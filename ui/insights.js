/**
 * Insights: what to fix on the repository, by kind. Stale and unreviewed pull requests,
 * changes requested, big diffs, old drafts, old and unassigned issues, failed runs.
 */
import { Panel, Stat, Health, Bars, List, ListRow } from './kit.js';
import { findings, prRow, issueRow } from './overview.js';

const KINDS = [['changesRequested', 'Changes requested', 'Someone asked for changes and the author has not pushed since.'], ['noReviewer', 'No reviewer', 'Open, not a draft, and nobody asked to review it.'], ['stalePulls', 'Stale', 'Not a draft and untouched for fourteen days.'], ['bigPulls', 'Big diffs', 'More than 500 lines changed; hard to review well.'], ['oldDrafts', 'Old drafts', 'Draft for more than a week.'], ['forMe', 'For you', 'Your review was requested.'], ['unassignedIssues', 'Unassigned issues', 'Open with nobody on it.'], ['oldIssues', 'Old issues', 'Untouched for thirty days.'], ['unlabeledIssues', 'Unlabeled issues', 'No label, so nobody triaged it.'], ['failedRuns', 'Failed runs', 'Workflow runs that ended in failure.']];
const PR_KINDS = ['changesRequested', 'noReviewer', 'stalePulls', 'bigPulls', 'oldDrafts', 'forMe'];

export function Insights({ host, repo, me, pulls, issues, runs, q, onOpenPull, onOpenIssue, onOpenRun }) {
  const { h, ui } = host;
  const { useState } = host.react;
  const [kind, setKind] = useState('changesRequested');
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const loading = pulls === null || issues === null || !runs.data;
  const f = findings({ pulls: pulls || [], issues: issues || [], runs: runs.data ? runs.data.runs || [] : [], me });
  const match = (s) => !q || String(s).toLowerCase().includes(q);
  const list = (f[kind] || []).filter((x) => match(`${x.number || ''} ${x.title} ${x.author || ''} ${x.name || ''}`));
  const ago = (iso) => { const d = iso ? (Date.now() - new Date(iso).getTime()) / 86400000 : 0; return !iso ? '' : d < 1 ? 'today' : `${Math.round(d)}d ago`; };
  const body = loading ? h(ui.Skeleton, { count: 8, height: 18 })
    : !list.length ? empty(q ? 'Nothing matches.' : 'Nothing here. Good.')
    : PR_KINDS.includes(kind) ? List(host, list.map((p) => prRow(host, p, onOpenPull, kind === 'bigPulls' ? `+${p.additions} -${p.deletions}` : ago(p.updatedAt))))
    : kind === 'failedRuns' ? List(host, list.map((r) => ListRow(host, { key: r.id, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-rosin)' } }), label: `${r.name} ${r.number ? `#${r.number}` : ''}`, sub: `${r.branch || ''}${r.actor ? ` - ${r.actor}` : ''}${r.title ? ` - ${r.title}` : ''}`, meta: ago(r.updatedAt), onClick: () => onOpenRun(r.id) })))
    : List(host, list.map((i) => issueRow(host, i, onOpenIssue)));
  const counts = Object.fromEntries(KINDS.map(([k]) => [k, (f[k] || []).length]));
  const problems = counts.changesRequested + counts.noReviewer + counts.stalePulls + counts.failedRuns;
  const keep = async () => { if (!host.writeNote || loading) return; const line = (x) => x.number && x.title ? `- #${x.number} ${x.title}${x.author ? ` - ${x.author}` : ''}` : `- ${x.name}${x.number ? ` #${x.number}` : ''}${x.branch ? ` - ${x.branch}` : ''}`; const md = [`# ${repo} - findings ${new Date().toISOString().slice(0, 10)}`, '', `${problems} to fix: ${counts.changesRequested} changes requested, ${counts.noReviewer} without reviewer, ${counts.stalePulls} stale, ${counts.failedRuns} failed runs.`, ...KINDS.flatMap(([k, l, why]) => (f[k] || []).length ? ['', `## ${l} (${f[k].length})`, `_${why}_`, ...f[k].map(line)] : [])].join('\n'); if (await host.writeNote(`${repo} findings ${new Date().toISOString().slice(0, 10)}`, md)) host.notify('Saved as a note', 'moss'); };
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'To fix', value: loading ? '...' : problems, tone: problems ? 'rosin' : 'moss', hint: 'changes requested, no reviewer, stale, failed runs' }),
      Stat(host, { label: 'Pull requests', value: pulls === null ? '...' : pulls.length, tone: 'brass', hint: pulls === null ? undefined : `${counts.forMe} for you` }),
      Stat(host, { label: 'Issues', value: issues === null ? '...' : issues.length, tone: 'muted', hint: issues === null ? undefined : `${counts.unassignedIssues} unassigned, ${counts.oldIssues} old` }),
      Stat(host, { label: 'Failed runs', value: !runs.data ? '...' : counts.failedRuns, tone: counts.failedRuns ? 'rosin' : 'moss' })),
    h('div', { className: 'mhealth' }, Health(host, { label: 'big diffs', value: loading ? '...' : counts.bigPulls }), Health(host, { label: 'old drafts', value: loading ? '...' : counts.oldDrafts }), Health(host, { label: 'unlabeled', value: loading ? '...' : counts.unlabeledIssues }), Health(host, { label: 'repository', value: repo || '-' })),
    Panel(host, { title: KINDS.find(([k]) => k === kind)[1], wide: true, action: h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } }, host.writeNote ? h(ui.Button, { className: 'sy-btn--sm', disabled: loading, onClick: keep }, 'Save findings as note') : null, KINDS.map(([k, l]) => h(ui.Chip, { key: k, on: kind === k, onClick: () => setKind(k) }, `${l}${loading ? '' : ` ${counts[k]}`}`))) },
      h('p', { className: 'mpanel__meta', style: { margin: '0 0 8px' } }, KINDS.find(([k]) => k === kind)[2]),
      h('div', { style: { maxHeight: 600, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, body)));
}

export function InsightsAside({ host, me, pulls, issues, runs }) {
  const { h, ui } = host;
  const loading = pulls === null || issues === null || !runs.data;
  const f = findings({ pulls: pulls || [], issues: issues || [], runs: runs.data ? runs.data.runs || [] : [], me });
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'By kind' }, loading ? h(ui.Skeleton, { count: 6, height: 14 }) : Bars(host, { rows: KINDS.map(([k, l]) => ({ label: l, value: (f[k] || []).length, color: ['changesRequested', 'failedRuns', 'stalePulls'].includes(k) ? 'var(--sy-rosin)' : ['noReviewer', 'unassignedIssues', 'oldIssues'].includes(k) ? 'var(--sy-brass)' : 'var(--sy-text-3)' })) })),
    Panel(host, { title: 'How it reads' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'Read from the open pull requests, the open issues and the latest workflow runs of the repository. A pull request can sit in several kinds. Stale means fourteen days without a push, a comment or a review.')));
}
