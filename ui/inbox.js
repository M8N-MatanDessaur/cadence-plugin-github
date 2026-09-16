/**
 * The inbox: your GitHub notifications across every repository, grouped by why they came
 * to you. Ones on a repository in this workspace open in place; the rest open on GitHub.
 */
import { ago } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

export function useInbox(host, enabled) {
  const { react, api } = host;
  const { useState, useEffect, useCallback } = react;
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!enabled) return;
    setError(null);
    api('/api/github/notifications').then((d) => setItems(d.items || [])).catch((e) => { setItems([]); setError(e.message); });
  }, [enabled]);
  useEffect(() => { reload(); }, [reload]);
  return { items, error, reload };
}

const REASONS = {
  review_requested: 'Asked to review', mention: 'Mentioned', assign: 'Assigned to you', author: 'Your own', comment: 'Commented on', state_change: 'State changed',
  subscribed: 'Watching', team_mention: 'Team mentioned', ci_activity: 'CI', manual: 'Subscribed', security_alert: 'Security', approval_requested: 'Approval asked',
};

export function Inbox({ host, inbox, repos, onOpen, onOpenIssue }) {
  const { h, ui, api, notify } = host;
  const { items, error, reload } = inbox;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const local = (n) => (repos || []).find((r) => r.github && r.github.owner.toLowerCase() === n.owner.toLowerCase() && r.github.repo.toLowerCase() === n.repo.toLowerCase());
  const list = items || [];
  const groups = {};
  for (const n of list) (groups[n.reason] = groups[n.reason] || []).push(n);
  const order = ['review_requested', 'mention', 'assign', 'approval_requested', 'security_alert', 'comment', 'state_change', 'author', 'ci_activity', 'team_mention', 'subscribed', 'manual'];
  const keys = [...order.filter((k) => groups[k]), ...Object.keys(groups).filter((k) => !order.includes(k))];
  const markRead = async (id) => { try { await api('/api/github/notifications/read', { method: 'POST', body: JSON.stringify(id ? { id } : { all: true }) }); notify(id ? 'Marked read' : 'Inbox cleared', 'moss'); reload(); } catch (e) { notify(e.message, 'rosin'); } };
  const open = (n) => {
    const r = local(n);
    if (r && n.number && n.type === 'PullRequest') return onOpen(r.name, n.number);
    if (r && n.number && n.type === 'Issue') return onOpenIssue(r.name, n.number);
    if (n.htmlUrl) window.open(n.htmlUrl, '_blank');
  };
  const row = (n) => ListRow(host, {
    key: n.id,
    lead: h('span', { className: 'mind-dot', style: { background: n.type === 'PullRequest' ? 'var(--sy-brass)' : n.type === 'Issue' ? 'var(--sy-moss)' : 'var(--sy-text-3)' } }),
    label: `${n.number ? `#${n.number} ` : ''}${n.title}`,
    sub: `${n.owner}/${n.repo} - ${n.type.replace(/([A-Z])/g, ' $1').trim().toLowerCase()}${local(n) ? '' : ' - not in this workspace'}`,
    meta: ago(n.updatedAt),
    onClick: () => open(n),
  });
  const prs = list.filter((n) => n.type === 'PullRequest').length;
  const iss = list.filter((n) => n.type === 'Issue').length;
  const askedOfYou = (groups.review_requested || []).length + (groups.mention || []).length + (groups.assign || []).length;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Unread', value: items === null ? '...' : list.length, tone: list.length ? 'brass' : 'muted' }),
      Stat(host, { label: 'Asked of you', value: items === null ? '...' : askedOfYou, tone: askedOfYou ? 'rosin' : 'muted', hint: askedOfYou ? 'reviews, mentions, assignments' : undefined }),
      Stat(host, { label: 'Pull requests', value: items === null ? '...' : prs }),
      Stat(host, { label: 'Issues', value: items === null ? '...' : iss, tone: 'muted' })),
    h('div', { className: 'mhealth' },
      ...[...new Set(list.map((n) => `${n.owner}/${n.repo}`))].slice(0, 5).map((r) => Health(host, { label: r, value: list.filter((n) => `${n.owner}/${n.repo}` === r).length })),
      list.length ? null : Health(host, { label: 'inbox', value: items === null ? '...' : 'empty' })),
    error ? h('p', { className: 'mlead', style: { margin: 0, color: 'var(--sy-rosin)' } }, error) : null,
    items === null ? Panel(host, { title: 'Inbox', wide: true }, h(ui.Skeleton, { count: 5, height: 18 }))
      : !list.length ? Panel(host, { title: 'Inbox', wide: true }, empty('Nothing unread. Enjoy it.'))
      : keys.map((k) => Panel(host, { key: k, title: REASONS[k] || k, wide: true, action: meta(`${groups[k].length}`) }, List(host, groups[k].map(row)))),
    list.length ? h('div', null, h(ui.Button, { className: 'sy-btn--sm', onClick: () => markRead(null) }, 'Mark everything read')) : null);
}

export function InboxAside({ host, inbox, repos }) {
  const { h, ui } = host;
  const { items } = inbox;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };
  const list = items || [];
  const byRepo = {};
  for (const n of list) byRepo[`${n.owner}/${n.repo}`] = (byRepo[`${n.owner}/${n.repo}`] || 0) + 1;
  const here = new Set((repos || []).filter((r) => r.github).map((r) => `${r.github.owner}/${r.github.repo}`.toLowerCase()));
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'By repository', ...FILL, action: meta(items === null ? '...' : `${Object.keys(byRepo).length}`) },
      items === null ? h(ui.Skeleton, { count: 3, height: 16 }) : Object.keys(byRepo).length ? List(host, Object.entries(byRepo).sort((a, b) => b[1] - a[1]).map(([r, n]) => ListRow(host, { key: r, label: r, sub: here.has(r.toLowerCase()) ? 'in this workspace' : 'elsewhere', meta: `${n}` }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing unread.')),
    Panel(host, { title: 'How it works' }, h('p', { className: 'mlead', style: { margin: 0 } }, 'Unread notifications from GitHub, grouped by why they reached you. Clicking one on a repository in this workspace opens it here; the others open on GitHub. Reading it there marks it read.')));
}
