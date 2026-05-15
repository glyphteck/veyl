'use client';

import { httpsCallable } from 'firebase/functions';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { getFunctions } from '@/lib/firebase/firebaseclient';
import { useChat } from '@/components/providers/chatprovider';
import Alert from './alert';

export default function DeleteChat({ data, close }) {
    const { startDeleteChat, restoreDeletedChat } = useChat();
    const chatId = data?.chatId ?? null;
    const canDelete = !!chatId;

    const handleDelete = () => {
        if (!canDelete) {
            return;
        }

        close?.();
        startDeleteChat?.(chatId, { keepSelected: true });
        void httpsCallable(getFunctions(), 'deleteChat')({ chatId }).catch((error) => {
            restoreDeletedChat?.(chatId);
            console.error('delete chat failed', error);
            toast('delete failed', {
                description: error?.message || 'Could not delete this chat.',
            });
        });
    };

    return (
        <Alert title="delete chat?" onCancel={close} onConfirm={handleDelete} disabled={!canDelete} confirmLabel="delete" confirmIcon={<Trash2 className="size-4" />}>
            <p className="text-muted">This removes the chat and its messages for both people.</p>
        </Alert>
    );
}
