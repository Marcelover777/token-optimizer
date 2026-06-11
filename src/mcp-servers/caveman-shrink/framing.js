class JsonRpcFramer {
  constructor({ mode = 'auto' } = {}) {
    this.mode = mode;
    this.buffer = Buffer.alloc(0);
    this.detectedMode = null;
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    const messages = [];
    while (this.buffer.length) {
      const mode = this._mode();
      if (mode === 'content-length') {
        const parsed = this._readContentLength();
        if (!parsed) break;
        messages.push(parsed);
      } else {
        const parsed = this._readNewline();
        if (!parsed) break;
        messages.push(parsed);
      }
    }
    return messages;
  }

  _mode() {
    if (this.mode !== 'auto') return this.mode;
    if (this.detectedMode) return this.detectedMode;
    const trimmed = this.buffer.toString('utf8', 0, Math.min(this.buffer.length, 32)).trimStart();
    this.detectedMode = /^Content-Length:/i.test(trimmed) ? 'content-length' : 'newline-json';
    return this.detectedMode;
  }

  _readContentLength() {
    const raw = this.buffer.toString('utf8');
    const headerEnd = raw.indexOf('\r\n\r\n') !== -1 ? raw.indexOf('\r\n\r\n') + 4 : raw.indexOf('\n\n') + 2;
    if (headerEnd < 2) return null;
    const header = raw.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      const nl = this.buffer.indexOf(10);
      if (nl === -1) return null;
      const line = this.buffer.slice(0, nl).toString('utf8');
      this.buffer = this.buffer.slice(nl + 1);
      return { message: null, raw: Buffer.from(line + '\n'), mode: 'newline-json', error: 'bad_header' };
    }
    const length = Number(match[1]);
    const total = Buffer.byteLength(header) + length;
    if (this.buffer.length < total) return null;
    const body = this.buffer.slice(Buffer.byteLength(header), total).toString('utf8');
    this.buffer = this.buffer.slice(total);
    try {
      return { message: JSON.parse(body), raw: Buffer.from(header + body), mode: 'content-length' };
    } catch (error) {
      return { message: null, raw: Buffer.from(header + body), mode: 'content-length', error };
    }
  }

  _readNewline() {
    const nl = this.buffer.indexOf(10);
    if (nl === -1) return null;
    const raw = this.buffer.slice(0, nl + 1);
    this.buffer = this.buffer.slice(nl + 1);
    const line = raw.toString('utf8').trim();
    if (!line) return { message: null, raw, mode: 'newline-json' };
    try {
      return { message: JSON.parse(line), raw, mode: 'newline-json' };
    } catch (error) {
      return { message: null, raw, mode: 'newline-json', error };
    }
  }

  encode(message, preferredMode) {
    const mode = preferredMode || this.detectedMode || (this.mode === 'auto' ? 'newline-json' : this.mode);
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    if (mode === 'content-length') {
      return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf8'), body]);
    }
    return Buffer.concat([body, Buffer.from('\n')]);
  }
}

module.exports = { JsonRpcFramer };
