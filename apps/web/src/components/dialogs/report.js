'use client';

import { useEffect, useMemo, useState } from 'react';
import { Flag, Loader, File, Image } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/card';
import { Button } from '@/components/button';
import { Input } from '@/components/input';
import { cloud } from '@/lib/cloud';
import { useChat } from '@/components/providers/chatprovider';
import { useUser } from '@/components/providers/userprovider';
import { formatUserDisplay } from '@veyl/shared/profile';
import { makeFileId } from '@veyl/shared/files';
import { buildReportFields, getReportAttachmentMeta } from '@veyl/shared/report';

function MsgPreview({ msg }) {
    if (!msg) return null;
    const { t, c, n } = msg;

    if (t === 'img') {
        return (
            <div className="flex items-center gap-2  min-w-0">
                <Image className="size-5 shrink-0 " />
                <span className="truncate ">{n || 'image'}</span>
            </div>
        );
    }

    if (t === 'file' || t === 'mp3' || t === 'mp4') {
        return (
            <div className="flex items-center gap-2 min-w-0">
                <File className="size-5 shrink-0 " />
                <span className="truncate ">{n || 'attachment'}</span>
            </div>
        );
    }

    if (t === 'txt' && c) {
        return <p className="line-clamp-2 wrap-break-word">{c}</p>;
    }

    return null;
}

export default function Report({ data, close }) {
    const peer = data?.peer ?? null;
    const msg = data?.msg ?? null;
    const peerChatPK = data?.peerChatPK ?? '';
    const onReported = data?.onReported;
    const onCancel = data?.onCancel ?? close;
    const { uid } = useUser();
    const { readMessageFile } = useChat();
    const [note, setNote] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const hasPreview = !!msg && msg.t !== undefined;
    const attachment = useMemo(() => getReportAttachmentMeta(msg), [msg]);
    const isSelfReport = !!uid && !!peer?.uid && peer.uid === uid;

    useEffect(() => {
        if (isSelfReport) {
            close?.();
        }
    }, [close, isSelfReport]);

    const handleSubmit = () => {
        if (!peer?.uid || submitting || isSelfReport) return;
        setSubmitting(true);
        close?.();

        void (async () => {
            try {
                const report = buildReportFields({ msg, note });
                let path;

                if (attachment && uid && peerChatPK) {
                    const bytes = await readMessageFile(peerChatPK, msg);
                    path = await cloud.reports.evidence.upload(uid, peer.uid, makeFileId(12), bytes, {
                        contentType: attachment.mimeType || 'application/octet-stream',
                    });
                }

                await cloud.reports.submit({
                    uid: peer.uid,
                    ...report,
                    ...(path ? { path } : {}),
                });
                onReported?.(msg);
                toast('report submitted', { icon: <Flag />, description: formatUserDisplay(peer, true) });
            } catch (error) {
                console.error('submit report failed', error);
                toast('report failed');
            }
        })();
    };

    if (isSelfReport) return null;

    return (
        <div className="flex flex-col gap-3 w-xs">
            <Card className="p-2">
                <div className="px-4 pt-2 text-2xl leading-none font-black">report {formatUserDisplay(peer, true)}?</div>
                <div className="flex flex-col gap-3 px-4 py-2">
                    <p className="text-muted">Glyphteck Corp will manually review this report{hasPreview ? ' and will have access to the content you are reporting' : ''}.</p>
                </div>
            </Card>
            {hasPreview && (
                <Card className="p-2">
                    <div className="px-4 pt-2 text-2xl leading-none font-black">harmful content:</div>
                    <div className="px-4 py-2">
                        <MsgPreview msg={msg} />
                    </div>
                </Card>
            )}
            <Input className="bg-background/70" value={note} onChange={(e) => setNote(e.target.value)} placeholder="reason for reporting..." maxLength={1000} disabled={submitting} />
            <div className="flex gap-2">
                <Button className="button-outline shrinker flex-1" onClick={onCancel} disabled={submitting}>
                    cancel
                </Button>
                <Button className="button-destructive shrinker flex-1" onClick={handleSubmit} disabled={submitting}>
                    {submitting ? <Loader className="size-4 animate-spin" /> : 'report'}
                </Button>
            </div>
        </div>
    );
}
