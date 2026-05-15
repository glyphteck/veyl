import { useMemo, useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/button';
import { Command, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty } from '@/components/command';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/avatar';
import { ChevronsUpDown, Check, Loader, UsersRound } from 'lucide-react';
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
    const { peers } = usePeer();
    const triggerRef = useRef(null);
    const contentRef = useRef(null);
    const commandInputRef = useRef(null);
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
            commandInputRef.current?.focus();
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
                      <Command className="max-h-71" shouldFilter={false}>
                          <CommandInput ref={commandInputRef} value={searchValue} onValueChange={handleSearchChange} onKeyDown={handleKeyDown} />
                          <CommandList>
                              {searching && query && (
                                  <CommandEmpty>
                                      <Loader className="animate-spin size-6" />
                                  </CommandEmpty>
                              )}
                              {!searching && query && !peerResults.length && <CommandEmpty>no result</CommandEmpty>}
                              {!query && <CommandEmpty>find a username</CommandEmpty>}
                              {query && peerResults.length > 0 && (
                                  <CommandGroup>
                                      {peerResults.map((peer) => {
                                          const displayName = formatUserDisplay(peer, true);
                                          return (
                                              <CommandItem key={peer.uid} value={`@${peer.username}`} onSelect={() => handlePeerSelect(peer)}>
                                                  <Avatar active={peer?.active} bot={!!peer?.bot}>
                                                      <AvatarImage src={peer.avatar} alt={peer.username} />
                                                      <AvatarFallback />
                                                  </Avatar>
                                                  <span>{displayName}</span>
                                                  {selectedPeer?.uid === peer.uid && <Check className="ml-auto" />}
                                              </CommandItem>
                                          );
                                      })}
                                  </CommandGroup>
                              )}
                          </CommandList>
                      </Command>
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
