'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/button';
import { skipAvatar, uploadAvatar } from '@/lib/useractions';
import { useUser } from '@/components/providers/userprovider';
import UpdateAvatar from '@/components/updateavatar';
import { ImageUp } from 'lucide-react';

export default function GetAvatar() {
    const router = useRouter();
    const { avatarBanned, refetchAvatar } = useUser();
    const [selectedImage, setSelectedImage] = useState(null);
    const [status, setStatus] = useState('idle');
    const isUploading = status === 'uploading';
    const isSkipping = status === 'skipping';
    const busy = isUploading || isSkipping;

    const handleConfirm = async () => {
        if (!selectedImage || busy || avatarBanned) return;

        try {
            setStatus('uploading');
            const ok = await uploadAvatar(selectedImage);
            if (!ok) {
                setStatus('idle');
                return;
            }
            await refetchAvatar?.({ optimistic: true });
            setStatus('skipping');
            router.push('/community');
        } catch {
            setStatus('idle');
        }
    };

    const handleSkip = async () => {
        if (busy) return;
        setStatus('skipping');
        const ok = await skipAvatar();
        if (!ok) {
            setStatus('idle');
            return;
        }
        router.push('/community');
    };

    const handleRemoveAvatar = () => {
        if (busy) return;
        setSelectedImage(null);
    };

    return (
        <div className="absolute inset-0 items-center flex justify-center">
            <div className="flex flex-col items-center gap-4">
                <div className="flex items-center gap-2 text-xl font-black leading-none select-none">set your avatar</div>
                <UpdateAvatar
                    className="size-48"
                    disabled={busy || avatarBanned}
                    onImageSelect={setSelectedImage}
                    onRemove={handleRemoveAvatar}
                    removeDisabled={busy}
                    selectedImage={selectedImage}
                    showRemove={!!selectedImage && !busy}
                />
                <div className="flex flex-col gap-1">
                    <div className="relative h-10 w-3xs">
                        <div className="pop absolute inset-0 flex items-center justify-center" data-open={!selectedImage}>
                            <Button type="button" className="grower w-full text-muted hover:text-foreground" disabled={busy} onClick={handleSkip}>
                                skip for now
                            </Button>
                        </div>
                        <div className="pop absolute inset-0 flex items-center justify-center" data-open={!!selectedImage}>
                            <Button type="button" className="button-outline shrinker w-full" disabled={!selectedImage || busy || avatarBanned} onClick={handleConfirm}>
                                <ImageUp className="stroke-2" />
                                confirm
                            </Button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
