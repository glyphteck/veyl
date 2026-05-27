'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { listNavigationStep } from '@/lib/focus';
import { cn } from '@/lib/utils';

const DropdownMenuContext = React.createContext(null);

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function composeEventHandlers(theirs, ours) {
    return (event) => {
        theirs?.(event);
        ours?.(event);
    };
}

function DropdownMenu({ open: openProp, onOpenChange, children }) {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
    const open = openProp ?? uncontrolledOpen;
    const triggerRef = React.useRef(null);
    const contentRef = React.useRef(null);
    const previousFocusRef = React.useRef(null);

    const setOpen = React.useCallback(
        (nextOpen) => {
            const value = typeof nextOpen === 'function' ? nextOpen(open) : nextOpen;
            if (openProp === undefined) {
                setUncontrolledOpen(value);
            }
            onOpenChange?.(value);
        },
        [open, openProp, onOpenChange]
    );

    React.useEffect(() => {
        if (open) {
            previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            return;
        }

        previousFocusRef.current?.focus?.({ preventScroll: true });
        previousFocusRef.current = null;
    }, [open]);

    React.useEffect(() => {
        if (!open) {
            return;
        }

        const handlePointerDown = (event) => {
            const target = event.target;
            if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) {
                return;
            }
            setOpen(false);
        };

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                setOpen(false);
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
    }, [open, setOpen]);

    return <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef, contentRef }}>{children}</DropdownMenuContext.Provider>;
}

const DropdownMenuTrigger = React.forwardRef(function DropdownMenuTrigger({ asChild = false, onClick, onKeyDown, children, ...props }, ref) {
    const menu = React.useContext(DropdownMenuContext);

    const setRefs = React.useCallback(
        (node) => {
            menu.triggerRef.current = node;
            if (typeof ref === 'function') {
                ref(node);
            } else if (ref) {
                ref.current = node;
            }
        },
        [menu, ref]
    );

    const handleClick = React.useCallback(() => {
        menu?.setOpen((prev) => !prev);
    }, [menu]);

    const handleKeyDown = React.useCallback(
        (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                menu?.setOpen((prev) => !prev);
            }
            const step = listNavigationStep(event, { ignoreEditable: false });
            if (step > 0) {
                event.preventDefault();
                menu?.setOpen(true);
            }
        },
        [menu]
    );

    if (asChild) {
        const child = React.Children.only(children);

        if (!React.isValidElement(child)) {
            return null;
        }

        return React.cloneElement(child, {
            ...props,
            ...child.props,
            ref: setRefs,
            'aria-expanded': menu?.open,
            'aria-haspopup': 'menu',
            onClick: composeEventHandlers(child.props.onClick, composeEventHandlers(onClick, handleClick)),
            onKeyDown: composeEventHandlers(child.props.onKeyDown, composeEventHandlers(onKeyDown, handleKeyDown)),
        });
    }

    return (
        <button
            ref={setRefs}
            type="button"
            aria-expanded={menu?.open}
            aria-haspopup="menu"
            onClick={composeEventHandlers(onClick, handleClick)}
            onKeyDown={composeEventHandlers(onKeyDown, handleKeyDown)}
            {...props}
        >
            {children}
        </button>
    );
});

const DropdownMenuContent = React.forwardRef(function DropdownMenuContent({ className, initialFocusIndex = 0, sideOffset = 6, style, ...props }, ref) {
    const menu = React.useContext(DropdownMenuContext);
    const contentRef = React.useRef(null);
    const [mounted, setMounted] = React.useState(false);
    const [position, setPosition] = React.useState(null);
    const [shown, setShown] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    const setRefs = React.useCallback(
        (node) => {
            contentRef.current = node;
            menu.contentRef.current = node;
            if (typeof ref === 'function') {
                ref(node);
            } else if (ref) {
                ref.current = node;
            }
        },
        [menu, ref]
    );

    const updatePosition = React.useCallback(() => {
        if (!menu?.triggerRef?.current || !contentRef.current) {
            return;
        }

        const gap = 8;
        const triggerRect = menu.triggerRef.current.getBoundingClientRect();
        const contentHeight = contentRef.current.offsetHeight || 0;
        const contentWidth = contentRef.current.offsetWidth || 0;
        const top = clamp(triggerRect.bottom + sideOffset, gap, window.innerHeight - contentHeight - gap);
        const right = Math.max(gap, window.innerWidth - triggerRect.right);
        const left = window.innerWidth - right - contentWidth;
        const originX = triggerRect.left + triggerRect.width / 2 - left;
        const originY = triggerRect.top + triggerRect.height / 2 - top;

        setPosition({ top, right, origin: `${originX}px ${originY}px` });
    }, [menu, sideOffset]);

    React.useLayoutEffect(() => {
        if (!menu?.open) {
            setShown(false);
            return;
        }

        updatePosition();

        let secondFrame;
        const firstFrame = requestAnimationFrame(() => {
            secondFrame = requestAnimationFrame(() => setShown(true));
        });

        return () => {
            cancelAnimationFrame(firstFrame);
            if (secondFrame) {
                cancelAnimationFrame(secondFrame);
            }
        };
    }, [menu?.open, updatePosition]);

    const getItems = React.useCallback(() => {
        if (!contentRef.current) {
            return [];
        }

        return Array.from(contentRef.current.querySelectorAll('[data-dropdown-item]:not(:disabled)'));
    }, []);

    const focusItem = React.useCallback(
        (index) => {
            const items = getItems();
            if (!items.length) {
                return;
            }

            const nextIndex = ((index % items.length) + items.length) % items.length;
            const item = items[nextIndex];
            item?.focus({ preventScroll: true });
            item?.scrollIntoView({ block: 'nearest' });
        },
        [getItems]
    );

    React.useLayoutEffect(() => {
        if (!menu?.open) {
            return;
        }

        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [menu?.open, updatePosition]);

    React.useEffect(() => {
        if (!menu?.open || !contentRef.current) {
            return;
        }

        focusItem(initialFocusIndex);
    }, [focusItem, initialFocusIndex, menu?.open]);

    const handleKeyDown = React.useCallback(
        (event) => {
            const items = getItems();
            if (!items.length) {
                return;
            }

            const currentIndex = items.indexOf(document.activeElement);
            const startIndex = currentIndex === -1 ? 0 : currentIndex;

            const step = listNavigationStep(event, { ignoreEditable: false });
            if (step) {
                event.preventDefault();
                focusItem(startIndex + step);
            } else if (event.key === 'Home') {
                event.preventDefault();
                focusItem(0);
            } else if (event.key === 'End') {
                event.preventDefault();
                focusItem(items.length - 1);
            } else if (event.key === 'Tab') {
                menu?.setOpen(false);
            }
        },
        [focusItem, getItems, menu]
    );

    if (!mounted) {
        return null;
    }

    const active = menu?.open && shown;
    const opacityTransition = active ? 'opacity 90ms cubic-bezier(0.2, 0, 0, 1)' : 'opacity 220ms cubic-bezier(0.2, 0, 0, 1)';

    return createPortal(
        <div
            ref={setRefs}
            role="menu"
            aria-hidden={!menu?.open}
            className={cn(
                'fixed z-30 min-w-48 overflow-y-auto rounded-round bg-background/70 shadow backdrop-blur-sm outline-none',
                active ? 'opacity-100' : 'pointer-events-none opacity-0',
                className
            )}
            style={{
                top: position?.top ?? -1000,
                right: position?.right ?? 8,
                transform: active ? 'translate3d(0, 0, 0) scale(1)' : 'translate3d(0, 0, 0) scale(0.88)',
                transformOrigin: position?.origin ?? 'top right',
                transition: `${opacityTransition}, transform var(--default-transition-duration) cubic-bezier(0.2, 0, 0, 1)`,
                willChange: 'opacity, transform',
                ...style,
            }}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleKeyDown}
            {...props}
        />,
        document.body
    );
});

function DropdownMenuItem({ className, onClick, onMouseMove, onSelect, disabled = false, children, ...props }) {
    const menu = React.useContext(DropdownMenuContext);

    return (
        <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            data-dropdown-item=""
            disabled={disabled}
            className={cn(
                'relative flex w-full cursor-pointer select-none items-center gap-2 px-3 py-2 text-left outline-none disabled:pointer-events-none disabled:opacity-50 [&>*:nth-child(-n+2)]:transition-transform [&>*:nth-child(-n+2)]:ease-out hover:[&>*:nth-child(-n+2)]:translate-x-3 focus:[&>*:nth-child(-n+2)]:translate-x-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:text-inherit',
                className
            )}
            onMouseMove={(event) => {
                onMouseMove?.(event);
                if (!disabled && event.currentTarget !== document.activeElement) {
                    event.currentTarget.focus({ preventScroll: true });
                }
            }}
            onClick={(event) => {
                onSelect?.(event);
                onClick?.(event);
                if (!event.defaultPrevented) {
                    menu?.setOpen(false);
                }
            }}
            {...props}
        >
            {children}
        </button>
    );
}

function DropdownMenuLabel({ className, ...props }) {
    return <div className={cn('px-3 py-2 text-xl font-black', className)} {...props} />;
}

function DropdownMenuSeparator({ className, ...props }) {
    return <div role="separator" className={cn('bg-border h-px', className)} {...props} />;
}

function DropdownMenuShortcut({ className, ...props }) {
    return <span className={cn('ml-auto text-sm font-black tracking-widest text-muted', className)} {...props} />;
}

export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut };
