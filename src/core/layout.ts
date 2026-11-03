export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const ASPECT = 16 / 9;
export const GAP = 2;

function gridDims(count: number, width: number, height: number) {
  let best = { cols: 1, rows: count, videoWidth: -1, empty: 0 };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const cellW = (width - GAP * (cols - 1)) / cols;
    const cellH = (height - GAP * (rows - 1)) / rows;
    const videoWidth = Math.min(cellW, cellH * ASPECT);
    const empty = cols * rows - count;
    if (videoWidth > best.videoWidth + 0.5 || (Math.abs(videoWidth - best.videoWidth) <= 0.5 && empty < best.empty)) {
      best = { cols, rows, videoWidth, empty };
    }
  }
  return { cols: best.cols, rows: best.rows };
}

export function gridLayout(count: number, area: Rect): Rect[] {
  if (count <= 0 || area.width <= 0 || area.height <= 0) return [];
  const { cols, rows } = gridDims(count, area.width, area.height);
  const cellW = (area.width - GAP * (cols - 1)) / cols;
  const cellH = (area.height - GAP * (rows - 1)) / rows;

  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    const inRow = row === rows - 1 ? count - row * cols : cols;
    const offset = ((cols - inRow) * (cellW + GAP)) / 2;
    const x = area.x + offset + col * (cellW + GAP);
    const y = area.y + row * (cellH + GAP);
    rects.push({
      x: Math.round(x),
      y: Math.round(y),
      width: Math.round(x + cellW) - Math.round(x),
      height: Math.round(y + cellH) - Math.round(y),
    });
  }
  return rects;
}

const videoWidth = (r: Rect) => Math.min(r.width, r.height * ASPECT);

export function focusLayout(count: number, area: Rect, stripRatio = 0.25): Rect[] {
  if (count <= 0 || area.width <= 0 || area.height <= 0) return [];
  if (count === 1) return [area];

  const others = count - 1;
  const stripW = Math.round(area.width * stripRatio);
  const stripH = Math.round(area.height * stripRatio);

  const right = {
    main: { ...area, width: area.width - stripW - GAP },
    strip: { x: area.x + area.width - stripW, y: area.y, width: stripW, height: area.height },
  };
  const bottom = {
    main: { ...area, height: area.height - stripH - GAP },
    strip: { x: area.x, y: area.y + area.height - stripH, width: area.width, height: stripH },
  };
  const pick = videoWidth(right.main) >= videoWidth(bottom.main) ? right : bottom;
  return [pick.main, ...gridLayout(others, pick.strip)];
}
