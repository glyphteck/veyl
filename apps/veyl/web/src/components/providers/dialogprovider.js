'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogOverlay, DialogContent, DialogHeader, DialogTitle, DialogDescription, DIALOG_CLOSE_MS } from '@/components/dialog';

const emptyDialog = { open: false, type: null, data: null };
const DialogContext = createContext();
const DialogStateContext = createContext(emptyDialog);
const dialogLoaders = {
    userdetails: () => import('@/components/dialogs/userdetails'),
    block: () => import('@/components/dialogs/block'),
    txdetails: () => import('@/components/dialogs/txdetails'),
    payments: () => import('@/components/dialogs/payments'),
    settings: () => import('@/components/dialogs/settings'),
    withdraw: () => import('@/components/dialogs/withdraw'),
    fundinginfo: () => import('@/components/dialogs/fundinginfo'),
    mainmenu: () => import('@/components/dialogs/mainmenu'),
    qrcode: () => import('@/components/dialogs/qrcode'),
    deleteaccount: () => import('@/components/dialogs/deleteaccount'),
    report: () => import('@/components/dialogs/report'),
    deletechat: () => import('@/components/dialogs/deletechat'),
    deletemessage: () => import('@/components/dialogs/deletemessage'),
    blocked: () => import('@/components/dialogs/blocked'),
    newchat: () => import('@/components/dialogs/newchat'),
    sendphoto: () => import('@/components/dialogs/sendphoto'),
    sharemedia: () => import('@/components/dialogs/sharemedia'),
    exportwallet: () => import('@/components/dialogs/exportwallet'),
    passwordrules: () => import('@/components/dialogs/passwordrules'),
    rememberaccount: () => import('@/components/dialogs/rememberaccount'),
};
const dialogComponents = new Map();
const dialogPromises = new Map();
const authDialogs = ['passwordrules', 'rememberaccount'];
const unlockDialogs = ['qrcode', 'fundinginfo'];
const appDialogs = [
    'userdetails',
    'block',
    'txdetails',
    'payments',
    'settings',
    'withdraw',
    'fundinginfo',
    'mainmenu',
    'qrcode',
    'deleteaccount',
    'report',
    'deletechat',
    'deletemessage',
    'blocked',
    'newchat',
    'sendphoto',
    'sharemedia',
    'exportwallet',
];

function loadDialog(type) {
    const load = dialogLoaders[type];
    if (!load) return Promise.resolve(null);
    if (dialogComponents.has(type)) return Promise.resolve(dialogComponents.get(type));

    let promise = dialogPromises.get(type);
    if (!promise) {
        promise = load()
            .then((mod) => {
                const Comp = mod.default;
                dialogComponents.set(type, Comp);
                return Comp;
            })
            .catch((error) => {
                dialogPromises.delete(type);
                throw error;
            });
        dialogPromises.set(type, promise);
    }
    return promise;
}

function preloadDialogs(types) {
    return Promise.all((types || []).map(loadDialog));
}

export function DialogProvider({ children }) {
    const [dialog, setDialog] = useState(emptyDialog);
    const closeTimerRef = useRef(null);

    useEffect(() => {
        return () => {
            window.clearTimeout(closeTimerRef.current);
        };
    }, []);

    const openDialog = useCallback(
        (nextType, nextData = null) => {
            if (!dialogLoaders[nextType]) return;
            window.clearTimeout(closeTimerRef.current);
            setDialog({ open: true, type: nextType, data: nextData });
        },
        []
    );
    const closeDialog = useCallback(() => {
        window.clearTimeout(closeTimerRef.current);
        setDialog((current) => (current.type ? { ...current, open: false } : current));
        closeTimerRef.current = window.setTimeout(() => {
            setDialog(emptyDialog);
        }, DIALOG_CLOSE_MS);
    }, []);
    const actions = useMemo(
        () => ({
            openDialog,
            closeDialog,
        }),
        [openDialog, closeDialog]
    );

    return (
        <DialogContext value={actions}>
            <DialogStateContext value={dialog}>{children}</DialogStateContext>
        </DialogContext>
    );
}

export function DialogHost({ allow }) {
    const dialog = useContext(DialogStateContext);
    const { closeDialog } = useDialog();
    const [, forceRender] = useState(0);
    const mountedDialogRef = useRef(null);
    const allowSet = useMemo(() => new Set(allow || []), [allow]);
    const Comp = dialog.type && allowSet.has(dialog.type) ? dialogComponents.get(dialog.type) : null;

    useEffect(() => {
        if (!dialog.type || !allowSet.has(dialog.type) || Comp) return;
        let cancelled = false;
        loadDialog(dialog.type).then(() => {
            if (!cancelled) forceRender((value) => value + 1);
        });
        return () => {
            cancelled = true;
        };
    }, [Comp, allowSet, dialog.type]);

    useEffect(() => {
        mountedDialogRef.current = Comp ? dialog.type : null;
    }, [Comp, dialog.type]);

    useEffect(() => {
        return () => {
            if (mountedDialogRef.current) closeDialog();
        };
    }, [closeDialog]);

    if (!Comp) return null;

    return (
        <Dialog open={dialog.open} present={!!dialog.type} onOpenChange={(open) => !open && closeDialog()}>
            <DialogOverlay />
            <DialogContent>
                <DialogHeader className="sr-only">
                    <DialogTitle>{dialog.type}</DialogTitle>
                    <DialogDescription></DialogDescription>
                </DialogHeader>
                <Comp data={dialog.data} close={closeDialog} />
            </DialogContent>
        </Dialog>
    );
}

export function DialogScope({ allow, children }) {
    const preloadRef = useRef(null);
    if (!preloadRef.current) {
        preloadRef.current = preloadDialogs(allow);
    }

    useEffect(() => {
        preloadRef.current.catch(() => {});
    }, []);

    return (
        <>
            {children}
            <DialogHost allow={allow} />
        </>
    );
}

export function AuthDialogHost({ children }) {
    return (
        <DialogScope allow={authDialogs}>
            {children}
        </DialogScope>
    );
}

export function UnlockDialogHost({ children }) {
    return (
        <DialogScope allow={unlockDialogs}>
            {children}
        </DialogScope>
    );
}

export function AppDialogHost({ children }) {
    return (
        <DialogScope allow={appDialogs}>
            {children}
        </DialogScope>
    );
}

export const useDialog = () => useContext(DialogContext);
