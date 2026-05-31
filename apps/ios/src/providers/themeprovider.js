import { createContext, useContext } from 'react';
import { useColorScheme } from 'react-native';
import { getColorScheme } from '../lib/colors';

const ThemeContext = createContext();

export function ThemeProvider({ children }) {
    const colorScheme = useColorScheme();
    const isDark = colorScheme === 'dark';
    const theme = getColorScheme(isDark);

    return <ThemeContext.Provider value={{ theme, isDark }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
