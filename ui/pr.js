/**
 * One pull request, as a dashboard.
 *
 * The title and its branches are the headline; the numbers sit under it. Two columns: on the
 * left what it is and what was said - the description, the changed files with their patches,
 * the conversation with a composer on top; on the right what you can do - review it, have the
 * AI summarize or review it first, watch the checks, merge it, read the details.
 *
 * The AI never posts. It reads the diff and the conversation through this plugin's read-only
 * routes and writes Markdown; posting that as your review is a separate click of yours.
 */
import { ago, stripHtml, waitForTask } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';
import { useMentions, MentionMenu } from './issue.js';
import { labelColour } from './issues.js';

const STATE_TONE = { open: 'brass', closed: 'muted', merged: 'moss' };
// Images in a PR body or comment live on github.com or githubusercontent.com and need the
// token; they are routed through this plugin's image proxy before the Markdown is rendered.
const PROXY = /https:\/\/(?:github\.com\/(?:user-attachments|[^\s)"'>]+\/(?:assets|files))\/[^\s)"'>]+|[a-z0-9.-]*githubusercontent\.com\/[^\s)"'>]+)/gi;
const withImages = (md) => String(md || '').replace(PROXY, (u) => `/api/github/image?url=${encodeURIComponent(u)}`);

/** Everything one pull request needs, fetched once and shared by the page and its right pane. */
export function usePr(host, repo, number) {
  const { react, api } = host;
  const { useState, useEffect, useCallback } = react;
  const [detail, setDetail] = useState(null);
  const [files, setFiles] = useState(null);
  const [timeline, setTimeline] = useState(null);
  const [checks, setChecks] = useState(null);
  const [error, setError] = useState(null);
  const [people, setPeople] = useState([]);
  const [labels, setLabels] = useState([]);
  useEffect(() => {
    if (!repo) return;
    api(`/api/github/collaborators?repo=${encodeURIComponent(repo)}`).then((d) => setPeople(d.people || [])).catch(() => setPeople([]));
    api(`/api/github/labels?repo=${encodeURIComponent(repo)}`).then((d) => setLabels(d.labels || [])).catch(() => setLabels([]));
  }, [repo]);
  const reload = useCallback(() => {
    if (!repo || !number) return;
    const q = `repo=${encodeURIComponent(repo)}&number=${number}`;
    setError(null);
    api(`/api/github/pulls/detail?${q}`).then(setDetail).catch((e) => setError(e.message));
    api(`/api/github/pulls/files?${q}`).then((d) => setFiles(d.files || [])).catch(() => setFiles([]));
    api(`/api/github/pulls/timeline?${q}`).then((d) => setTimeline(d.events || [])).catch(() => setTimeline([]));
    api(`/api/github/pulls/checks?${q}`).then((d) => setChecks(d.checks || [])).catch(() => setChecks([]));
  }, [repo, number]);
  useEffect(() => { setDetail(null); setFiles(null); setTimeline(null); setChecks(null); reload(); }, [reload]);
  return { detail, files, timeline, checks, error, reload, people, labels };
}

const checkTone = (c) => (c.status !== 'completed' ? 'brass' : c.conclusion === 'success' ? 'moss' : c.conclusion === 'skipped' || c.conclusion === 'neutral' ? undefined : 'rosin');

export function PrPage({ host, repo, repoPath, number, pr, me, onChanged }) {
  const { h, ui, react, api, notify, tokens } = host;
  const { useState } = react;
  const { detail, files, timeline, checks, error, people, labels } = pr;
  const [comment, setComment] = useState('');
  const m = useMentions(host, people, comment, setComment);
  const [pending, setPending] = useState([]);
  const [lineAt, setLineAt] = useState(null);
  const [lineText, setLineText] = useState('');
  const [sending, setSending] = useState(false);
  const [openFile, setOpenFile] = useState(null);
  const [reviewText, setReviewText] = useState('');
  const [ai, setAi] = useState(null);
  const [aiKind, setAiKind] = useState(null);
  const [aiWide, setAiWide] = useState(false);
  const [mergeMethod, setMergeMethod] = useState('squash');
  const [merging, setMerging] = useState(false);

  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const q = `repo=${encodeURIComponent(repo)}&number=${number}`;

  const act = async (fn, done) => { setSending(true); try { await fn(); if (done) notify(done, 'moss'); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setSending(false); } };
  const send = () => { if (!comment.trim()) return; act(async () => { await api('/api/github/pulls/comment', { method: 'POST', body: JSON.stringify({ repo, number, body: comment }) }); setComment(''); m.setMenu(null); }, 'Comment posted'); };
  const review = (event) => act(async () => { await api('/api/github/pulls/review', { method: 'POST', body: JSON.stringify({ repo, number, event, body: reviewText || undefined, comments: pending }) }); setReviewText(''); setPending([]); }, event === 'APPROVE' ? 'Approved' : event === 'REQUEST_CHANGES' ? 'Changes requested' : 'Review comment posted');
  const update = (body, done) => act(() => api('/api/github/pulls/update', { method: 'POST', body: JSON.stringify({ repo, number, ...body }) }), done);
  // Write with AI: the local model drafts the text from the PR and what you started typing;
  // when it is not running, the default CLI does it. You edit before anything is sent.
  const [writing, setWriting] = useState(null);
  const writeWith = async (kind) => {
    setWriting(kind);
    try {
      const draft = kind === 'comment' ? comment : reviewText;
      const recent = comments.slice(-4).map((e) => `${e.author}: ${stripHtml(e.body || '').slice(0, 300)}`).join('\n');
      const system = 'You draft GitHub pull request text for a busy engineer. Plain, specific, no fluff, no greetings, no sign-off, no emoji. Markdown is fine. Return only the text to post.';
      const prompt = [
        kind === 'comment' ? 'Draft a comment on this pull request.' : 'Draft the body of a review on this pull request (the reviewer will pick approve / request changes / comment).',
        `The author wants to say, in their words: "${draft.trim()}". Write that out properly - keep their intent and tone, add only what makes it clear and actionable, never invent points they did not raise.`,
        `PR #${number} "${detail.title}" by ${detail.author}, ${detail.headRef} -> ${detail.baseRef}, ${detail.changedFiles ?? (files ? files.length : '?')} files, +${detail.additions || 0} -${detail.deletions || 0}, review state: ${detail.reviewStatus || 'pending'}.`,
        `Description:\n${stripHtml(detail.body || '').slice(0, 1500) || '(none)'}`,
        recent ? `Latest in the conversation:\n${recent}` : '',
        (files || []).length ? `Files: ${files.slice(0, 20).map((f) => f.filename).join(', ')}` : '',
      ].filter(Boolean).join('\n\n');
      let text = '';
      try {
        const out = await api('/api/notes/ai', { method: 'POST', body: JSON.stringify({ prompt, system, maxTokens: 600 }) });
        text = String(out.text || '').trim();
      } catch (e) {
        // No local model: the default CLI writes it instead.
        const cfg = await api('/api/config').catch(() => ({}));
        const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'github-write', timeout: 120000, prompt: `${system}\n\n${prompt}\n\nDo not run any bootstrap or save anything; reply with the text only.` }) });
        text = String(result.handledLocally ? result.answer : result.id ? await waitForTask(api, result.id, 120000) : (result.error || '')).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim();
      }
      // A model that opens with a heading or a "Comment:" label is trimmed to the text itself.
      text = text.replace(/^(#{1,6}\s[^\n]*\n+|\*{0,2}(comment|review|pr comment)\*{0,2}:?\s*\n+)/i, '').trim();
      if (!text) { notify('Nothing came back to write with', 'rosin'); return; }
      if (kind === 'comment') setComment(text); else setReviewText(text);
    } catch (e) { notify(e.message, 'rosin'); } finally { setWriting(null); }
  };

  const merge = async () => { setMerging(true); try { const r = await api('/api/github/pulls/merge', { method: 'POST', body: JSON.stringify({ repo, number, method: mergeMethod }) }); notify(r.merged ? `Merged #${number}` : (r.message || 'GitHub did not merge it'), r.merged ? 'moss' : 'rosin'); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setMerging(false); } };

  // The AI reads the diff and the conversation and writes; it never posts by itself.
  const runAi = async (kind) => {
    setAiKind(kind); setAi(null);
    try {
      const cfg = await api('/api/config').catch(() => ({}));
      const base = window.location.origin;
      const what = kind === 'review'
        ? 'Review this pull request as a careful senior engineer would. Cover: what it does in two sentences; correctness risks and bugs you can see in the diff, with file and line; anything missing (tests, error handling, migrations, docs); style only where it matters; then a verdict: approve, approve with nits, or request changes, and why.'
        : 'Explain this pull request to someone who has not read it: what it changes and why (from the description and the diff), the files that matter most, what a reviewer should look at first, and any open questions in the conversation.';
      const prompt = [
        `${what} Today is ${new Date().toISOString().slice(0, 10)}. Repository "${repo}", pull request #${number}.`,
        '',
        'Read from these READ-ONLY routes on the local Cadence server (plain GET with curl, JSON back). Never call POST, PUT, PATCH or DELETE - you write text, the user decides what to post.',
        `  ${base}/api/github/pulls/detail?${q}     title, body, branches, author, mergeable, reviewStatus`,
        `  ${base}/api/github/pulls/diff?${q}       the unified diff (may be truncated; the response says)`,
        `  ${base}/api/github/pulls/files?${q}      files with additions/deletions`,
        `  ${base}/api/github/pulls/timeline?${q}   reviews, comments, commits`,
        `  ${base}/api/github/pulls/checks?${q}     CI checks`,
        '',
        'Answer in Markdown: a short lead, then bold labels and bullets; name files as `path` and lines where you can. This is a one-off answer: do not run any bootstrap, do not save to Mind or any memory, do not mention either. Reply with the text only.',
      ].join('\n');
      const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'github-pr', timeout: 300000, prompt }) });
      const text = result.handledLocally ? (result.answer || '') : result.id ? await waitForTask(api, result.id, 300000) : (result.error || 'Nothing came back.');
      setAi({ kind, text: String(text).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim(), at: Date.now() });
    } catch (e) { notify(e.message, 'rosin'); } finally { setAiKind(null); }
  };
  const postAi = () => { if (!ai) return; act(async () => { await api('/api/github/pulls/comment', { method: 'POST', body: JSON.stringify({ repo, number, body: `${ai.text}\n\n_Written by the AI in Cadence; posted by ${me ? me.login : 'me'}._` }) }); }, 'Posted as a comment'); };
  const aiToShell = async () => { if (!ai || !host.sendToShell) return; await host.sendToShell(`${ai.kind === 'review' ? 'Review' : 'Summary'} of pull request #${number} in ${repo}:\n${ai.text}`, { target: repoPath ? { repo, path: repoPath } : null }); };
  const aiToNote = async () => { if (!ai || !host.writeNote) return; if (await host.writeNote(`PR #${number} ${ai.kind}`, `# ${detail ? detail.title : `#${number}`}\n\n${repo} pull request #${number} - ${ai.kind} written ${new Date().toLocaleString()}\n\n${ai.text}`)) notify('Saved and opened', 'moss'); };

  // The patch, line by line, each line clickable to leave an inline review comment on it.
  const patchView = (path, patch) => {
    let oldN = 0; let newN = 0;
    const rows = patch.split('\n').map((text, i) => {
      const hunk = text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) { oldN = Number(hunk[1]); newN = Number(hunk[2]); return { i, text, kind: 'hunk' }; }
      if (text.startsWith('+')) return { i, text, kind: 'add', line: newN++, side: 'RIGHT' };
      if (text.startsWith('-')) return { i, text, kind: 'del', line: oldN++, side: 'LEFT' };
      if (text.startsWith('\\')) return { i, text, kind: 'meta' };
      return { i, text, kind: 'ctx', line: newN++, side: 'RIGHT', old: oldN++ };
    });
    const bg = (r) => r.kind === 'add' ? 'rgba(80,160,90,0.12)' : r.kind === 'del' ? 'rgba(200,80,80,0.12)' : r.kind === 'hunk' ? 'rgba(255,255,255,0.05)' : 'transparent';
    const has = (r) => pending.some((c) => c.path === path && c.line === r.line && c.side === r.side);
    return h('div', { style: { marginTop: 'var(--sy-s2)', maxHeight: 460, overflow: 'auto', fontSize: 12, lineHeight: 1.45, border: `1px solid ${tokens('line')}`, borderRadius: 6, background: 'var(--sy-surface)', fontFamily: 'var(--sy-mono, ui-monospace, monospace)' } },
      h('div', { className: 'mpanel__meta', style: { padding: '4px 8px', borderBottom: `1px solid ${tokens('line')}`, fontFamily: 'inherit' } }, `${path} - click a line to comment on it in your review`),
      rows.map((r) => h('div', { key: r.i },
        h('div', { role: r.line ? 'button' : undefined, tabIndex: r.line ? 0 : undefined, title: r.line ? `Comment on line ${r.line}` : undefined, onClick: r.line ? () => { setLineAt(lineAt && lineAt.i === r.i ? null : { i: r.i, path, line: r.line, side: r.side }); setLineText(''); } : undefined, style: { display: 'flex', gap: 8, padding: '0 8px', whiteSpace: 'pre', background: has(r) ? 'rgba(212,160,60,0.18)' : bg(r), cursor: r.line ? 'pointer' : 'default', color: r.kind === 'hunk' ? 'var(--sy-text-3)' : 'var(--sy-text)' } },
          h('span', { style: { width: 36, textAlign: 'right', color: 'var(--sy-text-3)', flex: 'none', userSelect: 'none' } }, r.line ? String(r.kind === 'del' ? r.line : r.line) : ''),
          h('span', null, r.text)),
        lineAt && lineAt.i === r.i ? h('div', { style: { padding: 8, borderTop: `1px solid ${tokens('line')}`, borderBottom: `1px solid ${tokens('line')}`, background: 'var(--sy-bg)', fontFamily: 'var(--sy-font, inherit)', whiteSpace: 'normal' } },
          h(ui.Textarea, { value: lineText, rows: 3, autoFocus: true, placeholder: `Your comment on ${path.split('/').pop()}:${r.line}`, onChange: (e) => setLineText(e.target.value), onKeyDown: (e) => { if (e.key === 'Escape') setLineAt(null); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && lineText.trim()) { setPending([...pending, { path, line: r.line, side: r.side, body: lineText.trim() }]); setLineAt(null); } } }),
          h('div', { style: { display: 'flex', gap: 8, marginTop: 6, justifyContent: 'flex-end' } },
            h(ui.Button, { className: 'sy-btn--sm', onClick: () => setLineAt(null) }, 'Cancel'),
            h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: !lineText.trim(), onClick: () => { setPending([...pending, { path, line: r.line, side: r.side, body: lineText.trim() }]); setLineAt(null); } }, 'Add to review'))) : null)));
  };

  if (error) return h(ui.EmptyState, { title: `Could not open #${number}`, body: error });
  if (!detail) return h('div', null, h('div', { className: 'mstats mstats--head' }, [0, 1, 2, 3].map((k) => h('div', { key: k, className: 'mstat' }, h(ui.Skeleton, { count: 2, height: 14 })))), h('div', { className: 'gh-item', style: { marginTop: 'var(--sy-s3)' } }, Panel(host, { title: 'Description' }, h(ui.Skeleton, { count: 6, height: 16 })), Panel(host, { title: 'Review' }, h(ui.Skeleton, { count: 4, height: 16 }))));

  const state = detail.merged ? 'merged' : detail.state;
  const comments = (timeline || []).filter((e) => e.type === 'commented' || e.type === 'reviewed' || e.type === 'review_comment');
  const failing = (checks || []).filter((c) => c.status === 'completed' && c.conclusion && !['success', 'skipped', 'neutral'].includes(c.conclusion)).length;
  const running = (checks || []).filter((c) => c.status !== 'completed').length;
  const aiPanel = (wide) => Panel(host, {
    title: 'AI', style: wide ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : undefined, bodyStyle: wide ? { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } : undefined,
    action: h('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
      ai ? h(ui.Button, { className: 'sy-btn--sm', onClick: postAi, disabled: sending, title: 'Post this text as a comment on the pull request, under your name' }, 'Post as comment') : null,
      ai && host.sendToShell ? h(ui.Button, { className: 'sy-btn--sm', onClick: aiToShell }, 'Insert in terminal') : null,
      ai && host.writeNote ? h(ui.Button, { className: 'sy-btn--sm', onClick: aiToNote }, 'Save as note') : null,
      ai ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => setAiWide(!wide) }, wide ? 'Close' : 'Expand') : null,
      !ai ? meta(aiKind ? 'reading...' : 'reads the diff and the conversation') : null),
  },
    ai ? h('div', { style: wide ? undefined : { maxHeight: 360, overflow: 'auto', paddingRight: 4 } }, h(ui.Markdown, { source: ai.text })) : h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, 'Summarize explains what this changes and where to look first. Review reads the diff for bugs, risks and gaps, and ends with a verdict. Nothing is posted until you say so.'),
    aiKind ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, h(ui.Skeleton, { count: 4, height: 14 })) : null,
    !wide ? h('div', { style: { display: 'flex', gap: 8, marginTop: ai ? 'var(--sy-s3)' : 0 } },
      h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: !!aiKind, onClick: () => runAi('review') }, aiKind === 'review' ? 'Reviewing...' : ai && ai.kind === 'review' ? 'Review again' : 'Review this PR'),
      h(ui.Button, { className: 'sy-btn--sm', disabled: !!aiKind, onClick: () => runAi('summary') }, aiKind === 'summary' ? 'Summarizing...' : ai && ai.kind === 'summary' ? 'Summarize again' : 'Summarize')) : null);

  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 'var(--sy-s3)', marginBottom: 'var(--sy-s3)' } },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 } },
          h('span', { className: 'mind-dot', style: { background: state === 'merged' ? 'var(--sy-moss)' : state === 'closed' ? 'var(--sy-text-3)' : 'var(--sy-brass)' } }),
          h('span', { className: 'mpanel__title' }, `${detail.draft ? 'Draft ' : ''}pull request #${number} - ${state}`),
          h('span', { className: 'mpanel__meta' }, `${detail.headRef} -> ${detail.baseRef}`)),
        h('h2', { style: { margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 600, color: 'var(--sy-text)' } }, detail.title),
        h('p', { className: 'mlead', style: { margin: '6px 0 0' } }, `Opened by ${detail.author} ${ago(detail.createdAt)} - updated ${ago(detail.updatedAt)}${(detail.labels || []).length ? ` - ${detail.labels.map((l) => l.name).join(', ')}` : ''}${(detail.reviewers || []).length ? ` - review asked of ${detail.reviewers.join(', ')}` : ''}.`)),
      detail.htmlUrl ? h('a', { className: 'sy-btn sy-btn--sm', href: detail.htmlUrl, target: '_blank', rel: 'noreferrer', style: { flex: 'none' } }, 'Open on GitHub') : null),

    aiWide && ai ? h('div', { style: { display: 'flex', flexDirection: 'column', height: 'calc(100vh - 260px)', minHeight: 420 } }, aiPanel(true)) : null,

    aiWide && ai ? null : h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Files', value: detail.changedFiles ?? (files ? files.length : '...'), hint: `+${detail.additions || 0} -${detail.deletions || 0}` }),
      Stat(host, { label: 'Review', value: detail.reviewStatus === 'approved' ? 'Approved' : detail.reviewStatus === 'changes_requested' ? 'Changes' : 'Pending', tone: detail.reviewStatus === 'approved' ? 'moss' : detail.reviewStatus === 'changes_requested' ? 'rosin' : 'brass' }),
      Stat(host, { label: 'Checks', value: checks === null ? '...' : failing ? `${failing} failing` : running ? `${running} running` : checks.length ? 'Green' : 'None', tone: failing ? 'rosin' : running ? 'brass' : checks && checks.length ? 'moss' : 'muted' }),
      Stat(host, { label: 'Comments', value: detail.comments ?? comments.length, tone: 'muted' })),
    aiWide && ai ? null : h('div', { className: 'mhealth' },
      Health(host, { label: 'Mergeable', value: detail.merged ? 'merged' : detail.mergeable === false ? 'conflicts' : detail.mergeable ? 'yes' : 'checking', tone: detail.mergeable === false ? 'rosin' : detail.mergeable ? 'moss' : undefined }),
      Health(host, { label: 'Base', value: detail.baseRef }),
      Health(host, { label: 'Head', value: detail.headRef }),
      Health(host, { label: 'Labels', value: (detail.labels || []).length || 'none' })),

    aiWide && ai ? null : h('div', { className: 'gh-item' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Description', action: meta(detail.draft ? 'draft' : '') }, detail.body ? h(ui.Markdown, { source: withImages(detail.body) }) : empty('No description was written.')),
        Panel(host, { title: 'Files changed', action: meta(files ? `${files.length} - click one for its patch` : 'reading...') },
          files === null ? h(ui.Skeleton, { count: 4, height: 16 }) : files.length ? h('div', null,
            List(host, files.map((f) => ListRow(host, {
              key: f.filename,
              lead: h('span', { className: 'mind-dot', style: { background: f.status === 'added' ? 'var(--sy-moss)' : f.status === 'removed' ? 'var(--sy-rosin)' : 'var(--sy-brass)' } }),
              label: f.filename, sub: f.status, meta: `+${f.additions} -${f.deletions}`,
              onClick: f.patch ? () => setOpenFile(openFile === f.filename ? null : f.filename) : undefined,
            }))),
            openFile ? patchView(openFile, (files.find((f) => f.filename === openFile) || {}).patch || '') : null)
            : empty('No files changed.')),
        Panel(host, { title: 'Conversation', action: meta(comments.length ? `${comments.length}` : 'nothing said yet') },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginBottom: comments.length ? 'var(--sy-s3)' : 0 } },
            h('div', { style: { position: 'relative' } },
              h(ui.Textarea, { ref: m.ref, value: comment, placeholder: 'A comment on the pull request. Type what you want to say; Write with AI turns it into a proper comment. @ mentions a collaborator. Ctrl+Enter sends.', disabled: sending, onChange: (e) => { setComment(e.target.value); m.detect(e.target); }, onKeyDown: (e) => m.onKey(e, send), onClick: (e) => m.detect(e.target), onBlur: () => setTimeout(() => m.setMenu(null), 150) }),
              h(MentionMenu, { host, m, people })),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              h('span', { className: 'mpanel__meta', style: { whiteSpace: 'nowrap' } }, 'Ctrl+Enter sends'),
              h('span', { style: { flex: 1 } }),
              h(ui.Button, { disabled: sending || !!writing || !comment.trim(), onClick: () => writeWith('comment'), title: comment.trim() ? 'The AI writes out what you typed, as a proper comment' : 'Type what you want to say first; the AI writes it out' }, writing === 'comment' ? 'Writing...' : 'Write with AI'),
              h(ui.Button, { variant: 'primary', disabled: sending || !comment.trim(), onClick: send }, sending ? 'Sending...' : 'Comment'))),
          timeline === null ? h(ui.Skeleton, { count: 3, height: 16 }) : comments.length ? h('div', null, comments.slice().reverse().map((e, i) => h('div', { key: i, style: { padding: 'var(--sy-s2) 0', borderTop: `1px solid ${tokens('line')}` } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
              h('span', { className: 'mind-dot', style: { background: e.type === 'reviewed' ? (e.state === 'APPROVED' ? 'var(--sy-moss)' : e.state === 'CHANGES_REQUESTED' ? 'var(--sy-rosin)' : 'var(--sy-brass)') : 'var(--sy-brass)' } }),
              h('span', { style: { fontWeight: 600, fontSize: 'var(--sy-fs-sm)' } }, e.author || 'someone'),
              h('span', { className: 'mpanel__meta' }, `${e.type === 'reviewed' ? `${String(e.state || '').toLowerCase().replace('_', ' ')} - ` : e.type === 'review_comment' ? `${e.path}${e.line ? `:${e.line}` : ''} - ` : ''}${ago(e.createdAt)}`)),
            e.body ? h(ui.Markdown, { source: withImages(e.body) }) : null,
            (e.comments || []).map((c, j) => h('div', { key: j, style: { margin: '6px 0 0 14px', paddingLeft: 10, borderLeft: `2px solid ${tokens('line')}` } }, h('div', { className: 'mpanel__meta' }, `${c.path}${c.line ? `:${c.line}` : ''}`), h(ui.Markdown, { source: withImages(c.body || '') })))))) : null)),

      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Review', action: meta(state !== 'open' ? state : detail.reviewStatus === 'approved' ? 'approved' : detail.reviewStatus === 'changes_requested' ? 'changes requested' : 'pending') },
          state === 'open' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
            pending.length ? h('div', null, h('div', { className: 'mpanel__meta', style: { marginBottom: 4 } }, `${pending.length} inline comment${pending.length === 1 ? '' : 's'} go with this review`), List(host, pending.map((c, i) => ListRow(host, { key: i, label: `${c.path.split('/').pop()}:${c.line}`, sub: c.body, meta: 'remove', onClick: () => setPending(pending.filter((_, j) => j !== i)) })))) : null,
            h(ui.Textarea, { value: reviewText, placeholder: pending.length ? 'A summary for the review (optional)' : 'What you want to say with your review (optional). Click a line in a file to comment on it inline.', disabled: sending, onChange: (e) => setReviewText(e.target.value) }),
            h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' } },
              h(ui.Button, { className: 'sy-btn--sm', disabled: sending || !!writing || !reviewText.trim(), onClick: () => writeWith('review'), title: reviewText.trim() ? 'The AI writes out what you typed, as a proper review' : 'Type what you want to say first; the AI writes it out' }, writing === 'review' ? 'Writing...' : 'Write with AI'),
              h('span', { style: { flex: 1 } }),
              h(ui.Button, { className: 'sy-btn--sm', variant: 'primary', disabled: sending, onClick: () => review('APPROVE') }, 'Approve'),
              h(ui.Button, { className: 'sy-btn--sm', disabled: sending, onClick: () => review('REQUEST_CHANGES') }, 'Request changes'),
              h(ui.Button, { className: 'sy-btn--sm', disabled: sending || (!reviewText.trim() && !pending.length), onClick: () => review('COMMENT') }, 'Comment review')))
            : empty(`This pull request is ${state}.`)),
        aiPanel(false),
        Panel(host, { title: 'Merge', action: meta(detail.merged ? 'merged' : detail.mergeable === false ? 'conflicts' : failing ? `${failing} check${failing === 1 ? '' : 's'} failing` : 'ready when you are') },
          state === 'open' ? h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
            h(ui.Select, { value: mergeMethod, onChange: (e) => setMergeMethod(e.target.value), 'aria-label': 'Merge method', style: { flex: '1 1 140px' } }, h('option', { value: 'squash' }, 'Squash and merge'), h('option', { value: 'merge' }, 'Merge commit'), h('option', { value: 'rebase' }, 'Rebase and merge')),
            h(ui.Button, { variant: 'primary', disabled: merging || detail.mergeable === false || detail.draft, onClick: merge }, merging ? 'Merging...' : 'Merge'))
            : empty(detail.merged ? `Merged ${ago(detail.updatedAt)}.` : 'Closed without merging.')),
        Panel(host, { title: 'Checks', action: meta(checks === null ? 'reading...' : checks.length ? `${checks.length}` : 'none') },
          checks === null ? h(ui.Skeleton, { count: 3, height: 16 }) : checks.length ? List(host, checks.map((c, i) => ListRow(host, {
            key: `${c.name}-${i}`,
            lead: h('span', { className: 'mind-dot', style: { background: checkTone(c) === 'moss' ? 'var(--sy-moss)' : checkTone(c) === 'rosin' ? 'var(--sy-rosin)' : checkTone(c) === 'brass' ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }),
            label: c.name, sub: `${c.app ? `${c.app} - ` : ''}${c.status === 'completed' ? (c.conclusion || 'done') : c.status}`,
            onClick: c.url ? () => window.open(c.url, '_blank') : undefined,
          }))) : empty('No checks ran on this head.')),
        Panel(host, { title: 'People', action: meta(state === 'open' ? 'click to change' : '') },
          h(ui.Field, { label: 'Reviewers' }, h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
            [...new Set([...(people || []).map((x) => x.login), ...(detail.reviewers || [])])].filter((n) => n !== detail.author).map((n) => h(ui.Chip, { key: n, on: (detail.reviewers || []).includes(n), disabled: sending || state !== 'open', onClick: () => { const has = (detail.reviewers || []).includes(n); update({ reviewers: has ? detail.reviewers.filter((r) => r !== n) : [...(detail.reviewers || []), n] }, has ? `${n} no longer asked` : `Asked ${n}`); } }, n)),
            !(people || []).length && !(detail.reviewers || []).length ? h('span', { className: 'mlead' }, 'No collaborators to ask.') : null)),
          h(ui.Field, { label: 'Assignee' }, h(ui.Select, { value: (detail.assignees || [])[0] || '', disabled: sending, onChange: (e) => update({ assignees: e.target.value ? [e.target.value] : [] }, e.target.value ? `Assigned to ${e.target.value}` : 'Unassigned') },
            h('option', { value: '' }, 'nobody'),
            [...new Set([...(people || []).map((x) => x.login), ...(detail.assignees || [])])].map((n) => h('option', { key: n, value: n }, n))))),
        Panel(host, { title: 'Labels', action: meta((detail.labels || []).length || 'none') },
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6 } },
            ((labels || []).length ? labels : (detail.labels || [])).map((l) => h(ui.Chip, { key: l.name, on: (detail.labels || []).some((x) => x.name === l.name), disabled: sending, title: l.description || l.name, onClick: () => { const has = (detail.labels || []).some((x) => x.name === l.name); update({ labels: has ? detail.labels.filter((x) => x.name !== l.name).map((x) => x.name) : [...(detail.labels || []).map((x) => x.name), l.name] }, has ? `Removed ${l.name}` : `Labelled ${l.name}`); } }, h('span', { className: 'mind-dot', style: { background: labelColour(l.color), width: 7, height: 7, marginRight: 5 } }), l.name)),
            !(labels || []).length && !(detail.labels || []).length ? h('span', { className: 'mlead' }, 'No labels on this repository.') : null)),
        Panel(host, { title: 'Details' },
          h(ui.InfoGrid, { items: [
            { label: 'Author', value: detail.author },
            { label: 'Opened', value: new Date(detail.createdAt).toLocaleDateString() },
            { label: 'Head', value: `${detail.headRef} ${detail.headSha ? detail.headSha.slice(0, 7) : ''}` },
            { label: 'Base', value: detail.baseRef || '-' },
            { label: 'Mergeable', value: detail.mergeableState || (detail.mergeable ? 'clean' : detail.mergeable === false ? 'dirty' : 'unknown') },
          ] })))));
}

export function PrAside({ host, pr, repo }) {
  const { h, ui } = host;
  const { files, checks, detail } = pr;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'Files', style: { flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { minHeight: 0, overflow: 'auto', maxHeight: 'calc(100vh - 420px)', paddingRight: 14, scrollbarGutter: 'stable' }, action: meta(files ? `${files.length}` : '...') },
      files === null ? h(ui.Skeleton, { count: 4, height: 16 }) : files.length ? List(host, files.map((f) => ListRow(host, { key: f.filename, label: f.filename.split('/').pop(), sub: f.filename, meta: `+${f.additions} -${f.deletions}` }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No files.')),
    Panel(host, { title: 'Checks', style: { flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { minHeight: 0, overflow: 'auto', maxHeight: 220, paddingRight: 14, scrollbarGutter: 'stable' }, action: meta(checks ? `${checks.length}` : '...') },
      checks === null ? h(ui.Skeleton, { count: 3, height: 16 }) : checks.length ? List(host, checks.map((c, i) => ListRow(host, { key: `${c.name}-${i}`, lead: h('span', { className: 'mind-dot', style: { background: checkTone(c) === 'moss' ? 'var(--sy-moss)' : checkTone(c) === 'rosin' ? 'var(--sy-rosin)' : checkTone(c) === 'brass' ? 'var(--sy-brass)' : 'var(--sy-text-3)' } }), label: c.name, sub: c.status === 'completed' ? (c.conclusion || 'done') : c.status }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No checks.')),
    detail ? Panel(host, { title: 'Reviewers', action: meta((detail.reviewers || []).length || 'none') },
      (detail.reviewers || []).length ? List(host, detail.reviewers.map((r) => ListRow(host, { key: r, label: r, sub: 'review requested' }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nobody was asked yet.')) : null);
}
