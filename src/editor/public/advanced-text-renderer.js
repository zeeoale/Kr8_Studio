import {
  normalizeAdvancedTextProperties,
  reconcileTextLines,
  splitTextLines,
  transformText
} from '/core/advanced-typography.js';

export function drawAdvancedTextLayer(context, layer, options = {}) {
  const properties = normalizeAdvancedTextProperties(layer.properties || {});
  properties.lineEditing = reconcileTextLines(properties.text || '', properties.lineEditing);
  const layout = createAdvancedTextLayout(context, layer, properties);

  drawTextBackground(context, layer, layout);

  context.save();
  applyTypographyTransform(context, layout, properties.typography);
  for (const line of layout.lines) {
    drawTextLine(context, line, properties, options);
  }
  context.restore();

  return {
    ...layout,
    typography: properties.typography,
    lineEditing: properties.lineEditing
  };
}

export function createAdvancedTextLayout(context, layer, normalizedProperties = null) {
  const properties = normalizedProperties || normalizeAdvancedTextProperties(layer.properties || {});
  const typography = properties.typography;
  const transform = layer.transform || {};
  const padding = finite(properties.padding, 0);
  const requestedWidth = Math.max(1, finite(transform.width, typography.maxWidth || 800));
  const requestedHeight = Math.max(1, finite(transform.height, 80));
  const wrapWidth = Math.max(1, finite(typography.maxWidth, requestedWidth - padding * 2));
  const manualLines = splitTextLines(transformText(properties.text || '', typography.textTransform));
  const overrides = reconcileTextLines(properties.text || '', properties.lineEditing).lines;
  const lines = [];

  for (let manualIndex = 0; manualIndex < manualLines.length; manualIndex += 1) {
    const override = properties.lineEditing.enabled ? overrides[manualIndex] : null;
    const fontSize = positive(override?.fontSize, typography.fontSize);
    const font = fontString(typography, fontSize);
    const letterSpacing = finite(override?.letterSpacing, typography.letterSpacing);
    const wrapped = typography.autoWrap
      ? wrapLine(context, manualLines[manualIndex], wrapWidth, font, letterSpacing, typography.wordSpacing)
      : [manualLines[manualIndex]];
    for (let wrapIndex = 0; wrapIndex < wrapped.length; wrapIndex += 1) {
      const text = wrapped[wrapIndex];
      setTextMetrics(context, font, letterSpacing, typography.wordSpacing);
      const metrics = context.measureText(text || ' ');
      const advanceWidth = measureTextWidth(metrics.width, text, letterSpacing, typography.wordSpacing);
      const addedSpacing = Math.max(0, advanceWidth - metrics.width);
      const glyphLeft = -finite(metrics.actualBoundingBoxLeft, 0);
      const glyphRight = Math.max(
        advanceWidth,
        finite(metrics.actualBoundingBoxRight, metrics.width) + addedSpacing
      );
      const ascent = Math.max(0, finite(metrics.actualBoundingBoxAscent, fontSize * 0.78));
      const descent = Math.max(0, finite(metrics.actualBoundingBoxDescent, fontSize * 0.22));
      const scaleX = finite(override?.scaleX, 1);
      const scaleY = finite(override?.scaleY, 1);
      const glyphWidth = Math.max(1, glyphRight - glyphLeft);
      const visualHeight = Math.max(1, ascent + descent);
      lines.push({
        id: override?.id || `line-${manualIndex}`,
        manualIndex,
        wrapIndex,
        text,
        font,
        fontSize,
        letterSpacing,
        wordSpacing: typography.wordSpacing,
        advanceWidth,
        glyphLeft,
        glyphRight,
        glyphWidth,
        ascent,
        descent,
        baselineOffset: (ascent - descent) / 2,
        visualWidth: glyphWidth * Math.abs(scaleX),
        visualHeight: visualHeight * Math.abs(scaleY),
        offsetX: finite(override?.offsetX, 0),
        offsetY: finite(override?.offsetY, 0),
        scaleX,
        scaleY,
        rotation: finite(override?.rotation, 0),
        opacity: clamp(finite(override?.opacity, 1), 0, 1)
      });
    }
  }

  if (!lines.length) {
    lines.push({
      id: 'line-0',
      manualIndex: 0,
      wrapIndex: 0,
      text: '',
      font: fontString(typography, typography.fontSize),
      fontSize: typography.fontSize,
      letterSpacing: typography.letterSpacing,
      wordSpacing: typography.wordSpacing,
      advanceWidth: 0,
      glyphLeft: 0,
      glyphRight: 0,
      glyphWidth: 0,
      ascent: typography.fontSize * 0.78,
      descent: typography.fontSize * 0.22,
      baselineOffset: typography.fontSize * 0.28,
      visualWidth: 0,
      visualHeight: typography.fontSize,
      offsetX: 0,
      offsetY: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      opacity: 1
    });
  }

  const centers = calculateLineCenters(lines, typography.lineHeight);
  let minY = Infinity;
  let maxY = -Infinity;
  let maxLineWidth = 1;
  for (let index = 0; index < lines.length; index += 1) {
    lines[index].flowY = centers[index];
    minY = Math.min(minY, centers[index] - lines[index].visualHeight / 2 + lines[index].offsetY);
    maxY = Math.max(maxY, centers[index] + lines[index].visualHeight / 2 + lines[index].offsetY);
    maxLineWidth = Math.max(maxLineWidth, lines[index].visualWidth + Math.abs(lines[index].offsetX));
  }

  const contentHeight = Math.max(1, maxY - minY);
  const autoSize = typography.boxMode === 'auto-size';
  const width = autoSize ? maxLineWidth + padding * 2 : requestedWidth;
  const height = autoSize ? contentHeight + padding * 2 : requestedHeight;
  const anchorX = finite(transform.anchorX, 0.5);
  const anchorY = finite(transform.anchorY, 0.5);
  const left = -width * anchorX;
  const top = -height * anchorY;
  const innerLeft = left + padding;
  const innerRight = left + width - padding;
  const innerTop = top + padding;
  const innerBottom = top + height - padding;
  const verticalOffset = typography.verticalAlign === 'top'
    ? innerTop - minY
    : typography.verticalAlign === 'bottom'
      ? innerBottom - maxY
      : (innerTop + innerBottom) / 2 - (minY + maxY) / 2;

  for (const line of lines) {
    const alignX = typography.align === 'left'
      ? innerLeft
      : typography.align === 'right'
        ? innerRight
        : (innerLeft + innerRight) / 2;
    line.x = alignX + line.offsetX;
    line.y = line.flowY + verticalOffset + line.offsetY;
    line.drawOffsetX = typography.align === 'left'
      ? 0
      : typography.align === 'right'
        ? -line.advanceWidth
        : -line.advanceWidth / 2;
    const lineLeft = line.x + (line.drawOffsetX + line.glyphLeft) * Math.abs(line.scaleX);
    line.bounds = {
      left: lineLeft,
      top: line.y - line.visualHeight / 2,
      width: line.visualWidth,
      height: line.visualHeight
    };
  }

  return {
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    padding,
    lines
  };
}

export function applyTypographyTransform(context, layout, typography) {
  const pivotX = layout.left + layout.width * finite(typography.anchorX, 0.5);
  const pivotY = layout.top + layout.height * finite(typography.anchorY, 0.5);
  const skewX = Math.tan(degreesToRadians(finite(typography.skewX, 0)));
  const skewY = Math.tan(degreesToRadians(finite(typography.skewY, 0)));
  context.translate(finite(typography.offsetX, 0), finite(typography.offsetY, 0));
  context.translate(pivotX, pivotY);
  context.rotate(degreesToRadians(finite(typography.rotation, 0)));
  context.transform(1, skewY, skewX, 1, 0, 0);
  context.scale(
    finite(typography.scaleX, 1) * finite(typography.stretchX, 1),
    finite(typography.scaleY, 1) * finite(typography.stretchY, 1)
  );
  context.translate(-pivotX, -pivotY);
}

function drawTextBackground(context, layer, layout) {
  const properties = layer.properties || {};
  const backgroundOpacity = clamp(finite(properties.backgroundOpacity, 0), 0, 1);
  if (backgroundOpacity <= 0) return;
  context.save();
  context.globalAlpha *= backgroundOpacity;
  context.fillStyle = properties.backgroundColor || '#000000';
  drawRoundedRect(context, layout.left, layout.top, layout.width, layout.height, finite(properties.radius, 0));
  context.fill();
  context.restore();
}

function drawTextLine(context, line, properties, options) {
  const typography = properties.typography;
  const effects = properties.textEffects;
  const texture = properties.textureMask;
  const useBitmap = effects.distressed.enabled ||
    effects.glitch.enabled ||
    effects.scanlines.enabled ||
    texture.enabled;

  context.save();
  context.translate(line.x, line.y);
  context.rotate(degreesToRadians(line.rotation));
  context.scale(line.scaleX, line.scaleY);
  context.globalAlpha *= clamp(typography.textOpacity * line.opacity, 0, 1);

  if (useBitmap && line.text) {
    const bitmap = createEffectBitmap(line, properties, options);
    context.drawImage(bitmap.canvas, bitmap.offsetX, bitmap.offsetY);
  } else {
    drawNativeGlyphs(context, line, properties);
  }
  context.restore();
}

function drawNativeGlyphs(context, line, properties) {
  const typography = properties.typography;
  const effects = properties.textEffects;
  setTextMetrics(context, line.font, line.letterSpacing, line.wordSpacing);
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  context.lineJoin = 'round';
  const drawX = finite(line.drawOffsetX, 0);
  const drawY = finite(line.baselineOffset, 0);

  if (effects.glow.enabled && effects.glow.intensity > 0) {
    context.save();
    context.fillStyle = colorWithOpacity(effects.glow.color, clamp(effects.glow.intensity, 0, 1));
    context.shadowColor = effects.glow.color;
    context.shadowBlur = Math.max(0, finite(effects.glow.blur, 18));
    context.fillText(line.text, drawX, drawY);
    context.restore();
  }

  if (effects.shadow.enabled) {
    context.shadowColor = colorWithOpacity(effects.shadow.color, clamp(effects.shadow.opacity, 0, 1));
    context.shadowBlur = Math.max(0, finite(effects.shadow.blur, 0));
    context.shadowOffsetX = finite(effects.shadow.offsetX, 0);
    context.shadowOffsetY = finite(effects.shadow.offsetY, 0);
  } else {
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;
  }

  if (effects.stroke.enabled && effects.stroke.width > 0) {
    context.strokeStyle = colorWithOpacity(effects.stroke.color, clamp(effects.stroke.opacity, 0, 1));
    context.lineWidth = Math.max(0, finite(effects.stroke.width, 0));
    context.strokeText(line.text, drawX, drawY);
  }
  context.fillStyle = typography.color;
  context.fillText(line.text, drawX, drawY);
}

function createEffectBitmap(line, properties, options) {
  const effects = properties.textEffects;
  const typography = properties.typography;
  const effectPad = Math.ceil(Math.max(
    12,
    effects.glow.enabled ? effects.glow.blur * 2 : 0,
    effects.shadow.enabled
      ? effects.shadow.blur * 2 + Math.abs(effects.shadow.offsetX) + Math.abs(effects.shadow.offsetY)
      : 0,
    effects.glitch.enabled ? Math.abs(effects.glitch.horizontalDisplacement) + 4 : 0
  ));
  const contentWidth = Math.max(2, Math.ceil(line.glyphWidth));
  const contentHeight = Math.max(2, Math.ceil(line.ascent + line.descent));
  const width = Math.max(2, contentWidth + effectPad * 2);
  const height = Math.max(2, contentHeight + effectPad * 2);
  const canvas = createCanvas(width, height);
  const bitmapContext = canvas.getContext('2d', { willReadFrequently: true });
  const bitmapLine = {
    ...line,
    drawOffsetX: effectPad - line.glyphLeft,
    baselineOffset: effectPad + line.ascent
  };
  const centeredProperties = {
    ...properties,
    typography: { ...typography, align: 'left', textOpacity: 1 }
  };
  drawNativeGlyphs(bitmapContext, bitmapLine, centeredProperties);

  if (properties.textureMask.enabled) {
    applyTextureMask(bitmapContext, canvas, properties.textureMask, options.getTextureImage?.(properties.textureMask.assetId));
  }
  if (effects.distressed.enabled) {
    applyDistressedMask(bitmapContext, canvas, effects.distressed);
  }
  if (effects.scanlines.enabled) {
    applyScanlines(bitmapContext, canvas, effects.scanlines);
  }
  if (effects.glitch.enabled) {
    applyGlitch(bitmapContext, canvas, effects.glitch, options.time || 0);
  }
  return {
    canvas,
    contentWidth,
    offsetX: line.drawOffsetX + line.glyphLeft - effectPad,
    offsetY: -line.ascent - effectPad
  };
}

function applyTextureMask(context, canvas, texture, image) {
  if (!image || !image.complete || !image.naturalWidth) return;
  const textureCanvas = createCanvas(canvas.width, canvas.height);
  const textureContext = textureCanvas.getContext('2d', { willReadFrequently: true });
  const scale = Math.max(0.01, finite(texture.scale, 1));
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  textureContext.translate(canvas.width / 2 + finite(texture.offsetX, 0), canvas.height / 2 + finite(texture.offsetY, 0));
  textureContext.rotate(degreesToRadians(finite(texture.rotation, 0)));
  textureContext.drawImage(image, -width / 2, -height / 2, width, height);
  processTexturePixels(textureContext, textureCanvas, texture);
  textureContext.globalCompositeOperation = 'destination-in';
  textureContext.drawImage(canvas, 0, 0);
  context.save();
  context.globalCompositeOperation = mapTextureBlendMode(texture.blendMode);
  context.drawImage(textureCanvas, 0, 0);
  context.restore();
}

function processTexturePixels(context, canvas, texture) {
  const contrast = Math.max(0, finite(texture.contrast, 1));
  const threshold = clamp(finite(texture.threshold, 0), 0, 1);
  if (contrast === 1 && threshold === 0 && !texture.invertMask) return;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const luminance = (data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722) / 255;
    let value = clamp((luminance - 0.5) * contrast + 0.5, 0, 1);
    if (threshold > 0) value = value >= threshold ? 1 : 0;
    if (texture.invertMask) value = 1 - value;
    data[index + 3] = Math.round(data[index + 3] * value);
  }
  context.putImageData(imageData, 0, 0);
}

function applyDistressedMask(context, canvas, effect) {
  const random = seededRandom(Math.round(finite(effect.seed, 1)));
  const amount = clamp(finite(effect.amount, 0.2), 0, 1);
  const scale = Math.max(0.1, finite(effect.scale, 1));
  const threshold = clamp(finite(effect.threshold, 0.5), 0, 1);
  const count = Math.round((canvas.width * canvas.height / 2400) * amount);
  context.save();
  context.globalCompositeOperation = 'destination-out';
  for (let index = 0; index < count; index += 1) {
    const sample = random();
    const remove = effect.inverted ? sample > threshold : sample < threshold;
    if (!remove) continue;
    const width = (1 + random() * 12) * scale;
    const height = (0.5 + random() * 3) * scale;
    context.globalAlpha = 0.45 + random() * 0.55;
    context.fillRect(random() * canvas.width, random() * canvas.height, width, height);
  }
  context.restore();
}

function applyScanlines(context, canvas, effect) {
  const random = seededRandom(Math.round(finite(effect.seed, 1)));
  const density = clamp(finite(effect.density, 0.18), 0.01, 1);
  const spacing = Math.max(2, Math.round(1 / density));
  const thickness = Math.max(0.25, finite(effect.thickness, 1));
  const phase = random() * spacing;
  context.save();
  context.globalCompositeOperation = 'destination-out';
  context.globalAlpha = clamp(finite(effect.opacity, 0.24), 0, 1);
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(degreesToRadians(finite(effect.angle, 0)));
  for (let y = -canvas.height + phase; y <= canvas.height; y += spacing) {
    context.fillRect(-canvas.width, y, canvas.width * 2, thickness);
  }
  const scratchCount = Math.round(density * 12);
  for (let index = 0; index < scratchCount; index += 1) {
    const x = -canvas.width + random() * canvas.width * 2;
    const width = Math.max(0.35, thickness * (0.35 + random()));
    context.fillRect(x, -canvas.height, width, canvas.height * 2);
  }
  context.restore();
}

function applyGlitch(context, canvas, effect, time) {
  const source = createCanvas(canvas.width, canvas.height);
  source.getContext('2d').drawImage(canvas, 0, 0);
  const animatedSeed = effect.mode === 'animated'
    ? Math.floor(finite(effect.seed, 1) + time * 12)
    : Math.floor(finite(effect.seed, 1));
  const random = seededRandom(animatedSeed);
  const sliceCount = Math.max(1, Math.round(finite(effect.sliceCount, 8)));
  const amount = clamp(finite(effect.amount, 0.2), 0, 1);
  const sliceHeight = canvas.height / sliceCount;
  context.clearRect(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < sliceCount; index += 1) {
    const y = Math.floor(index * sliceHeight);
    const height = Math.ceil(sliceHeight + 1);
    const active = random() < amount;
    const dx = active ? (random() * 2 - 1) * finite(effect.horizontalDisplacement, 12) : 0;
    const dy = active ? (random() * 2 - 1) * finite(effect.verticalDisplacement, 0) : 0;
    context.drawImage(source, 0, y, canvas.width, height, dx, y + dy, canvas.width, height);
    if (active && effect.rgbSplit) {
      drawTintedSlice(context, source, 0, y, canvas.width, height, dx - 3, y + dy, '#ff1744', 0.28);
      drawTintedSlice(context, source, 0, y, canvas.width, height, dx + 3, y + dy, '#00e5ff', 0.28);
    }
  }
}

function drawTintedSlice(context, source, sx, sy, sw, sh, dx, dy, color, opacity) {
  const slice = createCanvas(sw, sh);
  const sliceContext = slice.getContext('2d');
  sliceContext.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  sliceContext.globalCompositeOperation = 'source-in';
  sliceContext.fillStyle = color;
  sliceContext.fillRect(0, 0, sw, sh);
  context.save();
  context.globalAlpha = opacity;
  context.globalCompositeOperation = 'screen';
  context.drawImage(slice, dx, dy);
  context.restore();
}

function calculateLineCenters(lines, lineHeight) {
  const centers = [0];
  for (let index = 1; index < lines.length; index += 1) {
    const previousHeight = lines[index - 1].visualHeight;
    const currentHeight = lines[index].visualHeight;
    centers[index] = centers[index - 1] + ((previousHeight + currentHeight) / 2) * lineHeight;
  }
  return centers;
}

function wrapLine(context, text, maxWidth, font, letterSpacing, wordSpacing) {
  if (!text) return [''];
  const tokens = text.split(/(\s+)/);
  const lines = [];
  let current = '';
  setTextMetrics(context, font, letterSpacing, wordSpacing);
  for (const token of tokens) {
    const candidate = current + token;
    const width = measureTextWidth(context.measureText(candidate).width, candidate, letterSpacing, wordSpacing);
    if (current && width > maxWidth) {
      lines.push(current);
      current = token;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

function setTextMetrics(context, font, letterSpacing, wordSpacing) {
  context.font = font;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  if ('letterSpacing' in context) context.letterSpacing = `${finite(letterSpacing, 0)}px`;
  if ('wordSpacing' in context) context.wordSpacing = `${finite(wordSpacing, 0)}px`;
  context.fontKerning = 'normal';
  context.textRendering = 'optimizeLegibility';
}

function measureTextWidth(baseWidth, text, letterSpacing, wordSpacing) {
  return Math.max(
    0,
    baseWidth +
      Math.max(0, String(text).length - 1) * finite(letterSpacing, 0) +
      (String(text).match(/\s/g)?.length || 0) * finite(wordSpacing, 0)
  );
}

function fontString(typography, fontSize) {
  const style = typography.fontStyle === 'italic' ? 'italic' : 'normal';
  const weight = Math.max(100, Math.min(900, Math.round(finite(typography.fontWeight, 400) / 100) * 100));
  return `${style} ${weight} ${fontSize}px ${cssFont(typography.fontFamily)}`;
}

function cssFont(fontFamily) {
  const family = String(fontFamily || 'Arial').replaceAll('"', '').trim() || 'Arial';
  return `"${family}", Arial, sans-serif`;
}

function drawRoundedRect(context, x, y, width, height, radius) {
  const safeRadius = Math.min(Math.max(0, radius), width / 2, height / 2);
  context.beginPath();
  context.roundRect(x, y, width, height, safeRadius);
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  return canvas;
}

function seededRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function mapTextureBlendMode(mode) {
  const supported = new Set(['source-in', 'multiply', 'screen', 'overlay', 'soft-light', 'hard-light']);
  return supported.has(mode) ? mode : 'source-in';
}

function colorWithOpacity(color, opacity) {
  const value = String(color || '#000000');
  if (!value.startsWith('#')) return value;
  const hex = value.slice(1);
  const normalized = hex.length === 3
    ? hex.split('').map((part) => part + part).join('')
    : hex.padEnd(6, '0').slice(0, 6);
  return `#${normalized}${Math.round(clamp(opacity, 0, 1) * 255).toString(16).padStart(2, '0')}`;
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}
