import React, { useRef, useState, useEffect, useCallback } from 'react';
import Toolbar from './Toolbar';

// ── Layout constants ──────────────────────────────────────────────────────
const BOX_PAD_X = 28;          // horizontal padding inside boxes
const BOX_PAD_Y = 16;          // vertical padding inside boxes
const BOX_MIN_W = 100;
const BOX_MIN_H = 48;
const BOX_RADIUS = 12;
const FONT_SIZE = 14;
const FONT = `${FONT_SIZE}px Inter, system-ui, sans-serif`;
const AI_DRAW_STEP_MS = 120;

// ── Helpers ───────────────────────────────────────────────────────────────

/** Measure text width using an off-screen canvas */
const _measureCanvas = typeof OffscreenCanvas !== 'undefined'
  ? new OffscreenCanvas(1, 1).getContext('2d')
  : null;

function measureText(text, font = FONT) {
  const ctx = _measureCanvas || document.createElement('canvas').getContext('2d');
  ctx.font = font;
  return ctx.measureText(text || '');
}

/** Return the bounding box {x, y, w, h} of an element, measuring text for boxes */
function getBBox(el) {
  if (el.type === 'box') {
    const metrics = measureText(el.text, FONT);
    const w = Math.max(BOX_MIN_W, metrics.width + BOX_PAD_X * 2);
    const h = BOX_MIN_H;
    return { x: el.x, y: el.y, w, h };
  }
  if (el.type === 'text') {
    const metrics = measureText(el.text, `16px Inter, system-ui, sans-serif`);
    return { x: el.x, y: el.y, w: metrics.width, h: 20 };
  }
  return { x: el.x || 0, y: el.y || 0, w: 0, h: 0 };
}

/** Find the point on the edge of a rectangle nearest to an external target point */
function edgePoint(bbox, targetX, targetY) {
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const dx = targetX - cx;
  const dy = targetY - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: bbox.y }; // degenerate

  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const halfW = bbox.w / 2;
  const halfH = bbox.h / 2;

  // Which edge do we hit?
  if (absDx / halfW > absDy / halfH) {
    // hits left or right edge
    const signX = dx > 0 ? 1 : -1;
    return { x: cx + signX * halfW, y: cy + (dy * halfW) / absDx * signX };
  } else {
    // hits top or bottom edge
    const signY = dy > 0 ? 1 : -1;
    return { x: cx + (dx * halfH) / absDy * signY, y: cy + signY * halfH };
  }
}

// Clamp edge-point y so it never exits the box rect
function clampedEdgePoint(bbox, targetX, targetY) {
  const pt = edgePoint(bbox, targetX, targetY);
  pt.y = Math.max(bbox.y, Math.min(bbox.y + bbox.h, pt.y));
  pt.x = Math.max(bbox.x, Math.min(bbox.x + bbox.w, pt.x));
  return pt;
}

// ── Auto-layout for AI elements ──────────────────────────────────────────
// Hierarchical graph layout engine.
// Completely ignores AI-provided x/y coordinates.
// Uses arrow connections to build a graph, topologically sorts into layers,
// and places everything on a clean grid — guaranteed zero overlap.

const GAP_X = 60;   // horizontal gap between columns
const GAP_Y = 40;   // vertical gap between rows

function autoLayoutElements(elements, canvasW, canvasH) {
  if (!elements || elements.length === 0) return elements;

  const W = canvasW || 900;
  const H = canvasH || 600;
  const PAD = 50; // canvas edge padding

  // Deep-copy
  const laid = elements.map(e => ({ ...e }));

  // Identify placeable (non-arrow) elements and arrows
  const nodeIndices = [];   // indices of boxes/text in `laid`
  const arrows = [];        // { from: nodeIndex, to: nodeIndex }

  laid.forEach((el, i) => {
    if (el.type !== 'arrow') {
      nodeIndices.push(i);
    }
  });

  if (nodeIndices.length === 0) return laid;

  // Build adjacency from arrows
  // Arrow.from / .to are indices into the ORIGINAL elements array
  laid.forEach(el => {
    if (el.type === 'arrow' && el.from !== undefined && el.to !== undefined) {
      arrows.push({ from: el.from, to: el.to });
    }
  });

  // ── Compute bounding sizes for each node ─────────────────────────────
  const nodeSizes = nodeIndices.map(i => {
    const bb = getBBox(laid[i]);
    return { w: bb.w, h: bb.h };
  });

  // ── Assign layers via topological sort (BFS-based) ───────────────────
  // Map original-element-index → nodeIndices position
  const origToNode = {};
  nodeIndices.forEach((origIdx, nodePos) => {
    origToNode[origIdx] = nodePos;
  });

  const n = nodeIndices.length;
  const adjOut = Array.from({ length: n }, () => []);   // outgoing edges
  const inDeg = new Array(n).fill(0);

  arrows.forEach(({ from, to }) => {
    const f = origToNode[from];
    const t = origToNode[to];
    if (f !== undefined && t !== undefined && f !== t) {
      adjOut[f].push(t);
      inDeg[t]++;
    }
  });

  // Kahn's algorithm for topological ordering → assign depth
  const depth = new Array(n).fill(0);
  const queue = [];
  for (let i = 0; i < n; i++) {
    if (inDeg[i] === 0) queue.push(i);
  }

  const visited = new Set();
  while (queue.length > 0) {
    const u = queue.shift();
    visited.add(u);
    for (const v of adjOut[u]) {
      depth[v] = Math.max(depth[v], depth[u] + 1);
      inDeg[v]--;
      if (inDeg[v] === 0) queue.push(v);
    }
  }
  // Assign unvisited nodes (cycles or disconnected) their own layers
  for (let i = 0; i < n; i++) {
    if (!visited.has(i)) {
      depth[i] = (Math.max(...depth) || 0) + 1;
    }
  }

  // ── Group nodes by layer ─────────────────────────────────────────────
  const maxDepth = Math.max(...depth, 0);
  const layers = Array.from({ length: maxDepth + 1 }, () => []);
  for (let i = 0; i < n; i++) {
    layers[depth[i]].push(i);
  }

  // ── Compute column widths and row heights ────────────────────────────
  const layerWidths = layers.map(layer =>
    layer.length > 0 ? Math.max(...layer.map(i => nodeSizes[i].w)) : 0
  );
  const totalWidth = layerWidths.reduce((s, w) => s + w, 0) + (layers.length - 1) * GAP_X;
  // ── Position nodes ───────────────────────────────────────────────────
  // Center the whole diagram in the canvas
  const startX = Math.max(PAD, (W - totalWidth) / 2);
  const centerY = H / 2;

  let curX = startX;
  layers.forEach((layer, layerIdx) => {
    if (layer.length === 0) { curX += layerWidths[layerIdx] + GAP_X; return; }

    const colW = layerWidths[layerIdx];

    // Total height of this column's nodes
    const colTotalH = layer.reduce((s, i) => s + nodeSizes[i].h, 0) + (layer.length - 1) * GAP_Y;
    let curY = centerY - colTotalH / 2;

    layer.forEach(nodePos => {
      const origIdx = nodeIndices[nodePos];
      const sz = nodeSizes[nodePos];

      // Center the node horizontally within the column
      laid[origIdx].x = curX + (colW - sz.w) / 2;
      laid[origIdx].y = curY;

      curY += sz.h + GAP_Y;
    });

    curX += colW + GAP_X;
  });

  // ── If no arrows (unconnected nodes), use a simple grid ──────────────
  if (arrows.length === 0 && nodeIndices.length > 1) {
    const maxNodeW = Math.max(...nodeSizes.map(s => s.w));
    const maxNodeH = Math.max(...nodeSizes.map(s => s.h));
    const cellW = maxNodeW + GAP_X;
    const cellH = maxNodeH + GAP_Y;
    const cols = Math.max(1, Math.min(nodeIndices.length, Math.floor((W - PAD * 2) / cellW)));
    const rows = Math.ceil(nodeIndices.length / cols);

    const gridW = cols * cellW - GAP_X;
    const gridH = rows * cellH - GAP_Y;
    const gridStartX = Math.max(PAD, (W - gridW) / 2);
    const gridStartY = Math.max(PAD, (H - gridH) / 2);

    nodeIndices.forEach((origIdx, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const sz = nodeSizes[i];
      laid[origIdx].x = gridStartX + col * cellW + (maxNodeW - sz.w) / 2;
      laid[origIdx].y = gridStartY + row * cellH + (maxNodeH - sz.h) / 2;
    });
  }

  // ── Clamp on-screen ──────────────────────────────────────────────────
  nodeIndices.forEach((origIdx, i) => {
    const sz = nodeSizes[i];
    laid[origIdx].x = Math.max(PAD / 2, Math.min(W - sz.w - 10, laid[origIdx].x));
    laid[origIdx].y = Math.max(PAD / 2, Math.min(H - sz.h - 10, laid[origIdx].y));
  });

  return laid;
}

// ══════════════════════════════════════════════════════════════════════════
//  WHITEBOARD COMPONENT
// ══════════════════════════════════════════════════════════════════════════

export default function Whiteboard({ aiElements, onChange }) {
  const canvasRef = useRef(null);
  const [tool, setTool] = useState('pen');
  const [elements, setElements] = useState([]);
  const [history, setHistory] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [zoom, setZoom] = useState(1);
  const toolRef = useRef('pen');
  const isDrawingRef = useRef(false);
  const currentPathRef = useRef(null);
  const frameRef = useRef(0);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef(null);

  // Animation State
  const [animationQueue, setAnimationQueue] = useState([]);
  const [renderingIndex, setRenderingIndex] = useState(-1);
  const elementsRef = useRef(elements);

  // Track the last processed AI data to prevent re-processing
  const lastAiRef = useRef(null);
  const pendingLocalKeyRef = useRef(null);

  const updateElements = useCallback((nextElements) => {
    elementsRef.current = nextElements;
    setElements(nextElements);
    pendingLocalKeyRef.current = JSON.stringify(nextElements);
    setRedoStack([]);
    onChange?.({ elements: nextElements });
  }, [onChange]);

  // Handle new incoming AI elements
  useEffect(() => {
    if (aiElements && aiElements.elements) {
      const key = JSON.stringify(aiElements.elements);
      if (key === lastAiRef.current) return;
      if (key === pendingLocalKeyRef.current) {
        pendingLocalKeyRef.current = null;
        lastAiRef.current = key;
        return;
      }
      lastAiRef.current = key;

      const canvas = canvasRef.current;
      const cw = canvas?.width || 800;
      const ch = canvas?.height || 600;

      const incoming = autoLayoutElements(aiElements.elements, cw, ch);

      if (incoming.length > 0) {
        // Save current state for undo, then CLEAR the canvas
        setHistory(prev => [...prev, elementsRef.current]);
        elementsRef.current = [];
        setElements([]);

        // Queue ALL incoming elements for sequential animation
        setAnimationQueue(incoming);
        setRenderingIndex(0);
      }
    }
  }, [aiElements, updateElements]);

  // Sequenced animation
  useEffect(() => {
    if (renderingIndex >= 0 && renderingIndex < animationQueue.length) {
      const timer = setTimeout(() => {
        const next = [...elementsRef.current, animationQueue[renderingIndex]];
        elementsRef.current = next;
        setElements(next);
        if (renderingIndex === animationQueue.length - 1) {
          setRenderingIndex(-1);
          setAnimationQueue([]);
        } else {
          setRenderingIndex(index => index + 1);
        }
      }, AI_DRAW_STEP_MS);
      return () => clearTimeout(timer);
    }
  }, [renderingIndex, animationQueue]);

  // ── Drawing ────────────────────────────────────────────────────────────

  const drawElements = useCallback((ctx, els, currentToolPath) => {
    const W = ctx.canvas.clientWidth || ctx.canvas.width;
    const H = ctx.canvas.clientHeight || ctx.canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
    ctx.save();
    ctx.translate(panRef.current.x, panRef.current.y);
    ctx.scale(zoomRef.current, zoomRef.current);

    // Grid
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < W; i += 40) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke();
    }
    for (let i = 0; i < H; i += 40) {
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke();
    }

    const items = els.slice();
    if (currentToolPath) items.push(currentToolPath);

    items.forEach((el) => {
      ctx.strokeStyle = '#334155';
      ctx.fillStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      if (el.type === 'pen') {
        if (!el.points || el.points.length === 0) return;
        ctx.beginPath();
        ctx.moveTo(el.points[0].x, el.points[0].y);
        el.points.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();

      } else if (el.type === 'box') {
        const bbox = getBBox(el);
        const { x, y, w, h } = bbox;

        // Rounded rectangle
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, BOX_RADIUS);
        ctx.fill();
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Text (centered, clipped)
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x + 4, y + 2, w - 8, h - 4, BOX_RADIUS - 2);
        ctx.clip();
        ctx.fillStyle = '#1e293b';
        ctx.font = FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(el.text || 'Box', x + w / 2, y + h / 2);
        ctx.restore();

      } else if (el.type === 'text') {
        ctx.fillStyle = '#1e293b';
        ctx.font = '16px Inter, system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';

        // Word-wrap long text
        const words = (el.text || 'Text').split(' ');
        const maxWidth = 260;
        let line = '';
        let lineY = el.y;
        for (const word of words) {
          const testLine = line ? `${line} ${word}` : word;
          if (ctx.measureText(testLine).width > maxWidth && line) {
            ctx.fillText(line, el.x, lineY);
            line = word;
            lineY += 22;
          } else {
            line = testLine;
          }
        }
        ctx.fillText(line, el.x, lineY);

      } else if (el.type === 'arrow') {
        let fromX, fromY, toX, toY;

        if (el.from !== undefined && el.to !== undefined) {
          // Index-based arrow (AI-generated): look up source & target
          const fromEl = items[el.from];
          const toEl = items[el.to];
          if (!fromEl || !toEl) return;

          if (fromEl.type === 'box' && toEl.type === 'box') {
            // Connect edge-to-edge
            const fromBB = getBBox(fromEl);
            const toBB = getBBox(toEl);
            const fromCX = fromBB.x + fromBB.w / 2;
            const fromCY = fromBB.y + fromBB.h / 2;
            const toCX = toBB.x + toBB.w / 2;
            const toCY = toBB.y + toBB.h / 2;

            const fp = clampedEdgePoint(fromBB, toCX, toCY);
            const tp = clampedEdgePoint(toBB, fromCX, fromCY);
            fromX = fp.x; fromY = fp.y;
            toX = tp.x; toY = tp.y;
          } else {
            // Fallback for non-box items
            fromX = (fromEl.x || 0) + (fromEl.type === 'box' ? getBBox(fromEl).w / 2 : 0);
            fromY = (fromEl.y || 0) + (fromEl.type === 'box' ? getBBox(fromEl).h / 2 : 0);
            toX = toEl.x || 0;
            toY = toEl.y || 0;
          }
        } else {
          // Manually drawn arrow
          fromX = el.startX; fromY = el.startY;
          toX = el.endX;     toY = el.endY;
        }

        // Shaft
        const dx = toX - fromX;
        const dy = toY - fromY;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 2) return; // skip degenerate arrows

        const angle = Math.atan2(dy, dx);
        const headlen = 12;

        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        // Arrowhead (filled triangle)
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 7), toY - headlen * Math.sin(angle - Math.PI / 7));
        ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 7), toY - headlen * Math.sin(angle + Math.PI / 7));
        ctx.closePath();
        ctx.fillStyle = '#334155';
        ctx.fill();

      } else if (el.type === 'rectangle') {
        const width = el.endX - el.startX;
        const height = el.endY - el.startY;
        ctx.strokeRect(el.startX, el.startY, width, height);
      }
    });

    // Pulsating dot while animating
    if (renderingIndex !== -1 && renderingIndex < animationQueue.length) {
      const next = animationQueue[renderingIndex];
      const ax = next.x ?? next.startX ?? 50;
      const ay = next.y ?? next.startY ?? 50;
      ctx.beginPath();
      ctx.arc(ax, ay, 7, 0, 2 * Math.PI);
      ctx.fillStyle = 'rgba(20, 184, 166, 0.6)';
      ctx.fill();
    }
    ctx.restore();
  }, [renderingIndex, animationQueue]);

  // Pointer events update refs immediately; this schedules at most one paint
  // per browser frame instead of re-rendering React for every sampled point.
  const scheduleDraw = useCallback(() => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const canvas = canvasRef.current;
      if (!canvas) return;
      drawElements(canvas.getContext('2d'), elementsRef.current, currentPathRef.current);
    });
  }, [drawElements]);

  const updateZoom = useCallback((nextZoom) => {
    const value = Math.max(0.5, Math.min(2.5, nextZoom));
    zoomRef.current = value;
    setZoom(value);
    scheduleDraw();
  }, [scheduleDraw]);

  // Canvas resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resizeObserver = new ResizeObserver(() => {
      const parent = canvas.parentElement;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(parent.clientWidth * dpr));
      canvas.height = Math.max(1, Math.floor(parent.clientHeight * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scheduleDraw();
    });

    resizeObserver.observe(canvas.parentElement);
    return () => resizeObserver.disconnect();
  }, [scheduleDraw]);

  // Redraw on state change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    scheduleDraw();
  }, [elements, renderingIndex, animationQueue, scheduleDraw]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  // ── Pointer handlers ─────────────────────────────────────────────────

  const getCoords = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - panRef.current.x) / zoomRef.current,
      y: (e.clientY - rect.top - panRef.current.y) / zoomRef.current
    };
  };

  const eraseAt = useCallback(({ x, y }) => {
    const current = elementsRef.current;
    let hitIndex = -1;
    for (let i = current.length - 1; i >= 0; i -= 1) {
      const item = current[i];
      if (item.type === 'pen') {
        if (item.points?.some(point => Math.hypot(point.x - x, point.y - y) <= 14)) {
          hitIndex = i;
          break;
        }
      } else if (item.type !== 'arrow') {
        const box = getBBox(item);
        if (x >= box.x - 8 && x <= box.x + box.w + 8 && y >= box.y - 8 && y <= box.y + box.h + 8) {
          hitIndex = i;
          break;
        }
      }
    }
    if (hitIndex === -1) return;
    const next = current
      .filter((_, index) => index !== hitIndex)
      .filter(item => !(item.type === 'arrow' && (item.from === hitIndex || item.to === hitIndex)))
      .map(item => item.type === 'arrow' ? {
        ...item,
        from: item.from > hitIndex ? item.from - 1 : item.from,
        to: item.to > hitIndex ? item.to - 1 : item.to
      } : item);
    setHistory(prev => [...prev, current]);
    updateElements(next);
  }, [updateElements]);

  const handlePointerDown = (e) => {
    if (renderingIndex !== -1) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const { x, y } = getCoords(e);
    toolRef.current = tool;
    isDrawingRef.current = true;
    if (tool === 'pan') {
      panStartRef.current = { clientX: e.clientX, clientY: e.clientY, ...panRef.current };
    } else if (tool === 'eraser') {
      eraseAt({ x, y });
      isDrawingRef.current = false;
    } else if (tool === 'pen') {
      currentPathRef.current = { type: 'pen', points: [{ x, y }] };
    } else if (tool === 'rectangle') {
      currentPathRef.current = { type: 'rectangle', startX: x, startY: y, endX: x, endY: y };
    } else if (tool === 'arrow') {
      currentPathRef.current = { type: 'arrow', startX: x, startY: y, endX: x, endY: y };
    } else if (tool === 'text') {
      const text = prompt("Enter text:");
      if (text) {
        const next = [...elementsRef.current, { type: 'text', text, x, y }];
        setHistory(prev => [...prev, elementsRef.current]);
        updateElements(next);
      }
      isDrawingRef.current = false;
      currentPathRef.current = null;
    } else if (tool === 'box') {
      const text = prompt("Enter box name:");
      if (text) {
        const next = [...elementsRef.current, { type: 'box', text, x, y }];
        setHistory(prev => [...prev, elementsRef.current]);
        updateElements(next);
      }
      isDrawingRef.current = false;
      currentPathRef.current = null;
    }
  };

  const handlePointerMove = (e) => {
    if (!isDrawingRef.current || !currentPathRef.current) return;
    if (toolRef.current === 'pan' && panStartRef.current) {
      panRef.current = {
        x: panStartRef.current.x + e.clientX - panStartRef.current.clientX,
        y: panStartRef.current.y + e.clientY - panStartRef.current.clientY
      };
      scheduleDraw();
      return;
    }
    const { x, y } = getCoords(e);
    if (toolRef.current === 'pen') {
      const points = currentPathRef.current.points;
      const last = points[points.length - 1];
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy >= 2.25) points.push({ x, y });
    } else if (toolRef.current === 'rectangle' || toolRef.current === 'arrow') {
      currentPathRef.current.endX = x;
      currentPathRef.current.endY = y;
    }
    scheduleDraw();
  };

  const handlePointerUp = () => {
    if (isDrawingRef.current && currentPathRef.current) {
      const next = [...elementsRef.current, currentPathRef.current];
      setHistory(prev => [...prev, elementsRef.current]);
      updateElements(next);
    }
    isDrawingRef.current = false;
    currentPathRef.current = null;
    panStartRef.current = null;
    scheduleDraw();
  };

  const undo = () => {
    if (history.length > 0) {
      const newHistory = [...history];
      const previous = newHistory.pop();
      setRedoStack(stack => [...stack, elementsRef.current]);
      elementsRef.current = previous;
      setElements(previous);
      pendingLocalKeyRef.current = JSON.stringify(previous);
      onChange?.({ elements: previous });
      setHistory(newHistory);
    }
  };

  const clear = () => {
    setHistory(prev => [...prev, elementsRef.current]);
    updateElements([]);
    lastAiRef.current = null; // allow same AI data to be re-drawn after clear
  };

  const exportCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const link = document.createElement("a");
    link.download = "AiTeacher-Whiteboard.png";
    link.href = dataUrl;
    link.click();
  };

  return (
    <div className="relative w-full h-full bg-[#f8fafc] overflow-hidden">
      <Toolbar
        currentTool={tool}
        setTool={setTool}
        onClear={clear}
        onUndo={undo}
        onRedo={() => {
          if (!redoStack.length) return;
          const next = redoStack[redoStack.length - 1];
          setRedoStack(stack => stack.slice(0, -1));
          setHistory(stack => [...stack, elementsRef.current]);
          elementsRef.current = next;
          setElements(next);
          pendingLocalKeyRef.current = JSON.stringify(next);
          onChange?.({ elements: next });
        }}
        zoom={zoom}
        onZoomIn={() => updateZoom(zoomRef.current + 0.1)}
        onZoomOut={() => updateZoom(zoomRef.current - 0.1)}
        onResetView={() => { panRef.current = { x: 0, y: 0 }; updateZoom(1); }}
      />

      {/* Export Button */}
      <button
        onClick={exportCanvas}
        className="absolute bottom-4 right-4 bg-white/90 backdrop-blur-sm border border-slate-200 text-slate-600 px-3 py-1.5 rounded-lg shadow-sm font-medium hover:text-brand-600 hover:scale-105 transition z-20 text-sm"
      >
        💾 Export PNG
      </button>

      {/* Animation Status Overlay */}
      {renderingIndex !== -1 && (
        <div className="absolute top-4 right-4 bg-brand-500 text-white text-xs font-semibold px-3 py-1.5 rounded-full shadow-md z-20 animate-pulse">
          AI is Drawing...
        </div>
      )}

      <canvas
        ref={canvasRef}
        className={`w-full h-full touch-none ${tool === 'pan' ? 'cursor-grab' : tool === 'eraser' ? 'cursor-cell' : 'cursor-crosshair'}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
    </div>
  );
}
