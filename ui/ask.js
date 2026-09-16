/**
 * Ask, as a bento - the same screen the Azure DevOps plugin has, over GitHub.
 *
 * Left: the question, and under it the answer as prose with every "#N" a chip that opens the
 * pull request. Right: questions prepared from what is on screen (what waits on you, the
 * biggest open PR, what is quiet), and the answers kept in the app's memory.
 */
import { Panel, Health, List, ListRow } from './kit.js';

const CITE = /#(\d{1,6})\b/g;
const RECENT_KEY = 'sy.gh.ask.recent';
const RECENT_MAX = 20;

const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch {} };
export const rememberAnswer = (entry) => { writeRecent([entry, ...readRecent().filter((e) => e.question !== entry.question)].slice(0, RECENT_MAX)); return entry; };
const cited = (text) => [...new Set([...String(text || '').matchAll(CITE)].map((m) => Number(m[1])))];
const when = (at) => { const d = new Date(at); const days = Math.floor((Date.now() - d.setHours(0, 0, 0, 0)) / 86400000); const clock = new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); return days <= 0 ? `today ${clock}` : days === 1 ? `yesterday ${clock}` : `${days}d ago`; };
const short = (s, n = 64) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}...` : s);

function prepare({ pulls, requests, me, repo }) {
  const out = [];
  const open = pulls || [];
  const forMe = (requests || []).length;
  if (forMe) out.push({ q: 'Which pull requests are waiting on my review, and which should I read first?', why: `${forMe} asking for you` });
  const biggest = open.slice().sort((a, b) => ((b.additions || 0) + (b.deletions || 0)) - ((a.additions || 0) + (a.deletions || 0)))[0];
  if (biggest) out.push({ q: `What does #${biggest.number} "${biggest.title}" change, and what is risky in it?`, why: `+${biggest.additions || 0} -${biggest.deletions || 0}, the largest open` });
  const stale = open.filter((p) => p.updatedAt && Date.now() - new Date(p.updatedAt) > 14 * 86400000).sort((a, b) => new Date(a.updatedAt) - new Date(b.updatedAt))[0];
  if (stale) out.push({ q: `Why has #${stale.number} "${stale.title}" gone quiet, and what would unblock it?`, why: `untouched since ${new Date(stale.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}` });
  const changes = open.filter((p) => p.reviewStatus === 'changes_requested');
  if (changes.length) out.push({ q: 'Which pull requests have changes requested, and what was asked?', why: `${changes.length} with changes requested` });
  const approved = open.filter((p) => p.reviewStatus === 'approved');
  if (approved.length) out.push({ q: 'Which approved pull requests are ready to merge, and is anything blocking them?', why: `${approved.length} approved` });
  out.push({ q: `What merged in ${repo || 'this repository'} in the last two weeks, and what did it change?`, why: 'the last two weeks' });
  out.push({ q: 'Who reviews the most here, and who is waiting the longest for a review?', why: 'across the open pull requests' });
  return out.slice(0, 7);
}

export function Ask({ host, api, repo, me, question, setQuestion, ask, asking, answer, setAnswer, pulls, requests, onOpen }) {
  const { h, ui, react, tokens, icons } = host;
  const { useState, useEffect, useMemo, useRef } = react;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { if (!asking) { setElapsed(0); return undefined; } const started = Date.now(); const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000); return () => clearInterval(t); }, [asking]);
  const [recent, setRecent] = useState(readRecent);
  useEffect(() => { setRecent(readRecent()); }, [answer]);
  const forget = () => { writeRecent([]); setRecent([]); };
  const root = useRef(null);
  const [height, setHeight] = useState(null);
  useEffect(() => {
    const fit = () => { const el = root.current; if (!el) return; const scroller = el.closest('.plugin-surface') || document.documentElement; if (el.clientWidth < 800) { setHeight(null); return; } setHeight(Math.max(360, Math.floor(scroller.getBoundingClientRect().bottom - el.getBoundingClientRect().top - 68))); };
    fit(); window.addEventListener('resize', fit); return () => window.removeEventListener('resize', fit);
  }, []);
  const suggestions = useMemo(() => prepare({ pulls, requests, me, repo }), [pulls, requests, me, repo]);
  const meta = (text) => h('span', { className: 'mpanel__meta' }, text);
  const FILL = { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }, bodyStyle: { flex: 1, minHeight: 0, overflow: 'auto', paddingRight: 14, scrollbarGutter: 'stable' } };

  const answerPanel = () => {
    if (asking) return Panel(host, { title: 'Reading GitHub', action: meta(`${elapsed}s`), ...FILL },
      h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, 'The AI is reading the pull requests, their files and their conversations, then writing the answer. A wide question takes a minute or two.'),
      h(ui.Skeleton, { count: 5, height: 16 }));
    if (!answer) {
      const open = (pulls || []).length;
      return Panel(host, { title: 'Answer', action: meta('nothing asked yet'), ...FILL },
        h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, 'The AI reads GitHub through this plugin for whatever the question needs and answers from what it read, citing pull requests you can open. Ask something, or pick a prepared question on the right.'),
        h('div', { className: 'mhealth' },
          Health(host, { label: repo || 'repository', value: `${open} open`, tone: 'brass' }),
          Health(host, { label: 'for you', value: requests ? `${requests.length}` : '...', hint: 'across your repos' }),
          Health(host, { label: 'reach', value: 'open and closed', hint: 'files, reviews, checks' })));
    }
    const ids = cited(answer.answer);
    const keepAnswer = async () => { if (host.writeNote && await host.writeNote(`GitHub - ${answer.question.slice(0, 60)}`, `# ${answer.question}\n\n_Asked ${new Date(answer.at).toLocaleString()}${repo ? ` on ${repo}` : ''}._\n\n${answer.answer}`)) host.notify('Saved as a note', 'moss'); };
    return Panel(host, { title: 'Answer', ...FILL, action: h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } }, host.writeNote ? h(ui.Button, { className: 'sy-btn--sm', onClick: keepAnswer }, 'Save as note') : null, meta(`${when(answer.at)} - ${answer.seconds}s${ids.length ? ` - ${ids.length} cited` : ''}`)) },
      h('p', { className: 'mlead', style: { margin: '0 0 var(--sy-s3)' } }, answer.question),
      h(ui.Markdown, { source: answer.answer }),
      ids.length ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 'var(--sy-s3)', paddingTop: 'var(--sy-s3)', borderTop: `1px solid ${tokens('line')}` } },
        ids.map((n) => h(ui.Chip, { key: n, onClick: () => onOpen(n), title: `Open #${n}` }, `#${n}`))) : null);
  };
  const column = (...children) => h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--sy-s3)', minWidth: 0, minHeight: 0, height: '100%' } }, ...children);

  return h('div', { ref: root, className: 'gh-ask', style: { height: height ? `${height}px` : 'auto' } },
    column(
      Panel(host, { title: 'Ask about the pull requests', action: meta('any period, open or closed') },
        h('div', { style: { display: 'flex', gap: 8 } },
          h(ui.Input, { placeholder: '"what is waiting on me?" or "what merged last week?"', value: question, disabled: asking, onChange: (e) => setQuestion(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') ask(); } }),
          h(ui.Button, { variant: 'primary', disabled: asking || !question.trim(), onClick: () => ask() }, asking ? `Asking... ${elapsed}s` : 'Ask'))),
      answerPanel()),
    column(
      Panel(host, { title: 'Worth asking', action: meta('from what is open') },
        List(host, suggestions.map((s) => ListRow(host, { key: s.q, lead: h(icons.search, { size: 13, style: { opacity: 0.6, flex: 'none' } }), label: s.q, sub: s.why, onClick: asking ? undefined : () => { setQuestion(s.q); ask(s.q); } })))),
      Panel(host, { title: 'Recently asked', ...FILL, action: recent.length ? h('button', { type: 'button', className: 'mpanel__meta', style: { background: 'none', border: 0, cursor: 'pointer', padding: 0, font: 'inherit' }, onClick: forget }, `${recent.length} kept - clear`) : meta('kept in the app') },
        recent.length ? List(host, recent.map((e) => ListRow(host, { key: e.at, lead: h(icons.history, { size: 13, style: { opacity: 0.6, flex: 'none' } }), label: short(e.question), sub: `${when(e.at)} - ${e.seconds}s${cited(e.answer).length ? ` - ${cited(e.answer).length} cited` : ''}`, onClick: () => { setQuestion(e.question); setAnswer(e); } })))
          : h('p', { className: 'mlead', style: { margin: 0 } }, 'Nothing asked yet. Every answer is kept here, and one click brings it back without asking again.'))));
}
