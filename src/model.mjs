const DOCUMENT_SCHEMA_VERSION = 1;
const DEFAULT_STORAGE_KEY = "w33d.relation.document.v1";
const RELATION_DIRECTIONS = new Set(["mutual", "directed"]);
const RELATION_VISIBILITIES = new Set(["public", "private"]);
const MIN_YEAR = 1;
const MAX_YEAR = 9999;

/**
 * 本地关系文档的硬边界。规模上限同时保护 localStorage、导入校验与
 * Canvas 的 O(n²) 布局；字符串上限按 JavaScript UTF-16 code unit 计数。
 */
export const DOCUMENT_LIMITS = Object.freeze({
  serializedCharacters: 1_000_000,
  people: 300,
  relationships: 1_200,
  documentId: 128,
  title: 120,
  description: 500,
  dataPolicy: 80,
  entityId: 128,
  personName: 80,
  personColor: 32,
  personEmoji: 16,
  relationshipNote: 500,
});

/**
 * 关系类型是稳定的存储值；UI 文案应在展示层本地化。
 */
export const RELATION_KINDS = Object.freeze([
  "partner",
  "dated",
  "affection",
  "spark",
]);

const RELATION_KIND_SET = new Set(RELATION_KINDS);

const PERSON_COLORS = Object.freeze([
  "#ff6ba8",
  "#8d7cff",
  "#36d6c5",
  "#ff9f43",
  "#63a4ff",
  "#d86cff",
  "#f45b69",
  "#49c6e5",
  "#a0d568",
]);

const DEMO_PEOPLE = Object.freeze([
  { id: "p01", name: "林见月", color: "#ff6ba8", emoji: "月" },
  { id: "p02", name: "周听潮", color: "#8d7cff", emoji: "潮" },
  { id: "p03", name: "沈拾星", color: "#36d6c5", emoji: "星" },
  { id: "p04", name: "许照野", color: "#ff9f43", emoji: "野" },
  { id: "p05", name: "苏眠云", color: "#63a4ff", emoji: "云" },
  { id: "p06", name: "唐问夏", color: "#d86cff", emoji: "夏" },
  { id: "p07", name: "江回声", color: "#f45b69", emoji: "声" },
  { id: "p08", name: "白予光", color: "#49c6e5", emoji: "光" },
  { id: "p09", name: "陆知遥", color: "#a0d568", emoji: "遥" },
]);

const DEMO_RELATIONSHIPS = Object.freeze([
  {
    id: "r01",
    sourceId: "p01",
    targetId: "p02",
    kind: "partner",
    direction: "mutual",
    startedYear: 2023,
    endedYear: null,
    intensity: 5,
    note: "在同一场流星雨里交换了愿望。",
    visibility: "public",
  },
  {
    id: "r02",
    sourceId: "p01",
    targetId: "p03",
    kind: "affection",
    direction: "directed",
    startedYear: 2020,
    endedYear: 2022,
    intensity: 4,
    note: "一封没有寄出的合成故事。",
    visibility: "public",
  },
  {
    id: "r03",
    sourceId: "p02",
    targetId: "p04",
    kind: "dated",
    direction: "mutual",
    startedYear: 2019,
    endedYear: 2021,
    intensity: 3,
    note: "短暂同行，后来各自看见新的风景。",
    visibility: "public",
  },
  {
    id: "r04",
    sourceId: "p03",
    targetId: "p04",
    kind: "spark",
    direction: "mutual",
    startedYear: 2021,
    endedYear: null,
    intensity: 2,
    note: "每次相遇都有一点微光。",
    visibility: "public",
  },
  {
    id: "r05",
    sourceId: "p03",
    targetId: "p05",
    kind: "affection",
    direction: "directed",
    startedYear: 2022,
    endedYear: null,
    intensity: 4,
    note: "把喜欢藏进了日常问候。",
    visibility: "public",
  },
  {
    id: "r06",
    sourceId: "p05",
    targetId: "p06",
    kind: "partner",
    direction: "mutual",
    startedYear: 2024,
    endedYear: null,
    intensity: 5,
    note: "一起把未知写成了双人旅程。",
    visibility: "public",
  },
  {
    id: "r07",
    sourceId: "p04",
    targetId: "p07",
    kind: "affection",
    direction: "directed",
    startedYear: 2023,
    endedYear: null,
    intensity: 3,
    note: "从一次偶然的对视开始。",
    visibility: "public",
  },
  {
    id: "r08",
    sourceId: "p06",
    targetId: "p07",
    kind: "spark",
    direction: "mutual",
    startedYear: 2022,
    endedYear: null,
    intensity: 2,
    note: "默契像电流一样一闪而过。",
    visibility: "public",
  },
  {
    id: "r09",
    sourceId: "p07",
    targetId: "p08",
    kind: "dated",
    direction: "mutual",
    startedYear: 2018,
    endedYear: 2020,
    intensity: 4,
    note: "故事结束，温柔仍然被记得。",
    visibility: "public",
  },
  {
    id: "r10",
    sourceId: "p08",
    targetId: "p09",
    kind: "affection",
    direction: "directed",
    startedYear: 2021,
    endedYear: null,
    intensity: 3,
    note: "沿着光的方向悄悄靠近。",
    visibility: "public",
  },
  {
    id: "r11",
    sourceId: "p02",
    targetId: "p09",
    kind: "spark",
    direction: "mutual",
    startedYear: 2025,
    endedYear: null,
    intensity: 2,
    note: "新的星轨刚刚亮起。",
    visibility: "public",
  },
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneValue(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function normalizedName(name) {
  return name.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

function compareIds(left, right) {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function canonicalEndpoints(sourceId, targetId, direction) {
  if (
    direction === "mutual" &&
    typeof sourceId === "string" &&
    typeof targetId === "string" &&
    compareIds(sourceId, targetId) > 0
  ) {
    return [targetId, sourceId];
  }

  return [sourceId, targetId];
}

function canonicalRelationshipKey(relationship) {
  const [sourceId, targetId] = canonicalEndpoints(
    relationship.sourceId,
    relationship.targetId,
    relationship.direction,
  );

  return JSON.stringify([
    relationship.kind,
    relationship.direction,
    sourceId,
    targetId,
  ]);
}

function isValidYear(value) {
  return Number.isInteger(value) && value >= MIN_YEAR && value <= MAX_YEAR;
}

function currentYear() {
  return new Date().getFullYear();
}

function nextAvailableId(document, prefix) {
  const usedIds = new Set([
    ...document.people.map((person) => person.id),
    ...document.relationships.map((relationship) => relationship.id),
  ]);

  let serial = 1;
  while (usedIds.has(`${prefix}-${serial}`)) serial += 1;
  return `${prefix}-${serial}`;
}

function toSelection(value) {
  if (value === undefined || value === null) return null;
  return new Set(Array.isArray(value) ? value : [value]);
}

function storageLike(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.getItem === "function" &&
    typeof value.setItem === "function"
  );
}

function defaultStorage() {
  try {
    return storageLike(globalThis.localStorage) ? globalThis.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * 返回一份完全合成、无性别字段的演示文档。
 */
export function createDemoDocument() {
  const document = {
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    id: "synthetic-starlight-demo",
    title: "心动星轨",
    description: "所有名字与关系均为合成演示数据，不对应任何真实人物。",
    dataPolicy: "synthetic-no-gender",
    people: cloneValue(DEMO_PEOPLE),
    relationships: cloneValue(DEMO_RELATIONSHIPS),
  };

  return assertValidDocument(document);
}

/**
 * 深拷贝 JSON 兼容的关系文档，确保调用方可以安全派生新状态。
 */
export function cloneDocument(document) {
  return cloneValue(document);
}

/**
 * 校验完整文档；错误采用带路径的稳定字符串，便于 UI 和测试展示。
 */
export function validateDocument(document) {
  const errors = [];
  const addError = (path, message) => errors.push(`${path}: ${message}`);

  if (!isRecord(document)) {
    return { valid: false, errors: ["document: must be an object"] };
  }

  if (!Array.isArray(document.people)) {
    addError("people", "must be an array");
  }
  if (!Array.isArray(document.relationships)) {
    addError("relationships", "must be an array");
  }

  if (!Array.isArray(document.people) || !Array.isArray(document.relationships)) {
    return { valid: false, errors };
  }

  if (document.people.length > DOCUMENT_LIMITS.people) {
    addError("people", `must contain at most ${DOCUMENT_LIMITS.people} entries`);
  }
  if (document.relationships.length > DOCUMENT_LIMITS.relationships) {
    addError(
      "relationships",
      `must contain at most ${DOCUMENT_LIMITS.relationships} entries`,
    );
  }
  if (errors.length > 0) return { valid: false, errors };

  try {
    const serialized = JSON.stringify(document);
    if (serialized.length > DOCUMENT_LIMITS.serializedCharacters) {
      addError(
        "document",
        `serialized form must contain at most ${DOCUMENT_LIMITS.serializedCharacters} characters`,
      );
      return { valid: false, errors };
    }
  } catch {
    return { valid: false, errors: ["document: must be JSON serializable"] };
  }

  const documentStringLimits = [
    ["id", DOCUMENT_LIMITS.documentId],
    ["title", DOCUMENT_LIMITS.title],
    ["description", DOCUMENT_LIMITS.description],
    ["dataPolicy", DOCUMENT_LIMITS.dataPolicy],
  ];
  for (const [field, maxLength] of documentStringLimits) {
    if (!Object.hasOwn(document, field)) continue;
    if (typeof document[field] !== "string") {
      addError(field, "must be a string");
    } else if (document[field].length > maxLength) {
      addError(field, `must contain at most ${maxLength} characters`);
    }
  }

  const globalIds = new Map();
  const normalizedNames = new Map();
  const personIds = new Set();

  for (const [index, person] of document.people.entries()) {
    const path = `people[${index}]`;
    if (!isRecord(person)) {
      addError(path, "must be an object");
      continue;
    }

    if (typeof person.id !== "string" || person.id.trim() === "") {
      addError(`${path}.id`, "must be a non-empty string");
    } else {
      if (person.id !== person.id.trim()) {
        addError(`${path}.id`, "must not contain surrounding whitespace");
      }
      if (person.id.length > DOCUMENT_LIMITS.entityId) {
        addError(
          `${path}.id`,
          `must contain at most ${DOCUMENT_LIMITS.entityId} characters`,
        );
      }
      if (globalIds.has(person.id)) {
        addError(`${path}.id`, `duplicate ID \"${person.id}\"`);
      } else {
        globalIds.set(person.id, `${path}.id`);
      }
      personIds.add(person.id);
    }

    if (typeof person.name !== "string" || person.name.trim() === "") {
      addError(`${path}.name`, "must be a non-empty string");
    } else {
      if (person.name !== person.name.trim()) {
        addError(`${path}.name`, "must not contain surrounding whitespace");
      }
      if (person.name.length > DOCUMENT_LIMITS.personName) {
        addError(
          `${path}.name`,
          `must contain at most ${DOCUMENT_LIMITS.personName} characters`,
        );
      }
      const nameKey = normalizedName(person.name);
      if (normalizedNames.has(nameKey)) {
        addError(`${path}.name`, `duplicate name \"${person.name}\"`);
      } else {
        normalizedNames.set(nameKey, `${path}.name`);
      }
    }

    if (Object.hasOwn(person, "gender") || Object.hasOwn(person, "sex")) {
      addError(path, "gender and sex fields are not part of this model");
    }

    for (const [field, maxLength] of [
      ["color", DOCUMENT_LIMITS.personColor],
      ["emoji", DOCUMENT_LIMITS.personEmoji],
    ]) {
      if (!Object.hasOwn(person, field)) continue;
      if (typeof person[field] !== "string") {
        addError(`${path}.${field}`, "must be a string");
      } else if (person[field].length > maxLength) {
        addError(`${path}.${field}`, `must contain at most ${maxLength} characters`);
      }
    }
  }

  const canonicalRelationships = new Map();

  for (const [index, relationship] of document.relationships.entries()) {
    const path = `relationships[${index}]`;
    if (!isRecord(relationship)) {
      addError(path, "must be an object");
      continue;
    }

    if (typeof relationship.id !== "string" || relationship.id.trim() === "") {
      addError(`${path}.id`, "must be a non-empty string");
    } else {
      if (relationship.id !== relationship.id.trim()) {
        addError(`${path}.id`, "must not contain surrounding whitespace");
      }
      if (relationship.id.length > DOCUMENT_LIMITS.entityId) {
        addError(
          `${path}.id`,
          `must contain at most ${DOCUMENT_LIMITS.entityId} characters`,
        );
      }
      if (globalIds.has(relationship.id)) {
        addError(`${path}.id`, `duplicate ID \"${relationship.id}\"`);
      } else {
        globalIds.set(relationship.id, `${path}.id`);
      }
    }

    if (!RELATION_KIND_SET.has(relationship.kind)) {
      addError(
        `${path}.kind`,
        `must be one of ${RELATION_KINDS.join(", ")}`,
      );
    }

    if (!RELATION_DIRECTIONS.has(relationship.direction)) {
      addError(`${path}.direction`, "must be mutual or directed");
    }

    for (const endpoint of ["sourceId", "targetId"]) {
      const value = relationship[endpoint];
      if (typeof value !== "string" || value.trim() === "") {
        addError(`${path}.${endpoint}`, "must be a non-empty string");
      } else {
        if (value.length > DOCUMENT_LIMITS.entityId) {
          addError(
            `${path}.${endpoint}`,
            `must contain at most ${DOCUMENT_LIMITS.entityId} characters`,
          );
        }
        if (!personIds.has(value)) {
          addError(`${path}.${endpoint}`, `references missing person \"${value}\"`);
        }
      }
    }

    if (
      typeof relationship.sourceId === "string" &&
      relationship.sourceId === relationship.targetId
    ) {
      addError(path, "self relationships are not allowed");
    }

    if (
      relationship.direction === "mutual" &&
      typeof relationship.sourceId === "string" &&
      typeof relationship.targetId === "string" &&
      compareIds(relationship.sourceId, relationship.targetId) > 0
    ) {
      addError(path, "mutual endpoints must be stored in canonical ID order");
    }

    if (!isValidYear(relationship.startedYear)) {
      addError(
        `${path}.startedYear`,
        `must be an integer from ${MIN_YEAR} through ${MAX_YEAR}`,
      );
    }

    if (
      relationship.endedYear !== null &&
      !isValidYear(relationship.endedYear)
    ) {
      addError(
        `${path}.endedYear`,
        `must be null or an integer from ${MIN_YEAR} through ${MAX_YEAR}`,
      );
    }

    if (
      isValidYear(relationship.startedYear) &&
      isValidYear(relationship.endedYear) &&
      relationship.endedYear < relationship.startedYear
    ) {
      addError(`${path}.endedYear`, "must not be earlier than startedYear");
    }

    if (
      !Number.isInteger(relationship.intensity) ||
      relationship.intensity < 1 ||
      relationship.intensity > 5
    ) {
      addError(`${path}.intensity`, "must be an integer from 1 through 5");
    }

    if (typeof relationship.note !== "string") {
      addError(`${path}.note`, "must be a string");
    } else if (relationship.note.length > DOCUMENT_LIMITS.relationshipNote) {
      addError(
        `${path}.note`,
        `must contain at most ${DOCUMENT_LIMITS.relationshipNote} characters`,
      );
    }

    if (!RELATION_VISIBILITIES.has(relationship.visibility)) {
      addError(`${path}.visibility`, "must be public or private");
    }

    if (
      RELATION_KIND_SET.has(relationship.kind) &&
      RELATION_DIRECTIONS.has(relationship.direction) &&
      typeof relationship.sourceId === "string" &&
      typeof relationship.targetId === "string"
    ) {
      const key = canonicalRelationshipKey(relationship);
      if (canonicalRelationships.has(key)) {
        addError(
          path,
          `duplicates canonical relationship at ${canonicalRelationships.get(key)}`,
        );
      } else {
        canonicalRelationships.set(key, path);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 在文档不合法时抛出带 errors 属性的 TypeError，否则原样返回文档。
 */
export function assertValidDocument(document) {
  const result = validateDocument(document);
  if (!result.valid) {
    const error = new TypeError(`Invalid relationship document:\n${result.errors.join("\n")}`);
    error.errors = result.errors;
    throw error;
  }
  return document;
}

/**
 * 开始与结束年份均为包含端点；null 结束年份表示仍在持续。
 */
export function relationshipIsActive(relationship, year = currentYear()) {
  if (!isValidYear(year)) {
    throw new TypeError(`year must be an integer from ${MIN_YEAR} through ${MAX_YEAR}`);
  }
  if (!isRecord(relationship) || !isValidYear(relationship.startedYear)) {
    return false;
  }

  return (
    relationship.startedYear <= year &&
    (relationship.endedYear === null || relationship.endedYear >= year)
  );
}

/**
 * 支持 year、kind/kinds、direction/directions、visibility/visibilities 与 personId 过滤。
 */
export function filterRelationships(documentOrRelationships, filters = {}) {
  const relationships = Array.isArray(documentOrRelationships)
    ? documentOrRelationships
    : documentOrRelationships?.relationships;

  if (!Array.isArray(relationships)) {
    throw new TypeError("documentOrRelationships must contain a relationships array");
  }

  if (typeof filters === "number") filters = { year: filters };
  if (!isRecord(filters)) throw new TypeError("filters must be an object");

  const kinds = toSelection(filters.kinds ?? filters.kind);
  const directions = toSelection(filters.directions ?? filters.direction);
  const visibilities = toSelection(
    filters.visibilities ?? filters.visibility,
  );
  const personIds = toSelection(filters.personIds ?? filters.personId);
  const selectedYear =
    filters.year ?? (filters.activeOnly === true ? currentYear() : undefined);

  if (selectedYear !== undefined && !isValidYear(selectedYear)) {
    throw new TypeError(
      `filters.year must be an integer from ${MIN_YEAR} through ${MAX_YEAR}`,
    );
  }

  return relationships
    .filter((relationship) => {
      if (kinds && !kinds.has(relationship.kind)) return false;
      if (directions && !directions.has(relationship.direction)) return false;
      if (visibilities && !visibilities.has(relationship.visibility)) return false;
      if (
        personIds &&
        !personIds.has(relationship.sourceId) &&
        !personIds.has(relationship.targetId)
      ) {
        return false;
      }
      if (
        selectedYear !== undefined &&
        !relationshipIsActive(relationship, selectedYear)
      ) {
        return false;
      }
      return true;
    })
    .map((relationship) => cloneValue(relationship));
}

/**
 * 计算面向展示的确定性统计值。
 */
export function graphStats(document, filters = {}) {
  assertValidDocument(document);
  const relationships = filterRelationships(document, filters);
  const activeYear = isRecord(filters) && filters.year !== undefined
    ? filters.year
    : currentYear();
  const connectedIds = new Set();
  const uniquePairs = new Set();
  const byKind = Object.fromEntries(RELATION_KINDS.map((kind) => [kind, 0]));
  let totalIntensity = 0;
  let mutual = 0;
  let directed = 0;

  for (const relationship of relationships) {
    connectedIds.add(relationship.sourceId);
    connectedIds.add(relationship.targetId);
    const pair = [relationship.sourceId, relationship.targetId].sort(compareIds);
    uniquePairs.add(JSON.stringify(pair));
    byKind[relationship.kind] += 1;
    totalIntensity += relationship.intensity;
    if (relationship.direction === "mutual") mutual += 1;
    else directed += 1;
  }

  const peopleCount = document.people.length;
  const relationshipCount = relationships.length;
  const possiblePairs = peopleCount > 1
    ? (peopleCount * (peopleCount - 1)) / 2
    : 0;
  const activeRelationshipCount = relationships.filter((relationship) =>
    relationshipIsActive(relationship, activeYear),
  ).length;

  return {
    people: peopleCount,
    relationships: relationshipCount,
    active: activeRelationshipCount,
    peopleCount,
    relationshipCount,
    activeRelationshipCount,
    connectedPeopleCount: connectedIds.size,
    isolatedPeopleCount: peopleCount - connectedIds.size,
    mutualCount: mutual,
    directedCount: directed,
    averageIntensity: relationshipCount === 0
      ? 0
      : Number((totalIntensity / relationshipCount).toFixed(2)),
    density: possiblePairs === 0
      ? 0
      : Number((uniquePairs.size / possiblePairs).toFixed(4)),
    byKind,
  };
}

/**
 * 使用 BFS 按边数求最短路径。directed 默认只沿 sourceId → targetId 行进。
 */
export function shortestPath(document, fromPersonId, toPersonId, options = {}) {
  assertValidDocument(document);
  const personIds = new Set(document.people.map((person) => person.id));
  if (!personIds.has(fromPersonId) || !personIds.has(toPersonId)) return null;
  if (fromPersonId === toPersonId) {
    return { personIds: [fromPersonId], relationshipIds: [] };
  }

  if (!isRecord(options)) throw new TypeError("options must be an object");
  const respectDirection = options.respectDirection ?? options.directed ?? true;
  const relationshipFilters = { ...options };
  delete relationshipFilters.respectDirection;
  delete relationshipFilters.directed;
  const relationships = filterRelationships(document, relationshipFilters);
  const adjacency = new Map(document.people.map((person) => [person.id, []]));

  for (const relationship of relationships) {
    adjacency.get(relationship.sourceId).push({
      personId: relationship.targetId,
      relationshipId: relationship.id,
    });
    if (relationship.direction === "mutual" || !respectDirection) {
      adjacency.get(relationship.targetId).push({
        personId: relationship.sourceId,
        relationshipId: relationship.id,
      });
    }
  }

  const queue = [fromPersonId];
  let queueIndex = 0;
  const visited = new Set([fromPersonId]);
  const previous = new Map();

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex += 1;

    for (const edge of adjacency.get(current)) {
      if (visited.has(edge.personId)) continue;
      visited.add(edge.personId);
      previous.set(edge.personId, {
        personId: current,
        relationshipId: edge.relationshipId,
      });

      if (edge.personId === toPersonId) {
        const pathPersonIds = [toPersonId];
        const relationshipIds = [];
        let cursor = toPersonId;
        while (cursor !== fromPersonId) {
          const step = previous.get(cursor);
          relationshipIds.push(step.relationshipId);
          cursor = step.personId;
          pathPersonIds.push(cursor);
        }
        pathPersonIds.reverse();
        relationshipIds.reverse();
        return { personIds: pathPersonIds, relationshipIds };
      }

      queue.push(edge.personId);
    }
  }

  return null;
}

/**
 * 返回时间轴的闭区间；持续中的关系延伸至给定的当前年份。
 */
export function yearBounds(document, openEndedYear = currentYear()) {
  assertValidDocument(document);
  if (!isValidYear(openEndedYear)) {
    throw new TypeError(
      `openEndedYear must be an integer from ${MIN_YEAR} through ${MAX_YEAR}`,
    );
  }
  if (document.relationships.length === 0) {
    return { min: openEndedYear, max: openEndedYear };
  }

  let min = MAX_YEAR;
  let max = MIN_YEAR;
  for (const relationship of document.relationships) {
    min = Math.min(min, relationship.startedYear);
    max = Math.max(
      max,
      relationship.startedYear,
      relationship.endedYear ?? openEndedYear,
    );
  }
  return { min, max };
}

/**
 * 新建人物并返回新文档；可传名称字符串或人物对象。
 */
export function createPerson(document, personInput) {
  assertValidDocument(document);
  const input = typeof personInput === "string"
    ? { name: personInput }
    : personInput;
  if (!isRecord(input)) throw new TypeError("personInput must be an object or name");

  const next = cloneDocument(document);
  const person = {
    ...cloneValue(input),
    id: typeof input.id === "string" && input.id.trim() !== ""
      ? input.id.trim()
      : nextAvailableId(next, "person"),
    name: typeof input.name === "string" ? input.name.trim() : input.name,
  };

  if (!Object.hasOwn(person, "color")) {
    person.color = PERSON_COLORS[next.people.length % PERSON_COLORS.length];
  }
  next.people = [...next.people, person];
  return assertValidDocument(next);
}

/**
 * 新建关系并返回新文档；mutual 端点会自动转成 canonical ID 顺序。
 */
export function createRelationship(
  document,
  relationshipInput,
  targetPersonId,
  relationshipOptions = {},
) {
  assertValidDocument(document);
  let input = relationshipInput;
  if (typeof relationshipInput === "string" && typeof targetPersonId === "string") {
    input = {
      ...relationshipOptions,
      sourceId: relationshipInput,
      targetId: targetPersonId,
    };
  }
  if (!isRecord(input)) throw new TypeError("relationshipInput must be an object");

  const next = cloneDocument(document);
  const direction = input.direction ?? "mutual";
  const [sourceId, targetId] = canonicalEndpoints(
    input.sourceId,
    input.targetId,
    direction,
  );
  const relationship = {
    ...cloneValue(input),
    id: typeof input.id === "string" && input.id.trim() !== ""
      ? input.id.trim()
      : nextAvailableId(next, "relationship"),
    sourceId,
    targetId,
    kind: input.kind ?? "spark",
    direction,
    startedYear: input.startedYear ?? currentYear(),
    endedYear: input.endedYear ?? null,
    intensity: input.intensity ?? 3,
    note: input.note ?? "",
    visibility: input.visibility ?? "private",
  };

  next.relationships = [...next.relationships, relationship];
  return assertValidDocument(next);
}

/**
 * 删除人物时会级联删除其关系；删除关系只移除该关系。
 */
export function deleteEntity(document, typeOrId, maybeId) {
  assertValidDocument(document);
  let type;
  let id;

  if (isRecord(typeOrId)) {
    type = typeOrId.type ?? typeOrId.entityType;
    id = typeOrId.id;
  } else if (maybeId === undefined) {
    id = typeOrId;
    if (document.people.some((person) => person.id === id)) type = "person";
    else if (document.relationships.some((relationship) => relationship.id === id)) {
      type = "relationship";
    }
  } else {
    type = typeOrId;
    id = maybeId;
  }

  if (type === "people") type = "person";
  if (type === "relationships" || type === "relation") type = "relationship";
  if (type !== "person" && type !== "relationship") {
    throw new RangeError(`entity \"${String(id)}\" was not found`);
  }

  const next = cloneDocument(document);
  if (type === "person") {
    if (!next.people.some((person) => person.id === id)) {
      throw new RangeError(`person \"${String(id)}\" was not found`);
    }
    next.people = next.people.filter((person) => person.id !== id);
    next.relationships = next.relationships.filter(
      (relationship) =>
        relationship.sourceId !== id && relationship.targetId !== id,
    );
  } else {
    if (!next.relationships.some((relationship) => relationship.id === id)) {
      throw new RangeError(`relationship \"${String(id)}\" was not found`);
    }
    next.relationships = next.relationships.filter(
      (relationship) => relationship.id !== id,
    );
  }

  return assertValidDocument(next);
}

/**
 * 序列化经过校验的文档。
 */
export function exportDocument(document, options = {}) {
  assertValidDocument(document);
  const pretty = typeof options === "boolean" ? options : options.pretty ?? true;
  return JSON.stringify(document, null, pretty ? 2 : 0);
}

/**
 * 保存文档。推荐 saveDocument(document, { storage, key })；也兼容第二参数直接传 storage。
 */
export function saveDocument(document, options = {}) {
  assertValidDocument(document);
  let storage;
  let key;

  if (storageLike(options)) {
    storage = options;
    key = DEFAULT_STORAGE_KEY;
  } else if (typeof options === "string") {
    storage = defaultStorage();
    key = options;
  } else if (isRecord(options)) {
    storage = options.storage ?? defaultStorage();
    key = options.key ?? DEFAULT_STORAGE_KEY;
  } else {
    throw new TypeError("save options must be an object, storage, or key string");
  }

  if (!storageLike(storage)) {
    throw new Error("No Web Storage compatible storage is available");
  }
  if (typeof key !== "string" || key.trim() === "") {
    throw new TypeError("storage key must be a non-empty string");
  }

  storage.setItem(key, exportDocument(document, { pretty: false }));
  return cloneDocument(document);
}

/**
 * 读取并校验文档。无已保存数据时返回 fallback（默认是全新 demo）。
 */
export function loadDocument(options = {}) {
  let storage;
  let key;
  let fallback;

  if (storageLike(options)) {
    storage = options;
    key = DEFAULT_STORAGE_KEY;
    fallback = createDemoDocument();
  } else if (typeof options === "string") {
    storage = defaultStorage();
    key = options;
    fallback = createDemoDocument();
  } else if (isRecord(options)) {
    storage = options.storage ?? defaultStorage();
    key = options.key ?? DEFAULT_STORAGE_KEY;
    fallback = options.fallback ?? createDemoDocument();
  } else {
    throw new TypeError("load options must be an object, storage, or key string");
  }

  assertValidDocument(fallback);
  if (!storageLike(storage)) return cloneDocument(fallback);
  if (typeof key !== "string" || key.trim() === "") {
    throw new TypeError("storage key must be a non-empty string");
  }

  const serialized = storage.getItem(key);
  if (serialized === null || serialized === undefined || serialized === "") {
    return cloneDocument(fallback);
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new SyntaxError(`Stored relationship document is not valid JSON: ${cause.message}`);
  }
  assertValidDocument(parsed);
  return cloneDocument(parsed);
}
