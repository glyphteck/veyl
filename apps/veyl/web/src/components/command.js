'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { forwardRef } from 'react';

function Command({ className, ...props }) {
    return <CommandPrimitive loop className={cn('shadow bg-background/70 backdrop-blur-sm flex flex-col w-full h-full rounded-round', className)} {...props} />;
}

const CommandInput = forwardRef(({ className, ...props }, ref) => {
    return (
        <div className="flex items-center gap-2 border-b px-3">
            <Search className="text-muted" />
            <CommandPrimitive.Input ref={ref} className={cn('flex py-1.5 w-full disabled:cursor-not-allowed disabled:opacity-50', className)} {...props} />
        </div>
    );
});
CommandInput.displayName = 'CommandInput';

function CommandList({ className, ...props }) {
    return (
        <CommandPrimitive.List
            className={cn('overflow-y-auto', className)}
            onWheel={(e) => {
                e.stopPropagation();
            }}
            {...props}
        />
    );
}

function CommandEmpty({ ...props }) {
    return <CommandPrimitive.Empty className="py-1.5 flex justify-center text-muted" {...props} />;
}

function CommandGroup({ className, ...props }) {
    return (
        <CommandPrimitive.Group
            className={cn(
                '**:[[cmdk-group-heading]]:font-black **:[[cmdk-group-heading]]:text-muted **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-2 **:[[cmdk-group-heading]]:sr-only',
                className
            )}
            {...props}
        />
    );
}

function CommandSeparator({ className, ...props }) {
    return <CommandPrimitive.Separator className={cn('bg-border h-px', className)} {...props} />;
}

function CommandItem({ className, ...props }) {
    return (
        <CommandPrimitive.Item
            className={cn(
                'cursor-pointer relative flex items-center gap-2 px-3 py-1.5 text-base select-none outline-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&>*:nth-child(-n+2)]:transition-transform [&>*:nth-child(-n+2)]:ease-out hover:[&>*:nth-child(-n+2)]:translate-x-3 focus:[&>*:nth-child(-n+2)]:translate-x-3 data-[selected=true]:[&>*:nth-child(-n+2)]:translate-x-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&>*.avatar]:size-6',
                className
            )}
            {...props}
        />
    );
}

function CommandShortcut({ className, ...props }) {
    return <span className={cn('text-muted ml-auto text-sm tracking-widest font-black', className)} {...props} />;
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut, CommandSeparator };
