'use client';

import '@/lib/console';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

export function ThemeProvider({ children, ...props }) {
    return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
