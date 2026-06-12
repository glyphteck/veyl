import { useEffect, useMemo, useState } from "react";
import { useChat } from "@/providers/chatprovider";
import { getCachedMessageFileUri, getMessageFileName } from "@/lib/chat/downloads";
import { loadCachedMsgImage } from "@/lib/chat/imagecache";
import { hasStoredFileRef, isImageAttachmentMsg, storedFileKey } from "@veyl/shared/chat/messages";

export function useMsgImage(peerChatPK, msg, active = true) {
  const { readMessageFile } = useChat();
  const initialUri = getCachedMessageFileUri(msg, peerChatPK);
  const [uri, setUri] = useState(() => initialUri);
  const [loading, setLoading] = useState(
    () => isImageAttachmentMsg(msg) && !initialUri && hasStoredFileRef(msg),
  );
  const source = useMemo(() => (uri ? { uri } : null), [uri]);

  useEffect(() => {
    let cancelled = false;
    const cachedUri = getCachedMessageFileUri(msg, peerChatPK);
    if (cachedUri) {
      setUri(cachedUri);
      setLoading(false);
      return;
    }

    if (!active) {
      setLoading(false);
      return;
    }

    if (!isImageAttachmentMsg(msg) || !peerChatPK || !hasStoredFileRef(msg)) {
      setUri(null);
      setLoading(false);
      return;
    }

    const key = storedFileKey(peerChatPK, msg);
    setLoading(true);
    const task = loadCachedMsgImage(
      key,
      msg?.m,
      () => readMessageFile(peerChatPK, msg),
      { fileName: getMessageFileName(msg), defaultExt: "jpg", defer: true },
    );
    task
      .then((nextUri) => {
        if (cancelled) {
          return;
        }
        setUri(nextUri);
        setLoading(false);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (error?.message !== "cache cleared") {
          console.warn("chat image load failed", error);
        }
        setUri(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    active,
    msg?.k,
    msg?.localUri,
    msg?.m,
    msg?.p,
    msg?.t,
    peerChatPK,
    readMessageFile,
  ]);

  return {
    source,
    loading,
  };
}
