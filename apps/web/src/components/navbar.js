'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { makeUserQr, qr } from '@veyl/shared/qr';
import { useUser } from '@/components/providers/userprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { useChat, useChatInput } from '@/components/providers/chatprovider';
import { handleAppShortcut, shortcuts } from '@/lib/shortcuts';
import { logout } from '@/lib/user/actions';
import { Button } from '@/components/button';
import { Dot } from '@/components/dot';
import RegtestTag from '@/components/regtesttag';
import UserMenu from '@/components/usermenu';
import {
    Wallet,
    Camera,
    HandCoins,
    Search,
    MessageCircle,
    MessageCirclePlus,
    Eye,
    EyeOff,
    Bot,
    Hammer,
} from 'lucide-react';

const FOCUSABLE_SELECTOR = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

function visibleFocusable(element) {
    return !!element && element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0;
}

export default function Navbar() {
    const router = useRouter();
    const pathname = usePathname();
    const { openDialog } = useDialog();
    const user = useUser();
    const { copyFundingAddress, fundingAddress, getFundingAddress, balance } = useWallet();
    const { lock } = useVault();
    const { hasTx } = useTxData();
    const { hasChats, chats } = useChat();
    const { focusChatInput, navbarRef } = useChatInput();
    const navRef = useRef(null);
    const { cloaked, cloak } = useCloak();
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const username = user?.username;
    const isAdmin = !!user?.isAdmin;
    const hasUnseenChats = !!chats?.some((c) => c?.unseen);
    const showWalletDot = false;
    const showChatDot = !user?.chatBanned && hasUnseenChats && !pathname?.startsWith('/chat');

    const handleNewChat = () => {
        if (user?.chatBanned) {
            return;
        }
        openDialog('newchat');
    };
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
    const handleNavKeyDown = useCallback(
        (event) => {
            if (pathname !== '/chat' || event.key !== 'Tab' || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
                return;
            }
            const focusables = [...(navRef.current?.querySelectorAll?.(FOCUSABLE_SELECTOR) || [])].filter(visibleFocusable);
            if (document.activeElement !== focusables[focusables.length - 1]) {
                return;
            }
            if (!focusChatInput()) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
        },
        [focusChatInput, pathname]
    );

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            handleAppShortcut(e, {
                pathname,
                openDialog,
                push: router.push,
                lock,
                logout,
                cloak,
                openUserMenu,
                openUserQr,
                hasTx,
                isAdmin,
                chatBanned: user?.chatBanned,
            });
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [cloak, hasTx, isAdmin, lock, openDialog, openUserMenu, openUserQr, pathname, router.push, user?.chatBanned]);

    return (
        <nav ref={navRef} className="py-2.25 w-full flex items-center z-30 sticky top-0" onKeyDown={handleNavKeyDown}>
            {/* icon buttons */}
            <div className="items-center flex-1 hidden md:flex justify-between pl-1 pr-3 [&_svg:not([class*='size-'])]:size-6">
                {/* nav */}
                <div className="flex gap-3">
                    {user?.chatBanned ? (
                        <Button className="grower-lg" disabled title="chat unavailable">
                            <MessageCircle />
                        </Button>
                    ) : pathname === '/chat' ? (
                        <Button ref={navbarRef} className="grower-lg" onClick={handleNewChat} title="new chat">
                            <Dot show={showChatDot} compact>
                                <MessageCirclePlus />
                            </Dot>
                        </Button>
                    ) : (
                        <Button asChild className="grower-lg">
                            <Link href="/chat">
                                <Dot show={showChatDot} compact>
                                    <MessageCircle />
                                </Dot>
                            </Link>
                        </Button>
                    )}
                    <Button asChild className="grower-lg">
                        <Link href="/camera">
                            <Camera />
                        </Link>
                    </Button>
                    <Button asChild className="grower-lg">
                        <Link href="/wallet">
                            <Dot show={showWalletDot} compact>
                                <Wallet />
                            </Dot>
                        </Link>
                    </Button>
                    {isAdmin ? (
                        <>
                            <Button asChild className="grower-lg">
                                <Link href="/admin/reports">
                                    <Hammer />
                                </Link>
                            </Button>
                            <Button asChild className="grower-lg">
                                <Link href="/admin/bots">
                                    <Bot />
                                </Link>
                            </Button>
                        </>
                    ) : null}
                </div>
                {/* actions */}
                <div className="flex">
                    <div className="flex gap-3">
                        <Button className="grower-lg" onClick={() => openDialog('payments')}>
                            <HandCoins className="size-6" />
                        </Button>
                    </div>
                </div>
            </div>
            {/* main menu */}
            <div className="w-full md:flex-1 items-center flex justify-center">
                <Button className="mainmenu" onClick={() => openDialog('mainmenu')}>
                    <Search className="text-muted" />
                    <span className=" text-muted">search for anything</span>
                    <span className="ml-auto text-sm text-muted font-black">{shortcuts.mainmenu}</span>
                </Button>
            </div>
            {/* right actions and profile menu */}
            <div className="flex-1 hidden md:flex justify-between items-center pr-1 pl-3">
                {/* right actions */}
                <div className="flex gap-3">
                    {(hasChats || hasTx) && (
                        <Button onClick={cloak} className="grower-lg" title="cloak">
                            {cloaked ? <EyeOff className="size-6" /> : <Eye className="size-6" />}
                        </Button>
                    )}
                </div>
                {/* profile menu */}
                <div className="flex items-center gap-2">
                    <RegtestTag />
                    <UserMenu
                        user={user}
                        balance={balance}
                        copyFundingAddress={copyFundingAddress}
                        fundingAddress={fundingAddress}
                        getFundingAddress={getFundingAddress}
                        lock={lock}
                        openDialog={openDialog}
                        open={userMenuOpen}
                        onOpenChange={setUserMenuOpen}
                    />
                </div>
            </div>
        </nav>
    );
}
