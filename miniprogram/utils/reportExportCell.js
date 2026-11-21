function reportCellParts(text, style = 'body') {
  if (style !== 'value') return [{ text, style }];
  if (!text || text === '—') return [{ text, style: 'muted' }];
  const lineBreak = text.indexOf('\n');
  if (lineBreak < 0) return [{ text, style }];
  return [
    { text: text.slice(0, lineBreak), style },
    { text: text.slice(lineBreak + 1), style: 'muted' }
  ];
}

module.exports = { reportCellParts };
