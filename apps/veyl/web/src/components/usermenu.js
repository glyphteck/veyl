'use client';

import { makeUserQr, qr } from '@glyphteck/shared/qrutils';
import { minWithdrawalSats } from '@glyphteck/shared/spark';
import { formatUserDisplay } from '@/lib/utils';
import { shortcuts } from '@/lib/shortcuts';
import { Button } from '@/components/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuItem, DropdownMenuShortcut } from '@/components/dropdownmenu';
import { BanknoteArrowDown, BanknoteArrowUp, KeyRound, Lock, LogOut, Settings2, Trash2, UserX } from 'lucide-react';

export default function UserMenu({ user, balance, copyFundingAddress, lock, openDialog, locked = false, className = 'shrinker-fixed hidden md:flex', disabled = false, avatarClassName = 'size-11 shadow' }) {
    const openUserQr = () => {
        const qrData = makeUserQr(user);
        if (!qrData) return;
        openDialog('qrcode', {
            type: qr.user,
            value: qrData,
        });
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button className={className} disabled={disabled}>
                    <Avatar active={user?.active} className={avatarClassName}>
                        <AvatarImage src={user?.avatar} alt={user?.username || 'User'} />
                        <AvatarFallback />
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                {user?.username && (
                    <>
                        <DropdownMenuItem className="text-xl font-black" onSelect={openUserQr}>
                            <span>{formatUserDisplay(user, true)}</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}
                {!locked && (
                    <>
                        <DropdownMenuItem
                            onSelect={async () => {
                                const address = await copyFundingAddress?.();
                                if (address) {
                                    openDialog('qrcode', { type: qr.bitcoin, value: address });
                                }
                            }}
                        >
                            <BanknoteArrowDown />
                            <span>fund wallet</span>
                        </DropdownMenuItem>
                        {balance != null && balance >= minWithdrawalSats && (
                            <DropdownMenuItem onSelect={() => openDialog('withdraw')}>
                                <BanknoteArrowUp />
                                <span>withdraw funds</span>
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => openDialog('exportwallet')}>
                            <KeyRound />
                            <span>export wallet</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}
                {!locked && (
                    <>
                        <DropdownMenuItem onClick={() => openDialog('settings')}>
                            <Settings2 />
                            <span>settings</span>
                            <DropdownMenuShortcut>{shortcuts.settings}</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDialog('blocked')}>
                            <UserX />
                            <span>blocked users</span>
                        </DropdownMenuItem>
                    </>
                )}
                {!locked && (
                    <DropdownMenuItem onClick={lock}>
                        <Lock />
                        <span>lock vault</span>
                        <DropdownMenuShortcut>{shortcuts.lock}</DropdownMenuShortcut>
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => openDialog('rememberaccount', { user })}>
                    <LogOut />
                    <span>logout</span>
                    <DropdownMenuShortcut>{shortcuts.logout}</DropdownMenuShortcut>
                </DropdownMenuItem>
                {!locked && (
                    <DropdownMenuItem className="text-destructive" onSelect={() => openDialog('deleteaccount')}>
                        <Trash2 />
                        <span>delete account</span>
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
