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

async function mapSwapComponent(compKey, propName, toValue) {
  let comp;
  try {
    comp = await figma.importComponentByKeyAsync(compKey);
  } catch (e) {
    return null;
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

    const node = locate(inst, item.path);
    if (!node) continue;

    if (item.fills) {
      try {
        node.fills = item.fills;
      } catch (e) {
        // skip this node
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
