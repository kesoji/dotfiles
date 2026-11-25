// スレッドの組み立て（1つの指示＝message と、その指示に replyTo でつながる項目を1つにまとめる）。
// 画面（app.js）と自己テスト（scripts/inbox.mjs の selfTestInbox）が、同じこの関数を使う。DOM には触らない。
//
// buildThreads(items, { kept }) → { threads, inThread, byRoot }
//   threads   [{ id, root, items, focus, prev, column, at }]
//     id・root  元の指示（message）の id と項目
//     items     その指示につながる項目（取り下げたものを除く・古い順）
//     focus     手が要る項目（未対応の要返事・確認依頼・やること）。スレッドの中で大きく出す
//     prev      それ以外（読むだけ・済んだ項目）。小さく畳んで上に並べる
//     column    スレッドを置く列。focus があれば ask → review → todo の先にあるもの、無くて未読の読むだけがあれば tell、どれも無ければ null（済んだ）
//     at        列の中の並びに使う時刻（手が要る項目・未読の読むだけのうち、いちばん古いもの）
//   inThread  列に出ているスレッド（column が null でない）の項目の id。列にそのまま出すと二重になるので、画面はこれを外す
//   byRoot    指示の id → スレッド
// kept は、この画面で開いて既読にした読むだけの id（読んでいる最中にスレッドを消さない）。
'use strict';

function buildThreads(items, opts) {
  const kept = (opts && opts.kept) || new Set();
  const WAIT = ['ask', 'review', 'todo'];
  const byId = new Map(items.map((x) => [x.id, x]));
  const groups = new Map();
  for (const x of items) {
    if (!x.replyTo || x.kind === 'message' || x.status === 'withdrawn') continue;
    const root = byId.get(x.replyTo);
    if (!root || root.kind !== 'message') continue;
    if (!groups.has(root.id)) groups.set(root.id, []);
    groups.get(root.id).push(x);
  }
  const threads = [];
  const inThread = new Set();
  const byRoot = new Map();
  for (const [id, list] of groups) {
    list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const focus = list.filter((x) => x.status === 'open' && WAIT.includes(x.kind));
    const fresh = list.filter((x) => x.kind === 'tell' && (x.status === 'open' || kept.has(x.id)));
    const column = WAIT.find((k) => focus.some((x) => x.kind === k)) || (fresh.length ? 'tell' : null);
    const t = { id, root: byId.get(id), items: list, focus, prev: list.filter((x) => !focus.includes(x)), column, at: (focus[0] || fresh[0] || list[0]).createdAt };
    threads.push(t);
    byRoot.set(id, t);
    if (column) for (const x of list) inThread.add(x.id);
  }
  return { threads, inThread, byRoot };
}
