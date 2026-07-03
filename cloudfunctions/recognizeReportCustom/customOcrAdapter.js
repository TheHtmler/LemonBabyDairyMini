function boxToPos(box, index = 0) {
  if (!box) {
    return { top: index * 24, left: 0, width: 0, height: 20 };
  }

  if (Array.isArray(box) && box.length === 4 && typeof box[0] === 'number') {
    const [x1, y1, x2, y2] = box;
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1) || 20
    };
  }

  if (Array.isArray(box) && Array.isArray(box[0])) {
    const xs = box.map((point) => Number(point[0]) || 0);
    const ys = box.map((point) => Number(point[1]) || 0);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return {
      left,
      top,
      width: Math.max(...xs) - left,
      height: Math.max(...ys) - top || 20
    };
  }

  if (box && typeof box === 'object') {
    return {
      left: Number(box.left ?? box.x ?? 0),
      top: Number(box.top ?? box.y ?? 0),
      width: Number(box.width ?? box.w ?? 0),
      height: Number(box.height ?? box.h ?? 20) || 20
    };
  }

  return { top: index * 24, left: 0, width: 0, height: 20 };
}

function linesToOcrItems(lines = []) {
  return (lines || [])
    .map((line, index) => ({
      text: `${line?.text || ''}`.trim(),
      confidence: line?.confidence,
      pos: boxToPos(line?.box, index)
    }))
    .filter((item) => item.text);
}

module.exports = {
  boxToPos,
  linesToOcrItems
};
