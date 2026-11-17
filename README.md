# Platform Switcher (Android ⇄ iOS)

A Figma plugin that switches the **Platform** variant property of components
from Android to iOS (or back) in one click.

![Interface](https://img.shields.io/badge/Figma-Plugin-black)

## Features

- Works on the current selection only — a frame or a section.
- Components are matched strictly by their `Platform` component property.
- Nested components that have their own `Platform` property are switched
  **sequentially, from the outermost to the deepest** — each nested switch
  is verified against the component set before it is applied.
- Other overrides are preserved across the switch:
  - nested component properties (a switch that is ON on Android stays ON on iOS),
  - image fills on nested layers (matched by layer name),
  - swapped nested components (INSTANCE_SWAP) are mapped to the target
    platform variant of their component set.
- Click the arrow between the Android and Apple icons to reverse the
  direction (iOS → Android); the arrow animates.
- Text overrides are intentionally **not** restored — they fall back to the
  target variant defaults.
- If any selected instance references a broken library or a deleted
  component, nothing is switched and a red error lists the broken instances.

## How it works

1. Before switching, the plugin takes a snapshot of every nested instance:
   its `componentProperties`, and image fills of any layer, each stored with
   a path (layer name + index among same-named siblings).
2. The `Platform` property is changed on the root instance.
3. The snapshot is re-applied by path on the new variant structure,
   processing nested instances outermost-first.

## Install from source

1. Figma → **Plugins → Development → Import plugin from manifest…**
2. Choose `manifest.json` from this folder.
3. Run via **Plugins → Development → Platform Switcher (Android ⇄ iOS)**.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Plugin manifest (id, no network access) |
| `code.js` | Plugin main (selection scan, snapshot, switching logic) |
| `ui.html` | Plugin UI (design-matched, English) |
| `assets/` | SVG sources of the Android / arrow / Apple icons |
| `PUBLISHING.md` | Figma Community publication checklist and texts (RU) |

## Limitations

- Nested nodes are matched between variants by layer name and order among
  same-named siblings. If the Android and iOS variants name their layers
  differently, those overrides cannot be restored.
- The target variant combination must exist in the component set.

## License

MIT
