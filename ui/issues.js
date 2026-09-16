/**
 * The issues, as a bento.
 *
 * Stat cards (open, assigned to you, unassigned, quiet), a strip of the labels that carry the
 * most, then the list split by what it means to you: assigned to you, unassigned, everyone
 * else's. Each row says who holds it, which labels, how many comments, how fresh.
 */
import { ago } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

export const labelColour = (hex) => (hex ? `#${hex}` : 'var(--sy-text-3)');

export function issueRow(host, i, onOpen) {
  const { h } = host;
  const first = (i.labels || [])[0];
  return ListRow(host, {
    key: i.number,
    lead: h('span', { className: 'mind-dot', style: { background: i.state === 'closed' ? 'var(--sy-text-3)' : first ? labelColour(first.color) : 'var(--sy-brass)' } }),
    label: `#${i.number} ${i.title}`,
    sub: [i.assignees && i.assignees.length ? i.assignees.join(', ') : 'unassigned', (i.labels || []).map((l) => l.name).join(', ') || null, i.milestone || null, i.updatedAt ? `updated ${ago(i.updatedAt)}` : null].filter(Boolean).join(' - '),
    meta: i.comments ? `${i.comments} comment${i.comments === 1 ? '' : 's'}` : null,
    onClick: () => onOpen(i.number),
  });
}

export function Issues({ host, me, repo, mode, issues, loading, onOpen, onNew }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (!repo) return h(ui.EmptyState, { title: 'Choose a repository', body: 'Pick one in the sidebar; its issues appear here.' });

  const list = issues || [];
  const mine = me ? list.filter((i) => (i.assignees || []).includes(me.login)) : [];
  const unassigned = list.filter((i) => !(i.assignees || []).length);
  const others = list.filter((i) => !mine.includes(i) && !unassigned.includes(i));
  const quiet = list.filter((i) => i.updatedAt && Date.now() - new Date(i.updatedAt) > 30 * 86400000).length;
  const byLabel = {};
  for (const i of list) for (const l of i.labels || []) byLabel[l.name] = (byLabel[l.name] || 0) + 1;
  const topLabels = Object.entries(byLabel).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const withComments = list.filter((i) => i.comments > 0).length;

  const section = (title, rows, hint) => Panel(host, { title, wide: true, action: meta(loading ? '' : `${rows.length}`) },
    loading ? h(ui.Skeleton, { count: 3, height: 18 }) : rows.length ? List(host, rows.map((i) => issueRow(host, i, onOpen))) : empty(hint));

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: mode === 'closed' ? 'Closed lately' : 'Open', value: loading ? '...' : list.length, tone: 'brass' }),
      Stat(host, { label: 'Assigned to you', value: loading ? '...' : mine.length, tone: mine.length ? 'brass' : 'muted' }),
      Stat(host, { label: 'Unassigned', value: loading ? '...' : unassigned.length, tone: unassigned.length ? 'rosin' : 'muted', hint: unassigned.length ? 'nobody holds these' : undefined }),
      Stat(host, { label: 'Quiet 30d+', value: loading ? '...' : quiet, tone: quiet ? 'rosin' : 'muted' })),
    h('div', { className: 'mhealth' },
      ...(topLabels.length ? topLabels.map(([name, n]) => Health(host, { label: name, value: n })) : [Health(host, { label: 'labels', value: 'none' })]),
      Health(host, { label: 'with comments', value: loading ? '...' : withComments }),
      Health(host, { label: 'Repository', value: repo })),
    mode === 'closed'
      ? section('Closed lately', list, 'Nothing closed lately.')
      : [
        me ? section('Assigned to you', mine, 'Nothing is assigned to you here.') : null,
        section('Unassigned', unassigned, 'Every open issue has someone.'),
        section(me ? 'Everyone else' : 'Open issues', others, 'No other open issues.'),
      ]);
}

export function IssuesAside({ host, me, repo, issues, closed, onOpen, onNew }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };
  const mine = me ? (issues || []).filter((i) => (i.assignees || []).includes(me.login)) : [];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'New issue', action: meta(repo || '') },
      h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, 'A title, a body, labels. Write with AI turns your words into a proper report.'),
      h(ui.Button, { variant: 'primary', className: 'sy-btn--sm', disabled: !repo, onClick: onNew }, 'New issue')),
    Panel(host, { title: 'Assigned to you', ...FILL, action: meta(issues === null ? 'reading...' : `${mine.length}`) },
      issues === null ? h(ui.Skeleton, { count: 3, height: 18 }) : mine.length ? List(host, mine.map((i) => issueRow(host, i, onOpen))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing assigned to you here.')),
    Panel(host, { title: 'Recently closed', ...FILL, action: meta(closed ? `${closed.length}` : '...') },
      closed === null ? h(ui.Skeleton, { count: 3, height: 18 }) : closed.length ? List(host, closed.map((i) => ListRow(host, { key: i.number, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-text-3)' } }), label: `#${i.number} ${i.title}`, sub: `${i.stateReason === 'not_planned' ? 'not planned' : 'done'} - ${ago(i.closedAt || i.updatedAt)}`, onClick: () => onOpen(i.number) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing closed lately.')));
}
