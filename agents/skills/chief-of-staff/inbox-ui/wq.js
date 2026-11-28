// 作業セッションの質問のカード（CoS がまだ受け箱に出していない質問）。
// 画面（app.js）と自己テスト（scripts/inbox.mjs の selfTestInbox）が、同じこの関数を使う。DOM には触らない。
//
// workerQuestions(chiefs, items) → [{ id, chief, worker, question, since, answers, answered }]
//   chiefs    GET /api/chiefs の chiefs（workers[] に report・reportUpdated・question を持つ）
//   items     GET /api/items の items
//   出すのは、報告書の状態が「質問」の作業セッションのうち、同じ CoS・同じ worker の未対応の要返事・確認依頼・やることが受け箱に無いもの
//   （CoS が cos ask --worker <ID> などで出したら、そちらを優先して出さない＝二重にしない）。
//   止まった後（since 以降）に CoS が出して、もう答えた項目があるときも出さない（答えた質問を、CoS が作業セッションに渡すまでの間にまた聞かない）。
//     id        カードの id（`wq:<CoS の dir>:<作業セッションの ID>`）
//     chief     { name, dir }
//     worker    GET /api/chiefs の作業セッション 1件（id・label・reportUpdated・question など）
//     question  報告書の質問の部分（無ければ null）
//     since     止まった時刻（報告書を最後に書いた時刻。無ければ null）
//     answers   この質問へ画面から送った答え（同じ CoS 宛て・同じ worker の message で、since 以降のもの。古い順。取り下げたものを除く）
//     answered  answers が1件でもあるか（あれば CoS の番なので、返事待ちの件数に数えない）
'use strict';

function workerQuestions(chiefs, items) {
  const norm = (d) => String(d || '').replace(/\/+$/, '');
  const WAIT = ['ask', 'review', 'todo'];
  const out = [];
  for (const c of chiefs || []) {
    for (const w of c.workers || []) {
      if (w.report !== '質問') continue;
      const mine = (x) => x.chief && norm(x.chief.dir) === norm(c.dir) && x.worker === w.id;
      const since = w.reportUpdated || null;
      // CoS が出した項目があれば出さない: 未対応のもの、または止まった後に出して済んだもの（答えた質問がまたカードで出てこないように）
      if ((items || []).some((x) => mine(x) && WAIT.includes(x.kind) && (x.status === 'open' || (x.status !== 'withdrawn' && since && String(x.createdAt) >= since)))) continue;
      const answers = (items || [])
        .filter((x) => mine(x) && x.kind === 'message' && x.status !== 'withdrawn' && (!since || String(x.createdAt) >= since))
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      out.push({ id: `wq:${c.dir}:${w.id}`, chief: { name: c.name, dir: c.dir }, worker: w, question: w.question || null, since, answers, answered: answers.length > 0 });
    }
  }
  return out;
}
