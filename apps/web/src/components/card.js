import { cn } from '@/lib/classes';

function Card({ className, ...props }) {
    return <div className={cn('flex h-full w-full flex-col overflow-hidden rounded-round bg-background/70 shadow backdrop-blur-sm', className)} {...props} />;
}

export { Card };
