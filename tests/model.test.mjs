import assert from "node:assert/strict";
import test from "node:test";

import {
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
      kind: id === "ca" ? "affection" : "spark",
      startedYear: 2020,
      endedYear: null,
      intensity: 3,
      note: "",
      visibility: "public",
    });
  }
  return document;
}

test("默认文档只包含合成中文名字和无性别的合法数据", () => {
  const document = createDemoDocument();
  const validation = validateDocument(document);

  assert.deepEqual(RELATION_KINDS, [
    "partner",
    "dated",
    "affection",
    "spark",
  ]);
  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.ok(document.people.length >= 8);
  assert.ok(document.relationships.length >= 10);
  assert.match(document.description, /合成/);
  assert.equal(new Set(document.people.map(({ name }) => name)).size, document.people.length);
  assert.ok(document.people.every(({ name }) => /\p{Script=Han}/u.test(name)));
  assert.ok(
    document.people.every(
      (person) => !("gender" in person) && !("sex" in person),
    ),
  );
  assert.ok(
    document.relationships.every((relationship) =>
      RELATION_KINDS.includes(relationship.kind),
    ),
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

test("时间轴使用包含端点并正确过滤 active relationship", () => {
  const document = createDemoDocument();
  const ended = document.relationships.find(({ id }) => id === "r03");
  const ongoing = document.relationships.find(({ id }) => id === "r01");

  assert.equal(relationshipIsActive(ended, 2018), false);
  assert.equal(relationshipIsActive(ended, 2019), true);
  assert.equal(relationshipIsActive(ended, 2021), true);
  assert.equal(relationshipIsActive(ended, 2022), false);
  assert.equal(relationshipIsActive(ongoing, 2026), true);

  assert.deepEqual(
    filterRelationships(document, { year: 2019 }).map(({ id }) => id),
    ["r03", "r09"],
  );
  assert.deepEqual(
    filterRelationships(document, { year: 2024, kind: "partner" }).map(
      ({ id }) => id,
    ),
    ["r01", "r06"],
  );
  assert.deepEqual(yearBounds(document, 2028), { min: 2018, max: 2028 });
});

test("graphStats 可按时间和可见性生成稳定统计", () => {
  const document = createDemoDocument();
  const stats = graphStats(document, { year: 2024, visibility: "public" });

  assert.equal(stats.people, document.people.length);
  assert.equal(stats.relationships, 7);
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
  badDate.relationships[0].endedYear = badDate.relationships[0].startedYear - 1;
  badDate.relationships[1].startedYear = "2020";
  const dateResult = validateDocument(badDate);
  assert.ok(dateResult.errors.some((error) => /earlier than startedYear/.test(error)));
  assert.ok(dateResult.errors.some((error) => /startedYear/.test(error)));
  assert.throws(() => assertValidDocument(badDate), (error) => {
    assert.ok(Array.isArray(error.errors));
    return /Invalid relationship document/.test(error.message);
  });
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
    kind: "spark",
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
        kind: "spark",
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
    targetId: "p01",
    kind: "spark",
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
      sourceId: "p01",
      targetId: "p10",
      kind: "spark",
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

  const withoutRelationship = deleteEntity(original, { type: "relationship", id: "r01" });
  assert.equal(withoutRelationship.relationships.some(({ id }) => id === "r01"), false);
  assert.equal(original.relationships.some(({ id }) => id === "r01"), true);
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
