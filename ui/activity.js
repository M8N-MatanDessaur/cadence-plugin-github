/**
 * Activity and team, as a bento.
 *
 * What moved on the repository lately (commits, pushes, opened and closed things, releases)
 * and who moved it: each person with their commits, pull requests, reviews asked of them,
 * issues held, and when they were last seen. Recently closed pull requests keep their place.
 */
import { ago } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

export function useActivity(host, repo, enabled) {
  const { react, api } = host;
  const { useState, useEffect, useCallback } = react;
  const [activity, setActivity] = useState(null);
  const [team, setTeam] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!repo || !enabled) return;
    setError(null);
    api(`/api/github/activity?repo=${encodeURIComponent(repo)}&days=14`).then(setActivity).catch((e) => { setActivity({ commits: [], events: [] }); setError(e.message); });
    api(`/api/github/team?repo=${encodeURIComponent(repo)}`).then((d) => setTeam(d.people || [])).catch(() => setTeam([]));
  }, [repo, enabled]);
  useEffect(() => { setActivity(null); setTeam(null); reload(); }, [reload]);
  return { activity, team, error, reload };
}

const eventTone = (e) => /closed|deleted/.test(e.what) ? 'var(--sy-text-3)' : /merged|release|created/.test(e.what) ? 'var(--sy-moss)' : 'var(--sy-brass)';

export function Activity({ host, me, repo, data, closed, onOpen }) {
  const { h, ui } = host;
  const { activity, team, error } = data;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (!repo) return h(ui.EmptyState, { title: 'Choose a repository', body: 'Pick one in the sidebar; what moved on it appears here.' });
  const loading = activity === null;
  const commits = activity ? activity.commits || [] : [];
  const events = activity ? activity.events || [] : [];
  const authors = new Set(commits.map((c) => c.author).filter(Boolean));
  const merged = (closed || []).filter((p) => p.merged).length;
  // Reviews, comments and pushes count as being around, not only commits and PRs.
  const lastEvent = {};
  for (const e of events) if (e.actor && (!lastEvent[e.actor] || new Date(e.at) > new Date(lastEvent[e.actor]))) lastEvent[e.actor] = e.at;
  const seenAt = (p) => [p.lastSeen, lastEvent[p.login]].filter(Boolean).sort().pop() || null;
  const busiest = (team || []).slice(0, 3);
  const lastCommit = commits[0];

  const person = (p) => ListRow(host, {
    key: p.login,
    lead: p.avatar ? h('img', { src: `/api/github/image?url=${encodeURIComponent(p.avatar)}`, alt: '', width: 20, height: 20, style: { borderRadius: '50%', display: 'block' } }) : h('span', { className: 'mind-dot', style: { background: 'var(--sy-brass)' } }),
    label: `${p.login}${me && p.login === me.login ? ' (you)' : ''}`,
    sub: [`${p.commits} commit${p.commits === 1 ? '' : 's'}`, `${p.prsOpen} open PR${p.prsOpen === 1 ? '' : 's'}`, `${p.prsMerged} merged`, p.reviewsAsked ? `${p.reviewsAsked} review${p.reviewsAsked === 1 ? '' : 's'} asked` : null, p.issuesHeld ? `${p.issuesHeld} issue${p.issuesHeld === 1 ? '' : 's'} held` : null].filter(Boolean).join(' - '),
    meta: seenAt(p) ? ago(seenAt(p)) : p.collaborator ? 'quiet' : '',
  });

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Commits, 14 days', value: loading ? '...' : commits.length, tone: 'brass' }),
      Stat(host, { label: 'People active', value: loading ? '...' : authors.size, tone: authors.size ? 'brass' : 'muted' }),
      Stat(host, { label: 'Merged lately', value: closed ? merged : '...', tone: merged ? 'moss' : 'muted' }),
      Stat(host, { label: 'Last commit', value: loading ? '...' : lastCommit ? ago(lastCommit.at).replace(' ago', '') : 'none', tone: 'muted', hint: lastCommit ? lastCommit.author : undefined })),
    h('div', { className: 'mhealth' },
      ...(busiest.length ? busiest.map((p) => Health(host, { label: p.login, value: `${p.commits + p.prsMerged}` })) : [Health(host, { label: 'team', value: team === null ? '...' : 'quiet' })]),
      Health(host, { label: 'events', value: loading ? '...' : events.length }),
      Health(host, { label: 'Repository', value: repo })),
    error ? h('p', { className: 'mlead', style: { margin: 0, color: 'var(--sy-rosin)' } }, error) : null,
    h('div', { className: 'gh-row2' },
      Panel(host, { title: 'Commits', action: meta(loading ? '' : `${commits.length} in 14 days`) },
        loading ? h(ui.Skeleton, { count: 5, height: 18 }) : commits.length ? h('div', { style: { maxHeight: 520, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, commits.slice(0, 60).map((c) => ListRow(host, { key: c.sha, lead: h('code', { className: 'mpanel__meta' }, c.short), label: c.message, sub: `${c.author} - ${ago(c.at)}`, onClick: c.htmlUrl ? () => window.open(c.htmlUrl, '_blank') : undefined })))) : empty('Nothing was committed in the last two weeks.')),
      Panel(host, { title: 'What happened', action: meta(loading ? '' : `${events.length}`) },
        loading ? h(ui.Skeleton, { count: 5, height: 18 }) : events.length ? h('div', { style: { maxHeight: 520, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, events.slice(0, 80).map((e, i) => ListRow(host, { key: i, lead: h('span', { className: 'mind-dot', style: { background: eventTone(e) } }), label: `${e.actor} ${e.what}`, sub: e.ref, meta: ago(e.at), onClick: /^#\d+/.test(e.ref) && /PR|reviewed|diff/.test(e.what) ? () => onOpen(Number(e.ref.match(/^#(\d+)/)[1])) : undefined })))) : empty('GitHub reports no events for the last two weeks.'))),
    Panel(host, { title: 'Team', wide: true, action: meta(team === null ? 'reading...' : `${team.length} - last 30 days`) },
      team === null ? h(ui.Skeleton, { count: 4, height: 18 }) : team.length ? List(host, team.map(person)) : empty('Nobody shows up on this repository.')),
    Panel(host, { title: 'Recently closed pull requests', wide: true, action: meta(closed ? `${closed.length}` : '...') },
      closed === null ? h(ui.Skeleton, { count: 3, height: 18 }) : closed.length ? List(host, closed.slice(0, 30).map((p) => ListRow(host, { key: p.number, lead: h('span', { className: 'mind-dot', style: { background: p.merged ? 'var(--sy-moss)' : 'var(--sy-text-3)' } }), label: `#${p.number} ${p.title}`, sub: `${p.author} - ${p.merged ? 'merged' : 'closed'} ${ago(p.updatedAt)}`, onClick: () => onOpen(p.number) }))) : empty('Nothing closed lately.')));
}

export function ActivityAside({ host, me, data, onOpen }) {
  const { h, ui } = host;
  const { team, activity } = data;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };
  const you = me && team ? team.find((p) => p.login === me.login) : null;
  const lastEvent = {};
  for (const e of (activity ? activity.events || [] : [])) if (e.actor && (!lastEvent[e.actor] || new Date(e.at) > new Date(lastEvent[e.actor]))) lastEvent[e.actor] = e.at;
  const seenAt = (p) => [p.lastSeen, lastEvent[p.login]].filter(Boolean).sort().pop() || null;
  const quiet = (team || []).filter((p) => p.collaborator && (!seenAt(p) || Date.now() - new Date(seenAt(p)) > 14 * 86400000));
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'You, 30 days', action: meta(you ? '' : team === null ? '...' : 'not on this repo') },
      you ? h(ui.InfoGrid, { items: [{ label: 'Commits', value: you.commits }, { label: 'Open PRs', value: you.prsOpen }, { label: 'Merged', value: you.prsMerged }, { label: 'Reviews asked', value: you.reviewsAsked }, { label: 'Issues held', value: you.issuesHeld }] }) : h('p', { className: 'mlead', style: { margin: 0 } }, team === null ? 'Reading...' : 'No activity of yours in the last 30 days.')),
    Panel(host, { title: 'Quiet collaborators', ...FILL, action: meta(team === null ? '...' : `${quiet.length}`) },
      team === null ? h(ui.Skeleton, { count: 2, height: 16 }) : quiet.length ? List(host, quiet.map((p) => ListRow(host, { key: p.login, label: p.login, sub: seenAt(p) ? `last seen ${ago(seenAt(p))}` : 'nothing in 30 days' }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Everyone with access has been around.')),
    Panel(host, { title: 'Latest pushes', ...FILL, action: meta(activity ? `${(activity.events || []).filter((e) => e.type === 'PushEvent').length}` : '...') },
      activity === null ? h(ui.Skeleton, { count: 3, height: 16 }) : (activity.events || []).some((e) => e.type === 'PushEvent') ? List(host, (activity.events || []).filter((e) => e.type === 'PushEvent').slice(0, 15).map((e, i) => ListRow(host, { key: i, label: e.ref, sub: `${e.actor} - ${ago(e.at)}` }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No push in the last two weeks.')));
}
