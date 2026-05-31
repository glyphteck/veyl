import { UnlockDialogHost } from '@/components/providers/dialogprovider';

export const metadata = {
    title: 'Locked',
    description: 'Unlock your vault',
};

export default function UnlockLayout({ children }) {
    return <UnlockDialogHost>{children}</UnlockDialogHost>;
}
