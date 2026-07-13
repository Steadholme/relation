import assert from "node:assert/strict";
import test from "node:test";

import {
  DOCUMENT_LIMITS,
  RELATION_KINDS,
  assertValidDocument,
  cloneDocument,
  createDemoDocument,
  createPerson,
  createRelationship,
  deleteEntity,
  exportDocument,
  filterRelationships,
  graphStats,
  loadDocument,
  relationshipIsActive,
  saveDocument,
  shortestPath,
  validateDocument,
  yearBounds,
} from "../src/model.mjs";
import { HeartGraph } from "../src/graph.mjs";

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function emptyDocument() {
  return {
    schemaVersion: 1,
    id: "test-document",
    title: "测试星图",
    people: [],
    relationships: [],
  };
}

function makePathDocument() {
  let document = emptyDocument();
  for (const id of ["a", "b", "c", "d", "e"]) {
    document = createPerson(document, { id, name: `节点${id}` });
  }

  const edges = [
    ["ab", "a", "b", "mutual"],
    ["bc", "b", "c", "mutual"],
    ["ad", "a", "d", "mutual"],
    ["de", "d", "e", "mutual"],
    ["ec", "e", "c", "mutual"],
    ["ca", "c", "a", "directed"],
  ];
  for (const [id, sourceId, targetId, direction] of edges) {
    document = createRelationship(document, {
      id,
      sourceId,
      targetId,
      direction,
      kind: id === "ca" ? "affection" : "dated",
      startedYear: 2020,
      endedYear: null,
      intensity: 3,
      note: "",
      visibility: "public",
    });
  }
  return document;
}

test("默认文档完整映射授权的 RelationWeb data.js 数据", () => {
  const document = createDemoDocument();
  const validation = validateDocument(document);

  assert.deepEqual(RELATION_KINDS, ["partner", "dated", "affection"]);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(document.people.length, 116);
  assert.equal(document.relationships.length, 108);
  assert.match(document.description, /RelationWeb data\.js/);
  assert.equal(document.dataPolicy, "authorized-upstream-data");
  assert.deepEqual(document.source, {
    repository: "https://github.com/Last-emo-boy/RelationWeb",
    commit: "ea9b337492572b8cf63bb9c781fb2ecd70937346",
    path: "data.js",
    normalization: "reciprocal-partner-edges-canonicalized",
  });
  assert.equal(new Set(document.people.map(({ name }) => name)).size, document.people.length);
  assert.ok(document.people.every(({ name }) => /\p{Script=Han}/u.test(name)));
  assert.ok(document.people.every(({ gender }) => gender === "男" || gender === "女"));
  assert.ok(
    document.relationships.every((relationship) =>
      RELATION_KINDS.includes(relationship.kind),
    ),
  );
  assert.deepEqual(
    Object.fromEntries(
      RELATION_KINDS.map((kind) => [
        kind,
        document.relationships.filter((relationship) => relationship.kind === kind).length,
      ]),
    ),
    { partner: 16, dated: 43, affection: 49 },
  );
  assert.ok(
    document.relationships
      .filter(({ kind }) => kind === "partner" || kind === "dated")
      .every(({ direction }) => direction === "mutual"),
  );
  assert.ok(
    document.relationships
      .filter(({ kind }) => kind === "affection")
      .every(({ direction }) => direction === "directed"),
  );
});

test("演示文档与深拷贝彼此隔离", () => {
  const first = createDemoDocument();
  const second = createDemoDocument();
  const cloned = cloneDocument(first);

  cloned.people[0].name = "已修改";
  cloned.relationships[0].note = "已修改";
  assert.notEqual(first.people[0].name, cloned.people[0].name);
  assert.notEqual(first.relationships[0].note, cloned.relationships[0].note);
  assert.deepEqual(first, second);
});

test("上游没有年份字段时不虚构年份", () => {
  const document = createDemoDocument();
  assert.ok(
    document.relationships.every(
      ({ startedYear, endedYear }) => startedYear === 1 && endedYear === null,
    ),
  );
  assert.ok(document.relationships.every((relationship) => relationshipIsActive(relationship, 2026)));
  assert.equal(filterRelationships(document, { year: 2026 }).length, 108);
  assert.deepEqual(yearBounds(document, 2028), { min: 1, max: 2028 });
});

test("graphStats 可按时间和可见性生成稳定统计", () => {
  const document = createDemoDocument();
  const stats = graphStats(document, { year: 2024, visibility: "public" });

  assert.equal(stats.people, document.people.length);
  assert.equal(stats.relationships, 108);
  assert.equal(stats.active, stats.relationships);
  assert.equal(
    Object.values(stats.byKind).reduce((sum, count) => sum + count, 0),
    stats.relationships,
  );
  assert.ok(stats.averageIntensity >= 1 && stats.averageIntensity <= 5);
  assert.ok(stats.density > 0 && stats.density <= 1);
});

test("shortestPath 使用 BFS 取得最少边数并保留对应关系 ID", () => {
  const document = makePathDocument();

  assert.deepEqual(shortestPath(document, "a", "c"), {
    personIds: ["a", "b", "c"],
    relationshipIds: ["ab", "bc"],
  });
  assert.deepEqual(shortestPath(document, "a", "a"), {
    personIds: ["a"],
    relationshipIds: [],
  });
  assert.equal(shortestPath(document, "missing", "a"), null);

  // directed 的 ca 默认不能从 a 反向直达 c。
  assert.deepEqual(shortestPath(document, "c", "a"), {
    personIds: ["c", "a"],
    relationshipIds: ["ca"],
  });
  assert.deepEqual(shortestPath(document, "a", "c", { respectDirection: false }), {
    personIds: ["a", "c"],
    relationshipIds: ["ca"],
  });
});

test("重复 ID 与规范化后的重复名字会被拒绝", () => {
  const duplicateId = cloneDocument(createDemoDocument());
  duplicateId.people.push({
    id: duplicateId.people[0].id,
    name: "新名字",
  });
  const idResult = validateDocument(duplicateId);
  assert.equal(idResult.valid, false);
  assert.ok(idResult.errors.some((error) => /duplicate ID/.test(error)));

  const duplicateName = cloneDocument(createDemoDocument());
  duplicateName.people.push({ id: "p10", name: duplicateName.people[0].name });
  const nameResult = validateDocument(duplicateName);
  assert.equal(nameResult.valid, false);
  assert.ok(nameResult.errors.some((error) => /duplicate name/.test(error)));

  const globalDuplicate = cloneDocument(createDemoDocument());
  globalDuplicate.relationships[0].id = globalDuplicate.people[0].id;
  assert.ok(
    validateDocument(globalDuplicate).errors.some((error) => /duplicate ID/.test(error)),
  );
});

test("dangling endpoint、自环和非法日期会被明确报告", () => {
  const dangling = cloneDocument(createDemoDocument());
  dangling.relationships[0].targetId = "missing-person";
  assert.ok(
    validateDocument(dangling).errors.some((error) => /references missing person/.test(error)),
  );

  const selfLoop = cloneDocument(createDemoDocument());
  selfLoop.relationships[0].targetId = selfLoop.relationships[0].sourceId;
  assert.ok(
    validateDocument(selfLoop).errors.some((error) => /self relationships/.test(error)),
  );

  const badDate = cloneDocument(createDemoDocument());
  badDate.relationships[0].startedYear = 2;
  badDate.relationships[0].endedYear = 1;
  badDate.relationships[1].startedYear = "2020";
  const dateResult = validateDocument(badDate);
  assert.ok(dateResult.errors.some((error) => /earlier than startedYear/.test(error)));
  assert.ok(dateResult.errors.some((error) => /startedYear/.test(error)));
  assert.throws(() => assertValidDocument(badDate), (error) => {
    assert.ok(Array.isArray(error.errors));
    return /Invalid relationship document/.test(error.message);
  });
});

test("createPerson 保留合法 gender 并拒绝未知值", () => {
  const withGender = createPerson(emptyDocument(), {
    id: "person-gender",
    name: "测试人物",
    gender: "女",
  });
  assert.equal(withGender.people[0].gender, "女");

  assert.throws(
    () => createPerson(emptyDocument(), {
      id: "person-invalid-gender",
      name: "测试人物",
      gender: "其",
    }),
    /must be 男 or 女/,
  );
});

test("文档规模与字符串长度边界阻止过量本地数据进入图布局", () => {
  const tooManyPeople = emptyDocument();
  tooManyPeople.people = Array.from(
    { length: DOCUMENT_LIMITS.people + 1 },
    (_, index) => ({ id: `person-${index}`, name: `人物${index}` }),
  );
  assert.ok(
    validateDocument(tooManyPeople).errors.some((error) =>
      error.includes(`at most ${DOCUMENT_LIMITS.people} entries`)),
  );

  const tooManyRelationships = emptyDocument();
  tooManyRelationships.relationships = Array.from(
    { length: DOCUMENT_LIMITS.relationships + 1 },
    () => ({}),
  );
  assert.ok(
    validateDocument(tooManyRelationships).errors.some((error) =>
      error.includes(`at most ${DOCUMENT_LIMITS.relationships} entries`)),
  );

  const fullDocument = emptyDocument();
  fullDocument.people = Array.from(
    { length: DOCUMENT_LIMITS.people },
    (_, index) => ({ id: `person-${index}`, name: `人物${index}` }),
  );
  assert.equal(validateDocument(fullDocument).valid, true);
  assert.throws(
    () => createPerson(fullDocument, { id: "overflow", name: "越界人物" }),
    new RegExp(`at most ${DOCUMENT_LIMITS.people} entries`),
  );

  const longTitle = cloneDocument(createDemoDocument());
  longTitle.title = "星".repeat(DOCUMENT_LIMITS.title + 1);
  assert.ok(
    validateDocument(longTitle).errors.some((error) => /title: must contain at most/.test(error)),
  );

  const longName = cloneDocument(createDemoDocument());
  longName.people[0].name = "月".repeat(DOCUMENT_LIMITS.personName + 1);
  assert.ok(
    validateDocument(longName).errors.some((error) =>
      /people\[0\]\.name: must contain at most/.test(error)),
  );

  const longNote = cloneDocument(createDemoDocument());
  longNote.relationships[0].note = "光".repeat(DOCUMENT_LIMITS.relationshipNote + 1);
  assert.ok(
    validateDocument(longNote).errors.some((error) =>
      /relationships\[0\]\.note: must contain at most/.test(error)),
  );

  const oversizedPayload = cloneDocument(createDemoDocument());
  oversizedPayload.extension = "x".repeat(DOCUMENT_LIMITS.serializedCharacters);
  assert.ok(
    validateDocument(oversizedPayload).errors.some((error) =>
      /document: serialized form must contain at most/.test(error)),
  );
});

test("选中关系的粒子只运行有限时长且 reduced-motion 始终禁用粒子", () => {
  let now = 100;
  const edge = {
    id: "r01",
    source: { id: "p01" },
    target: { id: "p02" },
  };
  const graph = Object.create(HeartGraph.prototype);
  Object.assign(graph, {
    destroyed: false,
    motionReduced: false,
    particleAnimationUntil: 0,
    selection: null,
    edgeById: new Map([[edge.id, edge]]),
    nodeById: new Map(),
    adjacency: new Map(),
    pathRelationshipIds: new Set(),
    pathNodeIds: new Set(),
    physicsActive: false,
    cameraAnimation: null,
    nodes: [],
    needsDraw: false,
    alpha: 0,
    stableFrames: 0,
    now: () => now,
    requestDraw() {
      this.needsDraw = true;
    },
  });

  graph.setSelection({ type: "relationship", id: edge.id });
  assert.deepEqual(graph.activeParticleEdges(), [edge]);
  assert.equal(graph.hasActiveAnimation(), true);

  graph.needsDraw = false;
  now += 10_000;
  assert.deepEqual(graph.activeParticleEdges(), []);
  assert.equal(graph.particleAnimationUntil, 0);
  assert.equal(graph.needsDraw, true);
  assert.equal(graph.hasActiveAnimation(), false);

  graph.setSelection({ type: "relationship", id: edge.id });
  graph.setMotionReduced(true);
  assert.equal(graph.particleAnimationUntil, 0);
  assert.deepEqual(graph.activeParticleEdges(), []);
  assert.equal(graph.hasActiveAnimation(), false);
});

test("mutual 关系创建时 canonicalize，反向重复关系仍会被拒绝", () => {
  let document = emptyDocument();
  document = createPerson(document, { id: "a", name: "甲" });
  document = createPerson(document, { id: "z", name: "乙" });
  const before = cloneDocument(document);
  document = createRelationship(document, {
    id: "first",
    sourceId: "z",
    targetId: "a",
    kind: "dated",
    direction: "mutual",
    startedYear: 2024,
    endedYear: null,
    intensity: 3,
    note: "",
    visibility: "public",
  });

  assert.deepEqual(before.relationships, []);
  assert.equal(document.relationships[0].sourceId, "a");
  assert.equal(document.relationships[0].targetId, "z");
  assert.throws(
    () =>
      createRelationship(document, {
        id: "second",
        sourceId: "z",
        targetId: "a",
        kind: "dated",
        direction: "mutual",
        startedYear: 2025,
        endedYear: null,
        intensity: 4,
        note: "",
        visibility: "public",
      }),
    /duplicates canonical relationship/,
  );

  const nonCanonical = cloneDocument(document);
  [nonCanonical.relationships[0].sourceId, nonCanonical.relationships[0].targetId] = [
    nonCanonical.relationships[0].targetId,
    nonCanonical.relationships[0].sourceId,
  ];
  assert.ok(
    validateDocument(nonCanonical).errors.some((error) => /canonical ID order/.test(error)),
  );
});

test("不可变 CRUD 添加实体并在删除人物时级联清理关系", () => {
  const original = createDemoDocument();
  const withPerson = createPerson(original, { id: "p10", name: "程逐风" });
  const withRelationship = createRelationship(withPerson, {
    id: "r12",
    sourceId: "p10",
    targetId: "p001",
    kind: "dated",
    direction: "mutual",
    startedYear: 2026,
    endedYear: null,
    intensity: 4,
    note: "新出现的合成关系。",
    visibility: "private",
  });

  assert.equal(original.people.some(({ id }) => id === "p10"), false);
  assert.equal(withPerson.relationships.some(({ id }) => id === "r12"), false);
  assert.deepEqual(
    withRelationship.relationships.find(({ id }) => id === "r12"),
    {
      id: "r12",
      sourceId: "p001",
      targetId: "p10",
      kind: "dated",
      direction: "mutual",
      startedYear: 2026,
      endedYear: null,
      intensity: 4,
      note: "新出现的合成关系。",
      visibility: "private",
    },
  );

  const withoutPerson = deleteEntity(withRelationship, "person", "p10");
  assert.equal(withoutPerson.people.some(({ id }) => id === "p10"), false);
  assert.equal(withoutPerson.relationships.some(({ id }) => id === "r12"), false);
  assert.equal(withRelationship.people.some(({ id }) => id === "p10"), true);

  const withoutRelationship = deleteEntity(original, { type: "relationship", id: "r001" });
  assert.equal(withoutRelationship.relationships.some(({ id }) => id === "r001"), false);
  assert.equal(original.relationships.some(({ id }) => id === "r001"), true);
  assert.throws(() => deleteEntity(original, "missing"), /was not found/);
});

test("save/load/export 可在注入的 storage 中无损往返且不泄露引用", () => {
  const storage = memoryStorage();
  const document = createDemoDocument();
  const saved = saveDocument(document, { storage, key: "relation-test" });
  const loaded = loadDocument({ storage, key: "relation-test" });

  assert.deepEqual(saved, document);
  assert.deepEqual(loaded, document);
  assert.notEqual(loaded, document);
  loaded.people[0].name = "本地改动";
  assert.notEqual(loadDocument({ storage, key: "relation-test" }).people[0].name, "本地改动");

  const compact = exportDocument(document, { pretty: false });
  assert.equal(compact.includes("\n"), false);
  assert.deepEqual(JSON.parse(compact), document);

  const fallback = emptyDocument();
  const missing = loadDocument({ storage, key: "missing", fallback });
  assert.deepEqual(missing, fallback);
  assert.notEqual(missing, fallback);

  storage.setItem("broken", "{not-json");
  assert.throws(
    () => loadDocument({ storage, key: "broken" }),
    /not valid JSON/,
  );
});
