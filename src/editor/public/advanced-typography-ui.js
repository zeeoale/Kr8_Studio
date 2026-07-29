import {
  normalizeAdvancedTextProperties,
  reconcileTextLines
} from '/core/advanced-typography.js';

export function renderAdvancedTypographyInspector(layer, api) {
  const properties = normalizeAdvancedTextProperties(layer.properties || {});
  properties.lineEditing = reconcileTextLines(properties.text || '', properties.lineEditing);
  TextContentPanel(properties, api);
  TextPresetManager(properties, api);
  TypographyPanel(properties, api);
  TextTransformPanel(properties, api);
  TextLineEditor(properties, api);
  TextEffectsPanel(properties, api);
  TextTexturePanel(properties, api);
  LegacyTextBoxPanel(properties, api);
}

export function TextContentPanel(properties, api) {
  api.addSection('Text Content');
  const textarea = api.addTextareaField('Text', properties.text || '', (value) => api.updateText(value), {
    live: true
  });
  textarea.classList.add('advanced-text-content');
  textarea.spellcheck = false;
}

export function TextPresetManager(properties, api) {
  api.addSection('Typography Preset');
  const presets = api.presets || [];
  api.addSelectField(
    'Preset',
    properties.typographyPresetId || '',
    ['', ...presets.map((preset) => preset.id)],
    (value) => api.selectPreset(value),
    (value) => value ? presets.find((preset) => preset.id === value)?.name || value : 'Custom'
  );
  api.addButtonRow([
    ['Apply', api.applyPreset],
    ['Save Preset', api.savePreset]
  ]);
}

export function TypographyPanel(properties, api) {
  const typography = properties.typography;
  api.addSection('Typography');
  api.addFontFamilyField('Font Family', typography.fontFamily, (value) => api.updateTypography({ fontFamily: value }));
  api.addNumberField('Font Size', typography.fontSize, (value) => api.updateTypography({ fontSize: Math.max(1, value) }), { step: 1 });
  api.addSelectField('Weight', String(typography.fontWeight), ['100', '200', '300', '400', '500', '600', '700', '800', '900'], (value) => api.updateTypography({ fontWeight: Number(value) }));
  api.addSelectField('Font Style', typography.fontStyle, ['normal', 'italic'], (value) => api.updateTypography({ fontStyle: value }));
  api.addNumberField('Line Height', typography.lineHeight, (value) => api.updateTypography({ lineHeight: value }), { step: 0.01 });
  api.addNumberField('Letter Spacing', typography.letterSpacing, (value) => api.updateTypography({ letterSpacing: value }), { step: 0.1 });
  api.addNumberField('Word Spacing', typography.wordSpacing, (value) => api.updateTypography({ wordSpacing: value }), { step: 0.1 });
  api.addSelectField('Horizontal', typography.align, ['left', 'center', 'right'], (value) => api.updateTypography({ align: value }));
  api.addSelectField('Vertical', typography.verticalAlign, ['top', 'middle', 'bottom'], (value) => api.updateTypography({ verticalAlign: value }));
  api.addSelectField('Transform', typography.textTransform, ['none', 'uppercase', 'lowercase'], (value) => api.updateTypography({ textTransform: value }));
  api.addColorField('Text Color', typography.color, (value) => api.updateTypography({ color: value }));
  api.addNumberField('Text Opacity', typography.textOpacity, (value) => api.updateTypography({ textOpacity: clamp(value, 0, 1) }), { step: 0.01 });
  api.addSelectField('Box Mode', typography.boxMode, ['fixed-box', 'auto-size'], (value) => api.updateTypography({ boxMode: value }), formatLabel);
  api.addCheckboxField('Auto Wrap', typography.autoWrap, (value) => api.updateTypography({ autoWrap: value }));
  if (typography.autoWrap) {
    api.addNumberField('Max Width', typography.maxWidth ?? layerWidth(api.layer), (value) => api.updateTypography({ maxWidth: Math.max(1, value) }));
  }
}

export function TextTransformPanel(properties, api) {
  const typography = properties.typography;
  api.addSection('Text Transform');
  api.addNumberField('Offset X', typography.offsetX, (value) => api.updateTypography({ offsetX: value }));
  api.addNumberField('Offset Y', typography.offsetY, (value) => api.updateTypography({ offsetY: value }));
  api.addNumberField('Scale X', typography.scaleX, (value) => api.updateTypography({ scaleX: value }), { step: 0.01 });
  api.addNumberField('Scale Y', typography.scaleY, (value) => api.updateTypography({ scaleY: value }), { step: 0.01 });
  api.addNumberField('Skew X', typography.skewX, (value) => api.updateTypography({ skewX: value }), { step: 0.1 });
  api.addNumberField('Skew Y', typography.skewY, (value) => api.updateTypography({ skewY: value }), { step: 0.1 });
  api.addNumberField('Rotation', typography.rotation, (value) => api.updateTypography({ rotation: value }), { step: 0.1 });
  api.addNumberField('H Stretch', typography.stretchX, (value) => api.updateTypography({ stretchX: value }), { step: 0.01 });
  api.addNumberField('V Stretch', typography.stretchY, (value) => api.updateTypography({ stretchY: value }), { step: 0.01 });
  api.addNumberField('Pivot X', typography.anchorX, (value) => api.updateTypography({ anchorX: clamp(value, 0, 1) }), { step: 0.01 });
  api.addNumberField('Pivot Y', typography.anchorY, (value) => api.updateTypography({ anchorY: clamp(value, 0, 1) }), { step: 0.01 });
  api.addCheckboxField('Canvas Snapping', api.snapping, api.updateSnapping);
}

export function TextLineEditor(properties, api) {
  api.addSection('Edit Lines Individually');
  api.addCheckboxField('Enabled', properties.lineEditing.enabled, (value) => api.updateLineEditing({ enabled: value }));
  if (!properties.lineEditing.enabled) return;

  const list = document.createElement('div');
  list.className = 'text-line-editor';
  for (let index = 0; index < properties.lineEditing.lines.length; index += 1) {
    const line = properties.lineEditing.lines[index];
    const item = document.createElement('section');
    item.className = `text-line-item${line.id === api.selectedLineId ? ' selected' : ''}`;
    const heading = document.createElement('button');
    heading.type = 'button';
    heading.className = 'text-line-heading';
    heading.textContent = `${index + 1}. ${line.textSnapshot || '(empty line)'}`;
    heading.title = line.textSnapshot;
    heading.addEventListener('click', () => api.selectLine(line.id));
    item.append(heading);

    const grid = document.createElement('div');
    grid.className = 'text-line-grid';
    addCompactNumber(grid, 'X', line.offsetX, (value) => api.updateLine(line.id, { offsetX: value }));
    addCompactNumber(grid, 'Y', line.offsetY, (value) => api.updateLine(line.id, { offsetY: value }));
    addCompactNumber(grid, 'Size', line.fontSize ?? '', (value) => api.updateLine(line.id, { fontSize: optionalNumber(value) }));
    addCompactNumber(grid, 'Spacing', line.letterSpacing ?? '', (value) => api.updateLine(line.id, { letterSpacing: optionalNumber(value) }), 0.1);
    addCompactNumber(grid, 'Scale X', line.scaleX, (value) => api.updateLine(line.id, { scaleX: value }), 0.01);
    addCompactNumber(grid, 'Scale Y', line.scaleY, (value) => api.updateLine(line.id, { scaleY: value }), 0.01);
    addCompactNumber(grid, 'Rotate', line.rotation, (value) => api.updateLine(line.id, { rotation: value }), 0.1);
    addCompactNumber(grid, 'Opacity', line.opacity, (value) => api.updateLine(line.id, { opacity: clamp(value, 0, 1) }), 0.01);
    item.append(grid);
    list.append(item);
  }
  api.form.append(list);
}

export function TextEffectsPanel(properties, api) {
  const effects = properties.textEffects;
  api.addSection('Text Effects');
  effectToggle('Stroke', 'stroke', effects.stroke, api, () => {
    api.addColorField('Stroke Color', effects.stroke.color, (value) => api.updateEffect('stroke', { color: value }));
    api.addNumberField('Stroke Width', effects.stroke.width, (value) => api.updateEffect('stroke', { width: Math.max(0, value) }), { step: 0.5 });
    api.addNumberField('Stroke Opacity', effects.stroke.opacity, (value) => api.updateEffect('stroke', { opacity: clamp(value, 0, 1) }), { step: 0.01 });
    api.addSelectField('Stroke Position', effects.stroke.position, ['center', 'inside', 'outside'], (value) => api.updateEffect('stroke', { position: value }));
  });
  effectToggle('Shadow', 'shadow', effects.shadow, api, () => {
    api.addColorField('Shadow Color', effects.shadow.color, (value) => api.updateEffect('shadow', { color: value }));
    api.addNumberField('Shadow Blur', effects.shadow.blur, (value) => api.updateEffect('shadow', { blur: Math.max(0, value) }));
    api.addNumberField('Shadow X', effects.shadow.offsetX, (value) => api.updateEffect('shadow', { offsetX: value }));
    api.addNumberField('Shadow Y', effects.shadow.offsetY, (value) => api.updateEffect('shadow', { offsetY: value }));
    api.addNumberField('Shadow Opacity', effects.shadow.opacity, (value) => api.updateEffect('shadow', { opacity: clamp(value, 0, 1) }), { step: 0.01 });
  });
  effectToggle('Glow', 'glow', effects.glow, api, () => {
    api.addColorField('Glow Color', effects.glow.color, (value) => api.updateEffect('glow', { color: value }));
    api.addNumberField('Glow Blur', effects.glow.blur, (value) => api.updateEffect('glow', { blur: Math.max(0, value) }));
    api.addNumberField('Glow Intensity', effects.glow.intensity, (value) => api.updateEffect('glow', { intensity: clamp(value, 0, 1) }), { step: 0.01 });
  });
  effectToggle('Distressed / Grunge', 'distressed', effects.distressed, api, () => {
    api.addNumberField('Distress Amount', effects.distressed.amount, (value) => api.updateEffect('distressed', { amount: clamp(value, 0, 1) }), { step: 0.01 });
    api.addNumberField('Distress Scale', effects.distressed.scale, (value) => api.updateEffect('distressed', { scale: Math.max(0.1, value) }), { step: 0.1 });
    api.addNumberField('Distress Seed', effects.distressed.seed, (value) => api.updateEffect('distressed', { seed: Math.round(value) }));
    api.addNumberField('Distress Threshold', effects.distressed.threshold, (value) => api.updateEffect('distressed', { threshold: clamp(value, 0, 1) }), { step: 0.01 });
    api.addCheckboxField('Distress Invert', effects.distressed.inverted, (value) => api.updateEffect('distressed', { inverted: value }));
  });
  effectToggle('Glitch', 'glitch', effects.glitch, api, () => {
    api.addNumberField('Glitch Amount', effects.glitch.amount, (value) => api.updateEffect('glitch', { amount: clamp(value, 0, 1) }), { step: 0.01 });
    api.addNumberField('Glitch Slices', effects.glitch.sliceCount, (value) => api.updateEffect('glitch', { sliceCount: Math.max(1, Math.round(value)) }));
    api.addNumberField('Glitch X', effects.glitch.horizontalDisplacement, (value) => api.updateEffect('glitch', { horizontalDisplacement: value }));
    api.addNumberField('Glitch Y', effects.glitch.verticalDisplacement, (value) => api.updateEffect('glitch', { verticalDisplacement: value }));
    api.addCheckboxField('RGB Split', effects.glitch.rgbSplit, (value) => api.updateEffect('glitch', { rgbSplit: value }));
    api.addNumberField('Glitch Seed', effects.glitch.seed, (value) => api.updateEffect('glitch', { seed: Math.round(value) }));
    api.addSelectField('Glitch Mode', effects.glitch.mode, ['static', 'animated'], (value) => api.updateEffect('glitch', { mode: value }));
  });
  effectToggle('Scanlines / Scratches', 'scanlines', effects.scanlines, api, () => {
    api.addNumberField('Line Density', effects.scanlines.density, (value) => api.updateEffect('scanlines', { density: clamp(value, 0.01, 1) }), { step: 0.01 });
    api.addNumberField('Line Thickness', effects.scanlines.thickness, (value) => api.updateEffect('scanlines', { thickness: Math.max(0.1, value) }), { step: 0.1 });
    api.addNumberField('Line Angle', effects.scanlines.angle, (value) => api.updateEffect('scanlines', { angle: value }), { step: 0.1 });
    api.addNumberField('Line Opacity', effects.scanlines.opacity, (value) => api.updateEffect('scanlines', { opacity: clamp(value, 0, 1) }), { step: 0.01 });
    api.addNumberField('Line Seed', effects.scanlines.seed, (value) => api.updateEffect('scanlines', { seed: Math.round(value) }));
  });
}

export function TextTexturePanel(properties, api) {
  const texture = properties.textureMask;
  api.addSection('Text Texture');
  api.addCheckboxField('Enabled', texture.enabled, (value) => api.updateTexture({ enabled: value }));
  api.addButtonRow([['Import Texture', api.importTexture]]);
  if (!texture.enabled) return;
  api.addTextField('Asset ID', texture.assetId, (value) => api.updateTexture({ assetId: value }));
  api.addSelectField('Texture Blend', texture.blendMode, ['source-in', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light'], (value) => api.updateTexture({ blendMode: value }));
  api.addNumberField('Texture Scale', texture.scale, (value) => api.updateTexture({ scale: Math.max(0.01, value) }), { step: 0.01 });
  api.addNumberField('Texture X', texture.offsetX, (value) => api.updateTexture({ offsetX: value }));
  api.addNumberField('Texture Y', texture.offsetY, (value) => api.updateTexture({ offsetY: value }));
  api.addNumberField('Texture Rotate', texture.rotation, (value) => api.updateTexture({ rotation: value }), { step: 0.1 });
  api.addCheckboxField('Invert Mask', texture.invertMask, (value) => api.updateTexture({ invertMask: value }));
  api.addNumberField('Contrast', texture.contrast, (value) => api.updateTexture({ contrast: Math.max(0, value) }), { step: 0.05 });
  api.addNumberField('Threshold', texture.threshold, (value) => api.updateTexture({ threshold: clamp(value, 0, 1) }), { step: 0.01 });
}

export function LegacyTextBoxPanel(properties, api) {
  api.addSection('Text Box');
  api.addColorField('Background', properties.backgroundColor || '#000000', (value) => api.updateProperties({ backgroundColor: value }));
  api.addNumberField('Bg Opacity', properties.backgroundOpacity || 0, (value) => api.updateProperties({ backgroundOpacity: clamp(value, 0, 1) }), { step: 0.01 });
  api.addNumberField('Padding', properties.padding || 0, (value) => api.updateProperties({ padding: Math.max(0, value) }));
  api.addNumberField('Radius', properties.radius || 0, (value) => api.updateProperties({ radius: Math.max(0, value) }));
}

function effectToggle(label, key, value, api, renderFields) {
  api.addCheckboxField(label, value.enabled, (enabled) => api.updateEffect(key, { enabled }));
  if (value.enabled) renderFields();
}

function addCompactNumber(target, label, value, onChange, step = 1) {
  const wrapper = document.createElement('label');
  wrapper.className = 'compact-field';
  const span = document.createElement('span');
  span.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = step;
  input.value = value;
  input.addEventListener('change', () => onChange(input.value === '' ? undefined : Number(input.value)));
  wrapper.append(span, input);
  target.append(wrapper);
}

function optionalNumber(value) {
  if (value === '' || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function layerWidth(layer) {
  return Number(layer?.transform?.width || 800);
}

function formatLabel(value) {
  return String(value).replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}
