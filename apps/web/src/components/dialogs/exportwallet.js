'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BanknoteArrowUp, Copy, Eye, EyeOff, KeyRound, Loader, Lock } from 'lucide-react';
import { Card } from '@/components/card';
import { Input } from '@/components/input';
import { Button } from '@/components/button';
import { normalizePassword } from '@veyl/shared/password';
import { decryptWalletMnemonic, zeroBytes } from '@/lib/crypto/seed';
import { useVault } from '@/components/providers/vaultprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { toast } from 'sonner';
import { cn } from '@/lib/classes';

export default function ExportWallet() {
    const { vault } = useVault();
    const { openDialog } = useDialog();
    const walletMnemonicRef = useRef(null);
    const [password, setPassword] = useState('');
    const [walletMnemonic, setWalletMnemonic] = useState(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isRevealed, setIsRevealed] = useState(false);
    const [error, setError] = useState('');

    const replaceWalletMnemonic = useCallback((nextMnemonic) => {
        zeroBytes(walletMnemonicRef.current);
        walletMnemonicRef.current = nextMnemonic;
        setWalletMnemonic(nextMnemonic);
    }, []);

    const loadWalletMnemonic = useCallback(
        async (event) => {
            event.preventDefault();
            if (isLoading) return;

            const nextPassword = normalizePassword(password);
            if (!nextPassword) {
                setError('password required');
                replaceWalletMnemonic(null);
                setIsRevealed(false);
                return;
            }

            setIsLoading(true);
            setError('');
            replaceWalletMnemonic(null);
            setIsRevealed(false);

            try {
                const nextMnemonic = await decryptWalletMnemonic(vault, nextPassword);
                replaceWalletMnemonic(nextMnemonic);
                setPassword('');
            } catch (err) {
                setError(err?.message === 'vault not ready' ? 'vault not ready' : 'incorrect password');
            } finally {
                setIsLoading(false);
            }
        },
        [vault, isLoading, password, replaceWalletMnemonic]
    );

    const handlePasswordChange = useCallback(
        (event) => {
            setPassword(event.target.value);
            setError('');
            replaceWalletMnemonic(null);
            setIsRevealed(false);
        },
        [replaceWalletMnemonic]
    );

    const handleCopy = useCallback(async () => {
        if (!walletMnemonic) return;
        await navigator.clipboard.writeText(walletMnemonic);
        toast('spark mnemonic copied', {
            icon: <Copy />,
            description: 'use it as the Spark mnemonicOrSeed value',
        });
    }, [walletMnemonic]);

    useEffect(() => {
        return () => {
            zeroBytes(walletMnemonicRef.current);
            walletMnemonicRef.current = null;
        };
    }, []);

    return (
        <div className="w-lg flex flex-col gap-2">
            <Card className="p-5">
                <div className="text-2xl font-black pb-4">export wallet</div>
                <div className="flex flex-col">
                    <div className="font-black text-lg">this is not a bitcoin wallet.</div>
                    <div className="flex flex-col gap-2">
                        <div className="text-sm">
                            you cannot use it like a normal bitcoin wallet. you can only use it with the spark network. either with a new account on this platform, on a different platform that uses spark wallets, or
                            yourself through the spark sdk.
                        </div>
                        <div className="flex flex-col gap-2">
                            <div className="flex gap-4">
                                <div className=" font-black text-lg text-foreground">withdraw instead</div>
                                <Button type="button" className=" grower-lg shrink-0" onClick={() => openDialog('withdraw')} title="withdraw">
                                    <BanknoteArrowUp />
                                </Button>
                            </div>
                            <div className="text-sm">if you do not want to use this account anymore, it is highly recommended that you withdraw your funds back to a bitcoin wallet instead.</div>
                        </div>
                    </div>
                </div>
            </Card>

            {!walletMnemonic ? (
                <form onSubmit={loadWalletMnemonic} className="flex flex-col gap-3">
                    <Input
                        start={<Lock className="pointer-events-none select-none" />}
                        type="password"
                        placeholder="password"
                        autoFocus
                        value={password}
                        onChange={handlePasswordChange}
                        disabled={isLoading}
                    />
                    {error ? <p className="text-sm font-black text-destructive">{error}</p> : null}
                    <Button type="submit" className="w-full shrinker button-fill" disabled={isLoading}>
                        {isLoading ? <Loader className="animate-spin" /> : <KeyRound />}
                        {isLoading ? 'decrypting spark wallet...' : 'decrypt wallet mnemonic'}
                    </Button>
                </form>
            ) : (
                <>
                    <div className="flex gap-3">
                        <Button
                            type="button"
                            className="shrinker button-outline flex-1"
                            onClick={() => {
                                setIsRevealed((prev) => !prev);
                            }}
                            title={isRevealed ? 'hide mnemonic' : 'show mnemonic'}
                        >
                            {isRevealed ? <Eye /> : <EyeOff />}
                            {isRevealed ? 'hide mnemonic' : 'show mnemonic'}
                        </Button>
                        <Button type="button" className="shrinker button-outline flex-1" onClick={handleCopy} title="copy mnemonic">
                            <Copy />
                            copy mnemonic
                        </Button>
                    </div>
                    <Card className={cn('transition-opacity', isRevealed ? 'opacity-100' : 'opacity-0')}>
                        <div className="px-5 py-5">
                            <div className={cn('font-mono text-base font-black leading-relaxed text-foreground', isRevealed ? 'select-text' : 'select-none')}>{walletMnemonic}</div>
                        </div>
                    </Card>
                </>
            )}
        </div>
    );
}
