const PROP_NAME = 'Platform';

figma.showUI(__html__, { width: 290, height: 201, title: 'Platform Switcher' });

figma.ui.onmessage = async (msg) => {
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
    const sameName = children.filter((c) => c.name === seg.name);
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
        node.fills = item.fills;
      } catch (e) {
        // skip this node
      }
    }

    if (item.bound) {
      for (const field of Object.keys(item.bound)) {
        let alreadyBound = false;
        try {
          const bv = node.boundVariables;
          alreadyBound =
            bv &&
            Array.isArray(bv[field]) &&
            bv[field].some((b) => b && b.type === 'VARIABLE_ALIAS');
        } catch (e) {
          alreadyBound = false;
        }
        if (alreadyBound) continue;

        for (const varId of item.bound[field]) {
          if (!varId) continue;
          try {
            let variable = await figma.variables.getVariableByIdAsync(varId);
            const mapped = await mapPlatformVariable(variable, fromValue, toValue);
            if (mapped) variable = mapped;
            if (variable) node.setBoundVariable(field, variable);
          } catch (e) {
            // skip this binding
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
