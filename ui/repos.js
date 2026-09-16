/**
 * Repositories: the ones on this machine, and the ones on GitHub.
 *
 * Local looks where you tell it to - a code folder, a drive - and lists every git repository it
 * finds there, with the ones already in the workspace marked. One click adds a repo to the
 * workspace, opens its folder in Explorer, or opens a shell on it. The folders to look in
 * start as the parents of the repositories the workspace already has, and are remembered.
 *
 * On GitHub lists what your account can see, fetched from GitHub; Clone asks where with the
 * app's own folder dialog, clones there, and registers the clone with Cadence.
 */
import { ago } from './helpers.js';
import { Panel, Stat, List, ListRow } from './kit.js';

const ROOTS_KEY = 'sy.gh.local-roots';
const readRoots = () => { try { const v = JSON.parse(localStorage.getItem(ROOTS_KEY) || 'null'); return Array.isArray(v) ? v : null; } catch { return null; } };
const writeRoots = (roots) => { try { localStorage.setItem(ROOTS_KEY, JSON.stringify(roots)); } catch {} };
const parentOf = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').replace(/\\[^\\]+$/, '');
const norm = (p) => String(p || '').replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();

export function Repos({ host, repos, onCloned }) {
  const { h, ui, react, api, notify } = host;
  const { useState, useEffect } = react;
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  // Local: where to look, and what was found there.
  // One chip per folder, whatever the slashes: the parents of the workspace's repos, deduped.
  const uniqueRoots = (list) => { const seen = new Set(); return list.filter((p) => { const k = norm(p); if (!p || seen.has(k)) return false; seen.add(k); return true; }); };
  const [roots, setRoots] = useState(() => uniqueRoots(readRoots() || (repos || []).map((r) => parentOf(r.path)).sort()));
  const [found, setFound] = useState({});
  const [foldersOpen, setFoldersOpen] = useState(false);
  const [typedRoot, setTypedRoot] = useState('');
  const [scanning, setScanning] = useState(0);
  const [localQ, setLocalQ] = useState('');

  const load = (p = 1) => {
    setError(null);
    api(`/api/github/user-repos?page=${p}${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}`)
      .then((d) => { setList((prev) => (p === 1 ? d.repos : [...(prev || []), ...d.repos])); setHasMore(!!d.hasMore); setPage(p); })
      .catch((e) => { setError(e.message); setList([]); });
  };
  useEffect(() => { load(1); }, []);

  const scan = (root) => {
    setScanning((n) => n + 1);
    api(`/api/github/local-repos?root=${encodeURIComponent(root)}&depth=3`)
      .then((d) => setFound((f) => ({ ...f, [root]: d.repos || [] })))
      .catch((e) => { setFound((f) => ({ ...f, [root]: [] })); notify(`Could not look in ${root}: ${e.message}`, 'rosin'); })
      .finally(() => setScanning((n) => n - 1));
  };
  useEffect(() => { writeRoots(roots); for (const r of roots) if (!found[r]) scan(r); }, [roots]);

  const addRoot = async () => {
    try {
      const picked = await api('/api/browse-folder', { method: 'POST' });
      if (picked && !picked.canceled && picked.path) setRoots(uniqueRoots([...roots, picked.path]));
    } catch (e) { notify(e.message, 'rosin'); }
  };
  const addTyped = () => { const v = typedRoot.trim(); if (!v) return; setRoots(uniqueRoots([...roots, v])); setTypedRoot(''); };
  // A stack of folders, for the rows and the dialog.
  const FolderIcon = () => h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { display: 'block', color: 'var(--sy-brass)' } },
    h('path', { d: 'M20 17a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.9a2 2 0 0 1-1.69-.9l-.81-1.2a2 2 0 0 0-1.67-.9H8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2Z' }),
    h('path', { d: 'M2 8v11a2 2 0 0 0 2 2h14' }));
  const folderRow = (r, action) => ListRow(host, { key: r, lead: h(FolderIcon), label: r, sub: found[r] ? `${found[r].length} git repositor${found[r].length === 1 ? 'y' : 'ies'} found` : scanning ? 'looking...' : 'not scanned yet', meta: action });
  const foldersDialog = () => h(ui.Modal, { title: 'Folders to look in', onClose: () => setFoldersOpen(false), footer: h(ui.Button, { variant: 'primary', onClick: () => setFoldersOpen(false) }, 'Done') },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 420 } },
      h('p', { className: 'mlead', style: { margin: 0 } }, 'Every git repository inside these folders shows up under Local. Add a folder or a whole drive; remove one to stop looking there.'),
      roots.length ? List(host, roots.map((r) => folderRow(r, h('button', { type: 'button', className: 'sy-btn sy-btn--sm', onClick: () => dropRoot(r), title: `Stop looking in ${r}` }, 'Remove')))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nowhere to look yet.'),
      h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        h(ui.Input, { value: typedRoot, placeholder: 'Type a folder path, for example C:\\Code', onChange: (e) => setTypedRoot(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') addTyped(); }, 'aria-label': 'Folder path', style: { flex: 1 } }),
        h(ui.Button, { disabled: !typedRoot.trim(), onClick: addTyped }, 'Add'),
        h(ui.Button, { onClick: addRoot, title: 'Pick a folder with the system dialog' }, 'Browse...'))));
  const dropRoot = (root) => { setRoots(roots.filter((r) => r !== root)); setFound((f) => { const n = { ...f }; delete n[root]; return n; }); };

  const inWorkspace = new Map((repos || []).map((r) => [norm(r.path), r.name]));
  const addToWorkspace = async (r) => {
    setBusy(r.path);
    try { await api('/api/repos', { method: 'POST', body: JSON.stringify({ name: r.name, path: r.path }) }); notify(`${r.name} is in the workspace`, 'moss'); onCloned && onCloned(); }
    catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  const reveal = async (r) => {
    const name = inWorkspace.get(norm(r.path));
    try {
      if (name) await api('/api/files/reveal', { method: 'POST', body: JSON.stringify({ repo: name, path: '' }) });
      else await api('/api/open-external', { method: 'POST', body: JSON.stringify({ url: `file:///${String(r.path).replace(/\\/g, '/')}` }) });
    } catch (e) { notify(e.message, 'rosin'); }
  };
  const shell = (r) => host.openShell ? host.openShell({ repo: inWorkspace.get(norm(r.path)) || r.name, path: r.path }) : host.navigate('terminal');

  const here = new Set((repos || []).map((r) => r.name.toLowerCase()));
  const clone = async (r) => {
    setBusy(r.full_name);
    try {
      const picked = await api('/api/browse-folder', { method: 'POST' });
      const dest = picked && !picked.canceled ? picked.path : null;
      if (!dest) { setBusy(null); return; }
      const out = await api('/api/github/clone', { method: 'POST', body: JSON.stringify({ cloneUrl: r.clone_url, destPath: dest }) });
      await api('/api/repos', { method: 'POST', body: JSON.stringify({ name: out.name || r.name, path: out.path }) });
      notify(`Cloned ${r.name} into ${out.path}; it is in the workspace now`, 'moss');
      onCloned && onCloned();
      if (!roots.some((x) => norm(x) === norm(dest))) setRoots(uniqueRoots([...roots, dest])); else scan(dest);
    } catch (e) { notify(`Clone failed: ${e.message}`, 'rosin'); }
    finally { setBusy(null); }
  };

  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const items = list || [];
  const seen = new Set();
  const local = [].concat(...roots.map((r) => found[r] || [])).filter((r) => { const k = norm(r.path); if (seen.has(k)) return false; seen.add(k); return true; })
    .filter((r) => !localQ.trim() || `${r.name} ${r.path} ${r.github || ''}`.toLowerCase().includes(localQ.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const notYet = local.filter((r) => !inWorkspace.has(norm(r.path)));
  const FILL = { style: { minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { minHeight: 0, overflow: 'auto', maxHeight: 'calc(100vh - 420px)', paddingRight: 14, scrollbarGutter: 'stable' } };

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'In the workspace', value: (repos || []).length, tone: 'brass' }),
      Stat(host, { label: 'Found on disk', value: scanning ? '...' : local.length, hint: `in ${roots.length} folder${roots.length === 1 ? '' : 's'}` }),
      Stat(host, { label: 'Not in the workspace', value: scanning ? '...' : notYet.length, tone: notYet.length ? 'brass' : 'muted', hint: 'one click adds' }),
      Stat(host, { label: 'On GitHub', value: list === null ? '...' : `${items.length}${hasMore ? '+' : ''}`, hint: 'that your token can see' })),
    error ? h('p', { className: 'mlead', style: { margin: 0 } }, `GitHub: ${error}`) : null,
    h('div', { className: 'gh-row2' },
      Panel(host, { title: 'Local', ...FILL, action: h(ui.Button, { className: 'sy-btn--sm', onClick: () => setFoldersOpen(true), title: 'See and change the folders that are searched' }, 'Look in a folder...') },
        foldersOpen ? foldersDialog() : null,
        h('div', { style: { marginBottom: 'var(--sy-s2)' } },
          roots.length ? List(host, roots.map((r) => folderRow(r, null))) : h('span', { className: 'mpanel__meta' }, 'Nowhere to look yet. Choose a folder.')),
        h('div', { style: { marginBottom: 'var(--sy-s2)' } }, h(ui.Input, { value: localQ, placeholder: 'Filter what was found', onChange: (e) => setLocalQ(e.target.value), 'aria-label': 'Filter local repositories' })),
        scanning && !local.length ? h(ui.Skeleton, { count: 5, height: 18 })
          : local.length ? List(host, local.map((r) => {
            const name = inWorkspace.get(norm(r.path));
            return ListRow(host, {
              key: r.path,
              lead: h('span', { className: 'mind-dot', style: { background: name ? 'var(--sy-moss)' : r.github ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }),
              label: name || r.name,
              sub: `${r.path}${r.github ? ` - ${r.github}` : r.origin ? ' - not on GitHub' : ' - no remote'}`,
              meta: h('span', { style: { display: 'inline-flex', gap: 6 } },
                name ? null : h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: busy === r.path, onClick: (e) => { e.stopPropagation(); addToWorkspace(r); }, title: 'Add this repository to the workspace' }, busy === r.path ? 'Adding...' : 'Add'),
                h(ui.Button, { className: 'sy-btn--sm', onClick: (e) => { e.stopPropagation(); reveal(r); }, title: 'Open the folder in Explorer' }, 'Explorer'),
                name ? h(ui.Button, { className: 'sy-btn--sm', onClick: (e) => { e.stopPropagation(); shell(r); }, title: 'A shell on this repository' }, 'Shell') : null),
            });
          })) : h('p', { className: 'mlead', style: { margin: 0 } }, roots.length ? 'No git repository found in those folders.' : 'Choose a folder to look in.')),
      Panel(host, { title: 'On GitHub', ...FILL, action: meta(list === null ? 'reading...' : hasMore ? 'more on GitHub' : 'all shown') },
        h('div', { style: { display: 'flex', gap: 8, marginBottom: 'var(--sy-s2)' } },
          h(ui.Input, { value: q, placeholder: 'Search your GitHub repositories', onChange: (e) => setQ(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') load(1); }, 'aria-label': 'Search GitHub repositories' }),
          h(ui.Button, { onClick: () => load(1) }, 'Search')),
        list === null ? h(ui.Skeleton, { count: 6, height: 18 })
          : items.length ? h('div', null,
            List(host, items.map((r) => ListRow(host, {
              key: r.full_name,
              lead: h('span', { className: 'mind-dot', style: { background: here.has(r.name.toLowerCase()) ? 'var(--sy-moss)' : r.private ? 'var(--sy-text-3)' : 'var(--sy-brass)' } }),
              label: r.full_name,
              sub: [r.description, r.language, r.private ? 'private' : 'public', r.pushed_at ? `pushed ${ago(r.pushed_at)}` : null].filter(Boolean).join(' - '),
              meta: here.has(r.name.toLowerCase()) ? 'on this machine' : h(ui.Button, { className: 'sy-btn--sm', disabled: !!busy, onClick: (e) => { e.stopPropagation(); clone(r); }, title: 'Choose a folder, clone there, and add it to the workspace' }, busy === r.full_name ? 'Cloning...' : 'Clone...'),
            }))),
            hasMore ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, h(ui.Button, { onClick: () => load(page + 1) }, 'More from GitHub')) : null)
            : h('p', { className: 'mlead', style: { margin: 0 } }, 'No repository matches.'))));
}
