import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { ChevronsUpDown, Check, Loader, Search, UsersRound } from 'lucide-react';
import { mergeProfiles } from '@glyphteck/shared/search/merge';
import { formatUserDisplay } from '@/lib/utils';
import { useSearch } from '@/lib/search/usesearch';
import { useUser } from '@/components/providers/userprovider';
import { usePeer } from '@/components/providers/peerprovider';

export default function PeerSelector({ selectedPeer, onPeerChange, disabled = false, active = false, openOnActive = false, filterPeers, label = 'peer', className = '' }) {
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
            if (openOnActive) {
                setPopoverOpen(true);
            }
        }, 0);
        return () => window.clearTimeout(timeout);
    }, [active, disabled, openOnActive]);

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
        }
    };

    const handleTriggerKeyDown = (event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
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
                  >
                      <div className="flex h-full max-h-71 w-full flex-col rounded-round bg-background/70 shadow backdrop-blur-sm">
                          <div className="flex items-center gap-2 border-b px-3">
                              <Search className="text-muted" />
                              <input
                                  ref={searchInputRef}
                                  value={searchValue}
                                  onChange={(event) => handleSearchChange(event.target.value)}
                                  onKeyDown={handleKeyDown}
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
                                  displayPeers.map((peer) => {
                                      const displayName = formatUserDisplay(peer, true);
                                      return (
                                          <button
                                              key={peer.uid}
                                              type="button"
                                              className="relative flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-base outline-none select-none [&>*:nth-child(-n+2)]:transition-transform [&>*:nth-child(-n+2)]:ease-out hover:[&>*:nth-child(-n+2)]:translate-x-3 focus:[&>*:nth-child(-n+2)]:translate-x-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&>*.avatar]:size-6"
                                              onClick={() => handlePeerSelect(peer)}
                                          >
                                              <Avatar active={peer?.active} bot={!!peer?.bot}>
                                                  <AvatarImage src={peer.avatar} alt={peer.username} />
                                                  <AvatarFallback />
                                              </Avatar>
                                              <span>{displayName}</span>
                                              {selectedPeer?.uid === peer.uid && <Check className="ml-auto shrink-0" />}
                                          </button>
                                      );
                                  })
                              ) : (
                                  <div className="flex justify-center py-1.5 text-muted">{query ? 'no result' : 'no recent wallet peers'}</div>
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
                className={`button-outline shrinker justify-between max-w-3xs ${className || ''}`}
                disabled={disabled}
            >
                {selectedPeer ? (
                    <span className="flex items-center gap-2">
                        <Avatar active={selectedPeer?.active} bot={!!selectedPeer?.bot} className="size-6">
                            <AvatarImage src={selectedPeer.avatar} alt={selectedPeer.username} />
                            <AvatarFallback />
                        </Avatar>
                        {formatUserDisplay(selectedPeer, true)}
                    </span>
                ) : (
                    <span className="flex items-center gap-2 text-muted">
                        <UsersRound />
                        {label}
                    </span>
                )}
                <ChevronsUpDown className="text-muted" />
            </Button>
            {content}
        </>
    );
}
