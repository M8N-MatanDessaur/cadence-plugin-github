/**
 * Releases, as a bento: what shipped, what is waiting to ship since the last tag, and a
 * form that writes the notes from the commits and pull requests (Write with AI) and cuts
 * the release.
 */
import { ago, waitForTask } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

export function useReleases(host, repo, enabled) {
  const { react, api } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const [delta, setDelta] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!repo || !enabled) return;
    setError(null);
    api(`/api/github/releases?repo=${encodeURIComponent(repo)}`).then(setData).catch((e) => { setData({ releases: [], tags: [] }); setError(e.message); });
    api(`/api/github/releases/delta?repo=${encodeURIComponent(repo)}`).then(setDelta).catch(() => setDelta({ commits: [], pulls: [] }));
  }, [repo, enabled]);
  useEffect(() => { setData(null); setDelta(null); reload(); }, [reload]);
  return { data, delta, error, reload };
}

const bump = (tag, part) => {
  const m = String(tag || '').match(/^(v?)(\d+)\.(\d+)\.(\d+)/);
  if (!m) return '';
  const n = [Number(m[2]), Number(m[3]), Number(m[4])];
  if (part === 'major') { n[0]++; n[1] = 0; n[2] = 0; } else if (part === 'minor') { n[1]++; n[2] = 0; } else n[2]++;
  return `${m[1]}${n.join('.')}`;
};

export function Releases({ host, repo, releases, onNew }) {
  const { h, ui } = host;
  const { data, delta, error } = releases;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (!repo) return h(ui.EmptyState, { title: 'Choose a repository', body: 'Pick one in the sidebar; its releases appear here.' });
  const loading = data === null;
  const list = data ? data.releases || [] : [];
  const latest = list.find((r) => !r.draft && !r.prerelease) || list[0];
  const waiting = delta ? (delta.commits || []).length : null;
  const downloads = list.reduce((n, r) => n + r.assets.reduce((m, a) => m + (a.downloads || 0), 0), 0);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Latest', value: loading ? '...' : latest ? latest.tag : 'none', tone: 'brass', hint: latest && latest.publishedAt ? ago(latest.publishedAt) : undefined }),
      Stat(host, { label: 'Waiting to ship', value: waiting === null ? '...' : waiting, tone: waiting ? 'rosin' : 'muted', hint: waiting ? `commit${waiting === 1 ? '' : 's'} since ${delta.from || 'the start'}` : undefined }),
      Stat(host, { label: 'Releases', value: loading ? '...' : list.length }),
      Stat(host, { label: 'Downloads', value: loading ? '...' : downloads, tone: 'muted' })),
    h('div', { className: 'mhealth' },
      Health(host, { label: 'drafts', value: loading ? '...' : list.filter((r) => r.draft).length }),
      Health(host, { label: 'prereleases', value: loading ? '...' : list.filter((r) => r.prerelease).length }),
      Health(host, { label: 'tags', value: data ? (data.tags || []).length : '...' }),
      Health(host, { label: 'Repository', value: repo })),
    error ? h('p', { className: 'mlead', style: { margin: 0, color: 'var(--sy-rosin)' } }, error) : null,
    h('div', { className: 'gh-row2' },
      Panel(host, { title: 'Since the last release', action: h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', onClick: onNew }, 'New release') },
        delta === null ? h(ui.Skeleton, { count: 4, height: 16 }) : (delta.commits || []).length ? h('div', { style: { maxHeight: 420, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } },
          (delta.pulls || []).length ? List(host, delta.pulls.map((p) => ListRow(host, { key: `pr${p.number}`, lead: h('span', { className: 'mind-dot', style: { background: 'var(--sy-moss)' } }), label: `#${p.number} ${p.title}`, sub: `${p.author}${p.labels.length ? ` - ${p.labels.join(', ')}` : ''}` }))) : null,
          List(host, delta.commits.slice(0, 40).map((c) => ListRow(host, { key: c.sha, lead: h('code', { className: 'mpanel__meta' }, c.sha), label: c.message, sub: c.author }))))
          : empty(delta.from ? `Nothing since ${delta.from}.` : 'No commits found.')),
      Panel(host, { title: 'Latest release', action: meta(latest ? `${latest.tag} - ${latest.author}` : '') },
        loading ? h(ui.Skeleton, { count: 6, height: 16 }) : latest ? h('div', { style: { maxHeight: 420, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, h(ui.Markdown, { source: latest.body || '_No notes were written._' })) : empty('No release yet. The form on the right cuts the first one.'))),
    Panel(host, { title: 'All releases', wide: true, action: meta(loading ? '' : `${list.length}`) },
      loading ? h(ui.Skeleton, { count: 4, height: 18 }) : list.length ? List(host, list.map((r) => ListRow(host, { key: r.id, lead: h('span', { className: 'mind-dot', style: { background: r.draft ? 'var(--sy-text-3)' : r.prerelease ? 'var(--sy-brass)' : 'var(--sy-moss)' } }), label: `${r.name}${r.name !== r.tag ? ` (${r.tag})` : ''}`, sub: `${r.draft ? 'draft' : r.prerelease ? 'prerelease' : 'released'} - ${r.author} - ${ago(r.publishedAt || r.createdAt)}${r.assets.length ? ` - ${r.assets.length} asset${r.assets.length === 1 ? '' : 's'}` : ''}`, onClick: r.htmlUrl ? () => window.open(r.htmlUrl, '_blank') : undefined }))) : empty('No releases.')));
}

export function ReleasesAside({ host, releases, onNew }) {
  const { h, ui } = host;
  const { data, delta } = releases;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };
  const latest = data ? (data.releases || []).find((r) => !r.draft && !r.prerelease) : null;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'Next release', action: meta(latest ? `after ${latest.tag}` : '') },
      h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, delta && (delta.commits || []).length ? `${delta.commits.length} commit${delta.commits.length === 1 ? '' : 's'} are waiting. The AI writes the notes from them.` : 'Nothing is waiting, but you can still cut one.'),
      h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } }, latest && bump(latest.tag, 'patch')
        ? ['patch', 'minor', 'major'].map((p) => h(ui.Button, { key: p, className: 'sy-btn--sm', variant: p === 'patch' ? 'primary' : undefined, onClick: () => onNew(bump(latest.tag, p)) }, bump(latest.tag, p)))
        : [h(ui.Button, { key: 'first', className: 'sy-btn--sm', variant: 'primary', onClick: () => onNew(latest ? '' : 'v0.1.0') }, latest ? 'Next release' : 'First release, v0.1.0')])),
    Panel(host, { title: 'Tags', ...FILL, action: meta(data ? `${(data.tags || []).length}` : '...') },
      data === null ? h(ui.Skeleton, { count: 4, height: 16 }) : (data.tags || []).length ? List(host, data.tags.map((t) => ListRow(host, { key: t.name, label: t.name, sub: t.sha }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No tags yet.')));
}

export function NewRelease({ host, repo, repoPath, releases, initialTag, onCreated, onCancel }) {
  const { h, ui, react, api, notify } = host;
  const { useState } = react;
  const { data, delta } = releases;
  const [tag, setTag] = useState(initialTag || '');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [pre, setPre] = useState(false);
  const [busy, setBusy] = useState(null);
  const write = async () => {
    setBusy('writing');
    try {
      const commits = (delta ? delta.commits || [] : []).map((c) => `- ${c.sha} ${c.message} (${c.author})`).join('\n');
      const pulls = (delta ? delta.pulls || [] : []).map((p) => `- #${p.number} ${p.title} by ${p.author}${p.labels.length ? ` [${p.labels.join(', ')}]` : ''}`).join('\n');
      const system = 'You write release notes for software users and the engineers who ship it. Plain, specific, grouped, no fluff, no emoji. Markdown only.';
      const prompt = `Write the release notes for ${tag || 'the next release'} of ${repo}${delta && delta.from ? `, everything since ${delta.from}` : ''}.${body.trim() ? ` The author's own notes to keep and expand: "${body.trim()}".` : ''}\n\nGroup under bold headings that fit (Features, Fixes, Changes, Internal); reference pull requests as #N; skip merge commits and noise; one line per item.\n\nPull requests:\n${pulls || '(none)'}\n\nCommits:\n${commits || '(none)'}`;
      let text = '';
      try { text = String((await api('/api/notes/ai', { method: 'POST', body: JSON.stringify({ prompt, system, maxTokens: 900 }) })).text || '').trim(); } catch (_) {}
      if (!text) {
        const cfg = await api('/api/config').catch(() => ({}));
        const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'github-release', timeout: 180000, prompt: `${system}\n\n${prompt}\n\nThis is a one-off answer: do not run any bootstrap, do not save anything. Reply with the notes only.` }) });
        text = String(result.handledLocally ? result.answer : result.id ? await waitForTask(api, result.id, 180000) : (result.error || '')).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim();
      }
      if (text) setBody(text); else notify('Nothing came back', 'rosin');
    } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  const create = async () => {
    if (!tag.trim()) return;
    setBusy('creating');
    try { const r = await api('/api/github/releases/create', { method: 'POST', body: JSON.stringify({ repo, tag: tag.trim(), name: name.trim() || tag.trim(), body, draft, prerelease: pre }) }); notify(`${draft ? 'Drafted' : 'Released'} ${r.tag}`, 'moss'); onCreated(); }
    catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  const exists = data && (data.tags || []).some((t) => t.name === tag.trim());
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'New release', wide: true, action: h('span', { className: 'mpanel__meta' }, delta && delta.from ? `since ${delta.from}` : repo) },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { className: 'gh-row2' },
          h(ui.Field, { label: 'Tag', hint: exists ? 'exists - the release goes on it' : 'created on the default branch if new' }, h(ui.Input, { value: tag, placeholder: 'v1.2.3', onChange: (e) => setTag(e.target.value), autoFocus: true })),
          h(ui.Field, { label: 'Name' }, h(ui.Input, { value: name, placeholder: tag || 'Same as the tag', onChange: (e) => setName(e.target.value) }))),
        h(ui.Field, { label: 'Notes' }, h(ui.Textarea, { value: body, rows: 12, placeholder: 'Your notes, or nothing: Write with AI drafts them from the commits and pull requests since the last release.', onChange: (e) => setBody(e.target.value) })),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          h(ui.Chip, { on: draft, onClick: () => setDraft(!draft) }, 'Draft'),
          h(ui.Chip, { on: pre, onClick: () => setPre(!pre) }, 'Prerelease')),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h(ui.Button, { onClick: onCancel }, 'Cancel'),
          h('span', { style: { flex: 1 } }),
          h(ui.Button, { disabled: !!busy || !delta, onClick: write }, busy === 'writing' ? 'Writing...' : 'Write with AI'),
          h(ui.Button, { variant: 'primary', disabled: !!busy || !tag.trim(), onClick: create }, busy === 'creating' ? 'Cutting...' : draft ? 'Save the draft' : 'Release it')))));
}
