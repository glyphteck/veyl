'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Copy, Download, Loader, MessageCircleOff } from 'lucide-react';
import Loading from '@/components/loading';
import { Button } from '@/components/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { Card } from '@/components/card';
import { useAdminData } from '@/components/providers/adminprovider';
import { useAdminFile } from '@/lib/admin/files';
import { imageWidth } from '@/lib/messages';
import { formatUserDisplay } from '@/lib/utils';
import { toast } from 'sonner';

function displayUser(user) {
    return user?.username || user?.uid || formatUserDisplay(user);
}

function formatDateTime(value) {
    let date = null;

    if (typeof value?.toDate === 'function') {
        date = value.toDate();
    } else if (value instanceof Date) {
        date = value;
    } else if (typeof value === 'number') {
        date = new Date(value);
    } else if (typeof value?.seconds === 'number') {
        date = new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000));
    } else if (typeof value?._seconds === 'number') {
        date = new Date(value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000));
    } else if (typeof value === 'string') {
        date = new Date(value);
    }

    if (!date) {
        return '';
    }

    return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(date);
}

function reportTypeLabel(type) {
    switch (type) {
        case 'txt':
            return 'text';
        case 'req':
            return 'request';
        case 'img':
            return 'image';
        case 'file':
            return 'file';
        case 'mp3':
            return 'audio';
        case 'mp4':
            return 'video';
        default:
            return '';
    }
}

function ReportEvidence({ report }) {
    const type = report?.parsed?.type || '';
    const typeLabel = reportTypeLabel(type);
    const attachment = report?.parsed?.attachment || null;
    const content = report?.parsed?.content || '';
    const fileUrl = useAdminFile(attachment?.path);
    const [downloading, setDownloading] = useState(false);
    const [aspect, setAspect] = useState(4 / 3);

    const handleDownload = async () => {
        if (!fileUrl || downloading) {
            return false;
        }

        setDownloading(true);

        try {
            const res = await fetch(fileUrl);
            if (!res.ok) {
                throw new Error(`download failed (${res.status})`);
            }

            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = attachment?.name || 'attachment';
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return true;
        } catch (error) {
            console.error('report attachment download failed', error);
            toast('download failed');
            return false;
        } finally {
            setDownloading(false);
        }
    };

    const handleCopyText = async () => {
        if (!content) {
            return;
        }

        await navigator.clipboard.writeText(content);
        toast('reported text copied to clipboard', { icon: <Copy /> });
    };

    if (attachment?.kind === 'img' && fileUrl) {
        const width = imageWidth(aspect);

        return (
            <div className="mt-3 flex flex-col gap-3">
                {typeLabel ? <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{typeLabel}</p> : null}
                {content ? <p className="text-sm text-muted">{content}</p> : null}
                <Button
                    type="button"
                    className="h-auto cursor-pointer overflow-hidden rounded-round bg-foreground/5 p-0 text-left shadow-sm"
                    style={{ width, maxWidth: '100%' }}
                    onClick={async () => {
                        if (await handleDownload()) {
                            toast('reported image saved', { icon: <Download /> });
                        }
                    }}
                    disabled={downloading}
                >
                    <img
                        src={fileUrl}
                        alt={attachment.name || 'reported image'}
                        className="block w-full object-cover"
                        style={{ aspectRatio: aspect }}
                        onLoad={(event) => {
                            const { naturalWidth, naturalHeight } = event.currentTarget;
                            if (naturalWidth > 0 && naturalHeight > 0) {
                                setAspect(naturalWidth / naturalHeight);
                            }
                        }}
                    />
                </Button>
            </div>
        );
    }

    if (attachment?.path && fileUrl) {
        return (
            <div className="mt-3 flex flex-col gap-3">
                {typeLabel ? <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{typeLabel}</p> : null}
                {content ? <p className="text-sm text-muted">{content}</p> : null}
                <Button type="button" className="button-outline w-fit px-4 py-2" onClick={handleDownload} disabled={downloading}>
                    {downloading ? <Loader className="size-4 animate-spin" /> : <Download className="size-4" />}
                    <span>{attachment.name || 'download attachment'}</span>
                </Button>
            </div>
        );
    }

    if (!content && !typeLabel) {
        return null;
    }

    return (
        <div className="mt-3 flex flex-col gap-2">
            {typeLabel ? <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{typeLabel}</p> : null}
            {content ? (
                <Button type="button" className="h-auto w-fit max-w-full cursor-pointer whitespace-pre-wrap wrap-break-word rounded-3xl bg-background/50 px-4 py-3 text-left text-sm" onClick={handleCopyText}>
                    {content}
                </Button>
            ) : null}
        </div>
    );
}

export default function AdminUserPage() {
    const params = useParams();
    const slug = Array.isArray(params?.username) ? params.username[0] : params?.username;
    const { details, loadOffender, banUser, unbanUser } = useAdminData();
    const entry = slug ? details[slug] : null;
    const offender = entry?.data?.offender || null;
    const reports = entry?.data?.reports || [];
    const [banning, setBanning] = useState('');

    useEffect(() => {
        if (slug) {
            loadOffender(slug);
        }
    }, [loadOffender, slug]);

    if (!entry || entry.loading) {
        return <Loading />;
    }

    if (entry.error === 'not-found' || !offender) {
        return (
            <div className="w-full h-full flex items-center justify-center">
                <Card className="w-full h-full">
                    <div className="flex h-full items-center justify-center px-4 py-2">
                        <p className="text-2xl text-muted">user not found</p>
                    </div>
                </Card>
            </div>
        );
    }

    const copyReporterUid = async (event, report) => {
        event.stopPropagation();
        await navigator.clipboard.writeText(report.reporter?.uid || '');
        toast('account id copied', { icon: <Copy /> });
    };

    const handleModeration = async (feature) => {
        if (!offender?.uid || banning) {
            return;
        }

        const isBanned = feature === 'avatar' ? offender.avatarBanned : offender.chatBanned;
        setBanning(feature);
        try {
            if (isBanned) {
                await unbanUser(offender.uid, feature);
                toast(`${feature} unbanned ${displayUser(offender)}`);
            } else {
                await banUser(offender.uid, feature);
                toast(`${feature} banned ${displayUser(offender)}`);
            }
        } catch (error) {
            console.error('admin moderation failed', error);
            toast(isBanned ? 'unban failed' : 'ban failed');
        } finally {
            setBanning('');
        }
    };

    return (
        <div className="w-full h-full">
            <Card className="w-full h-full">
                <div className="h-full overflow-y-auto">
                    <div className={`divide-y ${reports.length + 1 < 12 ? 'border-b' : ''}`}>
                        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-3 py-3">
                            <div className="flex min-w-0 items-center gap-2.5 pr-4">
                                <Button asChild className="grower-lg shrink-0">
                                    <Link href="/admin/reports">
                                        <ArrowLeft className="size-6" />
                                    </Link>
                                </Button>
                                <Avatar active={offender.active} bot={!!offender?.bot} className="size-10">
                                    <AvatarImage src={offender.avatar} alt={displayUser(offender)} />
                                    <AvatarFallback />
                                </Avatar>
                                <div className="min-w-0">
                                    <p className="truncate">
                                        <span>{displayUser(offender)}</span>
                                        <span className="text-muted"> · {offender.uid}</span>
                                    </p>
                                    <p className="truncate text-sm text-muted">reports: {offender.count}</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3">
                                <Button
                                    className={`grower-lg ${offender.chatBanned ? 'text-destructive' : 'text-active'}`}
                                    onClick={() => handleModeration('chat')}
                                    disabled={banning === 'chat'}
                                    title={offender.chatBanned ? 'unban chat' : 'ban chat'}
                                >
                                    <MessageCircleOff className="size-6" />
                                </Button>
                                <Button
                                    className={`grower-lg size-10 p-0 ${offender.avatarBanned ? 'text-destructive' : 'text-active'}`}
                                    onClick={() => handleModeration('avatar')}
                                    disabled={banning === 'avatar'}
                                    title={offender.avatarBanned ? 'unban avatar' : 'ban avatar'}
                                >
                                    <Avatar className="pointer-events-none size-10">
                                        <AvatarFallback />
                                    </Avatar>
                                </Button>
                            </div>
                        </div>

                        {reports.length ? (
                            reports.map((report) => {
                                const note = report?.parsed?.note || 'no reporter note';

                                return (
                                    <div key={report.id} className="px-3 py-3">
                                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,360px)]">
                                            <div className="flex min-w-0 items-center gap-2.5 pr-4">
                                                <Button type="button" className="h-auto min-w-0 justify-start gap-2.5 rounded-none p-0 text-left" onClick={(event) => copyReporterUid(event, report)}>
                                                    <Avatar active={report.reporter?.active} bot={!!report.reporter?.bot} className="grower">
                                                        <AvatarImage src={report.reporter?.avatar} alt={displayUser(report.reporter)} />
                                                        <AvatarFallback />
                                                    </Avatar>
                                                </Button>
                                                <div className="min-w-0">
                                                    <Button type="button" className="h-auto max-w-full min-w-0 justify-start rounded-none p-0 text-left" onClick={(event) => copyReporterUid(event, report)}>
                                                        {displayUser(report.reporter)}
                                                    </Button>
                                                    <p className="truncate text-sm text-muted">{formatDateTime(report.createdAt)}</p>
                                                </div>
                                            </div>

                                            <div className="min-w-0 md:text-right">
                                                <p className="whitespace-pre-wrap wrap-break-word text-sm text-muted">{note}</p>
                                            </div>
                                        </div>

                                        <ReportEvidence report={report} />
                                    </div>
                                );
                            })
                        ) : (
                            <div className="flex h-full items-center justify-center px-4 py-8">
                                <p className="text-2xl text-muted">no reports</p>
                            </div>
                        )}
                    </div>
                </div>
            </Card>
        </div>
    );
}
