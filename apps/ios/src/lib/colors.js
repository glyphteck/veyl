export function alpha(color, percent) {
    return color.replace(/[\d.]+\)$/, `${percent / 100})`);
}

const GLASS_BACKGROUND_OPACITY = 75;
const GLASS_FOREGROUND_OPACITY = 90;
const INPUT_GLASS_BACKGROUND_OPACITY = 25;
const DISABLED_GLASS_BACKGROUND_OPACITY = 10;
const lightBackground = 'rgba(254, 254, 254, 1)';
const lightGlassBackground = 'rgba(252, 252, 252, 1)';
const lightForeground = 'rgba(0, 0, 0, 1)';
const darkBackground = 'rgba(0, 0, 0, 1)';
const darkForeground = 'rgba(252, 252, 252, 1)';

export function inputGlassTint(theme) {
    return alpha(theme.background, INPUT_GLASS_BACKGROUND_OPACITY);
}

export function disabledGlassTint(theme) {
    return alpha(theme.background, DISABLED_GLASS_BACKGROUND_OPACITY);
}

export const colors = {
    light: {
        background: lightBackground,
        glassBackground: alpha(lightGlassBackground, GLASS_BACKGROUND_OPACITY),
        foreground: lightForeground,
        glassForeground: alpha(lightForeground, GLASS_FOREGROUND_OPACITY),
        muted: 'rgba(128, 128, 128, 1)',
        destructive: 'rgba(185, 0, 8, 1)',
        alert: 'rgba(185, 0, 8, 1)',
        border: 'rgba(228, 228, 228, 1)',
        active: 'rgba(0, 195, 11, 1)',
        inflow: 'rgba(0, 99, 0, 1)',
        outflow: 'rgba(184, 0, 35, 1)',
        bitcoin: 'rgba(241, 88, 0, 1)',
        shadow: 'rgba(206, 206, 206, 1)',
    },
    dark: {
        background: darkBackground,
        glassBackground: alpha(darkBackground, GLASS_BACKGROUND_OPACITY),
        foreground: darkForeground,
        glassForeground: alpha(darkForeground, GLASS_FOREGROUND_OPACITY),
        muted: 'rgba(113, 113, 113, 1)',
        destructive: 'rgba(202, 0, 49, 1)',
        alert: 'rgba(202, 0, 49, 1)',
        border: 'rgba(38, 38, 38, 1)',
        active: 'rgba(0, 211, 44, 1)',
        inflow: 'rgba(0, 162, 0, 1)',
        outflow: 'rgba(202, 0, 49, 1)',
        bitcoin: 'rgba(255, 140, 0, 1)',
        shadow: 'rgba(0, 0, 0, 1)',
    },
};

export const getColorScheme = (isDark) => {
    return isDark ? colors.dark : colors.light;
};
