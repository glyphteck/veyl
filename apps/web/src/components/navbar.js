'use client';

import { useCallback, useRef } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@/components/providers/userprovider';
import { useWallet } from '@/components/providers/walletprovider';
import { useVault } from '@/components/providers/vaultprovider';
import { useTxData } from '@/components/providers/txdataprovider';
import { useDialog } from '@/components/providers/dialogprovider';
import { useCloak } from '@veyl/shared/providers/cloakprovider';
import { useChat, useChatInput } from '@/components/providers/chatprovider';
import { useShortcuts } from '@/components/providers/shortcutprovider';
import { shortcuts } from '@/lib/shortcuts';
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
    const pathname = usePathname();
    const { openDialog } = useDialog();
    const user = useUser();
    const { fundingAddress, getFundingAddress, balance } = useWallet();
    const { lock } = useVault();
    const { hasTx } = useTxData();
    const { hasChats, chats } = useChat();
    const { focusChatInput, navbarRef } = useChatInput();
    const { userMenuOpen, setUserMenuOpen } = useShortcuts();
    const navRef = useRef(null);
    const { cloaked, cloak } = useCloak();
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
