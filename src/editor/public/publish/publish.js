import { getYouTubeShortsWarning } from './youtube-shorts.js';

const ACTIVE_UPLOAD_STATES = new Set(['preparing', 'initializing', 'validating', 'uploading', 'retrying', 'waiting_meta_fetch', 'processing', 'publishing', 'cleaning_up']);
const PROVIDERS = Object.freeze({
  tiktok: {
    label: 'TikTok', mark: 'T', subtitle: 'Upload as Draft | Sandbox', uploadLabel: 'Upload Draft',
    success: 'Draft uploaded successfully. Open TikTok on your phone and tap the inbox notification to continue editing and publish.'
  },
  youtube: {
    label: 'YouTube', mark: 'Y', subtitle: 'YouTube Data API v3 | Resumable upload', uploadLabel: 'Upload Video',
    success: 'Video uploaded successfully. YouTube has accepted the file and metadata.'
  },
  instagram: {
    label: 'Instagram', mark: 'I', subtitle: 'Instagram Graph API | Public publish via secure bridge', uploadLabel: 'Publish',
    success: 'Instagram published the video successfully.'
  }
});

const state = {
  provider: 'tiktok',
  context: null,
  connectJobId: '',
  uploadJobId: '',
  pollTimer: 0,
  captionCopied: false,
  authorizationWindow: null,
  authorizationOpened: false
};
const ids = [
  'projectName', 'closeButton', 'providerBand', 'providerMark', 'providerSelect', 'providerSubtitle',
  'connectionBadge', 'validationBadge', 'sourceName', 'sourcePath', 'sourceDuration', 'sourceSize',
  'sourceVideo', 'sourceAudio', 'validationMessage', 'accountHeading', 'accountAvatar', 'avatarFallback',
  'accountName', 'accountDetail', 'connectButton', 'reconnectButton', 'disconnectButton', 'refreshTokenButton', 'connectionMessage', 'authorizationLink',
  'tiktokFields', 'captionInput', 'captionCount', 'captionCopyStatus', 'copyCaptionButton', 'youtubeFields', 'titleInput', 'descriptionInput', 'tagsInput',
  'privacyInput', 'categoryInput', 'kidsInput', 'syntheticInput', 'thumbnailInput', 'youtubeShortsWarning', 'uploadWarningTitle', 'uploadWarningText',
  'instagramFields', 'instagramDestination', 'instagramCaptionLabel', 'instagramCaption', 'instagramCaptionCount', 'shareToFeedLabel', 'shareToFeedInput',
  'instagramDurationMessage', 'publishAnywayRow', 'publishAnywayInput',
  'confirmationInput', 'confirmationText', 'progressPanel', 'uploadState', 'progressFill', 'progressBytes',
  'progressSpeed', 'progressEta', 'progressRetries', 'uploadMessage', 'privacyResult', 'openVideoLink',
  'statusText', 'cancelButton', 'uploadButton'
];
const elements = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));

elements.closeButton.addEventListener('click', () => window.close());
elements.providerSelect.addEventListener('change', changeProvider);
elements.connectButton.addEventListener('click', connectProvider);
elements.reconnectButton.addEventListener('click', connectProvider);
elements.disconnectButton.addEventListener('click', disconnectProvider);
elements.refreshTokenButton.addEventListener('click', refreshInstagramToken);
elements.uploadButton.addEventListener('click', startUpload);
elements.cancelButton.addEventListener('click', cancelUpload);
elements.copyCaptionButton.addEventListener('click', () => copyTikTokCaption());
elements.confirmationInput.addEventListener('change', updateUploadAvailability);
elements.titleInput.addEventListener('input', updateUploadAvailability);
elements.instagramDestination.addEventListener('change', () => { elements.publishAnywayInput.checked = false; renderProviderChrome(); renderInstagramDuration(); updateUploadAvailability(); });
elements.publishAnywayInput.addEventListener('change', updateUploadAvailability);
elements.instagramCaption.addEventListener('input', () => { elements.instagramCaptionCount.textContent = `${elements.instagramCaption.value.length} / 2200`; });
elements.captionInput.addEventListener('input', () => {
  elements.captionCount.textContent = `${elements.captionInput.value.length} / 2200`;
  state.captionCopied = false;
  elements.captionCopyStatus.textContent = '';
  elements.copyCaptionButton.textContent = 'Copy Caption';
});

renderProviderChrome();
await loadContext();

async function changeProvider() {
  window.clearTimeout(state.pollTimer);
  resetAuthorizationUi();
  state.provider = elements.providerSelect.value;
  state.connectJobId = '';
  state.uploadJobId = '';
  state.context = null;
  elements.confirmationInput.checked = false;
  elements.publishAnywayInput.checked = false;
  elements.progressPanel.hidden = true;
  elements.privacyResult.hidden = true;
  elements.openVideoLink.hidden = true;
  renderProviderChrome();
  resetProviderContextChrome();
  await loadContext();
}

function renderProviderChrome() {
  const provider = PROVIDERS[state.provider];
  const youtube = state.provider === 'youtube';
  const instagram = state.provider === 'instagram';
  elements.providerBand.classList.toggle('youtube', youtube);
  elements.providerBand.classList.toggle('instagram', instagram);
  elements.providerMark.textContent = provider.mark;
  elements.avatarFallback.textContent = youtube ? 'YT' : instagram ? 'IG' : 'TK';
  elements.providerSubtitle.textContent = provider.subtitle;
  elements.accountHeading.textContent = `${provider.label} Account`;
  elements.connectButton.textContent = instagram ? 'Validate Instagram account' : `Connect ${provider.label}`;
  elements.reconnectButton.textContent = `Reconnect ${provider.label}`;
  elements.disconnectButton.textContent = instagram ? 'Clear local Instagram session state' : `Disconnect ${provider.label}`;
  elements.tiktokFields.hidden = youtube || instagram;
  elements.youtubeFields.hidden = !youtube;
  elements.instagramFields.hidden = !instagram;
  elements.uploadButton.textContent = provider.uploadLabel;
  elements.uploadWarningTitle.textContent = youtube ? 'Upload Video' : instagram ? 'Public Instagram publish' : 'Upload as Draft';
  elements.uploadWarningText.textContent = youtube
    ? 'YouTube may force an upload to Private for an unverified Google API project. Kr8 reports the privacy actually accepted by YouTube.'
    : instagram ? `This will publish the ${elements.instagramDestination.value === 'story' ? 'Story' : 'Reel'} directly on the configured Instagram Professional account. Instagram has no draft handoff in this flow.`
      : 'This video will be uploaded to TikTok as a draft. Complete editing and publishing in the TikTok mobile app.';
  elements.confirmationText.textContent = youtube
    ? 'I confirm that I want to upload this Reel to the connected YouTube channel.'
    : instagram ? `I confirm that I want to publish this ${elements.instagramDestination.value === 'story' ? 'Story' : 'Reel'} publicly on the configured Instagram account.`
      : 'I confirm that I want to upload this Reel to the connected TikTok account as a draft.';
  elements.instagramCaptionLabel.hidden = instagram && elements.instagramDestination.value === 'story';
  elements.shareToFeedLabel.hidden = instagram && elements.instagramDestination.value === 'story';
  elements.openVideoLink.textContent = youtube ? 'Open on YouTube' : instagram ? 'Open on Instagram' : 'Open published video';
  renderYouTubeShortsWarning();
}

async function loadContext() {
  const providerAtRequest = state.provider;
  const label = PROVIDERS[providerAtRequest].label;
  setStatus(`Checking the latest Reel and ${label} connection...`);
  try {
    const response = await fetch(`/api/publish/context?provider=${encodeURIComponent(providerAtRequest)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Publisher context is unavailable.');
    if (state.provider !== providerAtRequest) return;
    state.context = payload;
    if (state.provider === 'youtube' && !elements.titleInput.value) elements.titleInput.value = payload.projectName || payload.source?.media?.name?.replace(/\.[^.]+$/, '') || '';
    renderContext();
    setStatus(payload.available ? `${label} publisher ready.` : 'Export a Reel before opening Publish.');
  } catch (error) {
    showError(error.message || error);
  }
}

function resetProviderContextChrome() {
  elements.connectionBadge.textContent = 'Checking';
  elements.connectionBadge.className = 'status-badge';
  elements.accountName.textContent = 'Checking account...';
  elements.accountDetail.textContent = '';
  elements.accountAvatar.hidden = true;
  elements.avatarFallback.hidden = false;
  elements.connectButton.hidden = true;
  elements.reconnectButton.hidden = true;
  elements.disconnectButton.hidden = true;
  elements.refreshTokenButton.hidden = true;
  setMessage(elements.connectionMessage, 'Checking provider status...', 'neutral');
}

function renderContext() {
  const context = state.context;
  elements.projectName.textContent = context.projectName || 'Kr8 project';
  renderSource(context.source, context.validationErrors);
  renderConnection(context.connection);
  renderYouTubeShortsWarning();
  renderInstagramDuration();
  updateUploadAvailability();
}

function renderSource(source, errors = []) {
  const label = PROVIDERS[state.provider].label;
  if (!source) {
    elements.sourceName.textContent = 'No Reel available';
    elements.sourcePath.textContent = '-';
    elements.validationBadge.textContent = 'Unavailable';
    elements.validationBadge.className = 'status-badge invalid';
    setMessage(elements.validationMessage, errors[0] || 'Export a Reel from Reel Mode first.', 'error');
    return;
  }
  const media = source.media;
  elements.sourceName.textContent = media.name;
  elements.sourcePath.textContent = media.path;
  elements.sourcePath.title = media.path;
  elements.sourceDuration.textContent = formatTime(media.duration);
  elements.sourceSize.textContent = formatBytes(media.sizeBytes);
  elements.sourceVideo.textContent = `${media.width}x${media.height} | ${formatNumber(media.fps)} fps | ${String(media.videoCodec || '').toUpperCase()}`;
  elements.sourceAudio.textContent = media.hasAudio ? String(media.audioCodec || 'present').toUpperCase() : 'No audio track';
  elements.validationBadge.textContent = media.valid ? 'Valid' : 'Invalid';
  elements.validationBadge.className = `status-badge ${media.valid ? 'valid' : 'invalid'}`;
  setMessage(elements.validationMessage, media.valid ? `File verified with ffprobe and ready for ${label}.` : errors.join(' '), media.valid ? 'success' : 'error');
}

function renderYouTubeShortsWarning() {
  const warning = state.provider === 'youtube'
    ? getYouTubeShortsWarning(state.context?.source?.media)
    : '';
  elements.youtubeShortsWarning.textContent = warning;
  elements.youtubeShortsWarning.hidden = !warning;
}

function renderConnection(connection) {
  const provider = PROVIDERS[state.provider];
  const connected = Boolean(connection?.connected);
  const configured = connection?.state !== 'not_configured' && connection?.configured !== false;
  const instagram = state.provider === 'instagram';
  elements.connectionBadge.textContent = connected ? 'Connected' : (configured ? 'Not connected' : 'Configuration required');
  elements.connectionBadge.className = `status-badge ${connected ? 'connected' : 'disconnected'}`;
  elements.accountName.textContent = connected ? connection.displayName : 'Not connected';
  elements.accountDetail.textContent = connected
    ? (state.provider === 'youtube' ? `Channel ID ${connection.channelId || 'available after upload'}` : instagram ? `@${connection.username || 'account'} | ${connection.accountType || 'Professional'}` : `TikTok ${connection.environment || 'sandbox'} account`)
    : (configured ? (instagram ? 'Validate the preconfigured Instagram Professional account.' : `Connect the ${provider.label} account used for publishing.`) : `Add ${connection?.missing?.join(' and ') || `${provider.label} credentials`} to .env.local.`);
  elements.connectButton.hidden = connected && !instagram;
  elements.connectButton.disabled = !configured;
  elements.reconnectButton.hidden = instagram || !connected;
  elements.disconnectButton.hidden = !connected;
  elements.refreshTokenButton.hidden = !instagram || !connected;
  const avatarUrl = connected ? connection.avatarUrl : '';
  elements.accountAvatar.hidden = !avatarUrl;
  elements.avatarFallback.hidden = Boolean(avatarUrl);
  elements.avatarFallback.textContent = state.provider === 'youtube' ? 'YT' : instagram ? 'IG' : 'TK';
  if (avatarUrl) elements.accountAvatar.src = avatarUrl;
  setMessage(elements.connectionMessage,
    connected ? (instagram
      ? `Token valid. Publishing uses this Professional account.${connection.bridgeConfigured ? ' Media bridge configured.' : ' Media bridge token still required before publishing.'}`
      : `Connected as ${connection.displayName}. Uploads will be sent to this ${state.provider === 'youtube' ? 'channel' : 'account'}.`)
      : (connection?.reason || (configured ? (instagram ? 'Validate the preconfigured Instagram account and token.' : `${provider.label} authorization opens in your default browser.`) : `${provider.label} credentials are not configured.`)),
    connected ? 'success' : (configured ? 'neutral' : 'error'));
}

async function connectProvider() {
  const label = PROVIDERS[state.provider].label;
  resetAuthorizationUi();
  if (state.provider !== 'instagram') prepareAuthorizationWindow(label);
  setConnectionBusy(true);
  setMessage(elements.connectionMessage, state.provider === 'instagram' ? 'Validating the preconfigured Instagram account...' : `Waiting for ${label} authorization in your browser...`, 'neutral');
  try {
    const response = await fetch(`/api/publish/${state.provider}/connect`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `${label} login could not start.`);
    state.connectJobId = payload.jobId;
    openAuthorizationUrl(payload.authorizationUrl);
    pollConnection();
  } catch (error) {
    closePendingAuthorizationWindow();
    setConnectionBusy(false);
    setMessage(elements.connectionMessage, error.message || String(error), 'error');
  }
}

async function pollConnection() {
  if (!state.connectJobId) return;
  const providerAtStart = state.provider;
  try {
    const response = await fetch(`/api/publish/${providerAtStart}/connect/status?jobId=${encodeURIComponent(state.connectJobId)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Login status is unavailable.');
    openAuthorizationUrl(payload.authorizationUrl);
    if (payload.status === 'connecting') {
      state.pollTimer = window.setTimeout(pollConnection, 500);
      return;
    }
    setConnectionBusy(false);
    if (payload.status === 'connected') {
      resetAuthorizationUi(false);
      await loadContext();
      setStatus(`${PROVIDERS[state.provider].label} account connected.`);
    } else {
      resetAuthorizationUi();
      setMessage(elements.connectionMessage, payload.error || `Login ${payload.status}.`, 'error');
    }
  } catch (error) {
    resetAuthorizationUi();
    setConnectionBusy(false);
    setMessage(elements.connectionMessage, error.message || String(error), 'error');
  }
}

function prepareAuthorizationWindow(label) {
  state.authorizationWindow = window.open('about:blank', 'kr8-publisher-oauth', 'popup,width=760,height=820');
  state.authorizationOpened = false;
  if (!state.authorizationWindow) return;
  try {
    state.authorizationWindow.document.title = `${label} authorization`;
    state.authorizationWindow.document.body.style.cssText = 'margin:0;display:grid;place-items:center;min-height:100vh;background:#11141a;color:#fff;font:16px system-ui';
    state.authorizationWindow.document.body.textContent = `Preparing ${label} authorization...`;
  } catch {}
}

function openAuthorizationUrl(value) {
  const authorizationUrl = String(value || '');
  if (!authorizationUrl || state.authorizationOpened) return;
  elements.authorizationLink.href = authorizationUrl;
  elements.authorizationLink.hidden = false;
  if (state.authorizationWindow && !state.authorizationWindow.closed) {
    try {
      state.authorizationWindow.location.replace(authorizationUrl);
      state.authorizationOpened = true;
      return;
    } catch {
      state.authorizationWindow = null;
    }
  }
  setMessage(elements.connectionMessage, 'Popup blocked. Open the authorization page with the button below.', 'neutral');
}

function closePendingAuthorizationWindow() {
  if (state.authorizationWindow && !state.authorizationOpened && !state.authorizationWindow.closed) {
    state.authorizationWindow.close();
  }
  state.authorizationWindow = null;
}

function resetAuthorizationUi(closePending = true) {
  if (closePending) closePendingAuthorizationWindow();
  state.authorizationWindow = null;
  state.authorizationOpened = false;
  elements.authorizationLink.hidden = true;
  elements.authorizationLink.removeAttribute('href');
}

async function disconnectProvider() {
  const label = PROVIDERS[state.provider].label;
  setConnectionBusy(true);
  try {
    const response = await fetch(`/api/publish/${state.provider}/disconnect`, { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `${label} disconnect failed.`);
    await loadContext();
    setStatus(state.provider === 'instagram' ? 'Instagram local session state cleared. Environment credentials were not changed.' : `${label} account disconnected and local tokens removed.`);
  } catch (error) {
    setMessage(elements.connectionMessage, error.message || String(error), 'error');
  } finally {
    setConnectionBusy(false);
  }
}

async function refreshInstagramToken() {
  setConnectionBusy(true);
  setMessage(elements.connectionMessage, 'Refreshing the Instagram token without changing .env.local...', 'neutral');
  try {
    const response = await fetch('/api/publish/instagram/refresh', { method: 'POST' });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Instagram token refresh failed.');
    await loadContext();
    setStatus('Instagram token refreshed in the local credential store.');
  } catch (error) {
    setMessage(elements.connectionMessage, error.message || String(error), 'error');
  } finally {
    setConnectionBusy(false);
  }
}

async function startUpload() {
  const label = PROVIDERS[state.provider].label;
  if (state.provider === 'tiktok' && elements.captionInput.value.trim()) {
    await copyTikTokCaption({ announce: false });
  }
  setUploadBusy(true);
  elements.progressPanel.hidden = false;
  elements.privacyResult.hidden = true;
  elements.openVideoLink.hidden = true;
  elements.uploadState.textContent = 'Preparing';
  setMessage(elements.uploadMessage, `Validating Reel and preparing ${label} upload...`, 'neutral');
  try {
    const body = state.provider === 'youtube' ? await youtubePayload() : state.provider === 'instagram' ? instagramPayload() : {};
    body.confirmed = elements.confirmationInput.checked;
    const response = await fetch(`/api/publish/${state.provider}/upload/start`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `${label} upload could not start.`);
    state.uploadJobId = payload.jobId;
    renderProgress(payload);
    pollUpload();
  } catch (error) {
    setUploadBusy(false);
    setMessage(elements.uploadMessage, error.message || String(error), 'error');
  }
}

function instagramPayload() {
  return {
    destination: elements.instagramDestination.value,
    caption: elements.instagramDestination.value === 'reel' ? elements.instagramCaption.value : '',
    shareToFeed: elements.shareToFeedInput.value === 'yes',
    publishAnyway: elements.publishAnywayInput.checked
  };
}

async function youtubePayload() {
  const file = elements.thumbnailInput.files?.[0];
  let thumbnail = null;
  if (file) {
    if (file.size > 2_000_000) throw new Error('YouTube thumbnail must be no larger than 2 MB.');
    thumbnail = { contentType: file.type, dataUrl: await readDataUrl(file) };
  }
  return {
    title: elements.titleInput.value,
    description: elements.descriptionInput.value,
    tags: elements.tagsInput.value,
    privacy: elements.privacyInput.value,
    categoryId: elements.categoryInput.value,
    madeForKids: elements.kidsInput.value === 'yes',
    containsSyntheticMedia: elements.syntheticInput.value === 'yes',
    thumbnail
  };
}

async function pollUpload() {
  if (!state.uploadJobId) return;
  const providerAtStart = state.provider;
  try {
    const response = await fetch(`/api/publish/${providerAtStart}/upload/status?jobId=${encodeURIComponent(state.uploadJobId)}`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Upload status is unavailable.');
    renderProgress(payload);
    if (ACTIVE_UPLOAD_STATES.has(payload.status)) {
      state.pollTimer = window.setTimeout(pollUpload, 400);
      return;
    }
    setUploadBusy(false);
    if (payload.status === 'uploaded') {
      const captionNote = providerAtStart === 'tiktok' && elements.captionInput.value.trim()
        ? state.captionCopied ? ' Caption copied: paste it in the TikTok mobile editor.' : ' Use Copy Caption before completing the post in TikTok.'
        : '';
      setMessage(elements.uploadMessage, payload.warning || `${PROVIDERS[providerAtStart].success}${captionNote}`, payload.warning ? 'neutral' : 'success');
      if (providerAtStart === 'youtube') renderYouTubeResult(payload);
      if (providerAtStart === 'instagram') renderInstagramResult(payload);
      setStatus(`${PROVIDERS[providerAtStart].label} upload completed.`);
    } else {
      setMessage(elements.uploadMessage, payload.error || `Upload ${payload.status}.`, payload.status === 'cancelled' ? 'neutral' : 'error');
      setStatus(`${PROVIDERS[providerAtStart].label} upload ${payload.status}.`);
    }
  } catch (error) {
    setUploadBusy(false);
    setMessage(elements.uploadMessage, error.message || String(error), 'error');
  }
}

function renderInstagramResult(job) {
  elements.privacyResult.hidden = false;
  elements.privacyResult.textContent = `${job.destination === 'story' ? 'Story' : 'Reel'} published publicly.${job.cleanupWarning ? ` Remote cleanup warning: ${job.cleanupWarning}` : ' Temporary bridge media cleaned up.'}`;
  elements.privacyResult.className = `message ${job.cleanupWarning ? 'neutral' : 'success'}`;
  if (job.permalink) {
    elements.openVideoLink.textContent = 'Open on Instagram';
    elements.openVideoLink.href = job.permalink;
    elements.openVideoLink.hidden = false;
  }
}

function renderInstagramDuration() {
  if (state.provider !== 'instagram') return;
  const check = instagramDurationState();
  elements.publishAnywayRow.hidden = !check.warning;
  setMessage(elements.instagramDurationMessage, check.message, check.type);
}

function instagramDurationState() {
  if (state.provider !== 'instagram') return { ready: true, warning: false, message: '', type: 'neutral' };
  const duration = Number(state.context?.source?.media?.duration || 0);
  if (!duration) return { ready: false, warning: false, message: 'A valid exported Reel is required.', type: 'error' };
  if (elements.instagramDestination.value === 'story') {
    if (duration > 60) return { ready: false, warning: false, message: 'This video exceeds the 60-second Story limit. Export a dedicated Story cut from Reel Mode before publishing.', type: 'error' };
    return { ready: true, warning: false, message: `Story duration ${formatTime(duration)}. No caption will be sent.`, type: 'success' };
  }
  if (duration > 210) return {
    ready: elements.publishAnywayInput.checked,
    warning: true,
    message: 'This Reel exceeds 3 minutes and 30 seconds. Instagram may upload it successfully but exclude it from recommendations to new audiences.',
    type: 'error'
  };
  return { ready: true, warning: false, message: `Reel duration ${formatTime(duration)}.`, type: 'success' };
}

function renderYouTubeResult(job) {
  const requested = job.requestedPrivacy || 'private';
  const effective = job.effectivePrivacy || 'unknown';
  const requestedSynthetic = job.containsSyntheticMedia === true;
  const effectiveSynthetic = job.effectiveSyntheticMedia === null || job.effectiveSyntheticMedia === undefined
    ? requestedSynthetic
    : job.effectiveSyntheticMedia === true;
  const disclosure = ` AI-generated or meaningfully altered realistic content: ${effectiveSynthetic ? 'Yes' : 'No'}.`;
  elements.privacyResult.hidden = false;
  const privacy = requested === effective
    ? `YouTube privacy: ${effective}.`
    : `Requested ${requested}; YouTube accepted the video as ${effective}.`;
  elements.privacyResult.textContent = `${privacy}${disclosure}`;
  elements.privacyResult.className = `message ${requested === effective ? 'success' : 'neutral'}`;
  if (job.videoUrl) {
    elements.openVideoLink.href = job.videoUrl;
    elements.openVideoLink.hidden = false;
  }
}

async function cancelUpload() {
  if (!state.uploadJobId) return;
  const response = await fetch(`/api/publish/${state.provider}/upload/cancel`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId: state.uploadJobId })
  });
  const payload = await response.json();
  if (!response.ok) {
    setMessage(elements.uploadMessage, payload.error || 'Upload cancellation failed.', 'error');
    return;
  }
  window.clearTimeout(state.pollTimer);
  setUploadBusy(false);
  renderProgress(payload.job);
  setMessage(elements.uploadMessage, 'Upload cancelled. The local Reel was not changed.', 'neutral');
}

function renderProgress(job) {
  const progress = Math.max(0, Math.min(1, Number(job.progress || 0)));
  elements.uploadState.textContent = statusLabel(job.status);
  elements.progressFill.style.width = `${(progress * 100).toFixed(1)}%`;
  elements.progressBytes.textContent = `${formatBytes(job.bytesSent)} / ${formatBytes(job.totalBytes)}`;
  elements.progressSpeed.textContent = `${formatBytes(job.bytesPerSecond)}/s`;
  elements.progressEta.textContent = job.etaSeconds === null ? 'ETA -' : `ETA ${formatTime(job.etaSeconds)}`;
  elements.progressRetries.textContent = `Retries ${job.retryCount || 0}`;
}

function updateUploadAvailability() {
  const active = Boolean(state.uploadJobId && !elements.cancelButton.disabled);
  const metadataReady = state.provider !== 'youtube' || Boolean(elements.titleInput.value.trim());
  const instagramReady = state.provider !== 'instagram' || (instagramDurationState().ready && state.context?.connection?.bridgeConfigured);
  const ready = Boolean(state.context?.source?.media?.valid && state.context?.connection?.connected && elements.confirmationInput.checked && metadataReady && instagramReady);
  elements.uploadButton.disabled = active || !ready;
}

function setConnectionBusy(busy) {
  elements.providerSelect.disabled = busy;
  elements.connectButton.disabled = busy;
  elements.reconnectButton.disabled = busy;
  elements.disconnectButton.disabled = busy;
  elements.refreshTokenButton.disabled = busy;
}

function setUploadBusy(busy) {
  elements.providerSelect.disabled = busy;
  elements.cancelButton.disabled = !busy;
  elements.uploadButton.disabled = busy;
  elements.confirmationInput.disabled = busy;
  elements.copyCaptionButton.disabled = busy;
  for (const element of [elements.captionInput, elements.titleInput, elements.descriptionInput, elements.tagsInput, elements.privacyInput, elements.categoryInput, elements.kidsInput, elements.syntheticInput, elements.thumbnailInput, elements.instagramDestination, elements.instagramCaption, elements.shareToFeedInput, elements.publishAnywayInput]) element.disabled = busy;
  if (!busy) updateUploadAvailability();
}

async function copyTikTokCaption({ announce = true } = {}) {
  const caption = elements.captionInput.value;
  if (!caption.trim()) {
    if (announce) {
      elements.captionCopyStatus.textContent = 'Nothing to copy';
      elements.captionInput.focus();
    }
    return false;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(caption);
    copied = true;
  } catch {
    try {
      elements.captionInput.focus();
      elements.captionInput.select();
      copied = document.execCommand('copy');
      elements.captionInput.setSelectionRange(caption.length, caption.length);
    } catch {
      copied = false;
    }
  }
  state.captionCopied = copied;
  elements.captionCopyStatus.textContent = copied ? 'Ready to paste' : 'Clipboard unavailable';
  elements.copyCaptionButton.textContent = copied ? 'Copied' : 'Copy Caption';
  return copied;
}

function readDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Thumbnail could not be read.'));
    reader.readAsDataURL(file);
  });
}

function setMessage(element, message, type) { element.textContent = message; element.className = `message ${type}`; }
function setStatus(message) { elements.statusText.textContent = message; }
function showError(message) { setStatus(message); setMessage(elements.validationMessage, message, 'error'); }
function statusLabel(value) { return ({ preparing: 'Preparing', initializing: 'Initializing upload', validating: 'Validating', uploading: state.provider === 'instagram' ? 'Uploading to bridge' : 'Uploading', retrying: 'Retrying', waiting_meta_fetch: 'Waiting for Meta fetch', processing: state.provider === 'youtube' ? 'Processing on YouTube' : state.provider === 'instagram' ? 'Processing' : 'Delivering to TikTok inbox', publishing: 'Publishing', cleaning_up: 'Cleaning up', uploaded: 'Published', failed: 'Failed', cancelled: 'Cancelled' })[value] || value; }
function formatTime(seconds) { const value = Math.max(0, Number(seconds || 0)); const minutes = Math.floor(value / 60); return `${minutes}:${String(Math.floor(value % 60)).padStart(2, '0')}`; }
function formatNumber(value) { return Number(value || 0).toFixed(2).replace(/\.00$/, ''); }
function formatBytes(bytes) { const value = Math.max(0, Number(bytes || 0)); if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GB`; if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`; if (value >= 1000) return `${(value / 1000).toFixed(1)} KB`; return `${Math.round(value)} B`; }
