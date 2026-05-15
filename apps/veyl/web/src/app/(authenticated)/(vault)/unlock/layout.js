import { DialogProvider } from '@/components/providers/dialogprovider';

export const metadata = {
    title: 'Locked',
    description: 'Unlock your vault',
};

export default function UnlockLayout({ children }) {
    return <DialogProvider allow={['qrcode']}>{children}</DialogProvider>;
}
