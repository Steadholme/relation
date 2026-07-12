import { HeartGraph } from "./graph.mjs";
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
  saveDocument,
  shortestPath,
  yearBounds,
} from "./model.mjs";

const STORAGE_KEY = "w33d.relation.heartlines.v1";
const THEME_KEY = "w33d.relation.theme.v1";
const MOTION_KEY = "w33d.relation.motion.v1";
const HISTORY_LIMIT = 40;

const KIND_META = Object.freeze({
  partner: { label: "伴侣", short: "PAIR" },
  dated: { label: "曾经交往", short: "PAST" },
  affection: { label: "心动", short: "PULSE" },
  spark: { label: "火花", short: "SPARK" },
});

const ACCENTS = Object.freeze([
  "#e87352",
  "#45c2b1",
  "#8d7cff",
  "#f1a340",
  "#63a4ff",
  "#d86cff",
]);

const dom = {};
const requiredIds = [
  "app",
  "brandButton",
  "saveStatus",
  "saveStatusText",
  "modeExplore",
  "modeStudio",
  "themeToggle",
  "motionToggle",
  "undoButton",
  "redoButton",
  "searchInput",
  "searchResults",
  "peopleMetric",
  "relationsMetric",
  "componentsMetric",
  "temperatureMetric",
  "allFilter",
  "addPersonButton",
  "addRelationshipButton",
  "pathSource",
  "pathTarget",
  "findPathButton",
  "clearPathButton",
  "pathSummary",
  "relationCanvas",
  "graphLoading",
  "zoomIn",
  "zoomOut",
  "fitGraph",
  "exportPng",
  "graphViewButton",
  "listViewButton",
  "a11yView",
  "graphSummary",
  "peopleList",
  "relationsList",
  "timelineRange",
  "timelineYear",
  "timelinePlay",
  "inspectorKicker",
  "inspectorTitle",
  "inspectorBody",
  "deleteSelectionButton",
  "resetDemoButton",
  "exportJsonButton",
  "personDialog",
  "personForm",
  "personName",
  "personAccent",
  "personVisibility",
  "relationshipDialog",
  "relationshipForm",
  "relationshipSource",
  "relationshipTarget",
  "relationshipKind",
  "relationshipDirection",
  "relationshipStarted",
  "relationshipEnded",
  "relationshipIntensity",
  "relationshipNote",
  "relationshipVisibility",
  "closePersonDialog",
  "closeRelationshipDialog",
  "toastRegion",
  "liveRegion",
];

for (const id of requiredIds) {
  const element = window.document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  dom[id] = element;
}

const state = {
  activeKinds: new Set(RELATION_KINDS),
  document: null,
  future: [],
  graph: null,
  history: [],
  layout: "constellation",
  mode: "explore",
  motionReduced: false,
  path: null,
  playing: false,
  playbackTimer: null,
  selection: null,
  theme: "dark",
  view: "graph",
  year: new Date().getFullYear(),
};

function safeStorageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStorageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function element(tag, options = {}) {
  const node = window.document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.type) node.type = options.type;
  if (options.value !== undefined) node.value = options.value;
  if (options.dataset) Object.assign(node.dataset, options.dataset);
  if (options.attributes) {
    for (const [name, value] of Object.entries(options.attributes)) {
      node.setAttribute(name, value);
    }
  }
  return node;
}

function personById(id) {
  return state.document.people.find((person) => person.id === id) ?? null;
}

function relationshipById(id) {
  return state.document.relationships.find((relationship) => relationship.id === id) ?? null;
}

function displayName(id) {
  return personById(id)?.name ?? "未知人物";
}

function currentRelationships() {
  return filterRelationships(state.document, {
    kinds: [...state.activeKinds],
    year: state.year,
  });
}

function currentGraphPeople() {
  return state.document.people.map((person) => ({
    ...person,
    accent: person.color,
    displayName: person.name,
  }));
}

function countComponents(people, relationships) {
  if (people.length === 0) return 0;
  const adjacency = new Map(people.map((person) => [person.id, []]));
  for (const relationship of relationships) {
    adjacency.get(relationship.sourceId)?.push(relationship.targetId);
    adjacency.get(relationship.targetId)?.push(relationship.sourceId);
  }

  let count = 0;
  const visited = new Set();
  for (const person of people) {
    if (visited.has(person.id)) continue;
    count += 1;
    const queue = [person.id];
    visited.add(person.id);
    for (let index = 0; index < queue.length; index += 1) {
      for (const neighbor of adjacency.get(queue[index]) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return count;
}

function setSaveState(saveState, text) {
  dom.saveStatus.dataset.state = saveState;
  dom.saveStatusText.textContent = text;
}

function announce(message) {
  dom.liveRegion.textContent = "";
  window.requestAnimationFrame(() => {
    dom.liveRegion.textContent = message;
  });
}

function toast(message, tone = "info") {
  const item = element("div", {
    className: "toast",
    text: message,
    attributes: { role: "status" },
    dataset: { tone },
  });
  dom.toastRegion.append(item);
  window.setTimeout(() => item.classList.add("is-leaving"), 2800);
  window.setTimeout(() => item.remove(), 3200);
  announce(message);
}

function persistDocument() {
  setSaveState("saving", "正在保存…");
  try {
    saveDocument(state.document, {
      key: STORAGE_KEY,
      storage: window.localStorage,
    });
    setSaveState("saved", "已保存到此设备");
    return true;
  } catch {
    setSaveState("error", "暂时无法保存");
    return false;
  }
}

function commitDocument(nextDocument, message) {
  assertValidDocument(nextDocument);
  state.history.push(cloneDocument(state.document));
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  state.future = [];
  state.document = cloneDocument(nextDocument);
  state.path = null;
  state.selection = null;

  const bounds = yearBounds(state.document, new Date().getFullYear());
  state.year = Math.max(bounds.min, Math.min(bounds.max, state.year));
  persistDocument();
  renderAll({ refit: true });
  if (message) toast(message, "success");
}

function undo() {
  const previous = state.history.pop();
  if (!previous) return;
  state.future.push(cloneDocument(state.document));
  state.document = previous;
  state.selection = null;
  state.path = null;
  persistDocument();
  renderAll({ refit: true });
  toast("已撤销上一步编辑");
}

function redo() {
  const next = state.future.pop();
  if (!next) return;
  state.history.push(cloneDocument(state.document));
  state.document = next;
  state.selection = null;
  state.path = null;
  persistDocument();
  renderAll({ refit: true });
  toast("已重做编辑");
}

function setMode(mode) {
  state.mode = mode;
  dom.app.dataset.mode = mode;
  for (const [button, value] of [
    [dom.modeExplore, "explore"],
    [dom.modeStudio, "studio"],
  ]) {
    const active = value === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function setView(view) {
  state.view = view;
  dom.app.dataset.view = view;
  const list = view === "list";
  dom.a11yView.hidden = !list;
  dom.graphViewButton.classList.toggle("is-active", !list);
  dom.graphViewButton.setAttribute("aria-pressed", String(!list));
  dom.listViewButton.classList.toggle("is-active", list);
  dom.listViewButton.setAttribute("aria-pressed", String(list));
  if (!list) window.requestAnimationFrame(() => state.graph.fit());
}

function setTheme(theme) {
  state.theme = theme;
  dom.app.dataset.theme = theme;
  dom.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
  dom.themeToggle.setAttribute(
    "aria-label",
    theme === "dark" ? "切换到浅色主题" : "切换到深色主题",
  );
  safeStorageSet(THEME_KEY, theme);
  state.graph?.setGraph({
    people: currentGraphPeople(),
    relationships: currentRelationships(),
  });
  state.graph?.setSelection(state.selection, state.path?.relationshipIds ?? []);
}

function setMotionReduced(reduced) {
  state.motionReduced = reduced;
  dom.app.dataset.motion = reduced ? "reduced" : "full";
  dom.motionToggle.setAttribute("aria-pressed", String(reduced));
  dom.motionToggle.setAttribute(
    "aria-label",
    reduced ? "恢复完整动效" : "减少动效",
  );
  safeStorageSet(MOTION_KEY, reduced ? "reduced" : "full");
  state.graph?.setMotionReduced(reduced);
}

function setSelection(selection, options = {}) {
  state.selection = selection;
  state.graph.setSelection(selection, state.path?.relationshipIds ?? []);
  renderInspector();
  renderEntityLists();

  if (selection?.type === "person" && options.focus !== false) {
    state.graph.focusPerson(selection.id);
    announce(`已选择${displayName(selection.id)}`);
  } else if (selection?.type === "relationship") {
    const relationship = relationshipById(selection.id);
    if (relationship) {
      announce(`已选择${displayName(relationship.sourceId)}与${displayName(relationship.targetId)}的关系`);
    }
  }
}

function renderMetrics(relationships) {
  const stats = graphStats(state.document, {
    kinds: [...state.activeKinds],
    year: state.year,
  });
  dom.peopleMetric.textContent = String(stats.peopleCount);
  dom.relationsMetric.textContent = String(stats.relationshipCount);
  dom.componentsMetric.textContent = String(
    countComponents(state.document.people, relationships),
  );
  dom.temperatureMetric.textContent = `${Math.round(stats.averageIntensity * 20)}°`;
}

function renderFilters() {
  const all = state.activeKinds.size === RELATION_KINDS.length;
  dom.allFilter.classList.toggle("is-active", all);
  dom.allFilter.setAttribute("aria-pressed", String(all));
  for (const button of window.document.querySelectorAll("[data-kind]")) {
    const active = state.activeKinds.has(button.dataset.kind) && !all;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
}

function optionForPerson(person, selectedValue = "") {
  const option = element("option", { text: person.name, value: person.id });
  option.selected = person.id === selectedValue;
  return option;
}

function replacePersonOptions(select, placeholder, selectedValue = select.value) {
  const placeholderOption = element("option", { text: placeholder, value: "" });
  select.replaceChildren(
    placeholderOption,
    ...state.document.people.map((person) => optionForPerson(person, selectedValue)),
  );
  if (state.document.people.some((person) => person.id === selectedValue)) {
    select.value = selectedValue;
  }
}

function renderPersonOptions() {
  replacePersonOptions(dom.pathSource, "选择起点人物");
  replacePersonOptions(dom.pathTarget, "选择终点人物");
  replacePersonOptions(dom.relationshipSource, "选择人物");
  replacePersonOptions(dom.relationshipTarget, "选择人物");
}

function renderTimeline() {
  const bounds = yearBounds(state.document, new Date().getFullYear());
  state.year = Math.max(bounds.min, Math.min(bounds.max, state.year));
  dom.timelineRange.min = String(bounds.min);
  dom.timelineRange.max = String(bounds.max);
  dom.timelineRange.value = String(state.year);
  dom.timelineYear.textContent = String(state.year);
  dom.timelinePlay.setAttribute("aria-pressed", String(state.playing));
  dom.timelinePlay.setAttribute(
    "aria-label",
    state.playing ? "暂停时间轴" : "播放时间轴",
  );
  dom.timelinePlay.classList.toggle("is-playing", state.playing);
}

function relatedForPerson(personId, relationships = currentRelationships()) {
  return relationships.filter(
    (relationship) =>
      relationship.sourceId === personId || relationship.targetId === personId,
  );
}

function infoRow(label, value) {
  const row = element("div", { className: "inspector-row" });
  row.append(
    element("span", { text: label }),
    element("strong", { text: value }),
  );
  return row;
}

function actionButton(label, action, className = "button button--secondary") {
  return element("button", {
    className,
    text: label,
    type: "button",
    dataset: { inspectorAction: action },
  });
}

function renderInspector() {
  const body = dom.inspectorBody;
  body.replaceChildren();
  dom.deleteSelectionButton.disabled = !state.selection;

  if (!state.selection) {
    dom.inspectorKicker.textContent = "SELECTION / NONE";
    dom.inspectorTitle.textContent = "选择一颗星";
    const empty = element("div", { className: "selection-empty" });
    const orbit = element("div", { className: "selection-empty__orbit" });
    orbit.append(element("span"));
    empty.append(
      orbit,
      element("p", { text: "关系不是排名，而是一张仍在变化的地图。" }),
      element("small", {
        text: `当前停在 ${state.year} 年。点选节点、连线，或使用左侧路径工具。`,
      }),
    );
    body.append(empty);
    return;
  }

  if (state.selection.type === "person") {
    const person = personById(state.selection.id);
    if (!person) {
      state.selection = null;
      renderInspector();
      return;
    }
    const relationships = relatedForPerson(person.id);
    dom.inspectorKicker.textContent = `PERSON / ${person.id.toUpperCase()}`;
    dom.inspectorTitle.textContent = person.name;

    const hero = element("section", { className: "inspector-person" });
    hero.append(
      element("div", {
        className: "inspector-person__avatar",
        text: person.emoji || person.name.slice(0, 1),
      }),
      element("div", { className: "inspector-person__copy" }),
    );
    hero.lastElementChild.append(
      element("span", { text: person.visibility === "public" ? "可公开" : "仅此设备" }),
      element("strong", {
        text: `${relationships.length} 条当前关系线`,
      }),
    );
    body.append(hero);

    const actions = element("div", { className: "inspector-actions" });
    actions.append(
      actionButton("编辑人物", "edit-person"),
      actionButton("从这里连接", "connect-person", "button button--primary"),
      actionButton("设为路径起点", "path-source", "button button--quiet"),
    );
    body.append(actions);

    const list = element("div", { className: "inspector-connections" });
    list.append(element("h3", { text: `${state.year} 年的连接` }));
    if (relationships.length === 0) {
      list.append(element("p", { text: "这个时间切片里还没有可见连接。" }));
    } else {
      for (const relationship of relationships) {
        const otherId = relationship.sourceId === person.id
          ? relationship.targetId
          : relationship.sourceId;
        const button = element("button", {
          className: "connection-item",
          type: "button",
          dataset: { relationshipId: relationship.id },
        });
        button.append(
          element("span", { text: displayName(otherId) }),
          element("small", { text: KIND_META[relationship.kind].label }),
        );
        list.append(button);
      }
    }
    body.append(list);
    return;
  }

  const relationship = relationshipById(state.selection.id);
  if (!relationship) {
    state.selection = null;
    renderInspector();
    return;
  }
  dom.inspectorKicker.textContent = `HEARTLINE / ${relationship.id.toUpperCase()}`;
  dom.inspectorTitle.textContent = KIND_META[relationship.kind].label;

  const pairing = element("section", { className: "inspector-pairing" });
  pairing.append(
    element("strong", { text: displayName(relationship.sourceId) }),
    element("span", {
      className: `relation-glyph relation-glyph--${relationship.kind}`,
      text: relationship.direction === "directed" ? "→" : "↔",
      attributes: { "aria-label": relationship.direction === "directed" ? "单向" : "双向" },
    }),
    element("strong", { text: displayName(relationship.targetId) }),
  );
  body.append(pairing);
  const details = element("div", { className: "inspector-details" });
  details.append(
    infoRow("时间", `${relationship.startedYear} — ${relationship.endedYear ?? "现在"}`),
    infoRow("方向", relationship.direction === "directed" ? "单向" : "双向"),
    infoRow("强度", `${relationship.intensity} / 5`),
    infoRow("可见性", relationship.visibility === "public" ? "可公开" : "仅此设备"),
  );
  body.append(details);
  if (relationship.note) {
    const note = element("blockquote", {
      className: "inspector-note",
      text: relationship.note,
    });
    body.append(note);
  }
  const actions = element("div", { className: "inspector-actions" });
  actions.append(actionButton("编辑关系", "edit-relationship", "button button--primary"));
  body.append(actions);
}

function entityButton(primary, secondary, dataset, selected) {
  const button = element("button", {
    className: `entity-list__button${selected ? " is-selected" : ""}`,
    type: "button",
    dataset,
  });
  button.append(
    element("strong", { text: primary }),
    element("span", { text: secondary }),
  );
  return button;
}

function entityListItem(button) {
  const item = element("li");
  item.append(button);
  return item;
}

function renderEntityLists() {
  const relationships = currentRelationships();
  const components = countComponents(state.document.people, relationships);
  dom.graphSummary.textContent = `${state.year} 年：${state.document.people.length} 个人物，${relationships.length} 条关系，${components} 个星群。`;
  dom.peopleList.replaceChildren(
    ...state.document.people.map((person) =>
      entityListItem(
        entityButton(
          person.name,
          `${relatedForPerson(person.id, relationships).length} 条连接`,
          { personId: person.id },
          state.selection?.type === "person" && state.selection.id === person.id,
        ),
      ),
    ),
  );
  dom.relationsList.replaceChildren(
    ...relationships.map((relationship) =>
      entityListItem(
        entityButton(
          `${displayName(relationship.sourceId)} ${relationship.direction === "directed" ? "→" : "↔"} ${displayName(relationship.targetId)}`,
          `${KIND_META[relationship.kind].label} · ${relationship.startedYear}—${relationship.endedYear ?? "现在"}`,
          { relationshipId: relationship.id },
          state.selection?.type === "relationship" && state.selection.id === relationship.id,
        ),
      ),
    ),
  );
}

function renderHistoryControls() {
  dom.undoButton.disabled = state.history.length === 0;
  dom.redoButton.disabled = state.future.length === 0;
}

function renderGraph(options = {}) {
  const relationships = currentRelationships();
  if (
    state.selection?.type === "relationship" &&
    !relationships.some((relationship) => relationship.id === state.selection.id)
  ) {
    state.selection = null;
  }
  if (
    state.path &&
    state.path.relationshipIds.some(
      (id) => !relationships.some((relationship) => relationship.id === id),
    )
  ) {
    state.path = null;
  }

  state.graph.setGraph({ people: currentGraphPeople(), relationships });
  state.graph.setSelection(state.selection, state.path?.relationshipIds ?? []);
  if (options.refit) {
    state.graph.setLayout(
      state.layout,
      state.selection?.type === "person" ? state.selection.id : undefined,
    );
    window.requestAnimationFrame(() => state.graph.fit());
  }
  renderMetrics(relationships);
}

function renderAll(options = {}) {
  renderFilters();
  renderPersonOptions();
  renderTimeline();
  renderGraph(options);
  renderInspector();
  renderEntityLists();
  renderHistoryControls();
  setPathSummary();
}

function closeSearch() {
  dom.searchResults.hidden = true;
  dom.searchInput.setAttribute("aria-expanded", "false");
}

function renderSearch() {
  const query = dom.searchInput.value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
  dom.searchResults.replaceChildren();
  if (!query) {
    closeSearch();
    return;
  }

  const matches = state.document.people
    .filter((person) =>
      `${person.name} ${person.alias ?? ""}`
        .normalize("NFKC")
        .toLocaleLowerCase("zh-CN")
        .includes(query),
    )
    .slice(0, 8);
  if (matches.length === 0) {
    dom.searchResults.append(
      element("p", { className: "search-results__empty", text: "没有找到这颗星。" }),
    );
  } else {
    for (const person of matches) {
      const button = element("button", {
        className: "search-result",
        type: "button",
        dataset: { personId: person.id },
        attributes: { role: "option" },
      });
      button.append(
        element("span", { className: "search-result__avatar", text: person.emoji || person.name[0] }),
        element("strong", { text: person.name }),
        element("small", { text: `${relatedForPerson(person.id).length} 条连接` }),
      );
      dom.searchResults.append(button);
    }
  }
  dom.searchResults.hidden = false;
  dom.searchInput.setAttribute("aria-expanded", "true");
}

function setPathSummary() {
  if (!state.path) {
    dom.pathSummary.textContent = "选择两个人物，查看关系如何相连。";
    return;
  }
  const names = state.path.personIds.map(displayName);
  dom.pathSummary.textContent = `${names.join(" → ")} · ${state.path.relationshipIds.length} 段关系`;
}

function findPath() {
  const sourceId = dom.pathSource.value;
  const targetId = dom.pathTarget.value;
  if (!sourceId || !targetId) {
    toast("请先选择路径的起点和终点", "warning");
    return;
  }
  if (sourceId === targetId) {
    toast("起点和终点需要是不同人物", "warning");
    return;
  }

  const result = shortestPath(state.document, sourceId, targetId, {
    kinds: [...state.activeKinds],
    respectDirection: false,
    year: state.year,
  });
  if (!result) {
    state.path = null;
    dom.pathSummary.textContent = "这个时间切片里暂时没有可达路径。";
    state.graph.setSelection(state.selection, []);
    toast("目前找不到两人之间的连接", "warning");
    return;
  }
  state.path = result;
  setPathSummary();
  state.graph.setSelection(state.selection, result.relationshipIds);
  state.graph.focusPerson(sourceId);
  announce(`已找到 ${result.relationshipIds.length} 段关系路径`);
}

function clearPath() {
  state.path = null;
  setPathSummary();
  state.graph.setSelection(state.selection, []);
}

function randomAccent() {
  return ACCENTS[state.document.people.length % ACCENTS.length];
}

function openPersonDialog(personId = null) {
  setMode("studio");
  dom.personForm.reset();
  dom.personForm.dataset.editingId = personId ?? "";
  const title = dom.personDialog.querySelector("h2");
  const submit = dom.personForm.querySelector('[type="submit"]');
  const person = personId ? personById(personId) : null;
  if (person) {
    title.textContent = "编辑人物";
    submit.textContent = "保存人物";
    dom.personName.value = person.name;
    dom.personAccent.value = person.color || randomAccent();
    dom.personVisibility.value = person.visibility || "private";
  } else {
    title.textContent = "添加人物";
    submit.textContent = "添加到星图";
    dom.personAccent.value = randomAccent();
    dom.personVisibility.value = "private";
  }
  dom.personDialog.showModal();
  window.requestAnimationFrame(() => dom.personName.focus());
}

function dateValueForYear(year) {
  return year ? String(year) : "";
}

function parseDateYear(value, fallback = null) {
  if (!value) return fallback;
  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isInteger(year) ? year : fallback;
}

function openRelationshipDialog(relationshipId = null, sourceId = null) {
  if (state.document.people.length < 2) {
    toast("至少需要两个人物才能添加关系", "warning");
    return;
  }
  setMode("studio");
  dom.relationshipForm.reset();
  renderPersonOptions();
  dom.relationshipForm.dataset.editingId = relationshipId ?? "";
  const title = dom.relationshipDialog.querySelector("h2");
  const submit = dom.relationshipForm.querySelector('[type="submit"]');
  const relationship = relationshipId ? relationshipById(relationshipId) : null;
  if (relationship) {
    title.textContent = "编辑关系";
    submit.textContent = "保存心轨";
    dom.relationshipSource.value = relationship.sourceId;
    dom.relationshipTarget.value = relationship.targetId;
    dom.relationshipKind.value = relationship.kind;
    dom.relationshipDirection.value = relationship.direction;
    dom.relationshipStarted.value = dateValueForYear(relationship.startedYear);
    dom.relationshipEnded.value = dateValueForYear(relationship.endedYear);
    dom.relationshipIntensity.value = String(relationship.intensity * 20);
    dom.relationshipNote.value = relationship.note;
    dom.relationshipVisibility.value = relationship.visibility;
  } else {
    title.textContent = "添加关系";
    submit.textContent = "连接心轨";
    dom.relationshipSource.value = sourceId ?? "";
    dom.relationshipKind.value = "partner";
    dom.relationshipDirection.value = "mutual";
    dom.relationshipStarted.value = dateValueForYear(state.year);
    dom.relationshipEnded.value = "";
    dom.relationshipIntensity.value = "60";
    dom.relationshipVisibility.value = "private";
  }
  updateIntensityOutput();
  dom.relationshipDialog.showModal();
  window.requestAnimationFrame(() => dom.relationshipSource.focus());
}

function updateIntensityOutput() {
  const output = dom.relationshipIntensity.closest("label")?.querySelector("output");
  if (output) output.textContent = `${dom.relationshipIntensity.value}%`;
}

function submitPerson(event) {
  event.preventDefault();
  const name = dom.personName.value.normalize("NFKC").trim();
  if (!name) return;
  const editingId = dom.personForm.dataset.editingId;

  try {
    let next;
    if (editingId) {
      next = cloneDocument(state.document);
      next.people = next.people.map((person) =>
        person.id === editingId
          ? {
              ...person,
              color: dom.personAccent.value,
              emoji: name.slice(0, 1),
              name,
              visibility: dom.personVisibility.value,
            }
          : person,
      );
      assertValidDocument(next);
    } else {
      next = createPerson(state.document, {
        color: dom.personAccent.value,
        emoji: name.slice(0, 1),
        name,
        visibility: dom.personVisibility.value,
      });
    }
    dom.personDialog.close();
    commitDocument(next, editingId ? "人物已更新" : "人物已加入星图");
  } catch (error) {
    toast(error.errors?.[0] ?? "人物信息未通过校验", "error");
  }
}

function relationshipInputFromForm(id = undefined) {
  const direction = dom.relationshipDirection.value;
  let sourceId = dom.relationshipSource.value;
  let targetId = dom.relationshipTarget.value;
  if (direction === "mutual" && sourceId > targetId) {
    [sourceId, targetId] = [targetId, sourceId];
  }
  return {
    ...(id ? { id } : {}),
    direction,
    endedYear: parseDateYear(dom.relationshipEnded.value, null),
    intensity: Math.max(1, Math.min(5, Math.round(Number(dom.relationshipIntensity.value) / 20))),
    kind: dom.relationshipKind.value,
    note: dom.relationshipNote.value.trim(),
    sourceId,
    startedYear: parseDateYear(dom.relationshipStarted.value, state.year),
    targetId,
    visibility: dom.relationshipVisibility.value,
  };
}

function submitRelationship(event) {
  event.preventDefault();
  const editingId = dom.relationshipForm.dataset.editingId;
  try {
    const input = relationshipInputFromForm(editingId || undefined);
    let next;
    if (editingId) {
      next = cloneDocument(state.document);
      next.relationships = next.relationships.map((relationship) =>
        relationship.id === editingId ? input : relationship,
      );
      assertValidDocument(next);
    } else {
      next = createRelationship(state.document, input);
    }
    dom.relationshipDialog.close();
    commitDocument(next, editingId ? "关系已更新" : "新的心轨已连接");
  } catch (error) {
    toast(error.errors?.[0] ?? "关系信息未通过校验", "error");
  }
}

function deleteSelection() {
  if (!state.selection) return;
  const entity = state.selection.type === "person"
    ? personById(state.selection.id)
    : relationshipById(state.selection.id);
  if (!entity) return;

  let prompt;
  if (state.selection.type === "person") {
    const count = state.document.relationships.filter(
      (relationship) =>
        relationship.sourceId === entity.id || relationship.targetId === entity.id,
    ).length;
    prompt = `删除「${entity.name}」将同时移除 ${count} 条关系。继续吗？`;
  } else {
    prompt = `删除这条「${KIND_META[entity.kind].label}」关系吗？`;
  }
  if (!window.confirm(prompt)) return;

  const next = deleteEntity(state.document, state.selection.type, state.selection.id);
  commitDocument(next, "已删除；仍可使用撤销恢复");
}

function resetDemo() {
  if (!window.confirm("重置会用合成演示图替换当前本地编辑。继续吗？")) return;
  const demo = createDemoDocument();
  const bounds = yearBounds(demo, new Date().getFullYear());
  state.year = bounds.max;
  state.activeKinds = new Set(RELATION_KINDS);
  commitDocument(demo, "已恢复合成演示星图");
}

function download(url, filename) {
  const anchor = element("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  window.document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function exportJson() {
  const blob = new Blob([exportDocument(state.document)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  download(url, `heartlines-${new Date().toISOString().slice(0, 10)}.json`);
  URL.revokeObjectURL(url);
  toast("JSON 已导出");
}

async function exportPng() {
  try {
    const result = await state.graph.exportPng();
    if (result instanceof Blob) {
      const url = URL.createObjectURL(result);
      download(url, `heartlines-${state.year}.png`);
      URL.revokeObjectURL(url);
    } else if (typeof result === "string") {
      download(result, `heartlines-${state.year}.png`);
    } else {
      throw new Error("Canvas export returned no image");
    }
    toast("星图 PNG 已导出");
  } catch {
    toast("暂时无法导出 PNG", "error");
  }
}

function toggleTimeline() {
  if (state.playing) {
    stopTimeline();
    return;
  }
  const min = Number(dom.timelineRange.min);
  const max = Number(dom.timelineRange.max);
  if (state.year >= max) state.year = min;
  state.playing = true;
  renderTimeline();
  state.playbackTimer = window.setInterval(() => {
    if (state.year >= max) {
      stopTimeline();
      return;
    }
    state.year += 1;
    state.path = null;
    setPathSummary();
    renderTimeline();
    renderGraph();
    renderInspector();
    renderEntityLists();
  }, state.motionReduced ? 1300 : 850);
}

function stopTimeline() {
  if (state.playbackTimer !== null) window.clearInterval(state.playbackTimer);
  state.playbackTimer = null;
  state.playing = false;
  renderTimeline();
}

function handleInspectorAction(action) {
  if (!state.selection) return;
  if (action === "edit-person" && state.selection.type === "person") {
    openPersonDialog(state.selection.id);
  } else if (action === "connect-person" && state.selection.type === "person") {
    openRelationshipDialog(null, state.selection.id);
  } else if (action === "path-source" && state.selection.type === "person") {
    dom.pathSource.value = state.selection.id;
    dom.pathTarget.focus();
    toast("已设为路径起点");
  } else if (action === "edit-relationship" && state.selection.type === "relationship") {
    openRelationshipDialog(state.selection.id);
  }
}

function bindEvents() {
  dom.brandButton.addEventListener("click", () => {
    state.selection = null;
    clearPath();
    renderInspector();
    state.graph.fit();
  });
  dom.modeExplore.addEventListener("click", () => setMode("explore"));
  dom.modeStudio.addEventListener("click", () => setMode("studio"));
  dom.undoButton.addEventListener("click", undo);
  dom.redoButton.addEventListener("click", redo);
  dom.themeToggle.addEventListener("click", () =>
    setTheme(state.theme === "dark" ? "light" : "dark"),
  );
  dom.motionToggle.addEventListener("click", () =>
    setMotionReduced(!state.motionReduced),
  );

  dom.searchInput.addEventListener("input", renderSearch);
  dom.searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      dom.searchInput.value = "";
      closeSearch();
    }
  });
  dom.searchResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-person-id]");
    if (!button) return;
    setSelection({ type: "person", id: button.dataset.personId });
    dom.searchInput.value = "";
    closeSearch();
  });

  window.document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".rail-section--search")) closeSearch();
  });

  dom.allFilter.addEventListener("click", () => {
    state.activeKinds = new Set(RELATION_KINDS);
    state.path = null;
    setPathSummary();
    renderAll();
  });
  for (const button of window.document.querySelectorAll("[data-kind]")) {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind;
      if (state.activeKinds.size === RELATION_KINDS.length) {
        state.activeKinds = new Set([kind]);
      } else if (state.activeKinds.has(kind)) {
        state.activeKinds.delete(kind);
        if (state.activeKinds.size === 0) state.activeKinds = new Set(RELATION_KINDS);
      } else {
        state.activeKinds.add(kind);
      }
      state.path = null;
      setPathSummary();
      renderAll();
    });
  }

  for (const button of window.document.querySelectorAll("[data-layout]")) {
    button.addEventListener("click", () => {
      state.layout = button.dataset.layout;
      for (const other of window.document.querySelectorAll("[data-layout]")) {
        const active = other === button;
        other.classList.toggle("is-active", active);
        other.setAttribute("aria-pressed", String(active));
      }
      state.graph.setLayout(
        state.layout,
        state.selection?.type === "person" ? state.selection.id : undefined,
      );
    });
  }

  dom.findPathButton.addEventListener("click", findPath);
  dom.clearPathButton.addEventListener("click", clearPath);
  dom.addPersonButton.addEventListener("click", () => openPersonDialog());
  dom.addRelationshipButton.addEventListener("click", () =>
    openRelationshipDialog(
      null,
      state.selection?.type === "person" ? state.selection.id : null,
    ),
  );

  dom.zoomIn.addEventListener("click", () => state.graph.zoomBy(1.18));
  dom.zoomOut.addEventListener("click", () => state.graph.zoomBy(0.84));
  dom.fitGraph.addEventListener("click", () => state.graph.fit());
  dom.exportPng.addEventListener("click", exportPng);
  dom.graphViewButton.addEventListener("click", () => setView("graph"));
  dom.listViewButton.addEventListener("click", () => setView("list"));

  dom.timelineRange.addEventListener("input", () => {
    stopTimeline();
    state.year = Number(dom.timelineRange.value);
    state.path = null;
    setPathSummary();
    renderTimeline();
    renderGraph();
    renderInspector();
    renderEntityLists();
  });
  dom.timelinePlay.addEventListener("click", toggleTimeline);

  dom.peopleList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-person-id]");
    if (button) setSelection({ type: "person", id: button.dataset.personId });
  });
  dom.relationsList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-relationship-id]");
    if (button) setSelection({ type: "relationship", id: button.dataset.relationshipId });
  });
  dom.inspectorBody.addEventListener("click", (event) => {
    const relationshipButton = event.target.closest("[data-relationship-id]");
    if (relationshipButton) {
      setSelection({ type: "relationship", id: relationshipButton.dataset.relationshipId });
      return;
    }
    const action = event.target.closest("[data-inspector-action]")?.dataset.inspectorAction;
    if (action) handleInspectorAction(action);
  });
  dom.deleteSelectionButton.addEventListener("click", deleteSelection);
  dom.resetDemoButton.addEventListener("click", resetDemo);
  dom.exportJsonButton.addEventListener("click", exportJson);

  dom.personForm.addEventListener("submit", submitPerson);
  dom.relationshipForm.addEventListener("submit", submitRelationship);
  dom.closePersonDialog.addEventListener("click", () => dom.personDialog.close());
  dom.closeRelationshipDialog.addEventListener("click", () => dom.relationshipDialog.close());
  for (const button of window.document.querySelectorAll("[data-dialog-cancel]")) {
    button.addEventListener("click", () => button.closest("dialog").close());
  }
  dom.relationshipIntensity.addEventListener("input", updateIntensityOutput);
  dom.relationshipKind.addEventListener("change", () => {
    if (dom.relationshipKind.value === "affection") {
      dom.relationshipDirection.value = "directed";
    } else if (dom.relationshipDirection.value === "directed") {
      dom.relationshipDirection.value = "mutual";
    }
  });

  window.document.addEventListener("keydown", (event) => {
    const editing = event.target.matches("input, textarea, select") || event.target.isContentEditable;
    if (event.key === "/" && !editing) {
      event.preventDefault();
      dom.searchInput.focus();
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (!editing && event.key === "+") {
      state.graph.zoomBy(1.18);
    } else if (!editing && event.key === "-") {
      state.graph.zoomBy(0.84);
    } else if (!editing && event.key === "0") {
      state.graph.fit();
    } else if (!editing && event.key.toLowerCase() === "r") {
      openRelationshipDialog(
        null,
        state.selection?.type === "person" ? state.selection.id : null,
      );
    } else if (!editing && (event.key === "Delete" || event.key === "Backspace")) {
      deleteSelection();
    } else if (event.key === "Escape" && !dom.personDialog.open && !dom.relationshipDialog.open) {
      state.selection = null;
      clearPath();
      renderInspector();
    }
  });

  for (const button of window.document.querySelectorAll("[data-mobile-action]")) {
    button.addEventListener("click", () => {
      const action = button.dataset.mobileAction;
      if (action === "search") {
        dom.searchInput.focus();
      } else if (action === "add") {
        openPersonDialog();
      } else if (action === "path") {
        dom.pathSource.focus();
      } else if (action === "controls") {
        window.document.querySelector(".control-rail")?.classList.toggle("is-mobile-open");
      } else if (action === "selection") {
        window.document.querySelector(".inspector")?.classList.toggle("is-mobile-open");
      }
    });
  }

  window.addEventListener("online", () => setSaveState("saved", "已保存到此设备"));
  window.addEventListener("offline", () => setSaveState("offline", "离线 · 编辑仍保存在本机"));
  window.document.addEventListener("visibilitychange", () => {
    if (window.document.hidden) stopTimeline();
  });
}

function boot() {
  let loadWarning = null;
  try {
    state.document = loadDocument({
      fallback: createDemoDocument(),
      key: STORAGE_KEY,
      storage: window.localStorage,
    });
  } catch {
    state.document = createDemoDocument();
    loadWarning = "本地草稿无法读取，已打开安全的合成演示图";
  }

  const bounds = yearBounds(state.document, new Date().getFullYear());
  state.year = bounds.max;
  state.theme = safeStorageGet(THEME_KEY) === "light" ? "light" : "dark";
  const savedMotion = safeStorageGet(MOTION_KEY);
  state.motionReduced = savedMotion
    ? savedMotion === "reduced"
    : window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  state.graph = new HeartGraph(dom.relationCanvas, {
    onSelect: (selection) => setSelection(selection, { focus: false }),
  });
  state.graph.setMotionReduced(state.motionReduced);
  bindEvents();
  setMode("explore");
  setTheme(state.theme);
  setMotionReduced(state.motionReduced);
  renderAll({ refit: true });
  setPathSummary();

  if (window.matchMedia("(forced-colors: active)").matches) setView("list");
  else setView("graph");

  window.requestAnimationFrame(() => {
    dom.graphLoading.hidden = true;
    dom.app.dataset.boot = "ready";
  });
  if (loadWarning) toast(loadWarning, "warning");
}

try {
  boot();
} catch (error) {
  dom.graphLoading.replaceChildren(
    element("strong", { text: "星图暂时无法启动" }),
    element("span", { text: "请刷新页面；你的本地数据不会被上传。" }),
  );
  dom.graphLoading.dataset.state = "error";
  setSaveState("error", "启动失败");
}
