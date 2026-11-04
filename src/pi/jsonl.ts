// @sigil implements design/pi-driver.sigil PiDriver (pi RPC client framing)
//
// Splits on LF only and decodes UTF-8 per complete record from a byte buffer, so a
// multi-byte character split across chunks survives and U+2028/U+2029 never split
// a record. Node readline is deliberately not used.
const LF = 0x0a;
const CR = 0x0d;

export class JsonlSplitter {
  private pending: Buffer = Buffer.alloc(0);
  private readonly decoder = new TextDecoder('utf-8');

  push(chunk: Buffer): string[] {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    const records: string[] = [];
    let start = 0;
    for (let i = this.pending.indexOf(LF, start); i !== -1; i = this.pending.indexOf(LF, start)) {
      records.push(this.decode(this.pending.subarray(start, i)));
      start = i + 1;
    }
    this.pending = this.pending.subarray(start);
    return records;
  }

  /** Flush a final record that had no trailing LF. */
  end(): string[] {
    if (this.pending.length === 0) return [];
    const last = this.decode(this.pending);
    this.pending = Buffer.alloc(0);
    return [last];
  }

  private decode(bytes: Buffer): string {
    const end = bytes.length > 0 && bytes[bytes.length - 1] === CR ? bytes.length - 1 : bytes.length;
    return this.decoder.decode(bytes.subarray(0, end));
  }
}
