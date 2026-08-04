export function reduceAspectRatio(width, height) {
  const safeWidth = positiveInteger(width);
  const safeHeight = positiveInteger(height);
  const divisor = greatestCommonDivisor(safeWidth, safeHeight);
  return { width: safeWidth / divisor, height: safeHeight / divisor };
}

export function formatAspectRatioToken(width, height) {
  const ratio = reduceAspectRatio(width, height);
  return `${ratio.width}_${ratio.height}`;
}

export function formatAspectRatioLabel(width, height) {
  const ratio = reduceAspectRatio(width, height);
  return `${ratio.width}:${ratio.height}`;
}

function positiveInteger(value) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b) [a, b] = [b, a % b];
  return Math.max(1, a);
}
