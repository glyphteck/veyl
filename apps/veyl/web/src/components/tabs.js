'use client';

import * as React from 'react';

import { cn } from '@/lib/classes';

const TabsContext = React.createContext(null);

function Tabs({ className, value: valueProp, defaultValue, onValueChange, children, ...props }) {
    const [uncontrolledValue, setUncontrolledValue] = React.useState(defaultValue ?? null);
    const value = valueProp !== undefined ? valueProp : uncontrolledValue;

    const setValue = React.useCallback(
        (nextValue) => {
            if (valueProp === undefined) {
                setUncontrolledValue(nextValue);
            }
            onValueChange?.(nextValue);
        },
        [onValueChange, valueProp]
    );

    return (
        <TabsContext.Provider value={{ value, setValue }}>
            <div className={cn('flex flex-col gap-2', className)} {...props}>
                {children}
            </div>
        </TabsContext.Provider>
    );
}

function TabsList({ className, ...props }) {
    return <div role="tablist" className={cn('shadow inline-flex items-center justify-center rounded-full', className)} {...props} />;
}

function TabsTrigger({ className, value, disabled = false, onClick, children, ...props }) {
    const tabs = React.useContext(TabsContext);
    const active = tabs?.value === value;

    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            data-state={active ? 'active' : 'inactive'}
            disabled={disabled}
            className={cn(
                'gap-2 bg-background/70 text-lg outline-none cursor-pointer inline-flex flex-1 items-center justify-center rounded-none first:rounded-l-full last:rounded-r-full py-1.5 whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0 group',
                active && 'bg-foreground text-background',
                className
            )}
            onClick={(event) => {
                onClick?.(event);
                if (!event.defaultPrevented && !disabled) {
                    tabs?.setValue(value);
                }
            }}
            {...props}
        >
            {children}
        </button>
    );
}

function TabsContent({ className, value, ...props }) {
    const tabs = React.useContext(TabsContext);

    if (tabs?.value !== value) {
        return null;
    }

    return <div role="tabpanel" data-state="active" className={cn('flex-1 outline-none', className)} {...props} />;
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
