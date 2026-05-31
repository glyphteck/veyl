import { cn } from '@/lib/classes';

export function Shortcut({ className, ...props }) {
    return <span className={cn('ml-auto text-sm font-black tracking-widest text-muted', className)} {...props} />;
}
