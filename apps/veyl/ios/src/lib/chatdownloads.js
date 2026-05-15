import { ActionSheetIOS } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as MediaLibrary from "expo-media-library";
import * as FileSystem from "expo-file-system/legacy";
import {
  dropCachedMsgFile,
  getCachedMsgFile,
  getCachedMsgImage,
  loadCachedMsgFile,
  loadCachedMsgImage,
} from "@/lib/msgimagecache";
import { loadVideoPreviewUri } from "@/lib/chatvideopreview";

const READY_DOWNLOAD_BYTES = 8 * 1024 * 1024;

const MIME_EXT = {
  "application/pdf": "pdf",
  "application/zip": "zip",
  "audio/aac": "aac",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/plain": "txt",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

function getImageKey(peerChatPK, msg) {
  return `${peerChatPK}:${msg?.p || ""}:${msg?.k || ""}`;
}

function getFileKey(peerChatPK, msg) {
  return `${peerChatPK}:${msg?.t || "file"}:${msg?.p || ""}:${msg?.k || ""}`;
}

function normalizeUri(uri) {
  if (typeof uri !== "string" || !uri) {
    return null;
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(uri) ? uri : `file://${uri}`;
}

function cleanPart(value, fallback) {
  const raw = String(value || fallback || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ");
  return raw || fallback;
}

function getExt(msg) {
  const name = typeof msg?.n === "string" ? msg.n.trim() : "";
  const namedExt = name.match(/\.([a-z0-9]{1,8})$/i)?.[1];
  if (namedExt) {
    return namedExt.toLowerCase();
  }

  const mimeType = String(msg?.m || "").toLowerCase();
  if (MIME_EXT[mimeType]) {
    return MIME_EXT[mimeType];
  }

  switch (msg?.t) {
    case "img":
      return "jpg";
    case "mp3":
      return "mp3";
    case "mp4":
      return "mp4";
    default:
      return "bin";
  }
}

function getBaseName(msg) {
  const name = typeof msg?.n === "string" ? msg.n.trim() : "";
  if (name) {
    return cleanPart(name.replace(/\.[^.]+$/, ""), "attachment");
  }

  switch (msg?.t) {
    case "img":
      return "image";
    case "mp3":
      return "audio";
    case "mp4":
      return "video";
    default:
      return "file";
  }
}

function getFileName(msg) {
  const ext = getExt(msg);
  const base = getBaseName(msg);
  return ext ? `${base}.${ext}` : base;
}

export function getMessageFileName(msg) {
  return getFileName(msg);
}

export function getCachedMessageFileUri(msg, peerChatPK) {
  const localUri = normalizeUri(msg?.localUri);
  if (localUri) {
    return localUri;
  }

  if (!peerChatPK || !msg?.p || !msg?.k) {
    return null;
  }

  const key = msg?.t === "img" ? getImageKey(peerChatPK, msg) : getFileKey(peerChatPK, msg);
  const cached = msg?.t === "img" ? getCachedMsgImage(key) : getCachedMsgFile(key);
  return normalizeUri(cached);
}

function hasRemoteFile(msg) {
  return (
    typeof msg?.p === "string" &&
    !!msg.p &&
    typeof msg?.k === "string" &&
    !!msg.k
  );
}

function isImageUri(uri) {
  return (
    typeof uri === "string" && /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(uri)
  );
}

function shouldWarmDownload(msg) {
  if (msg?.t === "img") {
    return true;
  }

  const size = Number(msg?.z);
  return Number.isFinite(size) && size > 0 && size <= READY_DOWNLOAD_BYTES;
}

function showShareSheet(uri) {
  return new Promise((resolve, reject) => {
    ActionSheetIOS.showShareActionSheetWithOptions(
      { url: uri },
      (error) => {
        reject(error || new Error("share failed"));
      },
      () => {
        resolve();
      },
    );
  });
}

function canUseLocalUri(msg) {
  return typeof msg?.localUri === "string" && !!msg.localUri;
}

async function resolveImageUri(msg, peerChatPK, readMessageFile, options = {}) {
  const localUri = normalizeUri(msg?.localUri);

  if (localUri) {
    return localUri;
  }

  if (
    !peerChatPK ||
    typeof readMessageFile !== "function" ||
    !msg?.p ||
    !msg?.k
  ) {
    throw new Error("image unavailable");
  }

  const key = getImageKey(peerChatPK, msg);
  const cached = getCachedMsgImage(key);
  if (cached && !isImageUri(cached)) {
    dropCachedMsgFile(key);
  }
  return (
    (cached && isImageUri(cached) ? cached : null) ||
    (await loadCachedMsgImage(
      key,
      msg?.m,
      () => readMessageFile(peerChatPK, msg),
      {
        fileName: getFileName(msg),
        defaultExt: "jpg",
        defer: options?.defer === true,
      },
    ))
  );
}

async function resolveFileUri(msg, peerChatPK, readMessageFile, options = {}) {
  const localUri = normalizeUri(msg?.localUri);
  if (localUri) {
    return localUri;
  }

  if (
    !peerChatPK ||
    typeof readMessageFile !== "function" ||
    !msg?.p ||
    !msg?.k
  ) {
    throw new Error("file unavailable");
  }

  if (msg?.t === "img") {
    return resolveImageUri(msg, peerChatPK, readMessageFile, options);
  }

  const key = getFileKey(peerChatPK, msg);
  const cached = getCachedMsgFile(key);
  return (
    cached ||
    (await loadCachedMsgFile(
      key,
      msg?.m,
      async () => {
        const bytes = await readMessageFile(peerChatPK, msg);
        return bytes;
      },
      { fileName: getFileName(msg), defer: options?.defer === true },
    ))
  );
}

export function resolveMessageFileUri(msg, peerChatPK, readMessageFile, options = {}) {
  return resolveFileUri(msg, peerChatPK, readMessageFile, options);
}

export function preloadMessageMediaUri(peerChatPK, msg, readMessageFile) {
  if (msg?.t !== "img" && msg?.t !== "mp4") {
    return null;
  }
  if (
    !peerChatPK ||
    typeof readMessageFile !== "function" ||
    (!hasRemoteFile(msg) && !canUseLocalUri(msg))
  ) {
    return null;
  }
  return resolveFileUri(msg, peerChatPK, readMessageFile, {
    defer: true,
  })
    .then((uri) => {
      if (msg?.t === "mp4" && uri) {
        return loadVideoPreviewUri({ peerChatPK, msg, uri })
          .catch(() => null)
          .then(() => uri);
      }
      return uri;
    })
    .catch(() => null);
}

export async function copyMessageText(msg) {
  const text = typeof msg?.c === "string" ? msg.c.trim() : "";
  if (!text) {
    throw new Error("message text unavailable");
  }
  await Clipboard.setStringAsync(text);
}

export async function copyMessageImage(msg, peerChatPK, readMessageFile) {
  const uri = await resolveImageUri(msg, peerChatPK, readMessageFile);
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await Clipboard.setImageAsync(base64);
}

export async function copyMessageFile(msg, peerChatPK, readMessageFile) {
  const uri = await resolveFileUri(msg, peerChatPK, readMessageFile);
  if (Clipboard.setUrlAsync) {
    await Clipboard.setUrlAsync(uri);
    return;
  }
  await Clipboard.setStringAsync(uri);
}

export async function saveMessageImage(msg, peerChatPK, readMessageFile) {
  const uri = await resolveImageUri(msg, peerChatPK, readMessageFile);
  const existing = await MediaLibrary.getPermissionsAsync(true);
  const perm = existing.granted
    ? existing
    : await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    throw new Error("Please allow photo access to save pictures.");
  }
  await MediaLibrary.saveToLibraryAsync(uri);
}

export async function saveMessageFile(msg, peerChatPK, readMessageFile) {
  const uri = await resolveFileUri(msg, peerChatPK, readMessageFile);
  await showShareSheet(uri);
}

export function warmMessageDownload(msg, peerChatPK, readMessageFile) {
  if (!shouldWarmDownload(msg)) {
    return null;
  }
  if (
    !peerChatPK ||
    typeof readMessageFile !== "function" ||
    (!hasRemoteFile(msg) && !canUseLocalUri(msg))
  ) {
    return null;
  }

  const key =
    msg?.t === "img"
      ? getImageKey(peerChatPK, msg)
      : getFileKey(peerChatPK, msg);
  const loader = () => readMessageFile(peerChatPK, msg);

  if (msg?.t === "img") {
    return loadCachedMsgImage(key, msg?.m, loader, {
      fileName: getFileName(msg),
      defaultExt: "jpg",
      defer: true,
    }).catch((error) => {
      console.warn("warm image download failed", error);
      return null;
    });
  }

  return loadCachedMsgFile(key, msg?.m, loader, {
    fileName: getFileName(msg),
    defer: true,
  }).catch((error) => {
    console.warn("warm file download failed", error);
    return null;
  });
}
