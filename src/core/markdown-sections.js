const { sha256 } = require('./protect');

function splitMarkdownSections(text) {
  const source = String(text || '');
  if (!source) return [];
  const lines = source.split(/(\n)/);
  const logical = [];
  for (let i = 0; i < lines.length; i += 2) {
    logical.push((lines[i] || '') + (lines[i + 1] || ''));
  }

  const sections = [];
  let startLine = 1;
  let start = 0;
  let title = '_root';
  let buf = '';

  function flush(nextStart) {
    if (!buf) return;
    sections.push({
      id: `sha256:${sha256(buf)}`,
      title,
      startLine,
      endLine: startLine + buf.split('\n').length - 1,
      start,
      end: nextStart,
      text: buf,
    });
  }

  let offset = 0;
  let lineNo = 1;
  for (const line of logical) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line.trimEnd());
    if (heading && buf) {
      flush(offset);
      startLine = lineNo;
      start = offset;
      title = heading[2];
      buf = '';
    } else if (heading) {
      title = heading[2];
      startLine = lineNo;
      start = offset;
    }
    buf += line;
    offset += line.length;
    lineNo += line.endsWith('\n') ? 1 : 0;
  }
  flush(source.length);
  return sections;
}

module.exports = { splitMarkdownSections };
