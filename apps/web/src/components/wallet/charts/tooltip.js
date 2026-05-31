import { cn } from '@/lib/classes';

export function ChartTooltip({ tip }) {
    if (!tip?.label || !tip?.value) {
        return null;
    }

    const { label, value, colors, left, top, placement = 'top' } = tip;

    return (
        <div
            className={cn(
                'bg-background/70 pointer-events-none absolute z-50 -translate-x-1/2 rounded-round px-3 py-2 shadow backdrop-blur-sm whitespace-nowrap',
                placement === 'top' && '-translate-y-full'
            )}
            style={{
                left,
                top,
            }}
        >
            <div className="text-sm" style={{ color: colors.muted }}>
                {label}
            </div>
            <div className="font-black">{value}</div>
        </div>
    );
}
