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
                    toast: 'veyl-toast flex w-fit min-w-0 max-w-96 items-center gap-3 rounded-round bg-background/70 px-4 py-3 shadow backdrop-blur-sm',
                    content: 'min-w-0',
                    title: 'text-base font-black leading-tight',
                    description: 'text-sm !text-muted',
                    icon: '[&>svg]:size-5',
                },
            }}
            {...props}
        />
    );
}
