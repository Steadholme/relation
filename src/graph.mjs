const TAU = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MIN_SCALE = 0.28;
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

export class HeartGraph {
  constructor(canvas, { onSelect, onHover } = {}) {
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
    this.particleAnimationUntil = 0;

    this.width = 1;
    this.height = 1;
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

    this.selection = this.normalizeSelection(this.selection);
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
    this.particleAnimationUntil = this.selection && !this.motionReduced
      ? this.now() + PARTICLE_ANIMATION_DURATION_MS
      : 0;
    this.requestDraw();
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

    if (!this.nodes.length) {
      this.view = { x: this.width / 2, y: this.height / 2, scale: 1 };
      this.requestDraw();
      return;
    }

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    this.nodes.forEach((node) => {
      const margin = node.radius + 36;
      minX = Math.min(minX, node.x - margin);
      minY = Math.min(minY, node.y - margin);
      maxX = Math.max(maxX, node.x + margin);
      maxY = Math.max(maxY, node.y + margin);
    });

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
      const scale = clamp(13.5 + Math.sqrt(outline.length) * 1.6, 14, 23);
      outline.forEach((node, index) => {
        const t = ((index + 0.5) / Math.max(1, outline.length)) * TAU;
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
      return;
    }

    const constellation = focus ? ordered.filter((node) => node !== focus) : ordered;
    constellation.forEach((node, index) => {
      const ordinal = focus ? index + 1 : index;
      const radius = ordinal === 0 ? 0 : 68 * Math.sqrt(ordinal);
      const angle = ordinal * GOLDEN_ANGLE + hashUnit(node.id, 21) * 0.42;
      node.targetX = Math.cos(angle) * radius;
      node.targetY = Math.sin(angle) * radius * 0.84;
    });
    if (focus) {
      focus.targetX = 0;
      focus.targetY = 0;
    }
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
    const targetStrength = this.layoutMode === "constellation" ? 0.018 : 0.05;

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
      const restLength = style.distance - (edge.intensity - 3) * 7;
      const strength = style.strength * (0.72 + edge.intensity * 0.11) * alpha * dt;
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

    const cellSize = 190;
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
            const collisionDistance = first.radius + second.radius + 20;
            const repulsion = (760 / (distanceSquared + 80)) * alpha * dt;
            const collision = distance < collisionDistance
              ? (collisionDistance - distance) * 0.075 * dt
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

    context.restore();

    if (!this.nodes.length) this.drawEmptyState(context);
  }

  drawBackground(context) {
    const base = context.createLinearGradient(0, 0, this.width, this.height);
    base.addColorStop(0, "#090817");
    base.addColorStop(0.48, "#120b23");
    base.addColorStop(1, "#070914");
    context.fillStyle = base;
    context.fillRect(0, 0, this.width, this.height);

    const rose = context.createRadialGradient(
      this.width * 0.23,
      this.height * 0.23,
      0,
      this.width * 0.23,
      this.height * 0.23,
      Math.max(this.width, this.height) * 0.72,
    );
    rose.addColorStop(0, "rgba(255, 63, 141, 0.16)");
    rose.addColorStop(0.48, "rgba(150, 73, 255, 0.055)");
    rose.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = rose;
    context.fillRect(0, 0, this.width, this.height);

    const cyan = context.createRadialGradient(
      this.width * 0.86,
      this.height * 0.76,
      0,
      this.width * 0.86,
      this.height * 0.76,
      Math.max(this.width, this.height) * 0.56,
    );
    cyan.addColorStop(0, "rgba(67, 216, 228, 0.085)");
    cyan.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = cyan;
    context.fillRect(0, 0, this.width, this.height);

    const starCount = Math.min(110, Math.floor((this.width * this.height) / 10500));
    context.fillStyle = "#ffffff";
    for (let index = 0; index < starCount; index += 1) {
      const x = hashUnit(index, 41) * this.width;
      const y = hashUnit(index, 42) * this.height;
      const radius = 0.35 + hashUnit(index, 43) * 0.9;
      context.globalAlpha = 0.1 + hashUnit(index, 44) * 0.35;
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
    }
    context.globalAlpha = 1;

    const vignette = context.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.15,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.72,
    );
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.38)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, this.width, this.height);
  }

  drawEmptyState(context) {
    const size = clamp(Math.min(this.width, this.height) * 0.13, 34, 74);
    const centerX = this.width / 2;
    const centerY = this.height / 2;
    context.save();
    context.translate(centerX, centerY);
    context.scale(size / 32, size / 32);
    context.beginPath();
    context.moveTo(0, 13);
    context.bezierCurveTo(-28, -3, -18, -25, 0, -12);
    context.bezierCurveTo(18, -25, 28, -3, 0, 13);
    context.closePath();
    context.strokeStyle = "rgba(255, 124, 176, 0.52)";
    context.lineWidth = 1.2;
    context.shadowColor = "#ff4f9a";
    context.shadowBlur = 12;
    context.stroke();
    context.restore();
  }

  drawEdge(context, edge) {
    const geometry = this.edgeGeometry(edge);
    const style = RELATION_STYLES[edge.kind] ?? RELATION_STYLES.default;
    const state = this.edgeState(edge);
    const scale = this.view.scale;
    const active = state.selected || state.adjacent || state.path || state.hovered;
    const alpha = state.muted ? 0.13 : active ? 0.92 : 0.42;
    const gradient = context.createLinearGradient(
      geometry.start.x,
      geometry.start.y,
      geometry.end.x,
      geometry.end.y,
    );
    gradient.addColorStop(0, edge.source.accent);
    gradient.addColorStop(1, edge.target.accent);

    context.save();
    context.lineCap = edge.kind === "affection" ? "round" : "round";
    context.lineJoin = "round";

    if (active) {
      context.globalAlpha = state.selected || state.path ? 0.34 : 0.2;
      context.strokeStyle = gradient;
      context.lineWidth = (state.selected || state.path ? 12 : 8) / scale;
      context.shadowColor = edge.target.accent;
      context.shadowBlur = 18 / scale;
      context.setLineDash([]);
      traceQuadratic(context, geometry);
      context.stroke();
      context.shadowBlur = 0;
    }

    context.globalAlpha = alpha;
    context.strokeStyle = gradient;
    context.lineWidth = (style.width + (state.selected || state.path ? 0.8 : 0)) / scale;
    context.setLineDash(style.dash.map((value) => value / scale));

    traceQuadratic(context, geometry);
    context.stroke();

    context.setLineDash([]);
    if (edge.directed) this.drawArrow(context, geometry, edge.target.accent, alpha);
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
    context.shadowColor = color;
    context.shadowBlur = 8 / this.view.scale;
    context.fill();
    context.shadowBlur = 0;
  }

  drawEdgeBadge(context, edge, geometry, state) {
    const point = pointOnQuadratic(geometry, 0.5);
    const scale = this.view.scale;
    const label = RELATION_LABELS[edge.kind] ?? RELATION_LABELS.default;
    const fontSize = 10.5 / scale;
    context.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    const textWidth = context.measureText(label).width;
    const width = textWidth + 14 / scale;
    const height = 20 / scale;
    const x = point.x - width / 2;
    const y = point.y - height / 2;

    roundedRect(context, x, y, width, height, 9 / scale);
    context.globalAlpha = state.selected || state.path ? 0.88 : 0.68;
    context.fillStyle = "#171126";
    context.fill();
    context.globalAlpha = 0.82;
    context.strokeStyle = edge.target.accent;
    context.lineWidth = 1 / scale;
    context.stroke();
    context.globalAlpha = 0.92;
    context.fillStyle = "#fff7fb";
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
        const radius = (index === 0 ? 2.8 : 1.9) / scale;
        const gradient = context.createRadialGradient(
          point.x,
          point.y,
          0,
          point.x,
          point.y,
          radius * 3.4,
        );
        gradient.addColorStop(0, "rgba(255,255,255,0.98)");
        gradient.addColorStop(0.28, edge.target.accent);
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.globalAlpha = 0.88;
        context.beginPath();
        context.arc(point.x, point.y, radius * 3.4, 0, TAU);
        context.fill();
      }
    });
    context.globalAlpha = 1;
  }

  drawNode(context, node, timestamp) {
    const scale = this.view.scale;
    const selected = this.selection?.type === "person" && this.selection.id === node.id;
    const path = this.pathNodeIds.has(node.id);
    const hovered = this.hover?.type === "person" && this.hover.id === node.id;
    const muted = Boolean(this.selection)
      && !selected
      && !path
      && !(this.selection.type === "relationship"
        && (this.edgeById.get(this.selection.id)?.source === node
          || this.edgeById.get(this.selection.id)?.target === node));
    const active = selected || path || hovered;
    const pulse = this.motionReduced || !selected ? 1 : 1 + Math.sin(timestamp * 0.0038) * 0.045;

    context.save();
    context.translate(node.x, node.y);
    context.scale(pulse, pulse);
    context.globalAlpha = muted ? 0.34 : 1;

    if (active) {
      const haloRadius = node.radius + (selected ? 17 : 12) / scale;
      const halo = context.createRadialGradient(0, 0, node.radius * 0.55, 0, 0, haloRadius);
      halo.addColorStop(0, node.accent);
      halo.addColorStop(1, "rgba(255,255,255,0)");
      context.globalAlpha = selected ? 0.28 : 0.18;
      context.fillStyle = halo;
      context.beginPath();
      context.arc(0, 0, haloRadius, 0, TAU);
      context.fill();
      context.globalAlpha = muted ? 0.34 : 1;
    }

    const face = context.createRadialGradient(
      -node.radius * 0.34,
      -node.radius * 0.38,
      node.radius * 0.08,
      0,
      0,
      node.radius * 1.1,
    );
    face.addColorStop(0, node.accent);
    face.addColorStop(0.38, "#2a1b39");
    face.addColorStop(1, "#100d1c");
    context.fillStyle = face;
    context.shadowColor = active ? node.accent : "rgba(255, 77, 150, 0.26)";
    context.shadowBlur = (active ? 20 : 9) / scale;
    context.beginPath();
    context.arc(0, 0, node.radius, 0, TAU);
    context.fill();
    context.shadowBlur = 0;

    const ring = context.createLinearGradient(-node.radius, -node.radius, node.radius, node.radius);
    ring.addColorStop(0, "rgba(255,255,255,0.86)");
    ring.addColorStop(0.38, node.accent);
    ring.addColorStop(1, "rgba(255,255,255,0.2)");
    context.strokeStyle = ring;
    context.lineWidth = (active ? 2.3 : 1.35) / scale;
    context.beginPath();
    context.arc(0, 0, node.radius, 0, TAU);
    context.stroke();

    context.beginPath();
    context.arc(-node.radius * 0.31, -node.radius * 0.34, node.radius * 0.13, 0, TAU);
    context.fillStyle = "rgba(255,255,255,0.36)";
    context.fill();

    const avatar = node.emoji || initials(node.name);
    const avatarSize = node.emoji ? node.radius * 0.92 : node.radius * 0.68;
    context.font = `${node.emoji ? "400" : "700"} ${avatarSize}px ui-sans-serif, system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#fffafc";
    context.shadowColor = "rgba(0,0,0,0.65)";
    context.shadowBlur = 4 / scale;
    context.fillText(avatar, 0, 1);
    context.shadowBlur = 0;
    context.restore();

    if (scale >= 0.38 || active) this.drawNodeLabel(context, node, muted, active);
  }

  drawNodeLabel(context, node, muted, active) {
    const scale = this.view.scale;
    const fontSize = 11.5 / scale;
    const rawLabel = Array.from(node.name);
    const label = rawLabel.length > 22 ? `${rawLabel.slice(0, 21).join("")}…` : node.name;
    context.save();
    context.font = `${active ? "700" : "600"} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
    const textWidth = context.measureText(label).width;
    const paddingX = 8 / scale;
    const height = 21 / scale;
    const y = node.y + node.radius + 8 / scale;
    const x = node.x - textWidth / 2 - paddingX;

    roundedRect(context, x, y, textWidth + paddingX * 2, height, 9 / scale);
    context.globalAlpha = muted ? 0.28 : active ? 0.9 : 0.7;
    context.fillStyle = "#100c1c";
    context.fill();
    context.globalAlpha = muted ? 0.28 : active ? 0.7 : 0.3;
    context.strokeStyle = node.accent;
    context.lineWidth = 0.9 / scale;
    context.stroke();
    context.globalAlpha = muted ? 0.38 : 0.96;
    context.fillStyle = "#fff8fc";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, node.x, y + height / 2 + 0.25 / scale);
    context.restore();
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
    this.requestDraw();
  }
}

export default HeartGraph;
