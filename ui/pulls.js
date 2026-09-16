/**
 * The pull requests, as a bento.
 *
 * Stat cards first (open, drafts, waiting on you, changes requested), then the list split by
 * what it means to you: the ones asking for your review, yours, everyone else's. Each row
 * says what a reviewer wants to know before opening it - who, which branch into which, how
 * big, how it stands - and opens the pull request.
 *
 * The right pane is the same "waiting on you" across every repository, and what closed lately.
 */
import { ago } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

const STATUS_COLOUR = { approved: 'var(--sy-moss)', changes_requested: 'var(--sy-rosin)' };

function row(host, p, { onOpen, withRepo }) {
  const { h } = host;
  const size = (p.additions !== undefined || p.deletions !== undefined) ? `+${p.additions || 0} -${p.deletions || 0}` : '';
  const status = p.draft ? 'draft' : p.reviewStatus === 'approved' ? 'approved' : p.reviewStatus === 'changes_requested' ? 'changes requested' : p.state === 'closed' ? 'closed' : 'review pending';
  return ListRow(host, {
    key: `${p.repo || ''}#${p.number}`,
    lead: h('span', { className: 'mind-dot', style: { background: p.draft ? 'var(--sy-text-3)' : STATUS_COLOUR[p.reviewStatus] || 'var(--sy-brass)' } }),
    label: `#${p.number} ${p.title}`,
    sub: [withRepo && p.repo ? p.repo : null, p.author ? `by ${p.author}` : null, p.headRef ? `${p.headRef} -> ${p.baseRef || 'main'}` : null, status, p.updatedAt ? `updated ${ago(p.updatedAt)}` : null].filter(Boolean).join(' - '),
    meta: size || (p.comments ? `${p.comments} comments` : null),
    onClick: () => onOpen(p.number, p.repo),
  });
}

export function Pulls({ host, me, repo, mode, pulls, loading, onOpen, repos }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);

  if (mode === 'review') {
    // Across every repository: the ones that name you. A repo the workspace has opens in place;
    // one it does not is opened on GitHub.
    const list = (pulls || []).map((p) => ({ ...p, repoName: p.repo, repo: (repos || []).some((r) => r.name === p.repo) ? p.repo : null, external: !(repos || []).some((r) => r.name === p.repo), htmlUrl: p.htmlUrl }));
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
      h('div', { className: 'mstats mstats--head' },
        Stat(host, { label: 'Awaiting you', value: loading ? '...' : list.length, tone: list.length ? 'brass' : 'muted' }),
        Stat(host, { label: 'In this workspace', value: loading ? '...' : list.filter((p) => !p.external).length }),
        Stat(host, { label: 'Elsewhere', value: loading ? '...' : list.filter((p) => p.external).length, hint: 'repos not on this machine' }),
        Stat(host, { label: 'Drafts', value: loading ? '...' : list.filter((p) => p.draft).length, tone: 'muted' })),
      Panel(host, { title: 'Asking for your review', wide: true, action: meta(me ? `as ${me.login}` : '') },
        loading ? h(ui.Skeleton, { count: 5, height: 18 })
          : list.length ? List(host, list.map((p) => p.external
            ? ListRow(host, { key: `${p.owner}/${p.repo}#${p.number}`, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-text-3)' } }), label: `#${p.number} ${p.title}`, sub: `${p.owner}/${p.repoName} - by ${p.author} - updated ${ago(p.updatedAt)} - not on this machine`, meta: 'GitHub', onClick: () => window.open(p.htmlUrl, '_blank') })
            : row(host, p, { onOpen, withRepo: true })))
            : empty('Nothing asks for your review right now.')));
  }

  const open = pulls || [];
  const mine = me ? open.filter((p) => (p.reviewers || []).includes(me.login)) : [];
  const yours = me ? open.filter((p) => p.author === me.login) : [];
  const others = open.filter((p) => !mine.includes(p) && !yours.includes(p));
  const changes = open.filter((p) => p.reviewStatus === 'changes_requested').length;
  const approved = open.filter((p) => p.reviewStatus === 'approved').length;
  const drafts = open.filter((p) => p.draft).length;
  const stale = open.filter((p) => p.updatedAt && Date.now() - new Date(p.updatedAt) > 14 * 86400000).length;

  if (!repo) return h(ui.EmptyState, { title: 'Choose a repository', body: 'Pick one in the sidebar; its pull requests appear here.' });

  const section = (title, list, hint) => Panel(host, { title, wide: true, action: meta(loading ? '' : `${list.length}`) },
    loading ? h(ui.Skeleton, { count: 3, height: 18 }) : list.length ? List(host, list.map((p) => row(host, p, { onOpen }))) : empty(hint));

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    mode === 'pulls' ? h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Open', value: loading ? '...' : open.length, tone: 'brass' }),
      Stat(host, { label: 'Asking you here', value: loading ? '...' : mine.length, tone: mine.length ? 'brass' : 'muted', hint: 'on this repository' }),
      Stat(host, { label: 'Changes requested', value: loading ? '...' : changes, tone: changes ? 'rosin' : 'muted' }),
      Stat(host, { label: 'Approved', value: loading ? '...' : approved, tone: approved ? 'moss' : 'muted', hint: approved ? 'ready to merge' : undefined })) : null,
    mode === 'pulls' ? h('div', { className: 'mhealth' },
      Health(host, { label: 'Drafts', value: loading ? '...' : drafts }),
      Health(host, { label: 'Yours', value: loading ? '...' : yours.length }),
      Health(host, { label: 'Quiet 14d+', value: loading ? '...' : stale, tone: stale ? 'rosin' : undefined }),
      Health(host, { label: 'Repository', value: repo })) : null,
    mode === 'pulls'
      ? [
        me ? section('Asking for your review', mine, 'Nothing asks for your review on this repository.') : null,
        me ? section('Yours', yours, 'You have no open pull request here.') : null,
        section(me ? 'Everyone else' : 'Open pull requests', others, 'No other open pull requests.'),
      ]
      : [
        h('div', { key: 'cards', className: 'mstats mstats--head' },
          Stat(host, { label: 'Closed lately', value: loading ? '...' : open.length, tone: 'brass' }),
          Stat(host, { label: 'Approved before closing', value: loading ? '...' : approved, tone: approved ? 'moss' : 'muted' }),
          Stat(host, { label: 'Authors', value: loading ? '...' : new Set(open.map((p) => p.author)).size }),
          Stat(host, { label: 'Last closed', value: loading ? '...' : (open[0] && open[0].updatedAt ? ago(open[0].updatedAt) : '-'), tone: 'muted' })),
        section('Recently closed', open, 'Nothing closed lately.'),
      ]);
}

export function PullsAside({ host, me, repo, pulls, closed, requests, onOpen }) {
  const { h, ui } = host;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const list = (requests || []);
  // The pane never scrolls as a whole: each panel takes its share and scrolls inside.
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'Awaiting you', style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' }, action: meta(requests === null ? 'reading...' : `${list.length} across your repos`) },
      requests === null ? h(ui.Skeleton, { count: 3, height: 18 })
        : list.length ? List(host, list.map((p) => ListRow(host, {
          key: `${p.owner}/${p.repo}#${p.number}`,
          lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-brass)' } }),
          label: `#${p.number} ${p.title}`,
          sub: `${p.repo} - ${p.author} - ${ago(p.updatedAt)}`,
          onClick: () => onOpen(p.number, p.repo),
        }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing is waiting on you.')),
    Panel(host, { title: 'Recently closed', style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' }, action: meta(repo || '') },
      (closed || []).length ? List(host, closed.map((p) => ListRow(host, {
        key: p.number,
        lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-text-3)' } }),
        label: `#${p.number} ${p.title}`,
        sub: `${p.author} - ${ago(p.updatedAt)}`,
        onClick: () => onOpen(p.number),
      }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing closed lately.')));
}
