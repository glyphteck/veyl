import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const base =
    'flex w-full rounded-full bg-background/70 px-2.75 py-1.5 shadow outline-none backdrop-blur-sm placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-50';

const Input = forwardRef(({ className, start, end, startPad = 'pl-9.5', endPad = 'pr-10.5', startPos = 'left-3 top-1/2 -translate-y-1/2', endPos = 'right-3 top-1/2 -translate-y-1/2', ...props }, ref) => {
    const hasStart = !!start;
    const hasEnd = !!end;

    if (!hasStart && !hasEnd) {
        return <input ref={ref} className={cn(base, className)} {...props} />;
    }

    return (
        <div className="relative w-full">
            <input ref={ref} className={cn(base, hasStart && startPad, hasEnd && endPad, className)} {...props} />
            {hasStart ? <div className={cn('absolute flex items-center', startPos)}>{start}</div> : null}
            {hasEnd ? <div className={cn('absolute flex items-center', endPos)}>{end}</div> : null}
        </div>
    );
});

Input.displayName = 'Input';

export { Input };
