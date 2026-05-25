import { Directory, File, Paths } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";

const MAX_CACHED_FILES = 24;
const MAX_CACHED_BYTES = 64 * 1024 * 1024;
const MAX_CONCURRENT_LOADS = 1;
const CACHE_DIR = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}chatmsgfiles/`
  : null;

const resolvedCache = new Map();
const taskCache = new Map();
const queue = [];

let dirReadyTask = null;
let activeLoads = 0;
let cacheEpoch = 0;

function hashKey(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

function getExt(mimeType) {
  switch (String(mimeType || "").toLowerCase()) {
    case "application/pdf":
      return "pdf";
    case "application/zip":
      return "zip";
    case "audio/aac":
      return "aac";
    case "audio/m4a":
      return "m4a";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "text/plain":
      return "txt";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    default:
      return "bin";
  }
}

function getCacheUri(key, mimeType, options = {}) {
  if (!CACHE_DIR) {
    return null;
  }

  const namedExt = String(options?.fileName || "")
    .trim()
    .match(/\.([a-z0-9]{1,8})$/i)?.[1]
    ?.toLowerCase();
  const ext = namedExt || options?.defaultExt || getExt(mimeType);
  return `${CACHE_DIR}${hashKey(key)}.${ext}`;
}

function touchResolved(key, entry) {
  resolvedCache.delete(key);
  resolvedCache.set(key, entry);
}

async function ensureCacheDir() {
  if (!CACHE_DIR) {
    throw new Error("cache directory unavailable");
  }
  if (!dirReadyTask) {
    dirReadyTask = Promise.resolve()
      .then(() => {
        new Directory(Paths.cache, "chatmsgfiles").create({
          idempotent: true,
          intermediates: true,
        });
      })
      .catch((error) => {
        dirReadyTask = null;
        throw error;
      });
  }
  await dirReadyTask;
}

function waitForIdle() {
  return new Promise((resolve) => {
    if (typeof globalThis.requestIdleCallback === "function") {
      globalThis.requestIdleCallback(() => resolve(), { timeout: 250 });
      return;
    }
    setTimeout(resolve, 0);
  });
}

function waitForTick() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function readCachedFile(key, mimeType, options = {}, epoch = cacheEpoch) {
  const uri = getCacheUri(key, mimeType, options);
  if (!uri || epoch !== cacheEpoch) {
    return null;
  }

  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  if (epoch !== cacheEpoch || !info?.exists) {
    return null;
  }

  const entry = { uri, size: Number.isFinite(info.size) ? info.size : 0 };
  touchResolved(key, entry);
  return uri;
}

function pruneResolved() {
  let totalBytes = 0;
  for (const entry of resolvedCache.values()) {
    totalBytes += Number(entry?.size) || 0;
  }

  while (
    resolvedCache.size > MAX_CACHED_FILES ||
    totalBytes > MAX_CACHED_BYTES
  ) {
    const oldest = resolvedCache.entries().next().value;
    if (!oldest) {
      return;
    }
    const [key, entry] = oldest;
    resolvedCache.delete(key);
    totalBytes -= Number(entry?.size) || 0;
    const uri = entry?.uri;
    if (typeof uri === "string" && uri.startsWith(CACHE_DIR || "")) {
      void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
  }
}

function flushQueue() {
  while (activeLoads < MAX_CONCURRENT_LOADS && queue.length) {
    const next = queue.shift();
    if (!next) {
      return;
    }

    activeLoads += 1;
    Promise.resolve()
      .then(next.run)
      .then(next.resolve, next.reject)
      .finally(() => {
        activeLoads = Math.max(0, activeLoads - 1);
        flushQueue();
      });
  }
}

function enqueue(run) {
  return new Promise((resolve, reject) => {
    queue.push({ run, resolve, reject });
    flushQueue();
  });
}

async function writeCachedFile(key, bytes, mimeType, epoch, options = {}) {
  await ensureCacheDir();
  if (epoch !== cacheEpoch) {
    throw new Error("cache cleared");
  }

  const uri = getCacheUri(key, mimeType, options);
  if (!uri) {
    throw new Error("cache directory unavailable");
  }

  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    const file = new File(uri);
    file.create({ overwrite: true });
    file.write(bytes);
  }

  if (epoch !== cacheEpoch) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    throw new Error("cache cleared");
  }

  return uri;
}

export function getCachedMsgFile(key) {
  const entry = resolvedCache.get(key);
  if (!entry?.uri) {
    return null;
  }
  touchResolved(key, entry);
  return entry.uri;
}

export function dropCachedMsgFile(key) {
  const entry = resolvedCache.get(key);
  if (!entry?.uri) {
    return;
  }
  resolvedCache.delete(key);
  taskCache.delete(key);
  if (typeof entry.uri === "string" && entry.uri.startsWith(CACHE_DIR || "")) {
    void FileSystem.deleteAsync(entry.uri, { idempotent: true }).catch(
      () => {},
    );
  }
}

export function loadCachedMsgFile(key, mimeType, loadBytes, options = {}) {
  if (!key || typeof loadBytes !== "function") {
    return Promise.reject(new Error("file cache args required"));
  }

  const cached = getCachedMsgFile(key);
  if (cached) {
    return Promise.resolve(cached);
  }

  const current = taskCache.get(key);
  if (current) {
    return current;
  }

  const task = enqueue(async () => {
    const existing = getCachedMsgFile(key);
    if (existing) {
      return existing;
    }

    const epoch = cacheEpoch;
    const diskCached = await readCachedFile(key, mimeType, options, epoch);
    if (diskCached) {
      return diskCached;
    }

    if (options?.defer) {
      await waitForIdle();
    }
    if (epoch !== cacheEpoch) {
      throw new Error("cache cleared");
    }

    const nextDiskCached = await readCachedFile(key, mimeType, options, epoch);
    if (nextDiskCached) {
      return nextDiskCached;
    }

    const bytes = await loadBytes();
    if (options?.defer) {
      await waitForIdle();
      await waitForTick();
    }
    const uri = await writeCachedFile(key, bytes, mimeType, epoch, options);
    touchResolved(key, { uri, size: bytes?.byteLength ?? 0 });
    pruneResolved();
    return uri;
  }).finally(() => {
    if (taskCache.get(key) === task) {
      taskCache.delete(key);
    }
  });

  taskCache.set(key, task);
  return task;
}

export function getCachedMsgImage(key) {
  return getCachedMsgFile(key);
}

export function loadCachedMsgImage(key, mimeType, loadBytes, options) {
  return loadCachedMsgFile(key, mimeType, loadBytes, options);
}

export async function clearMsgImageCache() {
  cacheEpoch += 1;
  queue.length = 0;
  taskCache.clear();

  const cachedUris = [...resolvedCache.values()]
    .map((entry) => entry?.uri)
    .filter(Boolean);
  resolvedCache.clear();

  await Promise.all(
    cachedUris.map((uri) =>
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}),
    ),
  );

  if (CACHE_DIR) {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true }).catch(
      () => {},
    );
  }
  dirReadyTask = null;
}
