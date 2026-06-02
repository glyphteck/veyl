import { forwardRef } from 'react';
import { Input } from '@/components/input';
import { moneyUnitLabel } from '@veyl/shared/money';
import { cn } from '@/lib/classes';

const MoneyAmountInput = forwardRef(function MoneyAmountInput({ className, cloaked = false, disabled = false, unit, onCycleUnit, ...props }, ref) {
    return (
        <div className="relative w-full">
            <Input
                ref={ref}
                className={cn('h-12 min-w-0 pl-4 pr-16 text-2xl font-black', cloaked && 'cloaked', className)}
                placeholder={unit === 'sats' ? '0000' : '0.00'}
                inputMode="numeric"
                pattern={unit === 'sats' ? '[0-9]*' : '[0-9.]*'}
                disabled={disabled}
                {...props}
            />
            <button
                type="button"
                aria-label={`change currency, current ${unit}`}
                title="change currency"
                className="grower absolute top-1/2 right-4.75 m-0 flex h-9 min-w-0 -translate-y-1/2 cursor-pointer appearance-none items-center justify-end border-0 bg-transparent p-0 text-2xl leading-none font-black text-muted disabled:pointer-events-none disabled:opacity-50"
                onMouseDown={(event) => event.preventDefault()}
                onClick={onCycleUnit}
                disabled={disabled}
            >
                {moneyUnitLabel(unit)}
            </button>
        </div>
    );
});

export { MoneyAmountInput };
