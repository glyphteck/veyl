'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { makeUserQr, qr } from '@veyl/shared/qr';
import { useChatInput } from '@/components/providers/chatprovider';
import { useDialog, useDialogState } from '@/components/providers/dialogprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { useUser } from '@/components/providers/userprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { handleAppShortcut } from '@/lib/shortcuts';
import { logout } from '@/lib/user/actions';

const ShortcutContext = createContext(null);

export function ShortcutProvider({ children }) {
    const router = useRouter();
    const pathname = usePathname();
    const { openDialog } = useDialog();
    const dialog = useDialogState();
    const user = useUser();
    const { lock } = useVault();
    const { hasTx } = useTxData();
    const { cloak } = useCloak();
    const { paymentPeer } = useChatInput();
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const username = user?.username;
    const isAdmin = !!user?.isAdmin;

    const openUserMenu = useCallback(() => {
        setUserMenuOpen(true);
    }, []);

    const openUserQr = useCallback(() => {
        const qrData = makeUserQr(username);
        if (!qrData) return;
        setUserMenuOpen(false);
        openDialog('qrcode', {
            type: qr.user,
            value: qrData,
        });
    }, [openDialog, username]);

    const getPaymentShortcutData = useCallback(
        (tab) => {
            if (dialog?.open && dialog.type === 'payments') {
                return { tab };
            }
            if (pathname?.startsWith('/chat') && paymentPeer?.walletPK) {
                return { tab, peer: paymentPeer };
            }
            return { tab };
        },
        [dialog?.open, dialog?.type, pathname, paymentPeer]
    );

    useEffect(() => {
        const handleKeyDown = (event) => {
            handleAppShortcut(event, {
                pathname,
                openDialog,
                push: router.push,
                lock,
                logout,
                cloak,
                openUserMenu,
                openUserQr,
                getPaymentShortcutData,
                hasTx,
                isAdmin,
                chatBanned: user?.chatBanned,
            });
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [cloak, getPaymentShortcutData, hasTx, isAdmin, lock, openDialog, openUserMenu, openUserQr, pathname, router.push, user?.chatBanned]);

    const value = useMemo(
        () => ({
            userMenuOpen,
            setUserMenuOpen,
        }),
        [userMenuOpen, setUserMenuOpen]
    );

    return <ShortcutContext.Provider value={value}>{children}</ShortcutContext.Provider>;
}

export function useShortcuts() {
    const context = useContext(ShortcutContext);
    if (!context) {
        throw new Error('useShortcuts must be used within a ShortcutProvider');
    }
    return context;
}
