#!/usr/bin/env node
// A stand-in for claude -p: records its arguments and environment, then writes a
// stream, subagent transcripts and, for a delegating arm, subzero task records.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? 'report';
const cwd = process.cwd();
writeFileSync(join(process.env.FAKE_CLAUDE_LOG, 'args.json'), JSON.stringify({ args, cwd, path: process.env.PATH }));

if (mode === 'crash') {
  process.stderr.write('claude: something went wrong\n');
  process.exit(1);
}
const session = 'sess-1';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const usage = (i, o) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
out({ type: 'system', subtype: 'init', session_id: session });
out({ type: 'assistant', parent_tool_use_id: null, session_id: session, message: { id: 'main-1', usage: usage(500, 50), content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'sigil-evaluator' } }] } });

const sub = join(process.env.FAKE_CLAUDE_PROJECTS, '-fake', session, 'subagents');
mkdirSync(sub, { recursive: true });
const report = mode === 'report' ? 'Final check: incomplete.\nHand-back state: incomplete' : 'I ran out of time.';
writeFileSync(join(sub, 'agent-e.jsonl'), JSON.stringify({ type: 'assistant', message: { id: 'e-1', usage: usage(4000, 400), content: [{ type: 'text', text: report }] } }) + '\n');
writeFileSync(join(sub, 'agent-e.meta.json'), JSON.stringify({ agentType: 'sigil-evaluator' }));

if (!args.includes('--plugin-dir')) {
  // An A interpreter: one API message written on two lines, as Claude Code does.
  const line = { type: 'assistant', cwd, message: { id: 'i-1', model: 'claude-sonnet-5-5', usage: usage(300, 30), content: [
    { type: 'tool_use', name: 'Write', input: { file_path: join(cwd, 'run', 'rooms-answer-1.egg') } },
  ] } };
  writeFileSync(join(sub, 'agent-i.jsonl'), [
    JSON.stringify({ type: 'user', cwd, message: { content: 'Write your claim rows to run/rooms-answer-1.egg.' } }),
    JSON.stringify(line),
    JSON.stringify(line),
  ].join('\n') + '\n');
  writeFileSync(join(sub, 'agent-i.meta.json'), JSON.stringify({ agentType: 'interpreter' }));
}

if (args.includes('--plugin-dir')) {
  const store = join(cwd, '.agents', 'subzero');
  mkdirSync(join(store, 'tasks', 'sz-bbbbbb', 'turns'), { recursive: true });
  mkdirSync(join(store, 'sessions'), { recursive: true });
  writeFileSync(join(store, 'tasks', 'sz-bbbbbb', 'task.json'), JSON.stringify({ brief: 'Write your claim rows to run/booking-answer-1.egg.', launchSpec: { cwd, thinkingLevel: 'high' } }));
  writeFileSync(join(store, 'tasks', 'sz-bbbbbb', 'turns', '1.json'), JSON.stringify({ status: 'completed', usage: { inputTokens: 700, outputTokens: 70, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 770, cost: 0, contextTokens: 800, contextWindow: 131072, contextPercent: 1 } }));
  // The session file is named as pi names it; TaskStore records its path on the index line.
  const sessionFile = join(store, 'sessions', '2026-11-03T13-52-33-320Z_sz-bbbbbb.jsonl');
  writeFileSync(join(store, 'index.jsonl'), JSON.stringify({ taskId: 'sz-bbbbbb', status: 'completed', sessionFile }) + '\n');
  writeFileSync(sessionFile, [
    JSON.stringify({ type: 'session', cwd }),
    JSON.stringify({ type: 'message', message: { role: 'assistant', content: [
      { type: 'toolCall', name: 'write', arguments: { path: 'run/booking-answer-1.egg' } },
      { type: 'toolCall', name: 'write', arguments: { path: 'run/scratch.md' } },
    ] } }),
  ].join('\n') + '\n');
}
out({ type: 'result', subtype: 'success', is_error: false, session_id: session, result: report });
