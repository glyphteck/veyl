export function alpha(color, percent) {
    return color.replace(/[\d.]+\)$/, `${percent / 100})`);
}

export const colors = {
    light: {
        background: 'rgba(255, 255, 255, 1)',
        glassTint: 'rgba(252, 252, 252, 1)',
        foreground: 'rgba(0, 0, 0, 1)',
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
        background: 'rgba(0, 0, 0, 1)',
        glassTint: 'rgba(0, 0, 0, 1)',
        foreground: 'rgba(252, 252, 252, 1)',
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
