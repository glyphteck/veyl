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
} from "@/lib/chat/imagecache";
import { hasStoredFileRef, isExpiredAttachmentMsg, storedFileKey } from "@veyl/shared/chat/messages";
import { CHAT_READY_DOWNLOAD_MAX_BYTES } from "@veyl/shared/config";
import { fileExtension, mimeExtension } from "@veyl/shared/utils/filetype";
import { cleanText } from "@veyl/shared/utils/text";
import { fileUri } from "@/lib/file";

function cleanPart(value, fallback) {
  const raw = String(value || fallback || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ");
  return raw || fallback;
}

function cacheKey(peerChatPK, msg) {
  return storedFileKey(peerChatPK, msg, { type: msg?.t !== "img" });
}

function getExt(msg) {
  const namedExt = fileExtension({ name: msg?.n });
  if (namedExt && namedExt.length <= 8) {
    return namedExt;
  }

  const mimeExt = mimeExtension(msg?.m, "");
  if (mimeExt) {
    return mimeExt;
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
  const name = cleanText(msg?.n);
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
  if (isExpiredAttachmentMsg(msg)) {
    return null;
  }

  const localUri = fileUri(msg?.localUri);
  if (localUri) {
    return localUri;
  }

  if (!peerChatPK || !hasStoredFileRef(msg)) {
    return null;
  }

  const key = cacheKey(peerChatPK, msg);
  const cached = msg?.t === "img" ? getCachedMsgImage(key) : getCachedMsgFile(key);
  return fileUri(cached);
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
  return Number.isFinite(size) && size > 0 && size <= CHAT_READY_DOWNLOAD_MAX_BYTES;
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
  const expired = isExpiredAttachmentMsg(msg);
  const localUri = expired ? null : fileUri(msg?.localUri);

  if (localUri) {
    return localUri;
  }

  if (
    !peerChatPK ||
    typeof readMessageFile !== "function" ||
    !hasStoredFileRef(msg)
  ) {
    throw new Error("image unavailable");
  }

  const key = cacheKey(peerChatPK, msg);
  const cached = expired ? null : getCachedMsgImage(key);
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
  const expired = isExpiredAttachmentMsg(msg);
  const localUri = expired ? null : fileUri(msg?.localUri);
  if (localUri) {
    return localUri;
  }

  if (
    !peerChatPK ||
    typeof readMessageFile !== "function" ||
    !hasStoredFileRef(msg)
  ) {
    throw new Error("file unavailable");
  }

  if (msg?.t === "img") {
    return resolveImageUri(msg, peerChatPK, readMessageFile, options);
  }

  const key = cacheKey(peerChatPK, msg);
  const cached = expired ? null : getCachedMsgFile(key);
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
    (!hasStoredFileRef(msg) && !canUseLocalUri(msg))
  ) {
    return null;
  }
  return resolveFileUri(msg, peerChatPK, readMessageFile, {
    defer: true,
  }).catch(() => null);
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

export async function downloadMessageImage(msg, peerChatPK, readMessageFile) {
  const uri = await resolveImageUri(msg, peerChatPK, readMessageFile);
  const existing = await MediaLibrary.getPermissionsAsync(true);
  const perm = existing.granted
    ? existing
    : await MediaLibrary.requestPermissionsAsync(true);
  if (!perm.granted) {
    throw new Error("Please allow photo access to save pictures.");
  }
  await MediaLibrary.Asset.create(uri);
}

export async function downloadMessageFile(msg, peerChatPK, readMessageFile) {
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
    (!hasStoredFileRef(msg) && !canUseLocalUri(msg))
  ) {
    return null;
  }

  const key = cacheKey(peerChatPK, msg);
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
