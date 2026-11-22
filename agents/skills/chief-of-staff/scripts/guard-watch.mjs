#!/usr/bin/env node
// PreToolUse(Bash) のフック: `cos watch` を run_in_background 以外（& での起動・前面での実行）で打つのを止める。
// & で起動した見張りは終わっても CoS に通知が来ず、親を失って残り続ける（同じ失敗が3回あった）。
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const cmd = input?.tool_input?.command ?? '';
  const bg = input?.tool_input?.run_in_background === true;
  if (!/(^|[;&|(]\s*|\n\s*)(node\s+\S*)?cos(\.mjs)?\s+watch\b/.test(cmd)) process.exit(0);
  if (bg && !/&\s*($|;|disown)/.test(cmd.replace(/&&/g, ''))) process.exit(0);
  process.stderr.write(
    'cos watch は Bash の run_in_background: true で、& を付けずに起動してください。' +
      '& や前面で起動すると、見張りが終わっても CoS に通知が来ません（親を失った見張りが残ります）。\n',
  );
  process.exit(2);
});
