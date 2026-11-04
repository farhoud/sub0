import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { JsonlSplitter } from '../../src/pi/jsonl.js';
import { PiRpcClient } from '../../src/pi/rpc-client.js';

describe('pi RPC framing', () => {
  it('delivers a record containing U+2028 as one record', () => {
    const splitter = new JsonlSplitter();
    const records = splitter.push(Buffer.from(JSON.stringify({ text: 'a b c' }) + '\n'));
    expect(records).toHaveLength(1);
    expect(JSON.parse(records[0]!).text).toBe('a b c');
  });

  it('decodes a multi-byte character split across two chunks', () => {
    const splitter = new JsonlSplitter();
    const bytes = Buffer.from(JSON.stringify({ text: 'héllo ✓' }) + '\n', 'utf8');
    const cut = bytes.indexOf(0xe2) + 1; // inside the three bytes of ✓
    expect(splitter.push(bytes.subarray(0, cut))).toEqual([]);
    expect(JSON.parse(splitter.push(bytes.subarray(cut))[0]!).text).toBe('héllo ✓');
  });

  it('splits on LF only and strips a trailing CR', () => {
    const splitter = new JsonlSplitter();
    expect(splitter.push(Buffer.from('{"a":1}\r\n{"b":"x\ry"}\n'))).toEqual(['{"a":1}', '{"b":"x\ry"}']);
  });

  it('matches a response to its command by id and routes events in between', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const events: any[] = [];
    const client = new PiRpcClient(stdin, stdout, { onEvent: (e) => events.push(e) });
    let sent = '';
    stdin.on('data', (c) => (sent += c));
    const pending = client.send({ type: 'get_state' });
    await new Promise((r) => setImmediate(r));
    const id = JSON.parse(sent).id;
    stdout.write(JSON.stringify({ type: 'tool_execution_start', toolName: 'read' }) + '\n');
    stdout.write(JSON.stringify({ type: 'response', id: 'other', success: true }) + '\n');
    stdout.write(JSON.stringify({ type: 'response', id, command: 'get_state', success: true, data: { ok: 1 } }) + '\n');
    expect((await pending).data).toEqual({ ok: 1 });
    expect(events.map((e) => e.type)).toEqual(['tool_execution_start', 'response']);
  });
});
