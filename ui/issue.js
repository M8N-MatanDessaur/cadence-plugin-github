/**
 * One issue, as a dashboard - and the form for a new one.
 *
 * Headline, numbers, then two columns: the description and the conversation on the left (a
 * composer on top, @mentions from the collaborators, Write with AI on your own words); on the
 * right what you can do - start working (a branch named after the issue, a shell on the repo
 * with the AI started), open or close it, hold it or hand it over, label it, a plan from the
 * AI, the pull requests that reference it, the details.
 */
import { ago, stripHtml, waitForTask } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';
import { labelColour } from './issues.js';

const PROXY = /https:\/\/(?:github\.com\/(?:user-attachments|[^\s)"'>]+\/(?:assets|files))\/[^\s)"'>]+|[a-z0-9.-]*githubusercontent\.com\/[^\s)"'>]+)/gi;
const withImages = (md) => String(md || '').replace(PROXY, (u) => `/api/github/image?url=${encodeURIComponent(u)}`);

/** Everything one issue needs, plus the repo's labels and people, shared by the page and its pane. */
export function useIssue(host, repo, number) {
  const { react, api } = host;
  const { useState, useEffect, useCallback } = react;
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(null);
  const [labels, setLabels] = useState([]);
  const [people, setPeople] = useState([]);
  const reload = useCallback(() => {
    if (!repo || !number) return;
    setError(null);
    api(`/api/github/issues/detail?repo=${encodeURIComponent(repo)}&number=${number}`).then(setDetail).catch((e) => setError(e.message));
  }, [repo, number]);
  useEffect(() => { setDetail(null); reload(); }, [reload]);
  useEffect(() => {
    if (!repo) return;
    api(`/api/github/labels?repo=${encodeURIComponent(repo)}`).then((d) => setLabels(d.labels || [])).catch(() => setLabels([]));
    api(`/api/github/collaborators?repo=${encodeURIComponent(repo)}`).then((d) => setPeople(d.people || [])).catch(() => setPeople([]));
  }, [repo]);
  return { detail, error, labels, people, reload };
}

/** Write with AI: the user's words, written out; never from nothing. */
async function writeOut(host, { draft, what, context }) {
  const { api } = host;
  const system = 'You write GitHub text for a busy engineer. Plain, specific, no fluff, no greetings, no sign-off, no emoji. Markdown is fine. Return only the text.';
  const prompt = [what, `The author wants to say, in their words: "${draft.trim()}". Write that out properly - keep their intent and tone, add only what makes it clear and actionable, never invent points they did not raise.`, context].filter(Boolean).join('\n\n');
  let text = '';
  try { text = String((await api('/api/notes/ai', { method: 'POST', body: JSON.stringify({ prompt, system, maxTokens: 700 }) })).text || '').trim(); }
  catch (_) {
    const cfg = await api('/api/config').catch(() => ({}));
    const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'github-write', timeout: 120000, prompt: `${system}\n\n${prompt}\n\nDo not run any bootstrap or save anything; reply with the text only.` }) });
    text = String(result.handledLocally ? result.answer : result.id ? await waitForTask(api, result.id, 120000) : (result.error || '')).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim();
  }
  return text.replace(/^(#{1,6}\s[^\n]*\n+|\*{0,2}(comment|issue|title|body)\*{0,2}:?\s*\n+)/i, '').trim();
}

/** The @mention composer shared by the issue and the new-issue form. */
export function useMentions(host, people, value, setValue) {
  const { react } = host;
  const { useState, useRef } = react;
  const ref = useRef(null);
  const [menu, setMenu] = useState(null);
  const names = (people || []).map((p) => p.login);
  const candidates = menu ? names.filter((n) => n.toLowerCase().includes(menu.query.toLowerCase())).slice(0, 6) : [];
  const detect = (el) => { const pos = el.selectionStart; const m = el.value.slice(0, pos).match(/(?:^|\s)@([\w-]{0,30})$/); if (!m) { setMenu(null); return; } setMenu({ query: m[1], start: pos - m[1].length - 1, index: 0 }); };
  const pick = (name) => { const el = ref.current; const pos = el ? el.selectionStart : value.length; const next = `${value.slice(0, menu.start)}@${name} ${value.slice(pos)}`; setValue(next); setMenu(null); requestAnimationFrame(() => { if (!el) return; el.focus(); const p = menu.start + name.length + 2; el.setSelectionRange(p, p); }); };
  const onKey = (e, onSend) => {
    if (menu && candidates.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ ...menu, index: (menu.index + 1) % candidates.length }); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setMenu({ ...menu, index: (menu.index - 1 + candidates.length) % candidates.length }); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(candidates[menu.index]); return true; }
      if (e.key === 'Escape') { setMenu(null); return true; }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSend) onSend();
    return false;
  };
  return { ref, menu, setMenu, candidates, detect, pick, onKey };
}

export function MentionMenu({ host, m, people }) {
  const { h, tokens } = host;
  if (!m.menu || !m.candidates.length) return null;
  return h('div', { role: 'listbox', style: { position: 'absolute', left: 0, top: '100%', marginTop: 4, zIndex: 5, minWidth: 220, background: 'var(--sy-surface)', border: `1px solid ${tokens('line-strong')}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', overflow: 'hidden' } },
    m.candidates.map((name, i) => h('button', { key: name, type: 'button', role: 'option', 'aria-selected': i === m.menu.index, onMouseDown: (e) => { e.preventDefault(); m.pick(name); }, onMouseEnter: () => m.setMenu({ ...m.menu, index: i }), style: { display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', border: 0, cursor: 'pointer', background: i === m.menu.index ? 'rgba(255,255,255,0.06)' : 'transparent', color: 'var(--sy-text)', font: 'inherit', fontSize: 'var(--sy-fs-sm)' } }, `@${name}`)));
}

export function IssuePage({ host, repo, repoPath, number, issue, me, onChanged, onOpenPull }) {
  const { h, ui, react, api, notify, tokens } = host;
  const { useState } = react;
  const { detail, error, labels, people } = issue;
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [writing, setWriting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [branch, setBranch] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planning, setPlanning] = useState(false);
  const [planWide, setPlanWide] = useState(false);
  const m = useMentions(host, people, comment, setComment);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);

  const act = async (fn, done) => { setSending(true); try { await fn(); if (done) notify(done, 'moss'); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setSending(false); } };
  const update = (body, done) => act(() => api('/api/github/issues/update', { method: 'POST', body: JSON.stringify({ repo, number, ...body }) }), done);
  const send = () => { if (!comment.trim()) return; act(async () => { await api('/api/github/issues/comment', { method: 'POST', body: JSON.stringify({ repo, number, body: comment }) }); setComment(''); m.setMenu(null); }, 'Comment posted'); };
  const write = async () => {
    if (!comment.trim() || !detail) return;
    setWriting(true);
    try {
      const recent = (detail.comments || []).slice(-4).map((c) => `${c.author}: ${stripHtml(c.body).slice(0, 300)}`).join('\n');
      const text = await writeOut(host, { draft: comment, what: 'Draft a comment on this GitHub issue.', context: `Issue #${number} "${detail.title}" by ${detail.author}, ${detail.state}, labels: ${(detail.labels || []).map((l) => l.name).join(', ') || 'none'}.\n\nDescription:\n${stripHtml(detail.body || '').slice(0, 1500) || '(none)'}${recent ? `\n\nLatest comments:\n${recent}` : ''}` });
      if (text) setComment(text); else notify('Nothing came back to write with', 'rosin');
    } catch (e) { notify(e.message, 'rosin'); } finally { setWriting(false); }
  };

  // Start working: the branch on the server, then the shell with the AI on this repo.
  const start = async () => {
    setStarting(true);
    try {
      const r = await api('/api/github/issues/start', { method: 'POST', body: JSON.stringify({ repo, number }) });
      setBranch(r.branch);
      notify(`${r.existed ? 'On' : 'Created'} ${r.branch}${r.assignedTo ? `, assigned to ${r.assignedTo}` : ''}`, 'moss');
      onChanged();
      if (host.openShell && repoPath) await host.openShell({ repo, path: repoPath }, { launch: true, label: `#${number}` });
    } catch (e) { notify(e.message, 'rosin'); } finally { setStarting(false); }
  };

  const planIt = async () => {
    setPlanning(true);
    try {
      const cfg = await api('/api/config').catch(() => ({}));
      const base = window.location.origin;
      const prompt = [
        `Read GitHub issue #${number} in repository "${repo}" and write a short working plan for it. Today is ${new Date().toISOString().slice(0, 10)}.`,
        '', 'Read from these READ-ONLY routes on the local Cadence server (plain GET with curl, JSON back). Never call POST, PUT, PATCH or DELETE.',
        `  ${base}/api/github/issues/detail?repo=${encodeURIComponent(repo)}&number=${number}   the issue, its comments, linked pull requests`,
        `  ${base}/api/github/pulls/detail?repo=${encodeURIComponent(repo)}&number=N              any linked pull request`,
        repoPath ? `  The repository is checked out at ${repoPath}; you may read its files to ground the plan.` : '',
        '', 'Cover: what is being asked in your own words, what is unclear and who to ask, the steps, how to verify, any risk. Concrete and short.',
        'Answer in Markdown: a short lead, then bold labels and bullets. Write every issue or PR as #N. This is a one-off answer: do not run any bootstrap, do not save to Mind or any memory, do not mention either. Reply with the plan only.',
      ].filter((l) => l !== '').join('\n');
      const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'github-issue', timeout: 240000, prompt }) });
      const text = result.handledLocally ? (result.answer || '') : result.id ? await waitForTask(api, result.id, 240000) : (result.error || 'No plan came back.');
      setPlan(String(text).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim());
    } catch (e) { notify(e.message, 'rosin'); } finally { setPlanning(false); }
  };
  const planToShell = () => plan && host.sendToShell && host.sendToShell(`Plan for GitHub issue #${number} "${detail ? detail.title : ''}" in ${repo}:\n${plan}`, { target: repoPath ? { repo, path: repoPath } : null });
  const planToNote = async () => { if (plan && host.writeNote && await host.writeNote(`${repo} #${number} plan`, `# ${detail ? detail.title : `#${number}`}\n\nGitHub issue #${number} in ${repo} - plan written ${new Date().toLocaleString()}\n\n${plan}`)) notify('Saved and opened', 'moss'); };

  if (error) return h(ui.EmptyState, { title: `Could not open #${number}`, body: error });
  if (!detail) return h('div', null, h('div', { className: 'mstats mstats--head' }, [0, 1, 2, 3].map((k) => h('div', { key: k, className: 'mstat' }, h(ui.Skeleton, { count: 2, height: 14 })))), h('div', { className: 'gh-item', style: { marginTop: 'var(--sy-s3)' } }, Panel(host, { title: 'Description' }, h(ui.Skeleton, { count: 6, height: 16 })), Panel(host, { title: 'Work on it' }, h(ui.Skeleton, { count: 4, height: 16 }))));

  const open = detail.state === 'open';
  const mineToo = me && (detail.assignees || []).includes(me.login);
  const toggleLabel = (name) => { const has = (detail.labels || []).some((l) => l.name === name); update({ labels: has ? detail.labels.filter((l) => l.name !== name).map((l) => l.name) : [...detail.labels.map((l) => l.name), name] }, has ? `Removed ${name}` : `Labelled ${name}`); };
  const planPanel = (wide) => Panel(host, { title: 'Plan', style: wide ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined, bodyStyle: wide ? { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } : undefined,
    action: h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
      plan && host.sendToShell ? h(ui.Button, { className: 'sy-btn--sm', onClick: planToShell }, 'Insert in terminal') : null,
      plan && host.writeNote ? h(ui.Button, { className: 'sy-btn--sm', onClick: planToNote }, 'Save as note') : null,
      plan ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setPlanWide(!wide) }, wide ? 'Close' : 'Expand') : null,
      !plan ? meta('optional') : null) },
    plan ? h('div', { style: wide ? undefined : { maxHeight: 360, overflow: 'auto', paddingRight: 4 } }, h(ui.Markdown, { source: plan })) : h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, 'Reads the issue, its comments, its linked pull requests and the repository, and writes what is being asked, what is unclear, the steps and how to verify it.'),
    planning ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, h(ui.Skeleton, { count: 4, height: 14 })) : null,
    !wide ? h('div', { style: { marginTop: plan ? 'var(--sy-s3)' : 0 } }, h(ui.Button, { className: 'sy-btn--sm', disabled: planning, onClick: planIt }, planning ? 'Reading...' : plan ? 'Plan it again' : 'Plan it')) : null);

  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 'var(--sy-s3)', marginBottom: 'var(--sy-s3)' } },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 } },
          h('span', { className: 'mind-dot', style: { background: open ? 'var(--sy-moss)' : 'var(--sy-text-3)' } }),
          h('span', { className: 'mpanel__title' }, `Issue #${number} - ${open ? 'open' : detail.stateReason === 'not_planned' ? 'closed, not planned' : 'closed'}`),
          (detail.labels || []).map((l) => h('span', { key: l.name, className: 'mpanel__meta', style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h('span', { className: 'mind-dot', style: { background: labelColour(l.color), width: 7, height: 7 } }), l.name))),
        h('h2', { style: { margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 600, color: 'var(--sy-text)' } }, detail.title),
        h('p', { className: 'mlead', style: { margin: '6px 0 0' } }, `Opened by ${detail.author} ${ago(detail.createdAt)} - updated ${ago(detail.updatedAt)} - ${(detail.assignees || []).length ? `held by ${detail.assignees.join(', ')}` : 'nobody holds it'}${detail.milestone ? ` - ${detail.milestone}` : ''}.`)),
      detail.htmlUrl ? h('a', { className: 'sy-btn sy-btn--sm', href: detail.htmlUrl, target: '_blank', rel: 'noreferrer', style: { flex: 'none' } }, 'Open on GitHub') : null),

    planWide && plan ? h('div', { style: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 260px)', minHeight: 420 } }, planPanel(true)) : null,
    planWide && plan ? null : h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'State', value: open ? 'Open' : 'Closed', tone: open ? 'moss' : 'muted' }),
      Stat(host, { label: 'Comments', value: (detail.comments || []).length }),
      Stat(host, { label: 'Linked PRs', value: (detail.linkedPulls || []).length, tone: (detail.linkedPulls || []).some((p) => p.merged) ? 'moss' : 'muted', hint: (detail.linkedPulls || []).some((p) => p.merged) ? 'one merged' : undefined }),
      Stat(host, { label: 'Age', value: ago(detail.createdAt).replace(' ago', ''), tone: 'muted' })),
    planWide && plan ? null : h('div', { className: 'gh-item' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Description' }, detail.body ? h(ui.Markdown, { source: withImages(detail.body) }) : empty('No description was written.')),
        Panel(host, { title: 'Conversation', action: meta((detail.comments || []).length ? `${detail.comments.length}` : 'nothing said yet') },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: (detail.comments || []).length ? 'var(--sy-s3)' : 0 } },
            h('div', { style: { position: 'relative' } },
              h(ui.Textarea, { ref: m.ref, value: comment, placeholder: 'A comment on the issue. Type what you want to say; Write with AI turns it into a proper comment. @ mentions a collaborator. Ctrl+Enter sends.', disabled: sending, onChange: (e) => { setComment(e.target.value); m.detect(e.target); }, onKeyDown: (e) => m.onKey(e, send), onClick: (e) => m.detect(e.target), onBlur: () => setTimeout(() => m.setMenu(null), 150) }),
              h(MentionMenu, { host, m, people })),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { className: 'mpanel__meta', style: { whiteSpace: 'nowrap' } }, 'Ctrl+Enter sends'),
              h('span', { style: { flex: 1 } }),
              h(ui.Button, { disabled: sending || writing || !comment.trim(), onClick: write, title: comment.trim() ? 'The AI writes out what you typed, as a proper comment' : 'Type what you want to say first' }, writing ? 'Writing...' : 'Write with AI'),
              h(ui.Button, { variant: 'primary', disabled: sending || !comment.trim(), onClick: send }, sending ? 'Sending...' : 'Comment'))),
          (detail.comments || []).length ? h('div', null, detail.comments.slice().reverse().map((c) => h('div', { key: c.id, style: { padding: 'var(--sy-s2) 0', borderTop: `1px solid ${tokens('line')}` } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } }, h('span', { className: 'mind-dot', style: { background: 'var(--sy-brass)' } }), h('span', { style: { fontWeight: 600, fontSize: 'var(--sy-fs-sm)' } }, c.author), h('span', { className: 'mpanel__meta' }, ago(c.createdAt))),
            h(ui.Markdown, { source: withImages(c.body) })))) : null),
        (detail.events || []).length ? Panel(host, { title: 'History', action: meta(`${detail.events.length}`) },
          List(host, detail.events.slice().reverse().slice(0, 20).map((e, i) => ListRow(host, { key: i, lead: h('span', { className: 'mind-dot', style: { background: e.type === 'closed' ? 'var(--sy-text-3)' : e.type === 'reopened' ? 'var(--sy-moss)' : 'var(--sy-brass)' } }), label: e.type === 'renamed' ? `renamed to "${e.to}"` : `${e.type}${e.assignee ? ` ${e.assignee}` : ''}${e.label ? ` ${e.label}` : ''}${e.milestone ? ` ${e.milestone}` : ''}${e.reason ? ` (${e.reason.replace('_', ' ')})` : ''}`, sub: `${e.actor || 'someone'} - ${ago(e.at)}` })))) : null),

      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Work on it', action: meta(branch ? 'branch ready' : !open ? 'closed' : mineToo ? 'yours' : 'not started') },
          branch ? h('div', null,
            h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, `You are on ${branch}, with the AI started in a shell on ${repo}.`),
            h(ui.Button, { variant: 'primary', onClick: () => host.openShell && repoPath ? host.openShell({ repo, path: repoPath }) : host.navigate('terminal') }, 'Open the shell'))
            : open ? h('div', null,
              h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, `Cuts a branch named after this issue in ${repo}, assigns the issue to you, and opens a shell on the repo with the AI started.`),
              h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
                h(ui.Button, { variant: 'primary', disabled: starting || sending || !repoPath, onClick: start }, starting ? 'Starting...' : 'Start working'),
                !mineToo && me ? h(ui.Button, { disabled: sending, onClick: () => update({ assignees: [...(detail.assignees || []), me.login] }, 'Assigned to you') }, 'Take it') : null))
            : empty('This issue is closed. Reopen it below to work on it.'),
          h('div', { style: { marginTop: 'var(--sy-s3)', paddingTop: 'var(--sy-s3)', borderTop: `1px solid ${tokens('line')}` } },
            h(ui.Field, { label: 'State' }, h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              h(ui.Chip, { on: open, disabled: sending, onClick: () => !open && update({ state: 'open' }, 'Reopened') }, 'Open'),
              h(ui.Chip, { on: !open && detail.stateReason !== 'not_planned', disabled: sending, onClick: () => open && update({ state: 'closed', stateReason: 'completed' }, 'Closed as done') }, 'Done'),
              h(ui.Chip, { on: !open && detail.stateReason === 'not_planned', disabled: sending, onClick: () => open && update({ state: 'closed', stateReason: 'not_planned' }, 'Closed, not planned') }, 'Not planned'))),
            h(ui.Field, { label: 'Held by' }, h(ui.Select, { value: (detail.assignees || [])[0] || '', disabled: sending, onChange: (e) => update({ assignees: e.target.value ? [e.target.value] : [] }, e.target.value ? `Handed to ${e.target.value}` : 'Unassigned') },
              h('option', { value: '' }, 'nobody'),
              [...new Set([...(people || []).map((p) => p.login), ...(detail.assignees || [])])].map((n) => h('option', { key: n, value: n }, n)))))),
        planPanel(false),
        Panel(host, { title: 'Labels', action: meta((detail.labels || []).length || 'none') },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
            (labels.length ? labels : (detail.labels || [])).map((l) => h(ui.Chip, { key: l.name, on: (detail.labels || []).some((x) => x.name === l.name), disabled: sending, onClick: () => toggleLabel(l.name), title: l.description || l.name }, h('span', { className: 'mind-dot', style: { background: labelColour(l.color), width: 7, height: 7, marginRight: 5 } }), l.name)))),
        Panel(host, { title: 'Pull requests', action: meta((detail.linkedPulls || []).length ? `${detail.linkedPulls.length} reference this` : 'none yet') },
          (detail.linkedPulls || []).length ? List(host, detail.linkedPulls.map((p) => ListRow(host, { key: p.number, lead: h('span', { className: 'mind-dot', style: { background: p.merged ? 'var(--sy-moss)' : p.state === 'open' ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: `#${p.number} ${p.title}`, sub: `${p.merged ? 'merged' : p.state} - ${p.author}`, onClick: () => onOpenPull(p.number) }))) : empty('No pull request references this issue yet. Start working and open one.')),
        Panel(host, { title: 'Details' }, h(ui.InfoGrid, { items: [
          { label: 'Author', value: detail.author },
          { label: 'Opened', value: new Date(detail.createdAt).toLocaleDateString() },
          { label: 'Closed', value: detail.closedAt ? new Date(detail.closedAt).toLocaleDateString() : '-' },
          { label: 'Milestone', value: detail.milestone || 'none' },
          { label: 'Held by', value: (detail.assignees || []).join(', ') || 'nobody' },
        ] })))));
}

export function IssueAside({ host, issue, onOpenPull }) {
  const { h, ui } = host;
  const { detail } = issue;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const participants = detail ? [...new Set([detail.author, ...(detail.assignees || []), ...(detail.comments || []).map((c) => c.author)])] : [];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'Pull requests', action: meta(detail ? `${(detail.linkedPulls || []).length}` : '...') },
      !detail ? h(ui.Skeleton, { count: 2, height: 16 }) : (detail.linkedPulls || []).length ? List(host, detail.linkedPulls.map((p) => ListRow(host, { key: p.number, label: `#${p.number} ${p.title}`, sub: p.merged ? 'merged' : p.state, onClick: () => onOpenPull(p.number) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'None reference this issue.')),
    Panel(host, { title: 'People', action: meta(`${participants.length}`) },
      participants.length ? List(host, participants.map((p) => ListRow(host, { key: p, label: p, sub: detail && (detail.assignees || []).includes(p) ? 'holds it' : p === (detail && detail.author) ? 'opened it' : 'commented' }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nobody yet.')));
}

/** The form for a new issue: title, body with Write with AI, labels. */
export function NewIssue({ host, repo, labels, onCreated, onCancel }) {
  const { h, ui, react, api, notify } = host;
  const { useState } = react;
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(null);
  const write = async () => {
    if (!body.trim() && !title.trim()) return;
    setBusy('writing');
    try {
      const text = await writeOut(host, { draft: `${title.trim()}${body.trim() ? `\n${body.trim()}` : ''}`, what: 'Write the body of a GitHub issue: what is wrong or wanted, how to reproduce or what done looks like, in short sections.', context: `Repository ${repo}.` });
      if (text) setBody(text);
      if (!title.trim()) { const first = text.split('\n').find((l) => l.trim()); if (first) setTitle(first.replace(/^#+\s*/, '').slice(0, 100)); }
    } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  const create = async () => {
    if (!title.trim()) return;
    setBusy('creating');
    try { const r = await api('/api/github/issues/create', { method: 'POST', body: JSON.stringify({ repo, title, body, labels: picked }) }); notify(`Opened #${r.number}`, 'moss'); onCreated(r.number); }
    catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'New issue', wide: true, action: h('span', { className: 'mpanel__meta' }, repo) },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(ui.Field, { label: 'Title' }, h(ui.Input, { value: title, placeholder: 'What is wrong, or what is wanted', onChange: (e) => setTitle(e.target.value), autoFocus: true })),
        h(ui.Field, { label: 'Body' }, h(ui.Textarea, { value: body, rows: 8, placeholder: 'Type what you know in your own words; Write with AI turns it into a proper report.', onChange: (e) => setBody(e.target.value) })),
        labels.length ? h(ui.Field, { label: 'Labels' }, h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } }, labels.map((l) => h(ui.Chip, { key: l.name, on: picked.includes(l.name), onClick: () => setPicked(picked.includes(l.name) ? picked.filter((x) => x !== l.name) : [...picked, l.name]) }, h('span', { className: 'mind-dot', style: { background: labelColour(l.color), width: 7, height: 7, marginRight: 5 } }), l.name)))) : null,
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h(ui.Button, { onClick: onCancel }, 'Cancel'),
          h('span', { style: { flex: 1 } }),
          h(ui.Button, { disabled: !!busy || (!body.trim() && !title.trim()), onClick: write }, busy === 'writing' ? 'Writing...' : 'Write with AI'),
          h(ui.Button, { variant: 'primary', disabled: !!busy || !title.trim(), onClick: create }, busy === 'creating' ? 'Opening...' : 'Open the issue')))));
}
