'use client';

import { useCallback, useEffect, useState } from 'react';
import { BanknoteArrowUp, KeyRound, Loader, Lock, Trash2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { Card } from '@/components/card';
import { Input } from '@/components/input';
import { Button } from '@/components/button';
import { getFunctions } from '@/lib/firebase/firebaseclient';
import { logout } from '@/lib/useractions';
import { useVault } from '@/components/providers/vaultprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useBitcoin } from '@/components/providers/bitcoinprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useUser } from '@/components/providers/userprovider';
import { minWithdrawalSats } from '@glyphteck/shared/spark';
import { verifyVaultPassword } from '@/lib/crypto/seed';
import { renderMoney } from '@/lib/utils';

export default function DeleteAccount({ close }) {
    const [step, setStep] = useState('risk');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [isPasswordValid, setIsPasswordValid] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const { openDialog } = useDialog();
    const bitcoin = useBitcoin();
    const { balance } = useWallet();
    const { settings, clearAvatar } = useUser();
    const { encSeed, localCache, lock } = useVault();
    const showWithdraw = balance != null && balance >= minWithdrawalSats;
    const balanceLabel = renderMoney(balance ?? 0n, settings.moneyFormat, bitcoin.price);

    const verifyPassword = useCallback(
        async (event) => {
            event.preventDefault();
            if (isVerifying || isPasswordValid) return;

            setIsVerifying(true);
            setError('');
            try {
                await verifyVaultPassword(encSeed, password);
                setIsPasswordValid(true);
                setPassword('');
            } catch (error) {
                setIsPasswordValid(false);
                if (error?.message === 'vault not ready') {
                    setError('vault still loading');
                } else {
                    setError('incorrect password');
                }
            } finally {
                setIsVerifying(false);
            }
        },
        [encSeed, isPasswordValid, isVerifying, password]
    );

    const deleteAccount = useCallback(async () => {
        setIsDeleting(true);
        try {
            const deleteAccountFn = httpsCallable(getFunctions(), 'deleteAccount');
            await deleteAccountFn();
            await localCache?.clear?.().catch(() => {});
            clearAvatar?.();
            lock?.(true);
            close?.();
            await logout({ remember: false });
        } catch (error) {
            setError(error?.message || 'failed to delete account');
            setIsDeleting(false);
        } finally {
            if (typeof window === 'undefined') {
                setIsDeleting(false);
            }
        }
    }, [clearAvatar, close, localCache, lock]);

    useEffect(() => {
        if (!isPasswordValid) return;
        setError('');
    }, [isPasswordValid]);

    const openExport = useCallback(() => {
        openDialog('exportwallet');
    }, [openDialog]);

    const openWithdraw = useCallback(() => {
        openDialog('withdraw');
    }, [openDialog]);

    const ActionRow = ({ onDelete, deleteDisabled }) => (
        <div className="flex items-center gap-4 [&_svg:not([class*='size-'])]:size-6">
            <Button className="grower-lg" onClick={openWithdraw} disabled={!showWithdraw || isVerifying || isDeleting} title="withdraw funds">
                <BanknoteArrowUp />
            </Button>
            <Button className="grower-lg" onClick={openExport} disabled={isVerifying || isDeleting} title="export wallet">
                <KeyRound />
            </Button>
            <Button
                className="button-destructive shrinker flex-1"
                onClick={onDelete}
                disabled={deleteDisabled}
            >
                <Trash2 />
                delete account
            </Button>
        </div>
    );

    return (
        <div className="w-md flex flex-col gap-3">
            {step === 'risk' ? (
                <>
                    <Card className="p-2">
                        <div className="px-4 pt-2 text-2xl leading-none font-black">delete account?</div>
                        <div className="flex flex-col gap-3 px-4 py-2 text-sm leading-6 text-foreground">
                            {showWithdraw ? (
                                <p className="text-muted">
                                    balance: <span className="font-black text-foreground">{balanceLabel}</span>
                                </p>
                            ) : null}
                            <p>
                                if you choose to delete your account, <span className="font-black text-destructive">you will permanently lose access to your funds and chats</span>. you can withdraw your funds first to a bitcoin wallet
                                before deleting your account, export your wallet to a different client, or simply send your remaining balance to another account.
                            </p>
                        </div>
                    </Card>
                    <ActionRow
                        deleteDisabled={isVerifying || isDeleting}
                        onDelete={() => {
                            setStep('confirm');
                            setPassword('');
                            setError('');
                            setIsPasswordValid(false);
                        }}
                    />
                </>
            ) : (
                <>
                    <Card className="p-2">
                        <div className="px-4 pt-2 text-2xl leading-none font-black">delete account forever?</div>
                        <div className="flex flex-col gap-3 px-4 py-2 text-sm leading-6 text-foreground">
                            {showWithdraw ? (
                                <p className="text-muted">
                                    balance: <span className="font-black text-foreground">{balanceLabel}</span>
                                </p>
                            ) : null}
                            <p>
                                if you choose to delete your account, <span className="font-black text-destructive">you will permanently lose access to your funds and chats</span>. you can withdraw your funds first to a bitcoin wallet
                                before deleting your account, export your wallet to a different client, or simply send your remaining balance to another account.
                            </p>
                        </div>
                    </Card>

                    {!isPasswordValid ? (
                        <form onSubmit={verifyPassword} className="flex flex-col gap-3">
                            <Input
                                id="delete-password"
                                start={<Lock className="pointer-events-none select-none" />}
                                type="password"
                                placeholder="password"
                                autoFocus
                                value={password}
                                onChange={(event) => {
                                    setPassword(event.target.value);
                                    setError('');
                                }}
                                disabled={isVerifying || isDeleting}
                            />
                            {error ? <p className="text-sm font-black text-destructive">{error}</p> : null}
                            <Button type="submit" className="w-full button-fill shrinker" disabled={isVerifying || isDeleting}>
                                confirm password
                            </Button>
                        </form>
                    ) : (
                        <Button className="button-destructive shrinker w-full" onClick={deleteAccount} disabled={isDeleting}>
                            {isDeleting ? <Loader className="animate-spin" /> : <Trash2 />}
                            {isDeleting ? 'deleting...' : 'delete account'}
                        </Button>
                    )}
                </>
            )}
        </div>
    );
}
