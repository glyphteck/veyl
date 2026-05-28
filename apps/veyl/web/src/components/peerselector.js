import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { ChevronsUpDown, Loader, Search, UsersRound } from 'lucide-react';
import { mergeProfiles } from '@glyphteck/shared/search/merge';
import { formatUserDisplay } from '@/lib/utils';
import { useSearch } from '@/lib/search/usesearch';
import { useUser } from '@/components/providers/userprovider';
import { usePeer } from '@/components/providers/peerprovider';
import { isEditableTarget, listNavigationStep } from '@/lib/focus';

function isFastSearchKey(event) {
    return event.key.length === 1 && event.key !== ' ' && !event.metaKey && !event.ctrlKey && !event.altKey;
}

export default function PeerSelector({ selectedPeer, onPeerChange, disabled = false, active = false, filterPeers, label = 'user', className = '' }) {
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [searchValue, setSearchValue] = useState('');
    const [mounted, setMounted] = useState(false);
    const [position, setPosition] = useState(null);
    const { searching, results, query, search, clearSearch } = useSearch('profiles');
    const { uid: currentUserUid } = useUser();
    const { peers, recentPeers } = usePeer();
    const triggerRef = useRef(null);
    const contentRef = useRef(null);
    const searchInputRef = useRef(null);
    const peerResults = useMemo(
        () =>
            mergeProfiles({
                local: peers || [],
                remote: results || [],
                parsed: query,
                excludeUid: currentUserUid,
                extraFilter: filterPeers,
            }),
        [currentUserUid, filterPeers, peers, query, results]
    );
    const defaultPeers = useMemo(() => {
        const list = Array.isArray(recentPeers?.wallet) ? recentPeers.wallet : [];
        return list.filter((peer) => peer?.uid && peer.uid !== currentUserUid && (!filterPeers || filterPeers(peer))).slice(0, 3);
    }, [currentUserUid, filterPeers, recentPeers?.wallet]);
    const displayPeers = query ? peerResults : defaultPeers;

    const focusTrigger = useCallback(() => {
        window.setTimeout(() => {
            triggerRef.current?.focus({ preventScroll: true });
        }, 0);
    }, []);

    const closePopover = useCallback((opts = {}) => {
        const { focus = false } = opts;
        setPopoverOpen(false);
        setSearchValue('');
        clearSearch();
        if (focus) {
            focusTrigger();
        }
    }, [clearSearch, focusTrigger]);

    useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    const updatePosition = useCallback(() => {
        if (!triggerRef.current) return;

        const gap = 8;
        const rect = triggerRef.current.getBoundingClientRect();
        const width = Math.min(rect.width, window.innerWidth - gap * 2);
        const left = Math.min(Math.max(rect.left, gap), window.innerWidth - width - gap);
        const top = rect.bottom + gap;

        setPosition({ top, left, width });
    }, []);

    useLayoutEffect(() => {
        if (!popoverOpen) {
            setPosition(null);
            return;
        }

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [popoverOpen, updatePosition]);

    useEffect(() => {
        if (!popoverOpen) return;

        const handlePointerDown = (event) => {
            const target = event.target;
            if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) {
                return;
            }
            closePopover();
        };

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePopover({ focus: true });
            }
        };

        window.addEventListener('mousedown', handlePointerDown);
        window.addEventListener('touchstart', handlePointerDown);
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            window.removeEventListener('mousedown', handlePointerDown);
            window.removeEventListener('touchstart', handlePointerDown);
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [closePopover, popoverOpen]);

    useEffect(() => {
        if (!popoverOpen) return;

        const timeout = window.setTimeout(() => {
            searchInputRef.current?.focus();
        }, 0);

        return () => window.clearTimeout(timeout);
    }, [popoverOpen]);

    useEffect(() => {
        if (!active || disabled) return;
        const timeout = window.setTimeout(() => {
            triggerRef.current?.focus({ preventScroll: true });
        }, 0);
        return () => window.clearTimeout(timeout);
    }, [active, disabled]);

    const handlePeerSelect = (peer) => {
        if (peer) {
            onPeerChange?.(peer);
            closePopover();
        }
    };

    const handlePopoverOpenChange = (open) => {
        if (open) {
            setPopoverOpen(true);
            return;
        }

        closePopover({ focus: true });
    };

    const handleSearchChange = (searchValue) => {
        setSearchValue(searchValue);
        if (searchValue) {
            search(searchValue);
        } else {
            clearSearch();
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !searchValue) {
            e.preventDefault();
            closePopover({ focus: true });
            return;
        }

        const textEntry = isEditableTarget(e.target);
        const step = listNavigationStep(e, {
            ignoreEditable: false,
            includeJk: !textEntry,
            includeHorizontal: !textEntry,
        });
        if (!step || !contentRef.current) {
            return;
        }

        const buttons = Array.from(contentRef.current.querySelectorAll('[data-peer-selector-item]:not(:disabled)'));
        if (!buttons.length) {
            return;
        }

        const currentIndex = buttons.indexOf(document.activeElement);
        const startIndex = currentIndex < 0 ? (step > 0 ? -1 : buttons.length) : currentIndex;
        const nextIndex = (startIndex + step + buttons.length) % buttons.length;
        e.preventDefault();
        buttons[nextIndex]?.focus({ preventScroll: true });
        buttons[nextIndex]?.scrollIntoView({ block: 'nearest' });
    };

    const handleTriggerKeyDown = (event) => {
        if (disabled) return;
        if (isFastSearchKey(event)) {
            event.preventDefault();
            handleSearchChange(`${searchValue}${event.key}`);
            handlePopoverOpenChange(true);
            return;
        }
        if (event.key === 'Enter' || event.key === ' ' || listNavigationStep(event, { ignoreEditable: false }) > 0) {
            event.preventDefault();
            handlePopoverOpenChange(true);
        }
    };

    const content =
        mounted && popoverOpen
            ? createPortal(
                  <div
                      ref={contentRef}
                      className="fixed z-50"
                      style={{
                          top: position?.top ?? -1000,
                          left: position?.left ?? -1000,
                          width: position?.width ?? 0,
                          visibility: position ? 'visible' : 'hidden',
                      }}
                      onKeyDown={handleKeyDown}
                  >
                      <div className="flex h-full max-h-71 w-full flex-col rounded-round bg-background/70 shadow backdrop-blur-sm">
                          <div className="flex items-center gap-2 border-b px-3">
                              <Search className="text-muted" />
                              <input
                                  ref={searchInputRef}
                                  value={searchValue}
                                  onChange={(event) => handleSearchChange(event.target.value)}
                                  className="flex w-full bg-transparent py-1.5 outline-none disabled:cursor-not-allowed disabled:opacity-50"
                                  autoFocus
                              />
                          </div>
                          <div
                              className="overflow-y-auto"
                              onWheel={(event) => {
                                  event.stopPropagation();
                              }}
                          >
                              {searching && query && !displayPeers.length ? (
                                  <div className="flex justify-center py-1.5 text-muted">
                                      <Loader className="animate-spin size-6" />
                                  </div>
                              ) : displayPeers.length > 0 ? (
                                  <div className="grid grid-cols-4 gap-4 p-4">
                                      {displayPeers.map((peer) => (
                                          <Button
                                              key={peer.uid}
                                              type="button"
                                              data-peer-selector-item=""
                                              aria-pressed={selectedPeer?.uid === peer.uid}
                                              className="h-auto flex-col rounded-none p-0 shrinker"
                                              onClick={() => handlePeerSelect(peer)}
                                          >
                                              <Avatar active={peer?.active} selected={selectedPeer?.uid === peer.uid} bot={!!peer?.bot} className="size-16">
                                                  <AvatarImage src={peer.avatar} alt={peer.username} />
                                                  <AvatarFallback />
                                              </Avatar>
                                              <span className="text-sm font-bold truncate max-w-20">{formatUserDisplay(peer, true)}</span>
                                          </Button>
                                      ))}
                                  </div>
                              ) : (
                                  <div className="flex justify-center py-1.5 text-muted">{query ? 'no result' : 'search for a user'}</div>
                              )}
                          </div>
                      </div>
                  </div>,
                  document.body
              )
            : null;

    return (
        <>
            <Button
                ref={triggerRef}
                type="button"
                aria-expanded={popoverOpen}
                aria-haspopup="dialog"
                onClick={() => handlePopoverOpenChange(!popoverOpen)}
                onKeyDown={handleTriggerKeyDown}
                className={`group button-outline w-full justify-between ${className || ''}`}
                disabled={disabled}
            >
                {selectedPeer ? (
                    <span className="flex min-w-0 items-center gap-3.5">
                        <Avatar active={selectedPeer?.active} bot={!!selectedPeer?.bot} className="size-9">
                            <AvatarImage src={selectedPeer.avatar} alt={selectedPeer.username} />
                            <AvatarFallback />
                        </Avatar>
                        <span className="truncate text-lg font-bold">{formatUserDisplay(selectedPeer, true)}</span>
                    </span>
                ) : (
                    <span className="flex min-w-0 items-center gap-3 text-muted">
                        <UsersRound className={`size-7 text-foreground transition-opacity ease-out ${popoverOpen ? 'opacity-100' : 'opacity-45 group-hover:opacity-100 group-focus-visible:opacity-100'}`} />
                        {label}
                    </span>
                )}
                <ChevronsUpDown className="size-6 text-muted" />
            </Button>
            {content}
        </>
    );
}
