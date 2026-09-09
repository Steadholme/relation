const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MIN_SCALE = 0.16;
const MAX_SCALE = 4.5;
const PARTICLE_ANIMATION_DURATION_MS = 2_400;

const PALETTE = [
  "#ff5c9a",
  "#ff7a6f",
  "#b66cff",
  "#5eead4",
  "#65a9ff",
  "#f7c65c",
  "#ff87d7",
  "#8b9dff",
];

const RELATION_STYLES = {
  partner: { distance: 132, strength: 0.058, width: 2.6, dash: [] },
  dated: { distance: 188, strength: 0.028, width: 2.1, dash: [10, 7] },
  affection: { distance: 158, strength: 0.038, width: 2.2, dash: [1.8, 6.5] },
  default: { distance: 166, strength: 0.034, width: 2, dash: [6, 5] },
};

const RELATION_LABELS = Object.freeze({
  partner: "现任",
  dated: "前任",
  affection: "好感",
  default: "关系",
});

const ATLAS_PALETTES = Object.freeze({
  dark: Object.freeze({
    background: "#0b100e",
    grid: "rgba(232, 226, 209, 0.030)",
    gridStrong: "rgba(232, 226, 209, 0.070)",
    ink: "#f0eadc",
    label: "#111714",
    muted: "#a59f91",
    panel: "#151b18",
    rule: "#596057",
    partner: "#e87352",
    dated: "#67bfb4",
    affection: "#d7ad62",
  }),
  light: Object.freeze({
    background: "#e9e4d8",
    grid: "rgba(34, 39, 34, 0.09)",
    gridStrong: "rgba(34, 39, 34, 0.2)",
    ink: "#1c211d",
    label: "#f5f0e5",
    muted: "#62685f",
    panel: "#f7f2e7",
    rule: "#777c72",
    partner: "#a9412c",
    dated: "#1f726b",
    affection: "#865c12",
  }),
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function hashString(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hashUnit(value, salt = 0) {
  let hash = hashString(`${value}:${salt}`);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967295;
}

function safeColor(value, fallback) {
  if (typeof value !== "string") return fallback;
  const color = value.trim();
  if (/^#[\da-f]{3,8}$/i.test(color)) return color;
  if (/^(?:rgb|hsl)a?\([\d.%+\-,\s]+\)$/i.test(color)) return color;
  return fallback;
}

function personName(person, id) {
  const value = person?.displayName ?? person?.name ?? id;
  const name = String(value ?? "").trim();
  return name || id;
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/u).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join("").toUpperCase();
  return `${Array.from(parts[0])[0] ?? ""}${Array.from(parts.at(-1))[0] ?? ""}`.toUpperCase();
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function pointOnQuadratic(geometry, t) {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * geometry.start.x
      + 2 * inverse * t * geometry.control.x
      + t * t * geometry.end.x,
    y: inverse * inverse * geometry.start.y
      + 2 * inverse * t * geometry.control.y
      + t * t * geometry.end.y,
  };
}

function tangentOnQuadratic(geometry, t) {
  return {
    x: 2 * (1 - t) * (geometry.control.x - geometry.start.x)
      + 2 * t * (geometry.end.x - geometry.control.x),
    y: 2 * (1 - t) * (geometry.control.y - geometry.start.y)
      + 2 * t * (geometry.end.y - geometry.control.y),
  };
}

function quadraticDistanceSquared(point, geometry) {
  let previous = geometry.start;
  let minimum = Number.POSITIVE_INFINITY;
  const segments = 18;

  for (let index = 1; index <= segments; index += 1) {
    const current = pointOnQuadratic(geometry, index / segments);
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const lengthSquared = dx * dx + dy * dy;
    let t = lengthSquared > 0
      ? ((point.x - previous.x) * dx + (point.y - previous.y) * dy) / lengthSquared
      : 0;
    t = clamp(t, 0, 1);
    const closestX = previous.x + dx * t;
    const closestY = previous.y + dy * t;
    const distanceX = point.x - closestX;
    const distanceY = point.y - closestY;
    minimum = Math.min(minimum, distanceX * distanceX + distanceY * distanceY);
    previous = current;
  }

  return minimum;
}

function traceQuadratic(context, geometry) {
  context.beginPath();
  context.moveTo(geometry.start.x, geometry.start.y);
  context.quadraticCurveTo(
    geometry.control.x,
    geometry.control.y,
    geometry.end.x,
    geometry.end.y,
  );
}

function isDirected(relationship) {
  if (relationship.direction === true) return true;
  const direction = String(relationship.direction ?? "").toLowerCase();
  return direction === "directed"
    || direction === "one-way"
    || direction === "oneway"
    || direction === "forward"
    || direction === "source-to-target";
}

function endpointId(edge, side) {
  const direct = edge?.[`${side}Id`];
  if (direct != null) return String(direct);
  const endpoint = edge?.[side];
  if (endpoint?.id != null) return String(endpoint.id);
  if (typeof endpoint === "string" || typeof endpoint === "number") return String(endpoint);
  return "";
}

/**
 * 返回稳定排序的无向连通分量。布局只关心人物之间是否相连，关系方向不影响分群。
 */
export function connectedComponents(nodes = [], edges = []) {
  const ids = [];
  const adjacency = new Map();
  for (const node of Array.isArray(nodes) ? nodes : []) {
    const id = node?.id == null ? "" : String(node.id);
    if (!id || adjacency.has(id)) continue;
    ids.push(id);
    adjacency.set(id, new Set());
  }

  for (const edge of Array.isArray(edges) ? edges : []) {
    const sourceId = endpointId(edge, "source");
    const targetId = endpointId(edge, "target");
    if (!sourceId || !targetId || sourceId === targetId) continue;
    if (!adjacency.has(sourceId) || !adjacency.has(targetId)) continue;
    adjacency.get(sourceId).add(targetId);
    adjacency.get(targetId).add(sourceId);
  }

  ids.sort((a, b) => a.localeCompare(b));
  const seen = new Set();
  const components = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const queue = [id];
    const component = [];
    seen.add(id);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor];
      component.push(current);
      const neighbors = [...(adjacency.get(current) ?? [])]
        .sort((a, b) => a.localeCompare(b));
      for (const neighbor of neighbors) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
    component.sort((a, b) => a.localeCompare(b));
    components.push(component);
  }

  components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));
  return components;
}

/**
 * 在最大分量周围以径向网格安放其余分量，并保证估算包围圆互不相交。
 */
/*
 * Packing defaults. The previous pair (98 / 128) flung the fifteen small
 * components far out around the one large cluster, so the plate's bounding box
 * was enormous: the fit landed on the zoom floor (16%) and the chart read as a
 * dense knot adrift in empty sky. A star chart should fill its plate with
 * legible stars, so the components pack closer and the fit can zoom in.
 */
export function radialComponentCenters(
  components = [],
  { nodeSpacing = 74, gap = 58 } = {},
) {
  const normalized = components
    .filter((component) => Array.isArray(component) && component.length)
    .map((ids) => ({
      ids: [...ids],
      radius: Math.max(54, nodeSpacing * Math.sqrt(Math.max(0, ids.length - 1)) + 58),
    }));
  if (!normalized.length) return [];

  const placed = [];
  normalized.forEach((component, index) => {
    if (index === 0) {
      placed.push({ ...component, x: 0, y: 0 });
      return;
    }

    const largestRadius = placed[0].radius;
    let destination = null;
    for (let ring = 0; ring < 80 && !destination; ring += 1) {
      const ringRadius = largestRadius
        + component.radius
        + gap
        + ring * (component.radius * 1.35 + gap * 0.72);
      const circumference = TAU * ringRadius;
      const slots = Math.max(
        8,
        Math.ceil(circumference / Math.max(96, component.radius * 2 + gap)),
      );
      const offset = hashUnit(component.ids[0], 83) * TAU;
      for (let slot = 0; slot < slots; slot += 1) {
        const angle = offset + (slot / slots) * TAU;
        const candidate = {
          x: Math.cos(angle) * ringRadius,
          y: Math.sin(angle) * ringRadius * 0.86,
        };
        const clear = placed.every((other) => {
          const distance = Math.hypot(candidate.x - other.x, candidate.y - other.y);
          return distance >= component.radius + other.radius + gap;
        });
        if (clear) {
          destination = candidate;
          break;
        }
      }
    }

    placed.push({
      ...component,
      x: destination?.x ?? (largestRadius + component.radius + gap) * index,
      y: destination?.y ?? 0,
    });
  });
  return placed;
}

export class HeartGraph {
  constructor(canvas, { onSelect, onHover, onViewChange } = {}) {
    if (!canvas || typeof canvas.getContext !== "function") {
      throw new TypeError("HeartGraph requires a canvas element");
    }

    const context = canvas.getContext("2d", { alpha: true, desynchronized: true });
    if (!context) throw new Error("HeartGraph could not create a 2D context");

    this.canvas = canvas;
    this.context = context;
    this.document = canvas.ownerDocument ?? globalThis.document ?? null;
    this.window = this.document?.defaultView ?? globalThis;
    this.onSelect = typeof onSelect === "function" ? onSelect : null;
    this.onHover = typeof onHover === "function" ? onHover : null;
    this.onViewChange = typeof onViewChange === "function" ? onViewChange : null;

    this.nodes = [];
    this.nodeById = new Map();
    this.edges = [];
    this.edgeById = new Map();
    this.adjacency = new Map();
    this.selection = null;
    this.pathRelationshipIds = new Set();
    this.pathNodeIds = new Set();
    this.hover = null;

    this.layoutMode = "constellation";
    this.layoutFocusId = null;
    this.alpha = 0;
    this.physicsActive = false;
    this.stableFrames = 0;
    this.motionReduced = false;
    this.theme = "dark";
    this.particleAnimationUntil = 0;

    this.width = 1;
    this.height = 1;
    this.fitPending = false;
    this.dpr = 1;
    this.view = { x: 0.5, y: 0.5, scale: 1 };
    this.viewInitialized = false;
    this.cameraAnimation = null;

    this.pointer = null;
    this.raf = 0;
    this.lastTick = 0;
    this.needsDraw = true;
    this.destroyed = false;
    this.hidden = Boolean(this.document?.hidden);

    const navigator = this.window.navigator ?? {};
    this.lowPower = Boolean(
      navigator.connection?.saveData
      || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
      || (navigator.deviceMemory && navigator.deviceMemory <= 4),
    );

    this.requestFrame = typeof this.window.requestAnimationFrame === "function"
      ? this.window.requestAnimationFrame.bind(this.window)
      : (callback) => this.window.setTimeout(() => callback(this.now()), 16);
    this.cancelFrame = typeof this.window.cancelAnimationFrame === "function"
      ? this.window.cancelAnimationFrame.bind(this.window)
      : this.window.clearTimeout.bind(this.window);

    this.boundTick = (timestamp) => this.tick(timestamp);
    this.boundResize = () => this.resize();
    this.boundVisibility = () => this.handleVisibility();
    this.boundPointerDown = (event) => this.handlePointerDown(event);
    this.boundPointerMove = (event) => this.handlePointerMove(event);
    this.boundPointerUp = (event) => this.handlePointerUp(event, false);
    this.boundPointerCancel = (event) => this.handlePointerUp(event, true);
    this.boundPointerLeave = () => this.handlePointerLeave();
    this.boundWheel = (event) => this.handleWheel(event);
    this.boundDoubleClick = (event) => this.handleDoubleClick(event);

    canvas.addEventListener("pointerdown", this.boundPointerDown);
    canvas.addEventListener("pointermove", this.boundPointerMove);
    canvas.addEventListener("pointerup", this.boundPointerUp);
    canvas.addEventListener("pointercancel", this.boundPointerCancel);
    canvas.addEventListener("pointerleave", this.boundPointerLeave);
    canvas.addEventListener("wheel", this.boundWheel, { passive: false });
    canvas.addEventListener("dblclick", this.boundDoubleClick);
    this.document?.addEventListener("visibilitychange", this.boundVisibility);

    if (typeof this.window.ResizeObserver === "function") {
      this.resizeObserver = new this.window.ResizeObserver(this.boundResize);
      this.resizeObserver.observe(canvas);
    } else {
      this.resizeObserver = null;
      this.window.addEventListener?.("resize", this.boundResize);
    }

    this.resize();
  }

  now() {
    return this.window.performance?.now?.() ?? Date.now();
  }

  palette() {
    return ATLAS_PALETTES[this.theme] ?? ATLAS_PALETTES.dark;
  }

  relationColor(kind) {
    const palette = this.palette();
    return palette[kind] ?? palette.rule;
  }

  emitView() {
    this.onViewChange?.({ ...this.view });
  }

  setGraph({ people = [], relationships = [] } = {}) {
    if (this.destroyed) return;

    const previousNodes = this.nodeById;
    const nextNodes = [];
    const nextNodeById = new Map();
    const personList = Array.isArray(people) ? people : [];

    personList.forEach((person, index) => {
      if (!person || person.id == null) return;
      const id = String(person.id).trim();
      if (!id || nextNodeById.has(id)) return;

      const fallback = PALETTE[hashString(id) % PALETTE.length];
      const oldNode = previousNodes.get(id);
      const node = {
        id,
        data: person,
        name: personName(person, id),
        accent: safeColor(person.accent ?? person.color, fallback),
        emoji: typeof person.emoji === "string" ? person.emoji.trim() : "",
        x: oldNode?.x ?? 0,
        y: oldNode?.y ?? 0,
        vx: oldNode?.vx ?? 0,
        vy: oldNode?.vy ?? 0,
        targetX: 0,
        targetY: 0,
        radius: 23,
        degree: 0,
        index,
        isNew: !oldNode,
        dragging: false,
      };
      nextNodes.push(node);
      nextNodeById.set(id, node);
    });

    const nextEdges = [];
    const nextEdgeById = new Map();
    const relationList = Array.isArray(relationships) ? relationships : [];

    relationList.forEach((relationship, index) => {
      if (!relationship || relationship.id == null) return;
      const id = String(relationship.id).trim();
      const sourceId = String(relationship.sourceId ?? "").trim();
      const targetId = String(relationship.targetId ?? "").trim();
      const source = nextNodeById.get(sourceId);
      const target = nextNodeById.get(targetId);
      if (!id || nextEdgeById.has(id) || !source || !target || source === target) return;

      const kind = String(relationship.kind ?? "default").toLowerCase();
      const edge = {
        id,
        data: relationship,
        source,
        target,
        kind,
        intensity: clamp(Math.round(finiteNumber(relationship.intensity, 3)), 1, 5),
        directed: isDirected(relationship),
        curve: 0,
        index,
      };
      nextEdges.push(edge);
      nextEdgeById.set(id, edge);
      source.degree += 1;
      target.degree += 1;
    });

    nextNodes.forEach((node) => {
      node.radius = clamp(22 + Math.sqrt(node.degree) * 2.1, 22, 30);
    });

    this.nodes = nextNodes;
    this.nodeById = nextNodeById;
    this.edges = nextEdges;
    this.edgeById = nextEdgeById;
    this.selection = this.normalizeSelection(this.selection);
    this.rebuildTopology();
    this.computeLayoutTargets();

    this.nodes.forEach((node) => {
      if (!node.isNew) return;
      const angle = hashUnit(node.id, 7) * TAU;
      const jitter = 8 + hashUnit(node.id, 8) * 18;
      node.x = node.targetX + Math.cos(angle) * jitter;
      node.y = node.targetY + Math.sin(angle) * jitter;
      node.vx = 0;
      node.vy = 0;
      node.isNew = false;
    });

    this.setPathRelationshipIds(this.pathRelationshipIds);

    if (!this.nodes.length) {
      this.alpha = 0;
      this.physicsActive = false;
      this.stableFrames = 0;
      this.requestDraw();
      return;
    }

    if (previousNodes.size === 0) this.fit();
    this.wakePhysics(0.95);
  }

  setSelection(selection, pathRelationshipIds = []) {
    if (this.destroyed) return;
    this.selection = this.normalizeSelection(selection);
    this.setPathRelationshipIds(pathRelationshipIds);
    this.computeLayoutTargets();
    this.particleAnimationUntil = this.selection && !this.motionReduced
      ? this.now() + PARTICLE_ANIMATION_DURATION_MS
      : 0;
    this.wakePhysics(this.motionReduced ? 0.72 : 0.58);
  }

  setLayout(mode, focusId = null) {
    if (this.destroyed) return;
    const nextMode = ["constellation", "heart", "orbit"].includes(mode)
      ? mode
      : "constellation";
    this.layoutMode = nextMode;
    this.layoutFocusId = focusId != null && this.nodeById.has(String(focusId))
      ? String(focusId)
      : null;
    this.computeLayoutTargets();
    this.wakePhysics(this.motionReduced ? 0.72 : 1);
  }

  setMotionReduced(value) {
    if (this.destroyed) return;
    const next = Boolean(value);
    if (next === this.motionReduced) return;
    this.motionReduced = next;
    this.cameraAnimation = null;
    this.particleAnimationUntil = next || !this.selection
      ? 0
      : this.now() + PARTICLE_ANIMATION_DURATION_MS;

    if (next) {
      this.settleReducedMotion();
    } else {
      this.wakePhysics(0.42);
    }
  }

  setTheme(theme) {
    if (this.destroyed) return;
    const next = theme === "light" ? "light" : "dark";
    if (next === this.theme) {
      this.requestDraw();
      return;
    }
    this.theme = next;
    this.requestDraw();
  }

  focusPerson(id) {
    if (this.destroyed) return false;
    const node = this.nodeById.get(String(id));
    if (!node) return false;

    const nextScale = clamp(Math.max(this.view.scale, 1.35), MIN_SCALE, 2.4);
    const destination = {
      x: this.width / 2 - node.x * nextScale,
      y: this.height / 2 - node.y * nextScale,
      scale: nextScale,
    };

    if (this.motionReduced) {
      this.view = destination;
      this.cameraAnimation = null;
      this.emitView();
    } else {
      this.cameraAnimation = {
        from: { ...this.view },
        to: destination,
        start: this.now(),
        duration: 430,
      };
    }
    this.requestDraw();
    return true;
  }

  fit() {
    if (this.destroyed) return;
    this.cameraAnimation = null;

    // The canvas starts at 1x1 and is measured by the ResizeObserver a frame
    // later, so a fit requested during boot divided the world extent by one
    // pixel and clamped to MIN_SCALE. That floored view was then never
    // recomputed, which is why the chart always opened as a tiny knot at 16%.
    // Defer instead, and let the first real measurement run it.
    if (this.width <= 1 || this.height <= 1) {
      this.fitPending = true;
      return;
    }
    this.fitPending = false;

    if (!this.nodes.length) {
      this.view = { x: this.width / 2, y: this.height / 2, scale: 1 };
      this.emitView();
      this.requestDraw();
      return;
    }

    // Frame the field of interest, not the extremes. Fitting to absolute
    // min/max let a couple of far-flung two-person components dictate the
    // frame: the fit bottomed out on the zoom floor and the plate showed a
    // dense unreadable knot adrift in empty sky. A survey plate frames where
    // the exposure actually is, so the bounds come from a robust percentile
    // and the few stragglers are simply allowed to sit off-plate — the viewer
    // can still pan or zoom out to them.
    const xs = [];
    const ys = [];
    let widestMargin = 0;
    this.nodes.forEach((node) => {
      xs.push(node.x);
      ys.push(node.y);
      widestMargin = Math.max(widestMargin, node.radius + 36);
    });
    xs.sort((a, b) => a - b);
    ys.sort((a, b) => a - b);
    // With few nodes every one of them is the field, so keep true extremes.
    const trim = xs.length >= 24 ? 0.04 : 0;
    const lo = (values) => values[Math.floor((values.length - 1) * trim)];
    const hi = (values) => values[Math.ceil((values.length - 1) * (1 - trim))];
    const minX = lo(xs) - widestMargin;
    const maxX = hi(xs) + widestMargin;
    const minY = lo(ys) - widestMargin;
    const maxY = hi(ys) + widestMargin;

    const padding = clamp(Math.min(this.width, this.height) * 0.1, 28, 84);
    const availableWidth = Math.max(1, this.width - padding * 2);
    const availableHeight = Math.max(1, this.height - padding * 2);
    const boundsWidth = Math.max(70, maxX - minX);
    const boundsHeight = Math.max(70, maxY - minY);
    const scale = clamp(
      Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight),
      MIN_SCALE,
      this.nodes.length === 1 ? 1.65 : 2.2,
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    this.view = {
      x: this.width / 2 - centerX * scale,
      y: this.height / 2 - centerY * scale,
      scale,
    };
    this.emitView();
    this.requestDraw();
  }

  zoomBy(factor) {
    if (this.destroyed) return;
    const zoom = finiteNumber(factor, 1);
    if (zoom <= 0) return;
    this.zoomAt(zoom, this.width / 2, this.height / 2);
  }

  exportPng() {
    if (this.destroyed) return "";
    this.draw(this.now());
    return this.canvas.toDataURL("image/png");
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.raf) {
      this.cancelFrame(this.raf);
      this.raf = 0;
    }
    this.resizeObserver?.disconnect();
    if (!this.resizeObserver) this.window.removeEventListener?.("resize", this.boundResize);

    this.canvas.removeEventListener("pointerdown", this.boundPointerDown);
    this.canvas.removeEventListener("pointermove", this.boundPointerMove);
    this.canvas.removeEventListener("pointerup", this.boundPointerUp);
    this.canvas.removeEventListener("pointercancel", this.boundPointerCancel);
    this.canvas.removeEventListener("pointerleave", this.boundPointerLeave);
    this.canvas.removeEventListener("wheel", this.boundWheel);
    this.canvas.removeEventListener("dblclick", this.boundDoubleClick);
    this.document?.removeEventListener("visibilitychange", this.boundVisibility);
    this.canvas.classList.remove("is-dragging", "is-hovering");

    this.pointer = null;
    this.cameraAnimation = null;
    this.onSelect = null;
    this.onHover = null;
  }

  rebuildTopology() {
    this.adjacency = new Map(this.nodes.map((node) => [node.id, []]));
    const groups = new Map();

    this.edges.forEach((edge) => {
      this.adjacency.get(edge.source.id)?.push(edge);
      this.adjacency.get(edge.target.id)?.push(edge);
      const pair = [edge.source.id, edge.target.id].sort().join("\u0000");
      if (!groups.has(pair)) groups.set(pair, []);
      groups.get(pair).push(edge);
    });

    groups.forEach((group) => {
      group.sort((a, b) => a.id.localeCompare(b.id));
      if (group.length === 1) {
        const edge = group[0];
        const sign = hashUnit(edge.id, 13) > 0.5 ? 1 : -1;
        edge.curve = sign * (9 + hashUnit(edge.id, 14) * 7);
        return;
      }
      const middle = (group.length - 1) / 2;
      group.forEach((edge, index) => {
        edge.curve = clamp((index - middle) * 27, -72, 72);
      });
    });
  }

  computeLayoutTargets() {
    if (!this.nodes.length) return;
    const focus = this.layoutFocusId
      ? this.nodeById.get(this.layoutFocusId)
      : null;
    const ordered = [...this.nodes].sort((a, b) => {
      const hashDifference = hashString(a.id) - hashString(b.id);
      return hashDifference || a.id.localeCompare(b.id);
    });

    if (this.layoutMode === "heart") {
      const outline = focus ? ordered.filter((node) => node !== focus) : ordered;
      const laneCount = clamp(Math.ceil(outline.length / 40), 1, 4);
      outline.forEach((node, index) => {
        const lane = index % laneCount;
        const laneIndex = Math.floor(index / laneCount);
        const laneSize = Math.ceil((outline.length - lane) / laneCount);
        const t = ((laneIndex + 0.5) / Math.max(1, laneSize)) * TAU
          + lane * 0.035;
        const scale = 25 + lane * 10.5 + Math.sqrt(outline.length) * 0.16;
        const x = 16 * Math.sin(t) ** 3;
        const y = 13 * Math.cos(t)
          - 5 * Math.cos(2 * t)
          - 2 * Math.cos(3 * t)
          - Math.cos(4 * t);
        node.targetX = x * scale;
        node.targetY = -y * scale + scale * 1.5;
      });
      if (focus) {
        focus.targetX = 0;
        focus.targetY = 36;
      }
      this.applySelectionExpansion();
      return;
    }

    if (this.layoutMode === "orbit") {
      const center = focus ?? [...this.nodes].sort((a, b) => b.degree - a.degree)[0];
      const distance = new Map([[center.id, 0]]);
      const queue = [center];

      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const node = queue[cursor];
        const depth = distance.get(node.id) ?? 0;
        for (const edge of this.adjacency.get(node.id) ?? []) {
          const neighbor = edge.source === node ? edge.target : edge.source;
          if (distance.has(neighbor.id)) continue;
          distance.set(neighbor.id, depth + 1);
          queue.push(neighbor);
        }
      }

      const maximumDepth = Math.max(0, ...distance.values());
      const rings = new Map();
      this.nodes.forEach((node) => {
        const depth = distance.get(node.id) ?? maximumDepth + 1;
        if (!rings.has(depth)) rings.set(depth, []);
        rings.get(depth).push(node);
      });

      rings.forEach((ring, depth) => {
        ring.sort((a, b) => hashString(a.id) - hashString(b.id));
        if (depth === 0) {
          ring[0].targetX = 0;
          ring[0].targetY = 0;
          return;
        }
        const radius = 112 + depth * 105 + Math.max(0, ring.length - 6) * 7;
        const offset = hashUnit(center.id, depth) * TAU;
        ring.forEach((node, index) => {
          const angle = offset + (index / ring.length) * TAU;
          node.targetX = Math.cos(angle) * radius;
          node.targetY = Math.sin(angle) * radius;
        });
      });
      this.applySelectionExpansion();
      return;
    }

    let components = connectedComponents(this.nodes, this.edges);
    if (focus) {
      components = [...components].sort((a, b) => {
        const aFocused = a.includes(focus.id) ? 1 : 0;
        const bFocused = b.includes(focus.id) ? 1 : 0;
        return bFocused - aFocused || b.length - a.length || a[0].localeCompare(b[0]);
      });
    }

    radialComponentCenters(components).forEach((placement) => {
      const componentIds = new Set(placement.ids);
      const componentNodes = placement.ids
        .map((id) => this.nodeById.get(id))
        .filter(Boolean);
      const root = focus && componentIds.has(focus.id)
        ? focus
        : [...componentNodes].sort((a, b) =>
          b.degree - a.degree || hashString(a.id) - hashString(b.id))[0];
      const traversal = [];
      const seen = new Set(root ? [root.id] : []);
      const queue = root ? [root] : [];
      for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const node = queue[cursor];
        traversal.push(node);
        const neighbors = (this.adjacency.get(node.id) ?? [])
          .map((edge) => edge.source === node ? edge.target : edge.source)
          .filter((neighbor) => componentIds.has(neighbor.id) && !seen.has(neighbor.id))
          .sort((a, b) => b.degree - a.degree || hashString(a.id) - hashString(b.id));
        for (const neighbor of neighbors) {
          if (seen.has(neighbor.id)) continue;
          seen.add(neighbor.id);
          queue.push(neighbor);
        }
      }
      componentNodes
        .filter((node) => !seen.has(node.id))
        .sort((a, b) => b.degree - a.degree || hashString(a.id) - hashString(b.id))
        .forEach((node) => traversal.push(node));

      traversal.forEach((node, index) => {
        const radius = index === 0 ? 0 : 98 * Math.sqrt(index);
        const angle = index * GOLDEN_ANGLE + hashUnit(node.id, 21) * 0.34;
        node.targetX = placement.x + Math.cos(angle) * radius;
        node.targetY = placement.y + Math.sin(angle) * radius * 0.86;
      });
    });
    this.applySelectionExpansion();
  }

  applySelectionExpansion() {
    if (this.selection?.type !== "person") return;
    const selected = this.nodeById.get(this.selection.id);
    if (!selected) return;

    const neighborById = new Map();
    for (const edge of this.adjacency.get(selected.id) ?? []) {
      const neighbor = edge.source === selected ? edge.target : edge.source;
      neighborById.set(neighbor.id, neighbor);
    }
    const neighbors = [...neighborById.values()]
      .sort((a, b) => b.degree - a.degree || hashString(a.id) - hashString(b.id));
    if (!neighbors.length) return;

    const centerX = selected.targetX;
    const centerY = selected.targetY;
    const perRing = 10;
    const angleOffset = hashUnit(selected.id, 97) * TAU;
    let outerRadius = 0;
    neighbors.forEach((neighbor, index) => {
      const ring = Math.floor(index / perRing);
      const ringStart = ring * perRing;
      const ringSize = Math.min(perRing, neighbors.length - ringStart);
      const radius = 205 + ring * 112 + Math.max(0, ringSize - 5) * 8;
      const angle = angleOffset + ((index - ringStart) / ringSize) * TAU;
      neighbor.targetX = centerX + Math.cos(angle) * radius;
      neighbor.targetY = centerY + Math.sin(angle) * radius;
      outerRadius = Math.max(outerRadius, radius);
    });

    const protectedRadius = outerRadius + 76;
    const neighborIds = new Set(neighbors.map(({ id }) => id));
    this.nodes.forEach((node) => {
      if (node === selected || neighborIds.has(node.id)) return;
      let dx = node.targetX - centerX;
      let dy = node.targetY - centerY;
      let distance = Math.hypot(dx, dy);
      if (distance >= protectedRadius) return;
      if (distance < 0.001) {
        const angle = hashUnit(node.id, 99) * TAU;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 1;
      }
      const destination = protectedRadius + hashUnit(node.id, 100) * 58;
      node.targetX = centerX + (dx / distance) * destination;
      node.targetY = centerY + (dy / distance) * destination;
    });
  }

  normalizeSelection(selection) {
    if (selection == null) return null;

    if (typeof selection === "string" || typeof selection === "number") {
      const id = String(selection);
      if (this.nodeById.has(id)) return { type: "person", id };
      if (this.edgeById.has(id)) return { type: "relationship", id };
      return null;
    }

    if (typeof selection !== "object") return null;
    const rawType = String(selection.type ?? selection.kind ?? "").toLowerCase();
    const explicitPersonId = selection.personId ?? selection.person?.id;
    const explicitRelationshipId = selection.relationshipId ?? selection.relationship?.id;

    if (explicitPersonId != null) {
      const id = String(explicitPersonId);
      return this.nodeById.has(id) ? { type: "person", id } : null;
    }
    if (explicitRelationshipId != null) {
      const id = String(explicitRelationshipId);
      return this.edgeById.has(id) ? { type: "relationship", id } : null;
    }

    const id = selection.id == null ? "" : String(selection.id);
    if ((rawType === "person" || rawType === "node") && this.nodeById.has(id)) {
      return { type: "person", id };
    }
    if ((rawType === "relationship" || rawType === "relation" || rawType === "edge")
      && this.edgeById.has(id)) {
      return { type: "relationship", id };
    }
    if (this.nodeById.has(id)) return { type: "person", id };
    if (this.edgeById.has(id)) return { type: "relationship", id };
    return null;
  }

  setPathRelationshipIds(ids) {
    const values = ids instanceof Set ? [...ids] : Array.isArray(ids) ? ids : [];
    this.pathRelationshipIds = new Set(
      values.map(String).filter((id) => this.edgeById.has(id)),
    );
    this.pathNodeIds = new Set();
    this.pathRelationshipIds.forEach((id) => {
      const edge = this.edgeById.get(id);
      if (!edge) return;
      this.pathNodeIds.add(edge.source.id);
      this.pathNodeIds.add(edge.target.id);
    });
  }

  wakePhysics(alpha = 0.8) {
    if (!this.nodes.length) {
      this.physicsActive = false;
      this.requestDraw();
      return;
    }
    this.alpha = Math.max(this.alpha, clamp(alpha, 0, 1));
    this.physicsActive = true;
    this.stableFrames = 0;
    if (this.motionReduced) {
      this.settleReducedMotion();
    } else {
      this.requestDraw();
    }
  }

  settleReducedMotion() {
    if (!this.nodes.length) {
      this.physicsActive = false;
      this.alpha = 0;
      this.requestDraw();
      return;
    }

    this.alpha = Math.max(this.alpha, 0.72);
    for (let index = 0; index < 38; index += 1) this.stepPhysics(1.15, true);
    this.nodes.forEach((node) => {
      node.vx = 0;
      node.vy = 0;
    });
    this.alpha = 0;
    this.physicsActive = false;
    this.stableFrames = 0;
    this.requestDraw();
  }

  stepPhysics(dt, settling = false) {
    if (!this.nodes.length) {
      this.physicsActive = false;
      return;
    }

    const alpha = this.alpha;
    const targetStrength = this.layoutMode === "constellation" ? 0.032 : 0.05;
    const largeGraph = this.nodes.length >= 64;
    const springMultiplier = largeGraph ? 0.22 : 1;

    this.nodes.forEach((node) => {
      if (node.dragging) return;
      node.vx += (node.targetX - node.x) * targetStrength * alpha * dt;
      node.vy += (node.targetY - node.y) * targetStrength * alpha * dt;
    });

    this.edges.forEach((edge) => {
      const style = RELATION_STYLES[edge.kind] ?? RELATION_STYLES.default;
      const dx = edge.target.x - edge.source.x;
      const dy = edge.target.y - edge.source.y;
      const distance = Math.max(0.001, Math.hypot(dx, dy));
      const adjacentToSelection = this.selection?.type === "person"
        && (edge.source.id === this.selection.id || edge.target.id === this.selection.id);
      const restLength = adjacentToSelection
        ? Math.max(205, style.distance)
        : (style.distance - (edge.intensity - 3) * 7) * (largeGraph ? 1.16 : 1);
      const strength = style.strength
        * (0.72 + edge.intensity * 0.11)
        * (adjacentToSelection ? 0.48 : springMultiplier)
        * alpha
        * dt;
      const force = (distance - restLength) * strength;
      const forceX = (dx / distance) * force;
      const forceY = (dy / distance) * force;

      if (!edge.source.dragging) {
        edge.source.vx += forceX;
        edge.source.vy += forceY;
      }
      if (!edge.target.dragging) {
        edge.target.vx -= forceX;
        edge.target.vy -= forceY;
      }
    });

    const cellSize = largeGraph ? 238 : 190;
    const grid = new Map();
    this.nodes.forEach((node, index) => {
      const cellX = Math.floor(node.x / cellSize);
      const cellY = Math.floor(node.y / cellSize);
      const key = `${cellX},${cellY}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(index);
    });

    this.nodes.forEach((first, firstIndex) => {
      const cellX = Math.floor(first.x / cellSize);
      const cellY = Math.floor(first.y / cellSize);
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const bucket = grid.get(`${cellX + offsetX},${cellY + offsetY}`) ?? [];
          for (const secondIndex of bucket) {
            if (secondIndex <= firstIndex) continue;
            const second = this.nodes[secondIndex];
            let dx = second.x - first.x;
            let dy = second.y - first.y;
            let distanceSquared = dx * dx + dy * dy;

            if (distanceSquared < 0.01) {
              const angle = hashUnit(`${first.id}:${second.id}`, 31) * TAU;
              dx = Math.cos(angle) * 0.1;
              dy = Math.sin(angle) * 0.1;
              distanceSquared = 0.01;
            }
            if (distanceSquared > cellSize * cellSize) continue;

            const distance = Math.sqrt(distanceSquared);
            const collisionDistance = first.radius + second.radius + (largeGraph ? 38 : 24);
            const repulsion = ((largeGraph ? 1_650 : 840) / (distanceSquared + 80)) * alpha * dt;
            const collision = distance < collisionDistance
              ? (collisionDistance - distance) * (largeGraph ? 0.13 : 0.085) * dt
              : 0;
            const force = repulsion + collision;
            const forceX = (dx / distance) * force;
            const forceY = (dy / distance) * force;

            if (!first.dragging) {
              first.vx -= forceX;
              first.vy -= forceY;
            }
            if (!second.dragging) {
              second.vx += forceX;
              second.vy += forceY;
            }
          }
        }
      }
    });

    const damping = Math.pow(settling ? 0.72 : 0.82, dt);
    let maximumSpeed = 0;
    this.nodes.forEach((node) => {
      if (node.dragging) {
        node.vx = 0;
        node.vy = 0;
        return;
      }
      node.vx = clamp(node.vx * damping, -18, 18);
      node.vy = clamp(node.vy * damping, -18, 18);
      node.x += node.vx * dt;
      node.y += node.vy * dt;
      if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        node.x = node.targetX;
        node.y = node.targetY;
        node.vx = 0;
        node.vy = 0;
      }
      maximumSpeed = Math.max(maximumSpeed, Math.hypot(node.vx, node.vy));
    });

    this.alpha *= Math.pow(settling ? 0.9 : 0.966, dt);
    if (this.pointer?.node) this.alpha = Math.max(this.alpha, 0.2);

    if (!settling) {
      if (this.alpha < 0.018 && maximumSpeed < 0.075) this.stableFrames += 1;
      else this.stableFrames = 0;

      if (this.stableFrames >= 14) {
        this.nodes.forEach((node) => {
          node.vx = 0;
          node.vy = 0;
        });
        this.alpha = 0;
        this.physicsActive = false;
      }
    }
  }

  edgeGeometry(edge) {
    const dx = edge.target.x - edge.source.x;
    const dy = edge.target.y - edge.source.y;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    const unitX = dx / length;
    const unitY = dy / length;
    const normal = { x: -unitY, y: unitX };
    const arrowAllowance = edge.directed ? 4 / this.view.scale : 0;
    const startInset = edge.source.radius + 3 / this.view.scale;
    const endInset = edge.target.radius + 3 / this.view.scale + arrowAllowance;
    const start = {
      x: edge.source.x + unitX * startInset,
      y: edge.source.y + unitY * startInset,
    };
    const end = {
      x: edge.target.x - unitX * endInset,
      y: edge.target.y - unitY * endInset,
    };
    return {
      start,
      end,
      control: {
        x: (start.x + end.x) / 2 + normal.x * edge.curve,
        y: (start.y + end.y) / 2 + normal.y * edge.curve,
      },
      normal,
    };
  }

  edgeState(edge) {
    const selected = this.selection?.type === "relationship" && this.selection.id === edge.id;
    const adjacent = this.selection?.type === "person"
      && (edge.source.id === this.selection.id || edge.target.id === this.selection.id);
    const path = this.pathRelationshipIds.has(edge.id);
    const hovered = this.hover?.type === "relationship" && this.hover.id === edge.id;
    const muted = Boolean(this.selection) && !selected && !adjacent && !path;
    return { selected, adjacent, path, hovered, muted };
  }

  activeParticleEdges(timestamp = this.now()) {
    if (this.motionReduced || !this.selection || this.particleAnimationUntil <= 0) {
      return [];
    }
    if (timestamp >= this.particleAnimationUntil) {
      this.particleAnimationUntil = 0;
      // 清掉上一帧已经绘制在 Canvas 上的粒子，但不再维持 RAF 循环。
      this.needsDraw = true;
      return [];
    }
    if (this.selection.type === "relationship") {
      const edge = this.edgeById.get(this.selection.id);
      return edge ? [edge] : [];
    }
    if (this.selection.type === "person") {
      return this.adjacency.get(this.selection.id) ?? [];
    }
    return [];
  }

  hasActiveAnimation(timestamp = this.now()) {
    return this.physicsActive
      || Boolean(this.cameraAnimation)
      || this.activeParticleEdges(timestamp).length > 0;
  }

  draw(timestamp = this.now()) {
    if (this.destroyed || this.width <= 0 || this.height <= 0) return;
    const context = this.context;
    const scale = this.view.scale;

    context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    this.drawBackground(context);

    context.save();
    context.translate(this.view.x, this.view.y);
    context.scale(scale, scale);

    this.edges.forEach((edge) => this.drawEdge(context, edge));
    if (!this.motionReduced) this.drawParticles(context, timestamp);
    this.nodes.forEach((node) => this.drawNode(context, node, timestamp));
    this.drawNodeLabels(context);

    context.restore();

    if (!this.nodes.length) this.drawEmptyState(context);
  }

  drawBackground(context) {
    const palette = this.palette();
    // No fill here. The plate ground — emulsion fog plus the centre bloom — is
    // painted by the page beneath this canvas, and render() has already cleared
    // it. Filling would flatten that bloom into a slab of UI grey.

    context.save();
    context.lineWidth = 1;
    for (let x = 0.5; x < this.width; x += 48) {
      context.strokeStyle = x % 192 === 0.5 ? palette.gridStrong : palette.grid;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, this.height);
      context.stroke();
    }
    for (let y = 0.5; y < this.height; y += 48) {
      context.strokeStyle = y % 192 === 0.5 ? palette.gridStrong : palette.grid;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(this.width, y);
      context.stroke();
    }

    context.restore();
  }

  drawEmptyState(context) {
    const palette = this.palette();
    const size = clamp(Math.min(this.width, this.height) * 0.13, 34, 74);
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    context.save();
    context.translate(centerX, centerY);
    context.scale(size / 32, size / 32);
    context.strokeStyle = palette.rule;
    context.lineWidth = 1;
    context.strokeRect(-22, -16, 44, 32);
    context.beginPath();
    context.moveTo(-16, 10);
    context.lineTo(-5, -4);
    context.lineTo(5, 4);
    context.lineTo(16, -10);
    context.stroke();
    context.restore();
  }

  drawEdge(context, edge) {
    const geometry = this.edgeGeometry(edge);
    const style = RELATION_STYLES[edge.kind] ?? RELATION_STYLES.default;
    const state = this.edgeState(edge);
    const scale = this.view.scale;
    const color = this.relationColor(edge.kind);
    const active = state.selected || state.adjacent || state.path || state.hovered;
    const overviewAlpha = this.nodes.length >= 64
      ? clamp(0.12 + scale * 0.12, 0.14, 0.32)
      : 0.58;
    const alpha = state.muted
      ? (this.nodes.length >= 64 ? 0.06 : 0.16)
      : active ? 1 : overviewAlpha;
    const intensityWidth = 0.72 + edge.intensity * 0.38;

    context.save();
    context.lineCap = edge.kind === "affection" ? "round" : "butt";
    context.lineJoin = "miter";

    if (active) {
      context.globalAlpha = state.selected || state.path ? 0.34 : 0.22;
      context.strokeStyle = color;
      context.lineWidth = (intensityWidth + (state.selected || state.path ? 4 : 2.5)) / scale;
      context.setLineDash([]);
      traceQuadratic(context, geometry);
      context.stroke();
    }

    context.globalAlpha = alpha;
    context.strokeStyle = color;
    const overviewWidth = this.nodes.length >= 64 && !active ? 0.78 : 1;
    context.lineWidth = (intensityWidth * overviewWidth) / scale;
    context.setLineDash(style.dash.map((value) => value / scale));

    traceQuadratic(context, geometry);
    context.stroke();

    context.setLineDash([]);
    if (edge.directed) this.drawArrow(context, geometry, color, alpha);
    if (active) this.drawEdgeBadge(context, edge, geometry, state);
    context.restore();
  }

  drawArrow(context, geometry, color, alpha) {
    const tangent = tangentOnQuadratic(geometry, 1);
    const length = Math.max(0.001, Math.hypot(tangent.x, tangent.y));
    const unitX = tangent.x / length;
    const unitY = tangent.y / length;
    const normalX = -unitY;
    const normalY = unitX;
    const size = 8.5 / this.view.scale;
    const width = 4.8 / this.view.scale;
    const tip = geometry.end;

    context.beginPath();
    context.moveTo(tip.x, tip.y);
    context.lineTo(tip.x - unitX * size + normalX * width, tip.y - unitY * size + normalY * width);
    context.lineTo(tip.x - unitX * size - normalX * width, tip.y - unitY * size - normalY * width);
    context.closePath();
    context.globalAlpha = Math.max(alpha, 0.62);
    context.fillStyle = color;
    context.fill();
  }

  drawEdgeBadge(context, edge, geometry, state) {
    const point = pointOnQuadratic(geometry, 0.5);
    const scale = this.view.scale;
    const palette = this.palette();
    const label = `${RELATION_LABELS[edge.kind] ?? RELATION_LABELS.default} · ${edge.intensity}/5`;
    const fontSize = 10.5 / scale;
    context.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    const textWidth = context.measureText(label).width;
    const width = textWidth + 16 / scale;
    const height = 22 / scale;
    const x = point.x - width / 2;
    const y = point.y - height / 2;

    roundedRect(context, x, y, width, height, 2 / scale);
    context.globalAlpha = state.selected || state.path ? 0.96 : 0.82;
    context.fillStyle = palette.panel;
    context.fill();
    context.globalAlpha = 0.96;
    context.strokeStyle = this.relationColor(edge.kind);
    context.lineWidth = 1 / scale;
    context.stroke();
    context.globalAlpha = 1;
    context.fillStyle = palette.ink;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, point.x, point.y + 0.25 / scale);
  }

  drawParticles(context, timestamp) {
    const edges = this.activeParticleEdges(timestamp);
    if (!edges.length) return;

    const scale = this.view.scale;
    edges.forEach((edge) => {
      const geometry = this.edgeGeometry(edge);
      const count = 3;
      for (let index = 0; index < count; index += 1) {
        const speed = 0.00012 + edge.intensity * 0.000018;
        const offset = hashUnit(edge.id, 61 + index);
        const t = (timestamp * speed + index / count + offset) % 1;
        const point = pointOnQuadratic(geometry, t);
        const radius = (index === 0 ? 2.2 : 1.4) / scale;
        context.fillStyle = this.relationColor(edge.kind);
        context.globalAlpha = 0.9;
        context.beginPath();
        context.rect(point.x - radius, point.y - radius, radius * 2, radius * 2);
        context.fill();
      }
    });
    context.globalAlpha = 1;
  }

  nodeState(node) {
    const selected = this.selection?.type === "person" && this.selection.id === node.id;
    const path = this.pathNodeIds.has(node.id);
    const hovered = this.hover?.type === "person" && this.hover.id === node.id;
    const adjacent = this.selection?.type === "person"
      && (this.adjacency.get(this.selection.id) ?? []).some((edge) =>
        edge.source === node || edge.target === node);
    const relationshipEndpoint = this.selection?.type === "relationship"
      && (this.edgeById.get(this.selection.id)?.source === node
        || this.edgeById.get(this.selection.id)?.target === node);
    const active = selected || path || hovered || adjacent || relationshipEndpoint;
    const muted = Boolean(this.selection) && !active;
    return { selected, path, hovered, adjacent, relationshipEndpoint, active, muted };
  }

  drawNode(context, node, timestamp) {
    const scale = this.view.scale;
    const palette = this.palette();
    const { selected, active, muted } = this.nodeState(node);

    context.save();
    context.translate(node.x, node.y);
    context.globalAlpha = muted ? 0.34 : 1;

    if (active) {
      const outerRadius = node.radius + (selected ? 8 : 5) / scale;
      context.globalAlpha = muted ? 0.34 : 0.92;
      context.strokeStyle = node.accent;
      context.lineWidth = (selected ? 2 : 1) / scale;
      context.setLineDash(selected ? [] : [3 / scale, 3 / scale]);
      context.beginPath();
      context.arc(0, 0, outerRadius, 0, TAU);
      context.stroke();
      context.setLineDash([]);
      context.globalAlpha = muted ? 0.34 : 1;
    }

    context.fillStyle = palette.panel;
    context.beginPath();
    context.arc(0, 0, node.radius, 0, TAU);
    context.fill();

    context.strokeStyle = node.accent;
    context.lineWidth = (active ? 2.3 : 1.35) / scale;
    context.beginPath();
    context.arc(0, 0, node.radius, 0, TAU);
    context.stroke();

    context.beginPath();
    context.moveTo(-node.radius - 4 / scale, 0);
    context.lineTo(-node.radius + 3 / scale, 0);
    context.moveTo(node.radius - 3 / scale, 0);
    context.lineTo(node.radius + 4 / scale, 0);
    context.moveTo(0, -node.radius - 4 / scale);
    context.lineTo(0, -node.radius + 3 / scale);
    context.moveTo(0, node.radius - 3 / scale);
    context.lineTo(0, node.radius + 4 / scale);
    context.lineWidth = 1 / scale;
    context.strokeStyle = palette.rule;
    context.stroke();

    const avatar = node.emoji || initials(node.name);
    const avatarSize = node.emoji ? node.radius * 0.92 : node.radius * 0.68;
    context.font = `${node.emoji ? "400" : "700"} ${avatarSize}px ui-sans-serif, system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = palette.ink;
    context.fillText(avatar, 0, 1);
    context.restore();
  }

  drawNodeLabels(context) {
    const scale = this.view.scale;
    const largeGraph = this.nodes.length >= 64;
    const backgroundBudget = !largeGraph
      ? Number.POSITIVE_INFINITY
      : scale < 0.4 ? 12
        : scale < 0.55 ? 20
          : scale < 0.78 ? 34
            : scale < 1.1 ? 58 : Number.POSITIVE_INFINITY;
    const minimumDegree = !largeGraph
      ? 0
      : scale < 0.4 ? 4
        : scale < 0.55 ? 3
          : scale < 0.78 ? 2 : 1;
    let backgroundCount = 0;
    this.labelRects = [];

    const candidates = this.nodes
      .map((node) => ({ node, state: this.nodeState(node) }))
      .filter(({ node, state }) => state.active || node.degree >= minimumDegree)
      .sort((a, b) =>
        Number(b.state.active) - Number(a.state.active)
        || b.node.degree - a.node.degree
        || hashString(a.node.id) - hashString(b.node.id));

    candidates.forEach(({ node, state }) => {
      if (!state.active && backgroundCount >= backgroundBudget) return;
      const rendered = this.drawNodeLabel(context, node, state);
      if (rendered && !state.active) backgroundCount += 1;
    });
  }

  drawNodeLabel(context, node, state) {
    const scale = this.view.scale;
    const palette = this.palette();
    const fontSize = 11.5 / scale;
    const rawLabel = Array.from(node.name);
    const label = rawLabel.length > 22 ? `${rawLabel.slice(0, 21).join("")}…` : node.name;
    context.save();
    context.font = `${state.active ? "700" : "600"} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    const textWidth = context.measureText(label).width;
    const paddingX = 8 / scale;
    const height = 21 / scale;
    const width = textWidth + paddingX * 2;
    const offset = node.radius + 8 / scale;
    const positions = [
      { x: node.x - width / 2, y: node.y + offset },
      { x: node.x - width / 2, y: node.y - offset - height },
      { x: node.x + offset, y: node.y - height / 2 },
      { x: node.x - offset - width, y: node.y - height / 2 },
    ];
    const gap = 5 / scale;
    const collides = (box) => this.labelRects.some((other) =>
      box.x < other.x + other.width + gap
      && box.x + box.width + gap > other.x
      && box.y < other.y + other.height + gap
      && box.y + box.height + gap > other.y);
    const boxes = positions.map(({ x, y }) => ({ x, y, width, height }));
    let box = boxes.find((candidate) => !collides(candidate));
    if (!box && state.active) box = boxes[hashString(node.id) % boxes.length];
    if (!box) {
      context.restore();
      return false;
    }
    this.labelRects.push(box);

    roundedRect(context, box.x, box.y, box.width, box.height, 2 / scale);
    context.globalAlpha = state.muted ? 0.28 : state.active ? 0.96 : 0.84;
    context.fillStyle = palette.label;
    context.fill();
    context.globalAlpha = state.muted ? 0.28 : state.active ? 0.7 : 0.3;
    context.strokeStyle = node.accent;
    context.lineWidth = 0.9 / scale;
    context.stroke();
    context.globalAlpha = state.muted ? 0.38 : 1;
    context.fillStyle = palette.ink;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(
      label,
      box.x + box.width / 2,
      box.y + box.height / 2 + 0.25 / scale,
    );
    context.restore();
    return true;
  }

  drawEmptyFrame() {
    this.requestDraw();
  }

  requestDraw() {
    if (this.destroyed) return;
    this.needsDraw = true;
    this.scheduleFrame();
  }

  scheduleFrame() {
    if (this.destroyed || this.hidden || this.raf) return;
    this.raf = this.requestFrame(this.boundTick);
  }

  tick(timestamp) {
    this.raf = 0;
    if (this.destroyed || this.hidden) return;

    const elapsed = this.lastTick ? timestamp - this.lastTick : 16.67;
    this.lastTick = timestamp;
    const dt = clamp(elapsed / 16.67, 0.35, 2.25);

    if (this.physicsActive) this.stepPhysics(dt);
    if (this.cameraAnimation) this.advanceCamera(timestamp);

    const activeAnimation = this.hasActiveAnimation(timestamp);
    if (this.needsDraw || activeAnimation) {
      this.needsDraw = false;
      this.draw(timestamp);
    }

    if (this.hasActiveAnimation(timestamp) || this.needsDraw) this.scheduleFrame();
  }

  advanceCamera(timestamp) {
    const animation = this.cameraAnimation;
    if (!animation) return;
    const progress = clamp((timestamp - animation.start) / animation.duration, 0, 1);
    const eased = 1 - (1 - progress) ** 3;
    this.view = {
      x: animation.from.x + (animation.to.x - animation.from.x) * eased,
      y: animation.from.y + (animation.to.y - animation.from.y) * eased,
      scale: animation.from.scale + (animation.to.scale - animation.from.scale) * eased,
    };
    this.emitView();
    if (progress >= 1) this.cameraAnimation = null;
  }

  resize() {
    if (this.destroyed) return;
    const rect = this.canvas.getBoundingClientRect?.() ?? {};
    const width = Math.max(1, Math.round(finiteNumber(rect.width, this.canvas.clientWidth || 1)));
    const height = Math.max(1, Math.round(finiteNumber(rect.height, this.canvas.clientHeight || 1)));
    const dprCap = this.lowPower ? 1.5 : 2;
    const dpr = clamp(finiteNumber(this.window.devicePixelRatio, 1), 1, dprCap);
    const backingWidth = Math.max(1, Math.round(width * dpr));
    const backingHeight = Math.max(1, Math.round(height * dpr));
    const changed = this.canvas.width !== backingWidth
      || this.canvas.height !== backingHeight
      || this.width !== width
      || this.height !== height;

    if (!changed) return;
    const oldWidth = this.width;
    const oldHeight = this.height;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = backingWidth;
    this.canvas.height = backingHeight;

    if (!this.viewInitialized) {
      this.view.x = width / 2;
      this.view.y = height / 2;
      this.viewInitialized = true;
    } else {
      this.view.x += (width - oldWidth) / 2;
      this.view.y += (height - oldHeight) / 2;
    }

    // A fit deferred during boot finally has a box to fit into.
    if (this.fitPending && width > 1 && height > 1) {
      this.fitPending = false;
      this.fit();
      return;
    }
    this.requestDraw();
  }

  handleVisibility() {
    this.hidden = Boolean(this.document?.hidden);
    if (this.hidden) {
      if (this.raf) {
        this.cancelFrame(this.raf);
        this.raf = 0;
      }
      this.lastTick = 0;
      return;
    }
    this.lastTick = 0;
    this.requestDraw();
  }

  canvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }

  worldPoint(screenPoint) {
    return {
      x: (screenPoint.x - this.view.x) / this.view.scale,
      y: (screenPoint.y - this.view.y) / this.view.scale,
    };
  }

  hitTest(screenPoint) {
    if (!this.nodes.length) return null;
    const world = this.worldPoint(screenPoint);
    const nodePadding = 7 / this.view.scale;

    for (let index = this.nodes.length - 1; index >= 0; index -= 1) {
      const node = this.nodes[index];
      const dx = world.x - node.x;
      const dy = world.y - node.y;
      const radius = node.radius + nodePadding;
      if (dx * dx + dy * dy <= radius * radius) {
        return { type: "person", id: node.id, node };
      }
    }

    const thresholdSquared = (9 / this.view.scale) ** 2;
    let best = null;
    let bestDistance = thresholdSquared;
    this.edges.forEach((edge) => {
      const distance = quadraticDistanceSquared(world, this.edgeGeometry(edge));
      if (distance > bestDistance) return;
      bestDistance = distance;
      best = { type: "relationship", id: edge.id, edge };
    });
    return best;
  }

  setHover(hit) {
    const next = hit ? { type: hit.type, id: hit.id } : null;
    const unchanged = this.hover?.type === next?.type && this.hover?.id === next?.id;
    if (unchanged) return;
    this.hover = next;
    this.updateCursor();
    this.requestDraw();

    if (this.onHover) {
      if (!next) {
        this.onHover(null);
      } else if (next.type === "person") {
        const node = this.nodeById.get(next.id);
        this.onHover({ type: "person", id: next.id, person: node?.data });
      } else {
        const edge = this.edgeById.get(next.id);
        this.onHover({ type: "relationship", id: next.id, relationship: edge?.data });
      }
    }
  }

  updateCursor() {
    this.canvas.classList.toggle("is-dragging", Boolean(this.pointer));
    this.canvas.classList.toggle("is-hovering", Boolean(!this.pointer && this.hover));
  }

  handlePointerDown(event) {
    if (this.destroyed || (event.button !== 0 && event.pointerType !== "touch")) return;
    const screen = this.canvasPoint(event);
    const hit = this.hitTest(screen);
    const node = hit?.type === "person" ? hit.node : null;
    this.pointer = {
      id: event.pointerId,
      startX: screen.x,
      startY: screen.y,
      lastX: screen.x,
      lastY: screen.y,
      startViewX: this.view.x,
      startViewY: this.view.y,
      hit,
      node,
      moved: false,
    };
    this.cameraAnimation = null;

    if (node) {
      node.dragging = true;
      node.vx = 0;
      node.vy = 0;
    }
    this.canvas.setPointerCapture?.(event.pointerId);
    this.setHover(hit);
    this.updateCursor();
    event.preventDefault();
  }

  handlePointerMove(event) {
    if (this.destroyed) return;
    const screen = this.canvasPoint(event);

    if (!this.pointer || this.pointer.id !== event.pointerId) {
      this.setHover(this.hitTest(screen));
      return;
    }

    const deltaX = screen.x - this.pointer.startX;
    const deltaY = screen.y - this.pointer.startY;
    if (Math.hypot(deltaX, deltaY) > 4) this.pointer.moved = true;
    this.pointer.lastX = screen.x;
    this.pointer.lastY = screen.y;

    if (this.pointer.node) {
      const world = this.worldPoint(screen);
      this.pointer.node.x = world.x;
      this.pointer.node.y = world.y;
      this.pointer.node.targetX = world.x;
      this.pointer.node.targetY = world.y;
      this.pointer.node.vx = 0;
      this.pointer.node.vy = 0;
      this.wakePhysics(0.32);
    } else {
      this.view.x = this.pointer.startViewX + deltaX;
      this.view.y = this.pointer.startViewY + deltaY;
      this.requestDraw();
    }
    event.preventDefault();
  }

  handlePointerUp(event, cancelled) {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    const gesture = this.pointer;
    this.pointer = null;
    this.canvas.releasePointerCapture?.(event.pointerId);

    if (gesture.node) {
      gesture.node.dragging = false;
      gesture.node.vx = 0;
      gesture.node.vy = 0;
      this.wakePhysics(0.18);
    }

    if (!cancelled && !gesture.moved) {
      const screen = this.canvasPoint(event);
      const hit = this.hitTest(screen) ?? gesture.hit;
      this.selectHit(hit);
    }
    this.updateCursor();
    this.requestDraw();
  }

  handlePointerLeave() {
    if (!this.pointer) this.setHover(null);
  }

  selectHit(hit) {
    if (!hit) {
      this.setSelection(null);
      this.onSelect?.(null);
      return;
    }
    if (hit.type === "person") {
      const selection = { type: "person", id: hit.id, person: hit.node?.data };
      this.setSelection(selection);
      this.onSelect?.(selection);
      return;
    }
    const selection = { type: "relationship", id: hit.id, relationship: hit.edge?.data };
    this.setSelection(selection);
    this.onSelect?.(selection);
  }

  handleWheel(event) {
    if (this.destroyed) return;
    const point = this.canvasPoint(event);
    const factor = Math.exp(-clamp(event.deltaY, -240, 240) * 0.0017);
    this.zoomAt(factor, point.x, point.y);
    event.preventDefault();
  }

  handleDoubleClick(event) {
    const hit = this.hitTest(this.canvasPoint(event));
    if (hit?.type === "person") {
      this.focusPerson(hit.id);
      event.preventDefault();
    }
  }

  zoomAt(factor, screenX, screenY) {
    const oldScale = this.view.scale;
    const nextScale = clamp(oldScale * factor, MIN_SCALE, MAX_SCALE);
    if (Math.abs(nextScale - oldScale) < 0.0001) return;
    const worldX = (screenX - this.view.x) / oldScale;
    const worldY = (screenY - this.view.y) / oldScale;
    this.view.scale = nextScale;
    this.view.x = screenX - worldX * nextScale;
    this.view.y = screenY - worldY * nextScale;
    this.cameraAnimation = null;
    this.emitView();
    this.requestDraw();
  }
}

export default HeartGraph;
