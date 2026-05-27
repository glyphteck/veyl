import { Loader } from 'lucide-react';

export function LoadingScreen({ overlay = false }) {
    const shellClass = overlay ? 'absolute inset-0 z-40 bg-background/70 backdrop-blur-sm' : 'fixed inset-0 z-50 bg-background text-foreground';

    return (
        <div className={`${shellClass} flex items-center justify-center`} role="status" aria-busy="true">
            <div className="flex items-center">
                <Loader className="size-8 animate-spin" />
            </div>
        </div>
    );
}

export default function Loading(props) {
    return <LoadingScreen {...props} />;
}
