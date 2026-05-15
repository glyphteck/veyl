'use client';

import { useTheme } from 'next-themes';
import { Toaster } from 'sonner';

export function Notifications(props) {
    const { theme = 'system' } = useTheme();

    return (
        <Toaster
            theme={theme}
            unstyled
            className="z-50 flex justify-center"
            toastOptions={{
                unstyled: true,
                classNames: {
                    toast: 'min-w-50 max-w-96 flex items-center gap-3 rounded-round bg-background/70 p-4 shadow backdrop-blur-sm',
                    title: 'font-black',
                    description: 'text-sm !text-muted',
                    icon: '[&>svg]:size-5',
                },
            }}
            {...props}
        />
    );
}
