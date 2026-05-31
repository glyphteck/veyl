'use client';

import { makeUserQr, qr } from '@veyl/shared/qr';
import { hasAvailableBalance } from '@veyl/shared/wallet/balance';
import { formatUserDisplay } from '@veyl/shared/profile';
import { shortcuts } from '@/lib/shortcuts';
import { Button } from '@/components/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuItem, DropdownMenuShortcut } from '@/components/dropdownmenu';
import { BanknoteArrowDown, BanknoteArrowUp, KeyRound, Lock, LogOut, QrCode, Settings2, UserX } from 'lucide-react';

export default function UserMenu({
    user,
    balance,
    copyFundingAddress,
    fundingAddress,
    getFundingAddress,
    lock,
    openDialog,
    locked = false,
    open,
    onOpenChange,
    className = 'shrinker-fixed hidden md:flex',
    disabled = false,
    avatarClassName = 'size-11 shadow',
}) {
    const openUserQr = () => {
        const qrData = makeUserQr(user);
        if (!qrData) return;
        openDialog('qrcode', {
            type: qr.user,
            value: qrData,
        });
    };

    const openFundingQr = async () => {
        const address = fundingAddress || (await getFundingAddress?.());
        if (!address) return;
        openDialog('qrcode', { type: qr.bitcoin, value: address });
        void copyFundingAddress?.(address).catch(() => {});
    };

    return (
        <DropdownMenu open={open} onOpenChange={onOpenChange}>
            <DropdownMenuTrigger asChild>
                <Button className={className} disabled={disabled} title="user menu">
                    <Avatar active={user?.active} className={avatarClassName}>
                        <AvatarImage src={user?.avatar} alt={user?.username || 'User'} />
                        <AvatarFallback />
                    </Avatar>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-50 pb-0.5" initialFocusIndex={user?.username ? 1 : 0}>
                {user?.username && (
                    <>
                        <DropdownMenuItem className="text-xl font-black" onSelect={openUserQr}>
                            <span className="min-w-0 flex-1 truncate pr-4">{formatUserDisplay(user, true)}</span>
                            <span className="sr-only">show qr code</span>
                            <DropdownMenuShortcut className="flex items-center tracking-normal">
                                <QrCode className="size-5" />
                            </DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}
                {!locked && (
                    <>
                        <DropdownMenuItem onSelect={openFundingQr}>
                            <BanknoteArrowDown />
                            <span className="pr-4">fund wallet</span>
                        </DropdownMenuItem>
                        {hasAvailableBalance(balance) && (
                            <DropdownMenuItem onSelect={() => openDialog('withdraw')}>
                                <BanknoteArrowUp />
                                <span className="pr-4">withdraw funds</span>
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={() => openDialog('exportwallet')}>
                            <KeyRound />
                            <span className="pr-4">export wallet</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}
                {!locked && (
                    <>
                        <DropdownMenuItem onClick={() => openDialog('settings')}>
                            <Settings2 />
                            <span className="pr-4">settings</span>
                            <DropdownMenuShortcut>{shortcuts.settings}</DropdownMenuShortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openDialog('blocked')}>
                            <UserX />
                            <span className="pr-4">blocked users</span>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}
                {!locked && (
                    <DropdownMenuItem onClick={lock}>
                        <Lock />
                        <span className="pr-4">lock vault</span>
                        <DropdownMenuShortcut>{shortcuts.lock}</DropdownMenuShortcut>
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => openDialog('rememberaccount', { user })}>
                    <LogOut />
                    <span className="pr-4">logout</span>
                    <DropdownMenuShortcut>{shortcuts.logout}</DropdownMenuShortcut>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
