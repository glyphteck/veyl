'use client';

import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useChat } from '@/components/providers/chatprovider';
import Alert from './alert';

export default function DeleteMessage({ data, close }) {
    const { deleteMessage } = useChat();

    const chatId = data?.chatId ?? null;
    const msg = data?.msg ?? null;
    const onDeleting = data?.onDeleting;
    const onDeleted = data?.onDeleted;
    const onDeleteFailed = data?.onDeleteFailed;
    const canDelete = !!chatId && !!msg?.id && !String(msg.id).startsWith('local:');

    const handleDelete = () => {
        if (!canDelete) {
            return;
        }

        onDeleting?.(msg);
        close?.();
        void deleteMessage(chatId, msg.id)
            .then(() => {
                onDeleted?.(msg.id, msg);
            })
            .catch((error) => {
                onDeleteFailed?.(msg);
                console.error('delete message failed', error);
                toast('delete failed', {
                    description: error?.message || 'Could not delete this message.',
                });
            });
    };

    return (
        <Alert title="delete message?" onCancel={close} onConfirm={handleDelete} disabled={!canDelete} confirmLabel="delete" confirmIcon={<Trash2 className="size-4" />}>
            <p className="text-muted">This removes it for both people in this chat.</p>
        </Alert>
    );
}
