'use client';

import { useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Loading from '@/components/loading';
import { useDialog } from '@/components/providers/dialogprovider';
import { usePeer } from '@/components/providers/peerprovider';

export default function UserPage() {
    const handledRef = useRef(false);
    const { username } = useParams();
    const router = useRouter();
    const { openDialog } = useDialog();
    const { addPeer } = usePeer();

    useEffect(() => {
        if (handledRef.current) return;
        handledRef.current = true;

        async function openUser() {
            const cleanUsername = Array.isArray(username) ? username[0] : username;
            const peer = cleanUsername ? await addPeer({ username: cleanUsername }) : null;
            if (peer) {
                openDialog('userdetails', { user: peer });
            } else {
                toast.error('user not found');
            }
            router.replace('/wallet');
        }

        openUser().catch((error) => {
            console.error('user route failed', error);
            router.replace('/wallet');
        });
    }, [addPeer, openDialog, router, username]);

    return <Loading />;
}
