# Публикация в Figma Community

## Изображения (сделаете сами)

| Материал | Размер | Формат | Примечание |
|---|---|---|---|
| Иконка плагина | 128 × 128 px | PNG | На белом или прозрачном фоне: робот Android (#3DDC84), стрелка (#A2A2A2), яблоко (чёрное) — в один ряд |
| Обложка (cover art) | 1920 × 960 px | PNG / JPG | Белый фон, по центру крупные три иконки (Android → стрелка → Apple), ниже название «Platform Switcher» |
| Скриншоты (необязательно) | 1920 × 960 px | PNG / JPG | 1–3 шт.: окно плагина с иллюстрацией; итог после переключения («✅ Switched …»); пример переключённого экрана Android → iOS |

SVG-исходники иконок лежат в `ui.html` плагина (встроены инлайн), цвета: Android `#3DDC84`, стрелка `#A2A2A2`, Apple — чёрный, заголовок `#A2A2A2`.

## Название (Name)

```
Platform Switcher (Android ⇄ iOS)
```

## Описание (Description) — вставить как есть

```
Switch the Platform variant property of your components from Android to iOS (or back) in one click.

• Select a frame or a section and hit Switch — only the selection is affected.
• Components are matched strictly by their Platform component property.
• Nested components are switched sequentially, from the outermost to the deepest.
• Other overrides are preserved: a switch that is ON on Android stays ON on iOS, swapped nested components are mapped to the target platform variant.
• Click the arrow between the icons to reverse the direction (iOS → Android).

Tip: text overrides are intentionally not restored — they fall back to the target variant defaults.

Built for design systems that maintain Android and iOS variants of the same components.
```

## Теги (Tags)

```
android, ios, platform, switch, variants, components, design system, mobile, nested components, override
```

(максимум 12; минимум — 1)

## Чек-лист публикации

1. **Figma Desktop** → меню Figma → **Preferences → Enable Dev Mode** (если ещё не включён).
2. В Dev Mode или через **Plugins → Development** найдите плагин, правый клик → **Publish to Community**.
3. Заполните: Name, Description (текст выше), Tags, загрузите иконку 128×128 и обложку 1920×960.
4. Creator — берётся из профиля Figma Community (нужен аккаунт с заполненным профилем; при первой публикации Figma предложит его создать).
5. Отправьте на модерацию — обычно от нескольких дней до пары недель.
6. После публикации плагин появится по ссылке вида `figma.com/community/plugin/<id>/platform-switcher-android-ios` — можно обновлять версиями (в manifest меняется поле `version`? нет — версия ставится при публикации обновления через тот же поток).

## Примечание о версиях

Публикуется версия из папки `figma-platform-switcher-no-texts/` (текущая актуальная:
без обработки текстов, с кликом по стрелке и английским интерфейсом).
Полная версия с восстановлением текстов (`figma-platform-switcher/`) — отдельный плагин,
при желании можно опубликовать отдельно под именем «Platform Switcher — Text Preserving».
