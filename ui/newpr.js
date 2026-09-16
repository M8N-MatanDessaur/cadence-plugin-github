/**
 * A new pull request: the local branch (pushed first if it is not on GitHub yet), the base,
 * a title and a description the AI writes from the commits and the diff, reviewers, labels.
 */
import { waitForTask } from './helpers.js';
import { Panel, List, ListRow } from './kit.js';
import { labelColour } from './issues.js';

export function NewPullRequest({ host, repo, repoPath, onCreated, onCancel }) {
  const { h, ui, react, api, notify } = host;
  const { useState, useEffect } = react;
  const [branches, setBranches] = useState(null);
  const [head, setHead] = useState('');
  const [base, setBase] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [draft, setDraft] = useState(false);
  const [people, setPeople] = useState([]);
  const [labels, setLabels] = useState([]);
  const [reviewers, setReviewers] = useState([]);
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(null);
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!repo) return;
    api(`/api/github/branches?repo=${encodeURIComponent(repo)}`).then((b) => { setBranches(b); setHead(b.local || ''); setBase(b.default || 'main'); }).catch((e) => { setBranches({ branches: [], error: e.message }); });
    api(`/api/github/collaborators?repo=${encodeURIComponent(repo)}`).then((d) => setPeople(d.people || [])).catch(() => {});
    api(`/api/github/labels?repo=${encodeURIComponent(repo)}`).then((d) => setLabels(d.labels || [])).catch(() => {});
  }, [repo]);
  // The commits on the branch, from the local checkout, so the description has something to say.
  useEffect(() => {
    if (!head || !base || !repoPath) return;
    setPreview(null);
    api(`/api/github/branch-commits?repo=${encodeURIComponent(repo)}&head=${encodeURIComponent(head)}&base=${encodeURIComponent(base)}`).then((d) => setPreview(d.commits || [])).catch(() => setPreview([]));
  }, [head, base, repoPath]);
  const needsPush = branches && head && !(branches.branches || []).includes(head);
  const write = async () => {
    setBusy('writing');
    try {
      const commits = (preview || []).map((c) => `- ${(c.subject || c.message || '').split('\n')[0]}`).join('\n');
      const system = 'You write GitHub pull request descriptions for a busy reviewer. Plain, specific, no fluff, no emoji. Markdown only.';
      const prompt = `Write the title (first line, no prefix) and description of a pull request from branch ${head} into ${base} on ${repo}.${title.trim() || body.trim() ? ` The author's own words to keep: "${[title.trim(), body.trim()].filter(Boolean).join(' - ')}".` : ''}\n\nSections: **What** (one or two lines), **Why**, **How to test**, and **Notes** only if something needs care. Never invent behaviour the commits do not show.\n\nCommits on the branch:\n${commits || '(none read locally - write from the author words and the branch name)'}`;
      let text = '';
      try { text = String((await api('/api/notes/ai', { method: 'POST', body: JSON.stringify({ prompt, system, maxTokens: 800 }) })).text || '').trim(); } catch (_) {}
      if (!text) {
        const cfg = await api('/api/config').catch(() => ({}));
        const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'github-newpr', timeout: 180000, prompt: `${system}\n\n${prompt}${repoPath ? `\n\nThe repository is checked out at ${repoPath} on branch ${head}; you may run git log/diff against origin/${base} there to ground the text.` : ''}\n\nThis is a one-off answer: do not run any bootstrap, do not save anything. Reply with the title line then the description only.` }) });
        text = String(result.handledLocally ? result.answer : result.id ? await waitForTask(api, result.id, 180000) : (result.error || '')).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim();
      }
      if (!text) return notify('Nothing came back', 'rosin');
      const lines = text.split('\n');
      const first = lines.findIndex((l) => l.trim());
      if (!title.trim() && first >= 0) { setTitle(lines[first].replace(/^#+\s*|^\*\*|\*\*$|^title:\s*/gi, '').trim().slice(0, 120)); setBody(lines.slice(first + 1).join('\n').trim()); }
      else setBody(text);
    } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  const create = async () => {
    if (!title.trim() || !head) return;
    setBusy('creating');
    try {
      const r = await api('/api/github/pulls/create', { method: 'POST', body: JSON.stringify({ repo, title, body, head, base, draft, push: !!needsPush, reviewers, labels: picked }) });
      notify(`Opened #${r.number}`, 'moss');
      onCreated(r.number);
    } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  const toggle = (list, set, v) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return h('div', { className: 'gh-item' },
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
      Panel(host, { title: 'Pull request', action: h('span', { className: 'mpanel__meta' }, branches === null ? 'reading branches...' : needsPush ? `${head} is not on GitHub yet - it is pushed first` : head === base ? 'pick a different branch' : `${head} into ${base}`) },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
          h('div', { className: 'gh-row2' },
            h(ui.Field, { label: 'From' }, h(ui.Select, { value: head, onChange: (e) => setHead(e.target.value), 'aria-label': 'Source branch' },
              [...new Set([branches && branches.local, ...((branches && branches.branches) || [])].filter(Boolean))].map((b) => h('option', { key: b, value: b }, `${b}${branches && b === branches.local ? ' (local)' : ''}`)))),
            h(ui.Field, { label: 'Into' }, h(ui.Select, { value: base, onChange: (e) => setBase(e.target.value), 'aria-label': 'Target branch' },
              ((branches && branches.branches) || [base]).map((b) => h('option', { key: b, value: b }, b))))),
          h(ui.Field, { label: 'Title' }, h(ui.Input, { value: title, placeholder: 'What this changes, in one line', onChange: (e) => setTitle(e.target.value), autoFocus: true })),
          h(ui.Field, { label: 'Description' }, h(ui.Textarea, { value: body, rows: 10, placeholder: 'What, why, how to test. Write with AI drafts it from the commits on the branch.', onChange: (e) => setBody(e.target.value) })),
          h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
            h(ui.Chip, { on: draft, onClick: () => setDraft(!draft) }, 'Draft'),
            h('span', { style: { flex: 1 } }),
            h(ui.Button, { onClick: onCancel }, 'Cancel'),
            h(ui.Button, { disabled: !!busy || !head, onClick: write }, busy === 'writing' ? 'Writing...' : 'Write with AI'),
            h(ui.Button, { variant: 'primary', disabled: !!busy || !title.trim() || !head || head === base, onClick: create }, busy === 'creating' ? (needsPush ? 'Pushing and opening...' : 'Opening...') : needsPush ? 'Push and open' : 'Open the pull request')))),
      Panel(host, { title: 'Commits on the branch', action: h('span', { className: 'mpanel__meta' }, preview === null ? (head ? 'reading...' : '') : `${preview.length}`) },
        preview === null ? h(ui.Skeleton, { count: 3, height: 16 }) : preview.length ? h('div', { style: { maxHeight: 320, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, List(host, preview.map((c, i) => ListRow(host, { key: c.hash || c.sha || i, lead: h('code', { className: 'mpanel__meta' }, String(c.hash || c.sha || '').slice(0, 7)), label: (c.subject || c.message || '').split('\n')[0], sub: c.author || c.authorName || '' })))) : h('p', { className: 'mlead', style: { margin: 0 } }, head === base ? 'Same branch on both sides.' : `Nothing on ${head} beyond origin/${base}, or the log could not be read locally.`))),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
      Panel(host, { title: 'Reviewers', action: h('span', { className: 'mpanel__meta' }, reviewers.length ? `${reviewers.length}` : 'none yet') },
        people.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, people.map((p) => h(ui.Chip, { key: p.login, on: reviewers.includes(p.login), onClick: () => toggle(reviewers, setReviewers, p.login) }, p.login))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No collaborators to ask.')),
      Panel(host, { title: 'Labels', action: h('span', { className: 'mpanel__meta' }, picked.length ? `${picked.length}` : 'none') },
        labels.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, labels.map((l) => h(ui.Chip, { key: l.name, on: picked.includes(l.name), onClick: () => toggle(picked, setPicked, l.name) }, h('span', { className: 'mind-dot', style: { background: labelColour(l.color), width: 7, height: 7, marginRight: 5 } }), l.name))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No labels on this repository.')),
      Panel(host, { title: 'Branch' }, h(ui.InfoGrid, { items: [{ label: 'Local', value: (branches && branches.local) || '-' }, { label: 'Pushed', value: branches === null ? '...' : needsPush ? 'not yet' : 'yes' }, { label: 'Ahead of default', value: branches && branches.aheadOfDefault !== null && branches.aheadOfDefault !== undefined ? String(branches.aheadOfDefault) : '-' }, { label: 'Default', value: (branches && branches.default) || '-' }] }))));
}
