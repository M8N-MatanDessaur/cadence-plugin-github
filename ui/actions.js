/**
 * GitHub Actions, as a bento.
 *
 * The runs (passing, failing, running), the workflows, then one run with its jobs and
 * steps. A failed job brings the tail of its log and the AI explains what went wrong and
 * what to do, which you can drop into a terminal or keep as a note. Re-run from here.
 */
import { ago, waitForTask } from './helpers.js';
import { Panel, Stat, Health, List, ListRow } from './kit.js';

export function useRuns(host, repo, enabled) {
  const { react, api } = host;
  const { useState, useEffect, useCallback } = react;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!repo || !enabled) return;
    setError(null);
    api(`/api/github/actions/runs?repo=${encodeURIComponent(repo)}&limit=40`).then(setData).catch((e) => { setData({ runs: [], workflows: [] }); setError(e.message); });
  }, [repo, enabled]);
  useEffect(() => { setData(null); reload(); }, [reload]);
  return { data, error, reload };
}

export const runTone = (r) => r.status !== 'completed' ? 'var(--sy-brass)' : r.conclusion === 'success' ? 'var(--sy-moss)' : r.conclusion === 'failure' || r.conclusion === 'timed_out' ? 'var(--sy-rosin)' : 'var(--sy-text-3)';
const runState = (r) => r.status !== 'completed' ? r.status.replace('_', ' ') : (r.conclusion || 'done').replace('_', ' ');
const runRow = (host, r, onOpen) => ListRow(host, { key: r.id, lead: host.h('span', { className: 'mind-dot', style: { background: runTone(r) } }), label: `${r.name}${r.title && r.title !== r.name ? ` - ${r.title}` : ''}`, sub: `${runState(r)} - ${r.branch} ${r.sha} - ${r.actor} - ${r.event}`, meta: ago(r.updatedAt), onClick: () => onOpen(r.id) });

export function Runs({ host, repo, runs, onOpen }) {
  const { h, ui } = host;
  const { data, error } = runs;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  if (!repo) return h(ui.EmptyState, { title: 'Choose a repository', body: 'Pick one in the sidebar; its workflow runs appear here.' });
  const loading = data === null;
  const list = data ? data.runs || [] : [];
  const failing = list.filter((r) => r.status === 'completed' && (r.conclusion === 'failure' || r.conclusion === 'timed_out'));
  const running = list.filter((r) => r.status !== 'completed');
  const passing = list.filter((r) => r.conclusion === 'success');
  // One health chip per workflow, from its latest run; dynamic runs (dependabot and the like) keep their own names.
  const latestByWorkflow = {};
  for (const w of (data ? data.workflows || [] : [])) { const r = list.find((x) => x.name === w.name); if (r) latestByWorkflow[w.name] = r; }
  if (!Object.keys(latestByWorkflow).length) for (const r of list) if (!latestByWorkflow[r.name]) latestByWorkflow[r.name] = r;
  const rate = list.length ? Math.round((passing.length / list.filter((r) => r.status === 'completed').length || 0) * 100) : null;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Runs', value: loading ? '...' : list.length, tone: 'brass' }),
      Stat(host, { label: 'Failing', value: loading ? '...' : failing.length, tone: failing.length ? 'rosin' : 'muted', hint: failing.length ? 'click one to see why' : undefined }),
      Stat(host, { label: 'Running', value: loading ? '...' : running.length, tone: running.length ? 'brass' : 'muted' }),
      Stat(host, { label: 'Pass rate', value: loading ? '...' : rate === null ? '-' : `${rate}%`, tone: rate === null ? 'muted' : rate >= 80 ? 'moss' : 'rosin' })),
    h('div', { className: 'mhealth' },
      ...Object.values(latestByWorkflow).slice(0, 5).map((r) => Health(host, { label: r.name, value: runState(r) })),
      Health(host, { label: 'Repository', value: repo })),
    error ? h('p', { className: 'mlead', style: { margin: 0, color: 'var(--sy-rosin)' } }, error) : null,
    failing.length ? Panel(host, { title: 'Failing', wide: true, action: meta(`${failing.length}`) }, List(host, failing.map((r) => runRow(host, r, onOpen)))) : null,
    running.length ? Panel(host, { title: 'Running now', wide: true, action: meta(`${running.length}`) }, List(host, running.map((r) => runRow(host, r, onOpen)))) : null,
    Panel(host, { title: 'All runs', wide: true, action: meta(loading ? '' : `latest ${list.length}`) },
      loading ? h(ui.Skeleton, { count: 5, height: 18 }) : list.length ? List(host, list.map((r) => runRow(host, r, onOpen))) : empty('No workflow ran on this repository.')));
}

export function RunsAside({ host, runs, onOpen }) {
  const { h, ui } = host;
  const { data } = runs;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };
  const wf = data ? data.workflows || [] : [];
  const list = data ? data.runs || [] : [];
  const latest = {};
  for (const r of list) if (!latest[r.name]) latest[r.name] = r;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', flex: 1, minHeight: 0, height: '100%' } },
    Panel(host, { title: 'Workflows', ...FILL, action: meta(data ? `${wf.length}` : '...') },
      data === null ? h(ui.Skeleton, { count: 3, height: 16 }) : wf.length ? List(host, wf.map((w) => { const r = latest[w.name]; return ListRow(host, { key: w.id, lead: h('span', { className: 'mind-dot', style: { background: r ? runTone(r) : 'var(--sy-text-3)' } }), label: w.name, sub: `${w.path.replace('.github/workflows/', '')} - ${w.state}${r ? ` - ${runState(r)} ${ago(r.updatedAt)}` : ''}`, onClick: r ? () => onOpen(r.id) : undefined }); })) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No workflows defined.')),
    Panel(host, { title: 'By branch', ...FILL, action: meta(data ? `${new Set(list.map((r) => r.branch)).size}` : '...') },
      data === null ? h(ui.Skeleton, { count: 3, height: 16 }) : List(host, [...new Set(list.map((r) => r.branch))].slice(0, 15).map((b) => { const r = list.find((x) => x.branch === b); return ListRow(host, { key: b, lead: h('span', { className: 'mind-dot', style: { background: runTone(r) } }), label: b, sub: `${runState(r)} - ${ago(r.updatedAt)}`, onClick: () => onOpen(r.id) }); }))));
}

export function useRun(host, repo, id) {
  const { react, api } = host;
  const { useState, useEffect, useCallback } = react;
  const [run, setRun] = useState(null);
  const [error, setError] = useState(null);
  const reload = useCallback(() => {
    if (!repo || !id) return;
    setError(null);
    api(`/api/github/actions/run?repo=${encodeURIComponent(repo)}&id=${id}`).then(setRun).catch((e) => setError(e.message));
  }, [repo, id]);
  useEffect(() => { setRun(null); reload(); }, [reload]);
  return { run, error, reload };
}

export function RunPage({ host, repo, repoPath, id, data, onChanged }) {
  const { h, ui, react, api, notify, tokens } = host;
  const { useState } = react;
  const { run, error } = data;
  const [busy, setBusy] = useState(null);
  const [why, setWhy] = useState(null);
  const [openJob, setOpenJob] = useState(null);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const empty = (text) => h('p', { className: 'mlead', style: { margin: 0 } }, text);
  const rerun = async (failedOnly) => { setBusy('rerun'); try { await api('/api/github/actions/rerun', { method: 'POST', body: JSON.stringify({ repo, id, failedOnly }) }); notify(failedOnly ? 'Failed jobs queued again' : 'Run queued again', 'moss'); onChanged(); } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); } };
  const explain = async () => {
    setBusy('why');
    try {
      const failed = (run.jobs || []).filter((j) => j.conclusion === 'failure');
      const logs = failed.map((j) => `### Job: ${j.name}\nFailed step: ${(j.steps.find((s) => s.conclusion === 'failure') || {}).name || '?'}\n\n${j.logTail}`).join('\n\n').slice(0, 14000);
      const system = 'You explain CI failures to a busy engineer. Plain, specific, no fluff. Return Markdown only.';
      const prompt = `GitHub Actions run "${run.name}" (${run.title}) on branch ${run.branch} at ${run.sha} in repository ${repo} failed.${run.message ? ` Head commit: "${run.message.split('\n')[0]}".` : ''}\n\nFrom the log tails below, say in this order: **What failed** (one line), **Why** (the actual error, quoted briefly), **Fix** (concrete steps or the command), **Flaky or real** (your read). Keep it short.\n\n${logs || '(no logs were available)'}`;
      let text = '';
      try { text = String((await api('/api/notes/ai', { method: 'POST', body: JSON.stringify({ prompt, system, maxTokens: 900 }) })).text || '').trim(); } catch (_) {}
      if (!text) {
        const cfg = await api('/api/config').catch(() => ({}));
        const result = await api('/api/orchestrator/spawn', { method: 'POST', body: JSON.stringify({ cli: cfg.DefaultCli || 'claude', from: 'github-actions', timeout: 180000, prompt: `${system}\n\n${prompt}${repoPath ? `\n\nThe repository is checked out at ${repoPath}; you may read its files to ground the fix.` : ''}\n\nThis is a one-off answer: do not run any bootstrap, do not save to Mind or any memory. Reply with the explanation only.` }) });
        text = String(result.handledLocally ? result.answer : result.id ? await waitForTask(api, result.id, 180000) : (result.error || '')).replace(/^\s*\[bootstrap:[^\]]*\]\s*/, '').trim();
      }
      setWhy(text || 'Nothing came back.');
    } catch (e) { notify(e.message, 'rosin'); } finally { setBusy(null); }
  };
  if (error) return h(ui.EmptyState, { title: 'Could not open the run', body: error });
  if (!run) return h('div', null, h('div', { className: 'mstats mstats--head' }, [0, 1, 2, 3].map((k) => h('div', { key: k, className: 'mstat' }, h(ui.Skeleton, { count: 2, height: 14 })))), h('div', { className: 'gh-item', style: { marginTop: 'var(--sy-s3)' } }, Panel(host, { title: 'Jobs' }, h(ui.Skeleton, { count: 5, height: 16 })), Panel(host, { title: 'Why it failed' }, h(ui.Skeleton, { count: 4, height: 16 }))));
  const jobs = run.jobs || [];
  const failed = jobs.filter((j) => j.conclusion === 'failure');
  const dur = (a, b) => a && b ? `${Math.max(1, Math.round((new Date(b) - new Date(a)) / 1000))}s` : '';
  return h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 'var(--sy-s3)', marginBottom: 'var(--sy-s3)' } },
      h('div', { style: { flex: 1, minWidth: 0 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } }, h('span', { className: 'mind-dot', style: { background: runTone(run) } }), h('span', { className: 'mpanel__title' }, `${run.name} - run ${run.number}${run.attempt > 1 ? `, attempt ${run.attempt}` : ''} - ${runState(run)}`)),
        h('h2', { style: { margin: 0, fontSize: 22, lineHeight: 1.25, fontWeight: 600, color: 'var(--sy-text)' } }, (run.message || '').split('\n')[0] || run.title || run.branch),
        h('p', { className: 'mlead', style: { margin: '6px 0 0' } }, `${run.branch} at ${run.sha} - ${run.event} by ${run.actor} - ${ago(run.createdAt)}.`)),
      run.htmlUrl ? h('a', { className: 'sy-btn sy-btn--sm', href: run.htmlUrl, target: '_blank', rel: 'noreferrer', style: { flex: 'none' } }, 'Open on GitHub') : null),
    h('div', { className: 'mstats mstats--head' },
      Stat(host, { label: 'Result', value: runState(run), tone: run.conclusion === 'success' ? 'moss' : run.conclusion === 'failure' ? 'rosin' : 'brass' }),
      Stat(host, { label: 'Jobs', value: jobs.length }),
      Stat(host, { label: 'Failed jobs', value: failed.length, tone: failed.length ? 'rosin' : 'muted' }),
      Stat(host, { label: 'Took', value: dur(run.createdAt, run.updatedAt) || '-', tone: 'muted' })),
    h('div', { className: 'gh-item' },
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Jobs', action: meta(`${jobs.length}`) },
          jobs.length ? List(host, jobs.map((j) => ListRow(host, { key: j.id, lead: h('span', { className: 'mind-dot', style: { background: runTone(j) } }), label: j.name, sub: `${runState(j)}${j.startedAt ? ` - ${dur(j.startedAt, j.completedAt)}` : ''} - ${j.steps.length} steps${j.conclusion === 'failure' ? ` - failed at "${(j.steps.find((s) => s.conclusion === 'failure') || {}).name || '?'}"` : ''}`, onClick: () => setOpenJob(openJob === j.id ? null : j.id) }))) : empty('No jobs reported yet.'),
          openJob ? (() => { const j = jobs.find((x) => x.id === openJob); if (!j) return null; return h('div', { style: { marginTop: 'var(--sy-s2)' } },
            List(host, j.steps.map((s) => ListRow(host, { key: s.number, lead: h('span', { className: 'mind-dot', style: { background: runTone(s), width: 7, height: 7 } }), label: s.name, meta: runState(s) }))),
            j.logTail ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, h(ui.CodeEditor, { value: j.logTail, language: 'plaintext', height: 360, readOnly: true })) : null); })() : null),
        failed.length && !openJob ? Panel(host, { title: 'Failing log', action: meta(failed[0].name) }, h(ui.CodeEditor, { value: failed[0].logTail || '(no log)', language: 'plaintext', height: 360, readOnly: true })) : null),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0 } },
        Panel(host, { title: 'Why it failed', action: h('div', { style: { display: 'flex', gap: 6 } },
          why && host.sendToShell ? h(ui.Button, { className: 'sy-btn--sm', onClick: () => host.sendToShell(`CI failure on ${run.branch} (${run.name} run ${run.number}) in ${repo}:\n${why}`, { target: repoPath ? { repo, path: repoPath } : null }) }, 'Insert in terminal') : null,
          why && host.writeNote ? h(ui.Button, { className: 'sy-btn--sm', onClick: async () => { if (await host.writeNote(`${repo} CI ${run.name} ${run.number}`, `# ${run.name} run ${run.number} on ${run.branch}\n\n${why}`)) notify('Saved and opened', 'moss'); } }, 'Save as note') : null,
          !why ? meta(failed.length ? 'the AI reads the logs' : 'nothing failed') : null) },
          why ? h('div', { style: { maxHeight: 420, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } }, h(ui.Markdown, { source: why })) : h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s2)' } }, failed.length ? 'Reads the failing jobs and their logs and says what broke, why, how to fix it, and whether it looks flaky.' : 'This run did not fail.'),
          busy === 'why' ? h('div', { style: { marginTop: 'var(--sy-s2)' } }, h(ui.Skeleton, { count: 4, height: 14 })) : null,
          failed.length ? h('div', { style: { marginTop: why ? 'var(--sy-s3)' : 0 } }, h(ui.Button, { className: 'sy-btn--sm', disabled: !!busy, onClick: explain }, busy === 'why' ? 'Reading the logs...' : why ? 'Explain it again' : 'Explain the failure')) : null),
        Panel(host, { title: 'Re-run', action: meta(run.status !== 'completed' ? 'still running' : '') },
          run.status === 'completed' ? h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            failed.length ? h(ui.Button, { variant: 'primary', disabled: !!busy, onClick: () => rerun(true) }, busy === 'rerun' ? 'Queuing...' : 'Re-run failed jobs') : null,
            h(ui.Button, { disabled: !!busy, onClick: () => rerun(false) }, busy === 'rerun' ? 'Queuing...' : 'Re-run everything'))
            : empty('Wait for it to finish.')),
        Panel(host, { title: 'Details' }, h(ui.InfoGrid, { items: [{ label: 'Workflow', value: run.name }, { label: 'Branch', value: run.branch }, { label: 'Commit', value: run.sha }, { label: 'Trigger', value: run.event }, { label: 'By', value: run.actor }, { label: 'Started', value: new Date(run.createdAt).toLocaleString() }] })))));
}

export function RunAside({ host, data }) {
  const { h, ui } = host;
  const { run } = data;
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const jobs = run ? run.jobs || [] : [];
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)' } },
    Panel(host, { title: 'Jobs', action: meta(run ? `${jobs.length}` : '...') },
      !run ? h(ui.Skeleton, { count: 3, height: 16 }) : jobs.length ? List(host, jobs.map((j) => ListRow(host, { key: j.id, lead: h('span', { className: 'mind-dot', style: { background: runTone(j) } }), label: j.name, sub: runState(j) }))) : h('p', { className: 'mlead', style: { margin: 0 } }, 'No jobs.')),
    run && run.message ? Panel(host, { title: 'Commit' }, h('p', { className: 'mlead', style: { margin: 0, whiteSpace: 'pre-wrap' } }, run.message.slice(0, 600))) : null);
}
