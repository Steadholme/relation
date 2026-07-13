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
} from "./model.mjs";

const STORAGE_KEY = "w33d.relation.heartlines.v2";
const THEME_KEY = "w33d.relation.theme.v1";
const MOTION_KEY = "w33d.relation.motion.v1";
const HISTORY_LIMIT = 40;
const mobileMedia = window.matchMedia("(max-width: 820px)");
const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");

const KIND_META = Object.freeze({
  partner: { label: "现任伴侣", short: "PAIR" },
  dated: { label: "前任伴侣", short: "PAST" },
  affection: { label: "单向好感", short: "PULSE" },
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
  "inspectorKicker",
  "inspectorTitle",
  "inspectorBody",
  "deleteSelectionButton",
  "resetDemoButton",
  "exportJsonButton",
  "personDialog",
  "personForm",
  "personName",
  "personGender",
  "personAccent",
  "personVisibility",
  "relationshipDialog",
  "relationshipForm",
  "relationshipSource",
  "relationshipTarget",
  "relationshipKind",
  "relationshipDirection",
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
  motionFollowsSystem: true,
  motionReduced: false,
  path: null,
  selection: null,
  searchIndex: -1,
  theme: "dark",
  view: "graph",
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

function persistDocument(document = state.document) {
  setSaveState("saving", "正在保存…");
  try {
    saveDocument(document, {
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
  if (!persistDocument(nextDocument)) {
    toast("保存失败，修改未应用；请检查浏览器存储设置", "error");
    return false;
  }

  state.history.push(cloneDocument(state.document));
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  state.future = [];
  state.document = cloneDocument(nextDocument);
  state.path = null;
  state.selection = null;
  renderAll({ refit: true });
  if (message) toast(message, "success");
  return true;
}

function undo() {
  const previous = state.history.at(-1);
  if (!previous) return;
  if (!persistDocument(previous)) {
    toast("保存失败，撤销未应用", "error");
    return;
  }
  state.history.pop();
  state.future.push(cloneDocument(state.document));
  state.document = previous;
  state.selection = null;
  state.path = null;
  renderAll({ refit: true });
  toast("已撤销上一步编辑");
}

function redo() {
  const next = state.future.at(-1);
  if (!next) return;
  if (!persistDocument(next)) {
    toast("保存失败，重做未应用", "error");
    return;
  }
  state.future.pop();
  state.history.push(cloneDocument(state.document));
  state.document = next;
  state.selection = null;
  state.path = null;
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

function setMotionReduced(reduced, options = {}) {
  state.motionReduced = reduced;
  dom.app.dataset.motion = reduced ? "reduced" : "full";
  dom.motionToggle.setAttribute("aria-pressed", String(reduced));
  dom.motionToggle.setAttribute(
    "aria-label",
    reduced ? "恢复完整动效" : "减少动效",
  );
  if (options.persist !== false) {
    state.motionFollowsSystem = false;
    safeStorageSet(MOTION_KEY, reduced ? "reduced" : "full");
  }
  state.graph?.setMotionReduced(reduced);
}

const controlRail = window.document.querySelector(".control-rail");
const inspectorPanel = window.document.querySelector(".inspector");
const mobileButtons = [...window.document.querySelectorAll("[data-mobile-action]")];

function buttonsForPanel(panel) {
  const actions = panel === controlRail
    ? new Set(["controls", "search", "path"])
    : new Set(["selection"]);
  return mobileButtons.filter((button) => actions.has(button.dataset.mobileAction));
}

function setMobilePanel(panel, open) {
  if (!panel) return;
  const mobile = mobileMedia.matches;
  const expanded = mobile && Boolean(open);
  panel.classList.toggle("is-mobile-open", expanded);
  panel.inert = mobile && !expanded;
  if (mobile) panel.setAttribute("aria-hidden", String(!expanded));
  else panel.removeAttribute("aria-hidden");
  for (const button of buttonsForPanel(panel)) {
    button.setAttribute("aria-expanded", String(expanded));
  }
}

function openMobilePanel(panel, focusTarget = null) {
  if (!mobileMedia.matches) {
    focusTarget?.focus();
    return;
  }
  const other = panel === controlRail ? inspectorPanel : controlRail;
  setMobilePanel(other, false);
  setMobilePanel(panel, true);
  if (focusTarget) window.requestAnimationFrame(() => focusTarget.focus());
}

function syncMobilePanels() {
  if (!mobileMedia.matches) {
    setMobilePanel(controlRail, false);
    setMobilePanel(inspectorPanel, false);
    return;
  }
  setMobilePanel(controlRail, controlRail?.classList.contains("is-mobile-open"));
  setMobilePanel(inspectorPanel, inspectorPanel?.classList.contains("is-mobile-open"));
}

function closeMobilePanels() {
  if (!mobileMedia.matches) return false;
  const hadOpenPanel = Boolean(
    controlRail?.classList.contains("is-mobile-open")
    || inspectorPanel?.classList.contains("is-mobile-open"),
  );
  setMobilePanel(controlRail, false);
  setMobilePanel(inspectorPanel, false);
  return hadOpenPanel;
}

function setSelection(selection, options = {}) {
  state.selection = selection;
  state.graph.setSelection(selection, state.path?.relationshipIds ?? []);
  renderInspector();
  renderEntityLists();
  if (selection && mobileMedia.matches) openMobilePanel(inspectorPanel);

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
      element("p", { text: "关系不是排名，而是一张彼此连接的地图。" }),
      element("small", {
        text: "点选节点、连线，或使用左侧路径工具。",
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
      element("span", {
        text: `${person.gender ?? "未知"} · ${person.visibility === "public" ? "可公开" : "仅此设备"}`,
      }),
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
    list.append(element("h3", { text: "人物连接" }));
    if (relationships.length === 0) {
      list.append(element("p", { text: "当前筛选中还没有可见连接。" }));
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
  dom.graphSummary.textContent = `${state.document.people.length} 个人物，${relationships.length} 条关系，${components} 个星群。`;
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
          KIND_META[relationship.kind]?.label ?? relationship.kind,
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
  renderGraph(options);
  renderInspector();
  renderEntityLists();
  renderHistoryControls();
  setPathSummary();
}

function closeSearch() {
  state.searchIndex = -1;
  dom.searchResults.hidden = true;
  dom.searchInput.setAttribute("aria-expanded", "false");
  dom.searchInput.removeAttribute("aria-activedescendant");
}

function searchOptions() {
  return [...dom.searchResults.querySelectorAll('[role="option"]')];
}

function setActiveSearchOption(index) {
  const options = searchOptions();
  if (!options.length) return;
  state.searchIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    const active = optionIndex === state.searchIndex;
    option.setAttribute("aria-selected", String(active));
    option.classList.toggle("is-active", active);
  });
  const active = options[state.searchIndex];
  dom.searchInput.setAttribute("aria-activedescendant", active.id);
  active.scrollIntoView({ block: "nearest" });
}

function chooseSearchPerson(personId) {
  if (!personId) return;
  setSelection({ type: "person", id: personId });
  dom.searchInput.value = "";
  closeSearch();
}

function renderSearch() {
  const query = dom.searchInput.value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
  dom.searchResults.replaceChildren();
  state.searchIndex = -1;
  dom.searchInput.removeAttribute("aria-activedescendant");
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
    for (const [index, person] of matches.entries()) {
      const button = element("button", {
        className: "search-result",
        type: "button",
        dataset: { personId: person.id },
        attributes: {
          "aria-selected": "false",
          id: `search-option-${index}`,
          role: "option",
          tabindex: "-1",
        },
      });
      button.append(
        element("span", { className: "search-result__avatar", text: person.emoji || person.name[0] }),
        element("strong", { text: person.name }),
        element("small", {
          text: `${person.gender ?? "未知"} · ${relatedForPerson(person.id).length} 条连接`,
        }),
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
  });
  if (!result) {
    state.path = null;
    dom.pathSummary.textContent = "当前筛选中暂时没有可达路径。";
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
    dom.personGender.value = person.gender ?? "男";
    dom.personAccent.value = person.color || randomAccent();
    dom.personVisibility.value = person.visibility || "private";
  } else {
    title.textContent = "添加人物";
    submit.textContent = "添加到星图";
    dom.personGender.value = "男";
    dom.personAccent.value = randomAccent();
    dom.personVisibility.value = "private";
  }
  dom.personDialog.showModal();
  window.requestAnimationFrame(() => dom.personName.focus());
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
    dom.relationshipIntensity.value = String(relationship.intensity * 20);
    dom.relationshipNote.value = relationship.note;
    dom.relationshipVisibility.value = relationship.visibility;
  } else {
    title.textContent = "添加关系";
    submit.textContent = "连接心轨";
    dom.relationshipSource.value = sourceId ?? "";
    dom.relationshipKind.value = "partner";
    dom.relationshipDirection.value = "mutual";
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
              gender: dom.personGender.value,
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
        gender: dom.personGender.value,
        name,
        visibility: dom.personVisibility.value,
      });
    }
    if (commitDocument(next, editingId ? "人物已更新" : "人物已加入星图")) {
      dom.personDialog.close();
    }
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
    endedYear: null,
    intensity: Math.max(1, Math.min(5, Math.round(Number(dom.relationshipIntensity.value) / 20))),
    kind: dom.relationshipKind.value,
    note: dom.relationshipNote.value.trim(),
    sourceId,
    startedYear: 1,
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
    if (commitDocument(next, editingId ? "关系已更新" : "新的心轨已连接")) {
      dom.relationshipDialog.close();
    }
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
  if (!window.confirm("重置会用项目默认关系图替换当前本地编辑。继续吗？")) return;
  const demo = createDemoDocument();
  state.activeKinds = new Set(RELATION_KINDS);
  commitDocument(demo, "已恢复默认关系图");
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
      download(url, "heartlines.png");
      URL.revokeObjectURL(url);
    } else if (typeof result === "string") {
      download(result, "heartlines.png");
    } else {
      throw new Error("Canvas export returned no image");
    }
    toast("星图 PNG 已导出");
  } catch {
    toast("暂时无法导出 PNG", "error");
  }
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
    const options = searchOptions();
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setActiveSearchOption(state.searchIndex + 1);
    } else if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setActiveSearchOption(state.searchIndex < 0 ? options.length - 1 : state.searchIndex - 1);
    } else if (event.key === "Enter" && state.searchIndex >= 0) {
      event.preventDefault();
      chooseSearchPerson(options[state.searchIndex]?.dataset.personId);
    } else if (event.key === "Escape") {
      dom.searchInput.value = "";
      closeSearch();
    }
  });
  dom.searchResults.addEventListener("click", (event) => {
    const button = event.target.closest("[data-person-id]");
    if (!button) return;
    chooseSearchPerson(button.dataset.personId);
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
      openMobilePanel(controlRail, dom.searchInput);
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
    } else if (
      event.key === "Escape"
      && !dom.personDialog.open
      && !dom.relationshipDialog.open
      && !closeMobilePanels()
    ) {
      state.selection = null;
      clearPath();
      renderInspector();
    }
  });

  for (const button of window.document.querySelectorAll("[data-mobile-action]")) {
    button.addEventListener("click", () => {
      const action = button.dataset.mobileAction;
      if (action === "search") {
        openMobilePanel(controlRail, dom.searchInput);
      } else if (action === "add") {
        openPersonDialog();
      } else if (action === "path") {
        openMobilePanel(controlRail, dom.pathSource);
      } else if (action === "controls") {
        const open = !controlRail?.classList.contains("is-mobile-open");
        if (open) openMobilePanel(controlRail);
        else setMobilePanel(controlRail, false);
      } else if (action === "selection") {
        const open = !inspectorPanel?.classList.contains("is-mobile-open");
        if (open) openMobilePanel(inspectorPanel);
        else setMobilePanel(inspectorPanel, false);
      }
    });
  }

  const handleMobileChange = () => syncMobilePanels();
  mobileMedia.addEventListener?.("change", handleMobileChange);
  motionMedia.addEventListener?.("change", (event) => {
    if (state.motionFollowsSystem) setMotionReduced(event.matches, { persist: false });
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
    loadWarning = "本地草稿无法读取，已打开项目默认关系图";
  }

  state.theme = safeStorageGet(THEME_KEY) === "light" ? "light" : "dark";
  const savedMotion = safeStorageGet(MOTION_KEY);
  state.motionFollowsSystem = savedMotion === null;
  state.motionReduced = state.motionFollowsSystem
    ? motionMedia.matches
    : savedMotion === "reduced";

  state.graph = new HeartGraph(dom.relationCanvas, {
    onSelect: (selection) => setSelection(selection, { focus: false }),
  });
  state.graph.setMotionReduced(state.motionReduced);
  bindEvents();
  syncMobilePanels();
  setMode("explore");
  setTheme(state.theme);
  setMotionReduced(state.motionReduced, { persist: false });
  renderAll({ refit: true });
  setPathSummary();

  if (!persistDocument(state.document)) {
    loadWarning = "浏览器存储不可用；为避免丢失，编辑功能会保持事务性关闭";
  }

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
