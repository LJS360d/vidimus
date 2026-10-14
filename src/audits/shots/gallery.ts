const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const gallery = (
  rows: { name: string; percent: string }[],
  baselineHref: string,
) => `<!doctype html>
<meta charset="utf-8"><title>screenshot diff</title>
<style>
 body{font:14px/1.5 system-ui;margin:2rem;background:#111;color:#eee}
 h2{font-size:1rem;margin:2rem 0 .5rem;font-weight:600}
 .row{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;align-items:start}
 figure{margin:0}figcaption{opacity:.6;font-size:.75rem;margin-bottom:.25rem}
 img{width:100%;border:1px solid #333;background:#fff}
</style>
${rows
  .map(
    ({ name, percent }) => `<h2>${escapeHtml(name)} — ${percent}% changed</h2>
<div class="row">
${[
  ['baseline', baselineHref],
  ['current', 'current'],
  ['diff', 'diff'],
]
  .map(
    ([label, dir]) =>
      ` <figure><figcaption>${label}</figcaption><img src="${dir}/${encodeURIComponent(name)}.png"></figure>`,
  )
  .join('\n')}
</div>`,
  )
  .join('\n')}
`;
