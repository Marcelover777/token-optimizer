const { sha256 } = require('./protect');

// Split a single heading-section's text into contiguous prose/code runs at
// fenced-code boundaries. Each run becomes its own compressible unit so the
// savings gate (and the LLM) operates on prose alone — a big fenced code block
// next to a paragraph no longer drags the whole section's ratio below the gate.
// Concatenating the runs' text reconstructs the section byte-for-byte.
function splitFencedRuns(text) {
  const lines = String(text || '').split(/(?<=\n)/); // keep trailing newlines
  const runs = [];
  let cur = '';
  let inCode = false;
  const flush = (kind) => { if (cur) { runs.push({ text: cur, kind }); cur = ''; } };
  for (const ln of lines) {
    const isFence = /^\s{0,3}(```|~~~)/.test(ln);
    if (isFence && !inCode) { flush('prose'); inCode = true; cur += ln; continue; }
    if (isFence && inCode) { cur += ln; flush('code'); inCode = false; continue; }
    cur += ln;
  }
  flush(inCode ? 'code' : 'prose'); // trailing run (unclosed fence -> code)
  return runs.length ? runs : [{ text: String(text || ''), kind: 'prose' }];
}

function splitMarkdownSections(text) {
  const source = String(text || '');
  if (!source) return [];
  const lines = source.split(/(\n)/);
  const logical = [];
  for (let i = 0; i < lines.length; i += 2) {
    logical.push((lines[i] || '') + (lines[i + 1] || ''));
  }

  const headingSections = [];
  let startLine = 1;
  let start = 0;
  let title = '_root';
  let buf = '';

  function flush(nextStart) {
    if (!buf) return;
    headingSections.push({
      title,
      startLine,
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

  // Expand each heading-section into prose/code runs, preserving exact offsets
  // so the join in compressFile reconstructs the file byte-for-byte.
  const sections = [];
  for (const sec of headingSections) {
    const runs = splitFencedRuns(sec.text);
    let off = sec.start;
    for (const run of runs) {
      sections.push({
        id: `sha256:${sha256(run.text)}`,
        title: sec.title,
        startLine: sec.startLine,
        endLine: sec.startLine + run.text.split('\n').length - 1,
        start: off,
        end: off + run.text.length,
        text: run.text,
        kind: run.kind,
      });
      off += run.text.length;
    }
  }
  return sections;
}

module.exports = { splitMarkdownSections, splitFencedRuns };
