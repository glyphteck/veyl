'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/classes';

const DialogContext = React.createContext(null);
export const DIALOG_CLOSE_MS = 160;

function Dialog({ open = false, present = open, onOpenChange, children }) {
    const previousFocusRef = React.useRef(null);
    const wasOpenRef = React.useRef(open);
    const wasPresentRef = React.useRef(present);
    const state = open ? 'open' : 'closed';

    React.useEffect(() => {
        if (open && !wasOpenRef.current) {
            previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }

        wasOpenRef.current = open;
    }, [open]);

    React.useEffect(() => {
        if (!present && wasPresentRef.current) {
            previousFocusRef.current?.focus?.({ preventScroll: true });
            previousFocusRef.current = null;
        }

        wasPresentRef.current = present;
    }, [present]);

    React.useEffect(() => {
        if (!present) {
            return;
        }

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [present]);

    React.useEffect(() => {
        if (!present) {
            return;
        }

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                onOpenChange?.(false);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [present, onOpenChange]);

    return <DialogContext.Provider value={{ open, present, state, onOpenChange }}>{children}</DialogContext.Provider>;
}

function DialogOverlay({ className, ...props }) {
    const dialog = React.useContext(DialogContext);

    if (!dialog?.present) {
        return null;
    }

    return createPortal(
        <div
            data-state={dialog.state}
            className={cn(
                'fixed inset-0 z-40 bg-background/50 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 fill-mode-both',
                className
            )}
            onClick={() => dialog.onOpenChange?.(false)}
            {...props}
        />,
        document.body
    );
}

const DialogContent = React.forwardRef(function DialogContent({ className, children, onOpenAutoFocus, ...props }, ref) {
    const dialog = React.useContext(DialogContext);
    const contentRef = React.useRef(null);
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    React.useEffect(() => {
        if (!dialog?.open || !contentRef.current) {
            return;
        }

        const event = {
            defaultPrevented: false,
            preventDefault() {
                this.defaultPrevented = true;
            },
        };

        onOpenAutoFocus?.(event);

        if (!event.defaultPrevented) {
            const focusTarget = contentRef.current.querySelector(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            (focusTarget || contentRef.current).focus({ preventScroll: true });
        }
    }, [dialog?.open, onOpenAutoFocus]);

    const setRefs = React.useCallback(
        (node) => {
            contentRef.current = node;
            if (typeof ref === 'function') {
                ref(node);
            } else if (ref) {
                ref.current = node;
            }
        },
        [ref]
    );

    if (!mounted || !dialog?.present) {
        return null;
    }

    const handleKeyDown = (event) => {
        if (event.key !== 'Tab' || !contentRef.current) {
            return;
        }

        const focusables = [...contentRef.current.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
            (node) => !node.hasAttribute('disabled') && node.getAttribute('aria-hidden') !== 'true'
        );

        if (!focusables.length) {
            event.preventDefault();
            contentRef.current.focus({ preventScroll: true });
            return;
        }

        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (event.shiftKey) {
            if (active === first || active === contentRef.current) {
                event.preventDefault();
                last.focus({ preventScroll: true });
            }
            return;
        }

        if (active === last) {
            event.preventDefault();
            first.focus({ preventScroll: true });
        }
    };

    return createPortal(
        <div
            ref={setRefs}
            role="dialog"
            aria-modal="true"
            tabIndex={-1}
            data-state={dialog.state}
            className={cn(
                'fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:pointer-events-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 fill-mode-both',
                className
            )}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={handleKeyDown}
            {...props}
        >
            {children}
        </div>,
        document.body
    );
});

function DialogHeader({ className, ...props }) {
    return <div className={cn('flex w-full items-center', className)} {...props} />;
}

function DialogTitle({ className, ...props }) {
    return <h2 className={cn('text-2xl font-black', className)} {...props} />;
}

function DialogDescription({ className, ...props }) {
    return <p className={cn('text-lg text-muted', className)} {...props} />;
}

export { Dialog, DialogContent, DialogDescription, DialogHeader, DialogOverlay, DialogTitle };
