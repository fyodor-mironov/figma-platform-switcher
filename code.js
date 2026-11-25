const PROP_NAME = 'Platform';

// Префиксы платформенных токенов в библиотеках Variables.
const PLATFORM_VAR_PREFIXES = { android: 'A_MZ', ios: 'I_MZ' };

figma.showUI(__html__, { width: 290, height: 201, title: 'Platform Linter' });

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'lint') { await handleLint(msg); return; }
  if (msg.type === 'listIosTokens') { await handleListIosTokens(msg); return; }
  if (msg.type === 'previewColors') { await handlePreviewColors(msg); return; }
  if (msg.type === 'remap') { await handleRemap(msg); return; }
  if (msg.type !== 'run') return;

  const fromValue = msg.reverse ? 'iOS' : 'Android';
  const toValue = msg.reverse ? 'Android' : 'iOS';
  const report = { switched: 0, nestedSwitched: 0 };

  try {
    await figma.currentPage.loadAsync();

    if (figma.currentPage.selection.length === 0) {
      figma.ui.resize(290, 290);
      figma.ui.postMessage({ type: 'done', report, empty: true });
      return;
    }

    const errorNames = [];
    const roots = collectTargetInstances(PROP_NAME, fromValue, errorNames);
    if (errorNames.length > 0) {
      figma.ui.resize(290, 320);
      figma.ui.postMessage({
        type: 'error',
        names: errorNames.slice(0, 8),
        total: errorNames.length,
      });
      return;
    }

    if (roots.length === 0) {
      figma.ui.resize(290, 290);
      figma.ui.postMessage({ type: 'done', report, empty: true });
      return;
    }

    for (const inst of roots) {
      try {
        await switchInstance(inst, PROP_NAME, fromValue, toValue, report);
        report.switched++;
      } catch (e) {
        // skip this instance and continue with the rest
      }
    }

    try {
      await switchPlatformModes(figma.currentPage.selection, toValue);
    } catch (e) {
      // skip
    }
  } catch (e) {
    // ignore
  }

  figma.ui.resize(290, 290);
  figma.ui.postMessage({ type: 'done', report });
};

function baseName(key) {
  return key.split('#')[0];
}

function findPropKey(props, name) {
  const lower = name.toLowerCase();
  return Object.keys(props).find((k) => baseName(k).toLowerCase() === lower);
}

function getInstanceProps(node) {
  try {
    return node.componentProperties;
  } catch (e) {
    return null;
  }
}

function isTarget(node, propName, fromValue) {
  if (node.type !== 'INSTANCE') return false;
  const props = getInstanceProps(node);
  if (!props) return false;
  const key = findPropKey(props, propName);
  if (!key) return false;
  return String(props[key].value).toLowerCase() === fromValue.toLowerCase();
}

function collectTargetInstances(propName, fromValue, errorNames) {
  const errorIds = new Set();
  const check = (n) => {
    if (n.type !== 'INSTANCE') return false;
    const props = getInstanceProps(n);
    if (props === null) {
      if (!errorIds.has(n.id)) {
        errorIds.add(n.id);
        errorNames.push(n.name);
      }
      return false;
    }
    if (!props) return false;
    const key = findPropKey(props, propName);
    if (!key) return false;
    return String(props[key].value).toLowerCase() === fromValue.toLowerCase();
  };

  const candidates = [];
  for (const node of figma.currentPage.selection) {
    if (check(node)) candidates.push(node);
    if ('findAll' in node) {
      candidates.push(...node.findAll(check));
    }
  }
  const ids = new Set(candidates.map((n) => n.id));
  return candidates.filter((n) => {
    let p = n.parent;
    while (p) {
      if (ids.has(p.id)) return false;
      p = p.parent;
    }
    return true;
  });
}

function snapshot(root) {
  const items = [];
  const walk = (node, path) => {
    if (node.type === 'INSTANCE') {
      let props = {};
      try {
        props = node.componentProperties;
      } catch (e) {
        // instance main component is in an error state, skip its props
      }
      items.push({ path, props });
    }
    let fills = null;
    try {
      if ('fills' in node && Array.isArray(node.fills)) {
        if (node.fills.some((p) => p.type === 'IMAGE')) fills = node.fills;
      }
    } catch (e) {
      // skip
    }
    if (fills) items.push({ path, fills });
    let bound = null;
    try {
      if ('boundVariables' in node && node.boundVariables) {
        const bv = node.boundVariables;
        const pick = {};
        for (const f of ['fills', 'strokes']) {
          if (
            Array.isArray(bv[f]) &&
            bv[f].some((b) => b && b.type === 'VARIABLE_ALIAS')
          ) {
            pick[f] = bv[f].map((b) => (b && b.type === 'VARIABLE_ALIAS' ? b.id : null));
          }
        }
        if (Object.keys(pick).length) bound = pick;
      }
    } catch (e) {
      // skip
    }
    if (bound) items.push({ path, bound });
    let children;
    try {
      children = 'children' in node ? node.children : null;
    } catch (e) {
      children = null;
    }
    if (children) {
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        const sameName = children.filter((c) => c.name === child.name);
        walk(child, path.concat([{ name: child.name, idx: sameName.indexOf(child) }]));
      }
    }
  };
  walk(root, []);
  return items;
}

async function switchPlatformModes(roots, toValue) {
  const cache = {};
  const platformCollections = [];

  const getCollection = async (id) => {
    if (!(id in cache)) {
      try {
        cache[id] = await figma.variables.getVariableCollectionByIdAsync(id);
      } catch (e) {
        cache[id] = null;
      }
    }
    return cache[id];
  };

  const isPlatformCollection = (c) => {
    if (!c || !Array.isArray(c.modes)) return false;
    const names = c.modes.map((m) => (m.name || '').toLowerCase());
    return names.some((n) => n.includes('android')) && names.some((n) => n.includes('ios'));
  };

  const register = (c) => {
    if (!c || !isPlatformCollection(c)) return;
    if (!platformCollections.some((p) => p.id === c.id)) platformCollections.push(c);
  };

  try {
    for (const c of await figma.variables.getLocalVariableCollectionsAsync()) {
      register(c);
    }
  } catch (e) {
    // ignore
  }

  const targetModeOf = (collection) =>
    collection.modes.find((m) => m.name.toLowerCase().includes(toValue.toLowerCase()));

  const applyTo = async (node, force) => {
    let modes = null;
    try {
      modes = node.explicitVariableModes || null;
    } catch (e) {
      modes = null;
    }
    if (modes) {
      for (const [collectionId] of Object.entries(modes)) {
        const collection = await getCollection(collectionId);
        console.log('[PS] collection:', collection ? collection.name : 'unresolved', collectionId);
        if (!collection || !isPlatformCollection(collection)) continue;
        register(collection);
        const target = targetModeOf(collection);
        if (!target) continue;
        try {
          node.setExplicitVariableModeForCollection(collection, target.modeId);
          console.log('[PS] set mode on', node.name, '→', target.name);
        } catch (e) {
          console.log('[PS] set mode failed on', node.name, e);
        }
      }
    }
    if (force) {
      for (const c of platformCollections) {
        const target = targetModeOf(c);
        if (!target) continue;
        try {
          node.setExplicitVariableModeForCollection(c, target.modeId);
          console.log('[PS] force set mode on', node.name, '→', target.name);
        } catch (e) {
          console.log('[PS] force set failed on', node.name, e);
        }
      }
    }
  };

  const walk = async (node) => {
    await applyTo(node, false);
    let children = null;
    try {
      children = 'children' in node ? node.children : null;
    } catch (e) {
      return;
    }
    if (!children) return;
    for (const c of children) await walk(c);
  };

  for (const root of roots) await walk(root);
  for (const root of roots) await applyTo(root, true);
}

function locate(root, path) {
  let node = root;
  for (const seg of path) {
    let children;
    try {
      children = 'children' in node ? node.children : null;
    } catch (e) {
      return null;
    }
    if (!children) return null;
    const sameName = node.children.filter((c) => c.name === seg.name);
    node = sameName[seg.idx];
    if (!node) return null;
  }
  return node;
}

function locateLoose(root, path) {
  const exact = locate(root, path);
  if (exact) return exact;
  if (path.length === 0) return null;
  const targetName = path[path.length - 1].name;
  const depth = path.length;
  let found = null;
  const walk = (node, d) => {
    if (found) return;
    if (d === depth && node.name === targetName) {
      found = node;
      return;
    }
    let children = null;
    try {
      children = 'children' in node ? node.children : null;
    } catch (e) {
      return;
    }
    if (!children) return;
    for (const c of children) walk(c, d + 1);
  };
  walk(root, 0);
  return found;
}

async function mapSwapComponent(compKey, propName, toValue) {
  let comp = null;
  try {
    const node = await figma.getNodeByIdAsync(compKey);
    if (node && node.type === 'COMPONENT') comp = node;
  } catch (e) {
    // not a local component id
  }
  if (!comp) {
    try {
      comp = await figma.importComponentByKeyAsync(compKey);
    } catch (e) {
      return null;
    }
  }
  if (comp && comp.parent && comp.parent.type === 'COMPONENT_SET') {
    const orig = comp.variantProperties || {};
    const match = comp.parent.children.find((c) => {
      const vp = c.variantProperties || {};
      return Object.keys(vp).every((k) => {
        if (k.toLowerCase() === propName.toLowerCase()) {
          return String(vp[k]).toLowerCase() === toValue.toLowerCase();
        }
        return vp[k] === orig[k];
      });
    });
    if (match) return match.key;
  }
  return comp ? comp.key : null;
}

const varCollectionCache = {};

// Индекс библиотечных переменных (имя -> key) для автомаппинга
// префиксных платформенных токенов (A_MZ ⇄ I_MZ). Строится один раз.
let libVarIndexPromise = null;

async function findLibraryVariableByName(name) {
  if (!libVarIndexPromise) {
    libVarIndexPromise = (async () => {
      const index = new Map();
      try {
        const cols = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
        for (const col of cols) {
          try {
            const vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(col.key);
            for (const v of vars) {
              if (!index.has(v.name)) index.set(v.name, v.key);
            }
          } catch (e) {
            // коллекция недоступна — пропускаем
          }
        }
      } catch (e) {
        // teamLibrary недоступен
      }
      return index;
    })();
  }
  const index = await libVarIndexPromise;
  const key = index.get(name);
  if (!key) return null;
  try {
    return await figma.variables.importVariableByKeyAsync(key);
  } catch (e) {
    return null;
  }
}

async function getVarCollection(id) {
  if (!(id in varCollectionCache)) {
    try {
      varCollectionCache[id] = await figma.variables.getVariableCollectionByIdAsync(id);
    } catch (e) {
      varCollectionCache[id] = null;
    }
  }
  return varCollectionCache[id];
}

async function findVariableByName(collection, name) {
  for (const id of collection.variableIds) {
    try {
      const v = await figma.variables.getVariableByIdAsync(id);
      if (v && v.name === name) return v;
    } catch (e) {
      // skip
    }
  }
  return null;
}

async function mapPlatformVariable(variable, fromValue, toValue) {
  if (!variable) return null;
  const from = fromValue.toLowerCase();
  const to = toValue.toLowerCase();
  const collection = await getVarCollection(variable.variableCollectionId);

  // Префиксный маппинг платформенных токенов: A_MZ/... ⇄ I_MZ/...
  // Ищем токен с тем же именем, но префиксом целевой платформы,
  // среди опубликованных библиотек Variables.
  const fromPrefix = PLATFORM_VAR_PREFIXES[from];
  const toPrefix = PLATFORM_VAR_PREFIXES[to];
  if (fromPrefix && toPrefix && variable.name.startsWith(fromPrefix)) {
    const mappedName = toPrefix + variable.name.slice(fromPrefix.length);
    const v = await findLibraryVariableByName(mappedName);
    if (v) return v;
  }

  if (collection && variable.name.toLowerCase().includes(from)) {
    const v = await findVariableByName(
      collection,
      variable.name.replace(new RegExp(fromValue, 'i'), toValue)
    );
    if (v) return v;
  }

  if (collection && collection.name.toLowerCase().includes(from)) {
    const wanted = collection.name.toLowerCase().replace(from, to);
    try {
      for (const c of await figma.variables.getLocalVariableCollectionsAsync()) {
        if (c.id === collection.id) continue;
        if (c.name.toLowerCase() !== wanted) continue;
        const v = await findVariableByName(c, variable.name);
        if (v) return v;
      }
    } catch (e) {
      // skip
    }
  }

  return null;
}

async function resolveTargetVariant(inst, propName, toValue) {
  let main;
  let instProps;
  try {
    main = await inst.getMainComponentAsync();
    instProps = inst.componentProperties;
  } catch (e) {
    return { error: 'component unavailable' };
  }
  if (!main) return { error: 'main component unavailable' };
  const set = main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : null;
  if (!set) return { error: 'component is not in a component set' };

  const currentVariantProps = {};
  for (const [k, v] of Object.entries(instProps)) {
    if (v.type === 'VARIANT') currentVariantProps[baseName(k)] = String(v.value);
  }

  const match = set.children.find((c) => {
    const vp = c.variantProperties || {};
    return Object.keys(vp).every((k) => {
      if (k.toLowerCase() === propName.toLowerCase()) {
        return String(vp[k]).toLowerCase() === toValue.toLowerCase();
      }
      const cur = currentVariantProps[k];
      return cur === undefined || String(vp[k]) === cur;
    });
  });

  if (!match) return { error: 'no matching target variant in component set' };
  return { variant: match };
}

async function switchInstance(inst, propName, fromValue, toValue, report) {
  const snap = snapshot(inst);

  let rootProps;
  try {
    rootProps = inst.componentProperties;
  } catch (e) {
    throw new Error('root component unavailable');
  }
  const key = findPropKey(rootProps, propName);
  if (!key) throw new Error('property not found');
  inst.setProperties({ [key]: toValue });

  const sorted = snap.slice().sort((a, b) => a.path.length - b.path.length);

  for (const item of sorted) {
    if (item.path.length === 0) continue;

    const node = locateLoose(inst, item.path);
    if (!node) continue;

    if (item.fills) {
      try {
        // Переносим только image-paint'ы (загруженные картинки сбрасываются
        // при смене варианта). Остальные краски берём из нового варианта,
        // чтобы не затереть его собственные привязки переменных: на разных
        // платформах у компонента могут быть разные токены, и они должны
        // сохраняться.
        const current = Array.isArray(node.fills) ? node.fills.slice() : [];
        let touched = false;
        for (let i = 0; i < item.fills.length; i++) {
          const snapPaint = item.fills[i];
          if (snapPaint && snapPaint.type === 'IMAGE') {
            if (i < current.length) {
              current[i] = snapPaint;
            } else {
              current.push(snapPaint);
            }
            touched = true;
          }
        }
        if (touched) node.fills = current;
      } catch (e) {
        // skip this node
      }
    }

    if (item.bound) {
      for (const field of Object.keys(item.bound)) {
        const ids = item.bound[field];
        let paints = null;
        try {
          paints = Array.isArray(node[field]) ? node[field] : null;
        } catch (e) {
          paints = null;
        }
        if (!paints) continue;

        let currentBound = null;
        try {
          currentBound = node.boundVariables;
        } catch (e) {
          currentBound = null;
        }

        // Привязка переменных к fills/strokes делается к каждому paint
        // отдельно через setBoundVariableForPaint — к полю целиком
        // привязать нельзя.
        const updated = paints.slice();
        let changed = false;

        for (let i = 0; i < ids.length && i < updated.length; i++) {
          const varId = ids[i];
          if (!varId) continue;

          // Не трогаем paint, у которого новый вариант уже имеет привязку.
          const alreadyBound =
            currentBound &&
            Array.isArray(currentBound[field]) &&
            currentBound[field][i] &&
            currentBound[field][i].type === 'VARIABLE_ALIAS';
          if (alreadyBound) continue;

          try {
            let variable = await figma.variables.getVariableByIdAsync(varId);
            if (!variable) continue;

            // Платформенный токен (A_MZ/I_MZ) переносим только через
            // маппинг на токен целевой платформы. Если аналога нет —
            // не привязываем исходный токен: на другой платформе у
            // компонента может быть назначен свой токен, и он не должен
            // ломаться.
            const fromPrefix = PLATFORM_VAR_PREFIXES[fromValue.toLowerCase()];
            const isPlatformToken = fromPrefix && variable.name.startsWith(fromPrefix);

            const mapped = await mapPlatformVariable(variable, fromValue, toValue);
            if (mapped) {
              variable = mapped;
            } else if (isPlatformToken) {
              // Нет аналога на целевой платформе — не тащим исходный токен,
              // оставляем привязку, назначенную в варианте.
              continue;
            }

            updated[i] = figma.variables.setBoundVariableForPaint(
              updated[i],
              'color',
              variable
            );
            changed = true;
          } catch (e) {
            // skip this binding
          }
        }

        if (changed) {
          try {
            node[field] = updated;
          } catch (e) {
            // skip this node
          }
        }
      }
    }

    if (!item.props || node.type !== 'INSTANCE') continue;

    const pk = findPropKey(item.props, propName);
    if (pk && String(item.props[pk].value).toLowerCase() === fromValue.toLowerCase()) {
      let nodeProps = null;
      try {
        nodeProps = node.componentProperties;
      } catch (e) {
        continue;
      }
      const nodePk = findPropKey(nodeProps, propName);
      if (nodePk) {
        const r = await resolveTargetVariant(node, propName, toValue);
        if (!r.error) {
          try {
            node.setProperties({ [nodePk]: toValue });
            report.nestedSwitched++;
          } catch (e) {
            continue;
          }
        }
      }
    }

    const toSet = {};
    for (const [k, v] of Object.entries(item.props)) {
      if (baseName(k).toLowerCase() === propName.toLowerCase()) continue;
      if (v.type === 'INSTANCE_SWAP') {
        const mapped = await mapSwapComponent(v.value, propName, toValue);
        toSet[k] = mapped || v.value;
      } else {
        toSet[k] = v.value;
      }
    }

    let avail;
    try {
      avail = node.componentProperties;
    } catch (e) {
      continue;
    }
    const filtered = {};
    for (const [k, val] of Object.entries(toSet)) {
      const matchKey = findPropKey(avail, baseName(k));
      if (matchKey) filtered[matchKey] = val;
    }

    if (Object.keys(filtered).length > 0) {
      try {
        node.setProperties(filtered);
      } catch (e) {
        // skip this node
      }
    }
  }
}

// ---------- Линтер токенов ----------

const LINT_WINDOW_HEIGHT = 520;

// Возвращает CSS-представление цвета переменной (первый режим коллекции)
// или null, если переменная не цветовая / значение — алиас.
function variableColorCss(variable) {
  try {
    if (!variable || variable.resolvedType !== 'COLOR') return null;
    const vals = variable.valuesByMode;
    const modeIds = Object.keys(vals);
    if (!modeIds.length) return null;
    const v = vals[modeIds[0]];
    if (!v || typeof v !== 'object' || v.type === 'VARIABLE_ALIAS') return null;
    if (typeof v.r !== 'number') return null;
    const r = Math.round(v.r * 255);
    const g = Math.round(v.g * 255);
    const b = Math.round(v.b * 255);
    const a = typeof v.a === 'number' ? v.a : 1;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  } catch (e) {
    return null;
  }
}

// Собирает все алиасы переменных из node.boundVariables:
// [{ field, id, index? }] — для массивов красок (fills, strokes) запоминается
// индекс конкретного paint'а: переменные на fills/strokes привязываются
// не к полю целиком, а к каждому paint отдельно (setBoundVariableForPaint).
function boundAliases(node) {
  let bv = null;
  try {
    bv = node.boundVariables;
  } catch (e) {
    return [];
  }
  if (!bv) return [];
  const out = [];
  for (const [field, value] of Object.entries(bv)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      value.forEach((alias, index) => {
        if (alias && alias.type === 'VARIABLE_ALIAS' && alias.id) {
          out.push({ field, id: alias.id, index });
        }
      });
    } else if (value.type === 'VARIABLE_ALIAS' && value.id) {
      out.push({ field, id: value.id });
    }
  }
  return out;
}

function collectAllNodes(roots) {
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    let children = null;
    try {
      children = 'children' in node ? node.children : null;
    } catch (e) {
      children = null;
    }
    if (children) {
      for (const child of children) walk(child);
    }
  };
  for (const r of roots) walk(r);
  return nodes;
}

// Сканирует выделение и находит ноды с привязанными переменными,
// чьи имена начинаются с заданного префикса (по умолчанию A_MZ).
async function handleLint(msg) {
  const prefix = (msg.prefix || 'A_MZ').trim();

  try {
    await figma.currentPage.loadAsync();

    if (figma.currentPage.selection.length === 0) {
      figma.ui.postMessage({ type: 'lintDone', tokens: [], empty: true });
      return;
    }

    const nodes = collectAllNodes(figma.currentPage.selection);
    const varCache = new Map(); // variableId -> variable | null
    const byToken = new Map();  // tokenName -> { name, usages: [] }

    for (const node of nodes) {
      const aliases = boundAliases(node);
      if (aliases.length === 0) continue;

      for (const { field, id, index } of aliases) {
        if (!varCache.has(id)) {
          let v = null;
          try {
            v = await figma.variables.getVariableByIdAsync(id);
          } catch (e) {
            v = null; // недоступная переменная (например, из удалённой библиотеки)
          }
          varCache.set(id, v);
        }
        const variable = varCache.get(id);
        if (!variable || !variable.name.startsWith(prefix)) continue;

        let entry = byToken.get(variable.name);
        if (!entry) {
          entry = { name: variable.name, color: variableColorCss(variable), usages: [] };
          byToken.set(variable.name, entry);
        }
        if (!entry.usages.some(
          (u) => u.nodeId === node.id && u.field === field && u.index === index
        )) {
          entry.usages.push({ nodeId: node.id, nodeName: node.name, field, index });
        }
      }
    }

    const tokens = Array.from(byToken.values())
      .map((t) => ({ name: t.name, color: t.color, count: t.usages.length, usages: t.usages }))
      .sort((a, b) => a.name.localeCompare(b.name));

    figma.ui.resize(290, LINT_WINDOW_HEIGHT);
    figma.ui.postMessage({ type: 'lintDone', tokens });
  } catch (e) {
    figma.ui.postMessage({ type: 'lintDone', tokens: [], error: e.message });
  }
}

// Возвращает полный список токенов с заданным префиксом (по умолчанию I_MZ)
// из всех доступных библиотек Variables.
async function handleListIosTokens(msg) {
  const prefix = (msg.prefix || 'I_MZ').trim();

  try {
    const collections = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    const tokens = [];

    for (const col of collections) {
      let vars = [];
      try {
        vars = await figma.teamLibrary.getVariablesInLibraryCollectionAsync(col.key);
      } catch (e) {
        continue; // коллекция недоступна — пропускаем
      }
      for (const v of vars) {
        if (v.name.startsWith(prefix)) {
          tokens.push({
            name: v.name,
            key: v.key,
            library: col.libraryName,
            collection: col.name,
          });
        }
      }
    }

    tokens.sort((a, b) => a.name.localeCompare(b.name));
    figma.ui.postMessage({ type: 'iosTokens', tokens });
  } catch (e) {
    figma.ui.postMessage({ type: 'iosTokens', tokens: [], error: e.message });
  }
}

// Резолвит цвета для видимых в списке библиотечных токенов.
// Значения библиотечных переменных доступны только после импорта,
// поэтому UI запрашивает превью порциями — только для отображаемых ключей.
async function handlePreviewColors(msg) {
  const keys = Array.isArray(msg.keys) ? msg.keys.slice(0, 150) : [];
  const colors = {};

  for (const key of keys) {
    try {
      const v = await figma.variables.importVariableByKeyAsync(key);
      colors[key] = v ? variableColorCss(v) : null;
    } catch (e) {
      colors[key] = null;
    }
  }

  figma.ui.postMessage({ type: 'tokenColors', colors });
}

// Перебиндивает переданные привязки (нода + поле [+ индекс paint'а])
// на выбранный iOS-токен.
async function handleRemap(msg) {
  const iosKey = msg.iosKey;
  const iosName = msg.iosName || iosKey;
  const usages = Array.isArray(msg.usages) ? msg.usages : [];
  const report = { replaced: 0, failed: [] };

  try {
    const variable = await figma.variables.importVariableByKeyAsync(iosKey);
    if (!variable) throw new Error('cannot import library variable');

    for (const u of usages) {
      try {
        const node = await figma.getNodeByIdAsync(u.nodeId);
        if (!node) throw new Error('node not found');

        if (
          (u.field === 'fills' || u.field === 'strokes') &&
          typeof u.index === 'number'
        ) {
          // Привязка к конкретному paint: клонируем массив красок,
          // подменяем нужный paint версией с привязанной переменной.
          const paints = node[u.field];
          if (!Array.isArray(paints) || !paints[u.index]) {
            throw new Error(`paint #${u.index} not found in ${u.field}`);
          }
          const updated = paints.slice();
          updated[u.index] = figma.variables.setBoundVariableForPaint(
            updated[u.index],
            'color',
            variable
          );
          node[u.field] = updated;
        } else {
          if (typeof node.setBoundVariable !== 'function') {
            throw new Error('node does not support variable binding');
          }
          node.setBoundVariable(u.field, variable);
        }
        report.replaced++;
      } catch (e) {
        const where = typeof u.index === 'number' ? `${u.field}[${u.index}]` : u.field;
        report.failed.push(`"${u.nodeName || u.nodeId}" (${where}): ${e.message}`);
      }
    }
  } catch (e) {
    report.failed.push('General error: ' + e.message);
  }

  figma.ui.postMessage({ type: 'remapDone', iosName, report });
}
