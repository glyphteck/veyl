'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogOverlay, DialogContent, DialogHeader, DialogTitle, DialogDescription, DIALOG_CLOSE_MS } from '@/components/dialog';
import * as Dialogs from '@/components/dialogs';

const DialogContext = createContext();
const emptyDialog = { open: false, type: null, data: null };

export function DialogProvider({ children, allow = null }) {
    const [dialog, setDialog] = useState(emptyDialog);
    const closeTimerRef = useRef(null);
    const registry = useMemo(
        () => {
            const all = {
                userdetails: Dialogs.UserDetails,
                block: Dialogs.Block,
                txdetails: Dialogs.TxDetails,
                payments: Dialogs.Payments,
                settings: Dialogs.Settings,
                withdraw: Dialogs.Withdraw,
                mainmenu: Dialogs.MainMenu,
                qrcode: Dialogs.QRCode,
                deleteaccount: Dialogs.DeleteAccount,
                report: Dialogs.Report,
                deletechat: Dialogs.DeleteChat,
                deletemessage: Dialogs.DeleteMessage,
                blocked: Dialogs.Blocked,
                newchat: Dialogs.NewChat,
                sendphoto: Dialogs.SendPhoto,
                sharemedia: Dialogs.ShareMedia,
                exportwallet: Dialogs.ExportWallet,
                passwordrules: Dialogs.PasswordRules,
                rememberaccount: Dialogs.RememberAccount,
            };

            if (!allow?.length) {
                return all;
            }

            return Object.fromEntries(Object.entries(all).filter(([key]) => allow.includes(key)));
        },
        [allow]
    );

    useEffect(() => {
        return () => {
            window.clearTimeout(closeTimerRef.current);
        };
    }, []);

    const openDialog = useCallback(
        (nextType, nextData = null) => {
            if (!registry[nextType]) {
                return;
            }
            window.clearTimeout(closeTimerRef.current);
            setDialog({ open: true, type: nextType, data: nextData });
        },
        [registry]
    );
    const closeDialog = useCallback(() => {
        window.clearTimeout(closeTimerRef.current);
        setDialog((current) => (current.type ? { ...current, open: false } : current));
        closeTimerRef.current = window.setTimeout(() => {
            setDialog(emptyDialog);
        }, DIALOG_CLOSE_MS);
    }, []);
    const Comp = dialog.type ? registry[dialog.type] : null;
    const ctx = useMemo(
        () => ({
            openDialog,
            closeDialog,
        }),
        [openDialog, closeDialog]
    );

    return (
        <DialogContext value={ctx}>
            {children}
            <Dialog open={dialog.open} present={!!dialog.type} onOpenChange={(open) => !open && closeDialog()}>
                <DialogOverlay />
                <DialogContent>
                    <DialogHeader className="sr-only">
                        <DialogTitle>{dialog.type}</DialogTitle>
                        <DialogDescription></DialogDescription>
                    </DialogHeader>
                    {Comp && <Comp data={dialog.data} close={closeDialog} />}
                </DialogContent>
            </Dialog>
        </DialogContext>
    );
}
export const useDialog = () => useContext(DialogContext);
