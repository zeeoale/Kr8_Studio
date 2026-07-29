export const YOUTUBE_PRIVACY_VALUES = Object.freeze(['private', 'unlisted', 'public']);
export const YOUTUBE_MUSIC_CATEGORY_ID = '10';

export function normalizeYouTubeMetadata(value = {}) {
  const title = String(value.title || '').trim();
  const description = String(value.description || '').trim();
  const tags = normalizeTags(value.tags);
  const privacy = String(value.privacy || 'private').trim().toLowerCase();
  const categoryId = String(value.categoryId || YOUTUBE_MUSIC_CATEGORY_ID).trim();
  const madeForKids = value.madeForKids === true || value.madeForKids === 'yes';
  const containsSyntheticMedia = value.containsSyntheticMedia === undefined
    ? true
    : value.containsSyntheticMedia === true || value.containsSyntheticMedia === 'yes';
  const errors = [];
  if (!title) errors.push('YouTube title is required.');
  if (title.length > 100) errors.push('YouTube title must be 100 characters or fewer.');
  if (description.length > 5000) errors.push('YouTube description must be 5000 characters or fewer.');
  if (!YOUTUBE_PRIVACY_VALUES.includes(privacy)) errors.push('YouTube privacy must be private, unlisted, or public.');
  if (!/^\d+$/.test(categoryId)) errors.push('YouTube category is invalid.');
  if (tags.join(',').length > 500) errors.push('YouTube tags exceed the 500 character limit.');
  return { valid: errors.length === 0, errors, title, description, tags, privacy, categoryId, madeForKids, containsSyntheticMedia };
}

export function toYouTubeVideoResource(metadata) {
  const value = normalizeYouTubeMetadata(metadata);
  if (!value.valid) throw new Error(value.errors[0]);
  return {
    snippet: {
      title: value.title,
      description: value.description,
      tags: value.tags,
      categoryId: value.categoryId
    },
    status: {
      privacyStatus: value.privacy,
      selfDeclaredMadeForKids: value.madeForKids,
      containsSyntheticMedia: value.containsSyntheticMedia
    }
  };
}

function normalizeTags(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map((tag) => String(tag).trim()).filter(Boolean))];
}
