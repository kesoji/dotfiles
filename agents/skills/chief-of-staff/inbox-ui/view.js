// 手元の Markdown（報告書など）を表示する。?src= に API のリンクの URL（/api/items/<id>/links/<n>）を渡す。
// ?repo= に元の項目の GitHub のリポジトリ（owner/name）があれば、#123 やコミットをリンクにする。
'use strict';
(async () => {
  const q = new URLSearchParams(location.search);
  const src = q.get('src') || '';
  const name = q.get('name') || '報告書';
  document.title = name;
  document.getElementById('name').textContent = name;
  const doc = document.getElementById('doc');
  if (!src.startsWith('/api/')) { doc.textContent = '表示できるのは受け箱のリンクだけです'; return; }
  document.getElementById('raw').href = src;
  try {
    const res = await fetch(src, { cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) { doc.textContent = text || `読めませんでした（${res.status}）`; return; }
    doc.replaceChildren(markdown(text, q.get('repo')));
  } catch (e) {
    doc.textContent = `読めませんでした: ${e.message}`;
  }
})();
