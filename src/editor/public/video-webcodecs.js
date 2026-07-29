let mp4boxModulePromise = null;

export async function createWebCodecsVideoDecoder(assetId, properties = {}) {
  if (!globalThis.VideoDecoder || !globalThis.EncodedVideoChunk) {
    return { supported: false, reason: 'WebCodecs VideoDecoder unavailable' };
  }
  if (!assetId) {
    return { supported: false, reason: 'Missing video asset id' };
  }

  try {
    const MP4Box = await loadMp4Box();
    const url = `/api/assets/${encodeURIComponent(assetId)}`;
    const buffer = await fetchArrayBuffer(url);
    const demuxed = await demuxMp4Samples(MP4Box, buffer);
    if (!demuxed.samples.length) {
      return { supported: false, reason: 'No MP4 video samples extracted' };
    }

    const config = {
      codec: demuxed.track.codec,
      codedWidth: demuxed.track.video.width,
      codedHeight: demuxed.track.video.height
    };
    if (demuxed.description) {
      config.description = demuxed.description;
    }

    const support = await VideoDecoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (!support.supported) {
      return { supported: false, reason: `Unsupported WebCodecs config: ${config.codec}` };
    }

    const state = {
      config,
      samples: demuxed.samples,
      sampleIndex: 0,
      currentFrame: null,
      decodedFrames: [],
      closed: false,
      properties,
      duration: demuxed.duration,
      width: demuxed.track.video.width,
      height: demuxed.track.video.height
    };

    const decoder = new VideoDecoder({
      output(frame) {
        state.decodedFrames.push(frame);
      },
      error(error) {
        state.error = error;
      }
    });
    decoder.configure(config);
    state.decoder = decoder;

    return {
      supported: true,
      mode: 'webcodecs',
      codec: config.codec,
      state,
      async prepare(timestamp, benchmark = null) {
        const target = getVideoFrameTime(properties, timestamp, state.duration);
        const beforeMs = Number(benchmark?.videoWebCodecsDecodeMs || 0);
        await withTimeout(
          decodeUntil(state, target, benchmark),
          900,
          `WebCodecs decode timeout at ${target.toFixed(3)}s`
        );
        return {
          frame: state.currentFrame,
          decodeMs: Math.max(0, Number(benchmark?.videoWebCodecsDecodeMs || 0) - beforeMs)
        };
      },
      close() {
        state.closed = true;
        if (state.currentFrame) state.currentFrame.close();
        for (const frame of state.decodedFrames) frame.close();
        state.decodedFrames = [];
        if (state.decoder?.state !== 'closed') state.decoder.close();
      }
    };
  } catch (error) {
    return { supported: false, reason: error?.message || String(error) };
  }
}

function loadMp4Box() {
  if (!mp4boxModulePromise) {
    mp4boxModulePromise = import('/vendor/mp4box.all.mjs');
  }
  return mp4boxModulePromise;
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Video fetch failed: ${response.status}`);
  }
  return response.arrayBuffer();
}

function demuxMp4Samples(MP4Box, buffer) {
  return new Promise((resolve, reject) => {
    const file = MP4Box.createFile();
    const samples = [];
    let selectedTrack = null;
    let resolved = false;

    file.onError = (error) => reject(new Error(String(error || 'MP4 demux failed')));
    file.onReady = (info) => {
      selectedTrack = (info.videoTracks || [])[0];
      if (!selectedTrack) {
        reject(new Error('No MP4 video track found'));
        return;
      }
      const track = findInternalTrack(file, selectedTrack.id);
      const description = extractDecoderDescription(MP4Box, track);
      file.onSamples = (id, user, batch) => {
        if (id !== selectedTrack.id) return;
        samples.push(...batch);
      };
      file.setExtractionOptions(selectedTrack.id, null, { nbSamples: 1000 });
      file.start();
      file.flush();
      resolved = true;
      resolve({
        track: selectedTrack,
        samples,
        description,
        duration: selectedTrack.duration / selectedTrack.timescale
      });
    };

    const mp4Buffer = buffer.slice(0);
    mp4Buffer.fileStart = 0;
    file.appendBuffer(mp4Buffer);
    file.flush();
    setTimeout(() => {
      if (!resolved) reject(new Error('MP4 demux timeout'));
    }, 3000);
  });
}

async function decodeUntil(state, targetSeconds, benchmark = null) {
  const startedAt = performance.now();
  const targetUs = Math.max(0, targetSeconds * 1_000_000);
  if (state.currentFrame && targetUs + 18_000 < state.currentFrame.timestamp) {
    resetDecoder(state);
  }
  const decodeUntilUs = targetUs + 500_000;
  while (!state.closed && state.sampleIndex < state.samples.length) {
    if (state.error) throw state.error;
    const sample = state.samples[state.sampleIndex];
    const sampleStartUs = sampleTimestampUs(sample);
    const sampleEndUs = sampleStartUs + sampleDurationUs(sample);
    const chunk = new EncodedVideoChunk({
      type: sample.is_sync ? 'key' : 'delta',
      timestamp: sampleStartUs,
      duration: sampleDurationUs(sample),
      data: sample.data
    });
    state.decoder.decode(chunk);
    state.sampleIndex += 1;
    if (sampleEndUs >= decodeUntilUs || hasDecodedFrameAtOrAfter(state, targetUs)) {
      await waitForDecoderOutput(state, targetUs, 700);
      promoteDecodedFrame(state, targetUs);
      if (!state.currentFrame) throw new Error('WebCodecs decoded no frame');
      if (benchmark) benchmark.videoWebCodecsDecodeMs += performance.now() - startedAt;
      return;
    }
  }

  await waitForDecoderOutput(state, targetUs, 700);
  promoteDecodedFrame(state, targetUs);
  if (!state.currentFrame) throw new Error('WebCodecs decoded no frame');
  if (benchmark) benchmark.videoWebCodecsDecodeMs += performance.now() - startedAt;
}

function resetDecoder(state) {
  if (state.decoder?.state !== 'closed') {
    state.decoder.close();
  }
  for (const frame of state.decodedFrames) frame.close();
  state.decodedFrames = [];
  if (state.currentFrame) state.currentFrame.close();
  state.currentFrame = null;
  state.sampleIndex = 0;
  state.error = null;
  state.decoder = new VideoDecoder({
    output(frame) {
      state.decodedFrames.push(frame);
    },
    error(error) {
      state.error = error;
    }
  });
  state.decoder.configure(state.config);
}

function hasDecodedFrameAtOrAfter(state, targetUs) {
  return state.decodedFrames.some((frame) => frame.timestamp >= targetUs - 18_000);
}

function waitForDecoderOutput(state, targetUs, timeoutMs) {
  if (hasDecodedFrameAtOrAfter(state, targetUs)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      state.decoder.removeEventListener?.('dequeue', onDequeue);
      clearTimeout(timer);
      resolve();
    };
    const onDequeue = () => {
      if (state.error) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(state.error);
        return;
      }
      if (hasDecodedFrameAtOrAfter(state, targetUs) || state.decoder.decodeQueueSize === 0) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    state.decoder.addEventListener?.('dequeue', onDequeue);
    requestAnimationFrame(onDequeue);
  });
}

function promoteDecodedFrame(state, targetUs) {
  let candidate = null;
  const remaining = [];
  let nearestFuture = null;
  for (const frame of state.decodedFrames) {
    if (frame.timestamp <= targetUs + 18_000) {
      if (candidate) candidate.close();
      candidate = frame;
    } else if (!nearestFuture || frame.timestamp < nearestFuture.timestamp) {
      nearestFuture = frame;
    } else {
      remaining.push(frame);
    }
  }
  if (!candidate && nearestFuture && nearestFuture.timestamp <= targetUs + 120_000) {
    candidate = nearestFuture;
  } else if (nearestFuture) {
    remaining.push(nearestFuture);
  }
  state.decodedFrames = remaining;
  if (candidate) {
    if (state.currentFrame) state.currentFrame.close();
    state.currentFrame = candidate;
  }
}

function sampleTimestampUs(sample) {
  const timescale = Math.max(1, Number(sample.timescale || 1));
  return Math.round((Number(sample.cts ?? sample.dts ?? 0) / timescale) * 1_000_000);
}

function sampleDurationUs(sample) {
  const timescale = Math.max(1, Number(sample.timescale || 1));
  return Math.max(1, Math.round((Number(sample.duration || 1) / timescale) * 1_000_000));
}

function findInternalTrack(file, trackId) {
  return (file.moov?.traks || []).find((track) => track.tkhd?.track_id === trackId) || null;
}

function extractDecoderDescription(MP4Box, track) {
  const entry = track?.mdia?.minf?.stbl?.stsd?.entries?.[0];
  if (entry?.avcC) return buildAvcDecoderDescription(entry.avcC);
  const configBox = entry?.hvcC || entry?.av1C;
  if (!configBox?.write || !MP4Box.DataStream) return undefined;
  return undefined;
}

function buildAvcDecoderDescription(avcC) {
  const sps = Array.isArray(avcC.SPS) ? avcC.SPS : [];
  const pps = Array.isArray(avcC.PPS) ? avcC.PPS : [];
  if (!sps.length || !pps.length) return undefined;

  const ext = avcC.ext instanceof Uint8Array ? avcC.ext : new Uint8Array();
  const bytes = [];
  bytes.push(Number(avcC.configurationVersion || 1) & 0xff);
  bytes.push(Number(avcC.AVCProfileIndication || 0) & 0xff);
  bytes.push(Number(avcC.profile_compatibility || 0) & 0xff);
  bytes.push(Number(avcC.AVCLevelIndication || 0) & 0xff);
  bytes.push(0xfc | (Number(avcC.lengthSizeMinusOne ?? 3) & 0x03));
  bytes.push(0xe0 | (Math.min(sps.length, 31) & 0x1f));
  for (const item of sps.slice(0, 31)) {
    appendNalu(bytes, item.data);
  }
  bytes.push(Math.min(pps.length, 255) & 0xff);
  for (const item of pps.slice(0, 255)) {
    appendNalu(bytes, item.data);
  }
  for (const value of ext) bytes.push(value);
  return new Uint8Array(bytes).buffer;
}

function appendNalu(bytes, data) {
  const nalu = data instanceof Uint8Array ? data : new Uint8Array();
  bytes.push((nalu.byteLength >> 8) & 0xff, nalu.byteLength & 0xff);
  for (const value of nalu) bytes.push(value);
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      reject(new Error(message));
    }, timeoutMs);
    promise.then(
      (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function getVideoFrameTime(properties, projectTimestamp, videoDuration) {
  const playbackRate = Math.max(0.05, Number(properties.playbackRate || 1));
  const trimStart = clamp(Number(properties.trimStart || 0), 0, Math.max(0, videoDuration));
  const rawTrimEnd = Number(properties.trimEnd || 0);
  const trimEnd = rawTrimEnd > trimStart ? Math.min(rawTrimEnd, videoDuration) : videoDuration;
  const segment = Math.max(0.001, trimEnd - trimStart);
  const offset = Math.max(0, Number(properties.startOffset || 0));
  const local = Math.max(0, (Number(projectTimestamp || 0) * playbackRate) + offset);
  if (properties.loop === false) {
    return clamp(trimStart + local, trimStart, Math.max(trimStart, trimEnd - 0.001));
  }
  return trimStart + (local % segment);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
