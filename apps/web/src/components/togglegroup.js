'use client';

import * as React from 'react';

import { listNavigationStep } from '@/lib/focus';
import { cn } from '@/lib/classes';

const ToggleGroupContext = React.createContext(null);

const rootClasses = 'shadow flex w-fit items-center rounded-full bg-background/60 backdrop-blur-sm';
const itemClasses =
    'font-black cursor-pointer bg-transparent text-foreground backdrop-blur-sm transition-colors ease-in-out inline-flex items-center justify-center gap-2 whitespace-nowrap h-9 min-w-9 rounded-none p-2 first:pl-2.5 last:pr-2.5 outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=off]:hover:bg-foreground/5 data-[state=off]:focus-visible:bg-foreground/5 [&_svg]:pointer-events-none [&_svg]:shrink-0 border-l first:border-l-0 first:rounded-l-full last:rounded-r-full focus:z-10 focus-visible:z-10';

function ToggleGroup({ className, type = 'single', value, onValueChange, disabled = false, required = false, children, ...props }) {
    const currentValue = type === 'multiple' ? (Array.isArray(value) ? value : []) : value ?? '';

    return (
        <ToggleGroupContext.Provider value={{ disabled, onValueChange, required, type, value: currentValue }}>
            <div role={type === 'single' ? 'radiogroup' : 'group'} aria-disabled={disabled || undefined} className={cn(rootClasses, className)} {...props}>
                {children}
            </div>
        </ToggleGroupContext.Provider>
    );
}

function ToggleGroupItem({ className, children, disabled = false, onClick, onKeyDown, value, ...props }) {
    const group = React.useContext(ToggleGroupContext);
    const active = group?.type === 'multiple' ? group.value.includes(value) : group?.value === value;

    const handleClick = (event) => {
        onClick?.(event);
        if (event.defaultPrevented || disabled || group?.disabled) {
            return;
        }

        if (group?.type === 'multiple') {
            const nextValue = active ? group.value.filter((item) => item !== value) : [...group.value, value];
            group.onValueChange?.(nextValue);
            return;
        }

        if (active) {
            if (!group?.required) {
                group?.onValueChange?.('');
            }
            return;
        }

        group?.onValueChange?.(value);
    };

    const handleKeyDown = (event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || !group) {
            return;
        }

        const parent = event.currentTarget.parentElement;
        if (!parent) {
            return;
        }

        const buttons = [...parent.querySelectorAll('button[type="button"]')].filter((button) => !button.disabled);
        const index = buttons.indexOf(event.currentTarget);

        if (index === -1 || !buttons.length) {
            return;
        }

        const step = listNavigationStep(event, { ignoreEditable: false });
        const nextIndex =
            step > 0
                ? (index + 1) % buttons.length
                : step < 0
                  ? (index - 1 + buttons.length) % buttons.length
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? buttons.length - 1
                      : null;

        if (nextIndex == null) return;

        event.preventDefault();
        const nextButton = buttons[nextIndex];
        nextButton.focus();

        if (group.type === 'single') {
            nextButton.click();
        }
    };

    return (
        <button
            type="button"
            role={group?.type === 'single' ? 'radio' : undefined}
            aria-checked={group?.type === 'single' ? active : undefined}
            aria-pressed={group?.type === 'multiple' ? active : undefined}
            data-state={active ? 'on' : 'off'}
            disabled={disabled || group?.disabled}
            className={cn(itemClasses, active && 'cursor-default bg-foreground text-background', className)}
            onClick={handleClick}
            onKeyDown={handleKeyDown}
            {...props}
        >
            {children}
        </button>
    );
}

export { ToggleGroup, ToggleGroupItem };
