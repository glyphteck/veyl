'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useTheme } from 'next-themes';
import { cn, formatDate, formatHour, renderMoney } from '@/lib/utils';
import { getChartColors, getChartDomain } from '@/components/wallet/charts/common';
import { ChartTooltip } from '@/components/wallet/charts/tooltip';

const ReactECharts = dynamic(() => import('echarts-for-react').then((mod) => mod.default), {
    ssr: false,
});
const grid = {
    left: 32,
    right: 32,
    top: 12,
    bottom: 30,
};

function getKey(point, hourly) {
    return hourly ? point.hour : point.date;
}

function formatLabel(value, hourly) {
    return hourly ? formatHour(value) : formatDate(value);
}

export function BalanceChart({ data = [], timeRange, moneyFormat, bitcoin, showAxis = true, className }) {
    const { resolvedTheme } = useTheme();
    const chartRef = useRef(null);
    const [tip, setTip] = useState(null);
    const hourly = timeRange === 'today' || timeRange === '24h';
    const colors = useMemo(() => getChartColors(), [resolvedTheme]);
    const values = useMemo(() => data.map((point) => Number(point.balance)), [data]);
    const [min, max] = useMemo(() => getChartDomain(values), [values]);
    const axisLabels = useMemo(() => {
        if (!showAxis || !data.length) return null;
        const first = formatLabel(getKey(data[0], hourly), hourly);
        const lastPoint = data[data.length - 1];
        const last = data.length > 1 ? formatLabel(getKey(lastPoint, hourly), hourly) : '';
        return { first, last };
    }, [data, hourly, showAxis]);

    const hideTip = useCallback(() => {
        setTip(null);
    }, []);

    const handleChartReady = useCallback((chart) => {
        chartRef.current = chart;
    }, []);

    const showTip = useCallback(
        (event) => {
            const chart = chartRef.current;
            if (!chart || !data.length) {
                hideTip();
                return;
            }

            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const width = chart.getWidth();
            const height = chart.getHeight();
            const plotWidth = Math.max(width - grid.left - grid.right, 1);
            const plotHeight = Math.max(height - grid.top - grid.bottom, 1);
            const spread = max - min || 1;
            const points = data
                .map((point, index) => {
                    const label = getKey(point, hourly);
                    const value = Number(point.balance);
                    const step = data.length > 1 ? plotWidth / (data.length - 1) : 0;
                    return {
                        point,
                        label,
                        x: grid.left + step * index,
                        y: grid.top + ((max - value) / spread) * plotHeight,
                    };
                })
                .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

            if (!points.length) {
                hideTip();
                return;
            }

            const nearest = points.reduce((best, point) => {
                if (!best) {
                    return point;
                }
                return Math.abs(point.x - x) < Math.abs(best.x - x) ? point : best;
            }, null);
            const gap = points.slice(1).reduce((best, point, index) => {
                const prev = points[index];
                const next = Math.abs(point.x - prev.x);
                return next > 0 && next < best ? next : best;
            }, Infinity);
            const threshold = Number.isFinite(gap) ? Math.max(12, gap / 2) : 24;

            if (!nearest || Math.abs(nearest.x - x) > threshold) {
                hideTip();
                return;
            }

            const nudge = nearest.x < width / 2 ? 24 : -24;
            const nudgedLeft = Math.min(Math.max(nearest.x + nudge, 32), width - 32);

            setTip({
                label: formatLabel(nearest.label, hourly),
                value: renderMoney(nearest.point.balance, moneyFormat, bitcoin?.price),
                colors,
                left: nudgedLeft,
                top: nearest.y < height / 2 ? nearest.y + 18 : Math.max(nearest.y - 18, 20),
                placement: nearest.y < height / 2 ? 'bottom' : 'top',
            });
        },
        [bitcoin?.price, colors, data, hideTip, hourly, max, min, moneyFormat]
    );

    const option = useMemo(() => {
        const labels = data.map((point) => getKey(point, hourly));

        return {
            animationDuration: 250,
            grid,
            xAxis: {
                type: 'category',
                boundaryGap: false,
                data: labels,
                axisLine: { show: false },
                axisTick: { show: false },
                splitLine: { show: false },
                axisPointer: { show: false },
                axisLabel: { show: false },
            },
            yAxis: {
                type: 'value',
                show: false,
                min,
                max,
            },
            series: [
                {
                    type: 'line',
                    data: data.map((point) => ({
                        value: Number(point.balance),
                        point,
                    })),
                    silent: true,
                    smooth: false,
                    showSymbol: true,
                    symbol: 'circle',
                    symbolSize: 14,
                    lineStyle: {
                        color: colors.foreground,
                        width: 2.5,
                    },
                    itemStyle: {
                        color: colors.foreground,
                        borderColor: colors.background,
                        borderWidth: 4,
                    },
                    emphasis: {
                        disabled: true,
                    },
                    blur: {
                        itemStyle: {
                            color: colors.foreground,
                            borderColor: colors.background,
                            borderWidth: 4,
                        },
                        lineStyle: {
                            color: colors.foreground,
                            width: 2.5,
                            opacity: 1,
                        },
                    },
                },
            ],
        };
    }, [colors, data, hourly]);

    return (
        <div className={cn('relative h-full w-full min-h-24', className)} onMouseMove={showTip} onMouseLeave={hideTip}>
            <ChartTooltip tip={tip} />
            <ReactECharts option={option} notMerge lazyUpdate onChartReady={handleChartReady} style={{ height: '100%', width: '100%' }} />
            {axisLabels ? (
                <div className="pointer-events-none absolute right-2 bottom-2 left-2 flex items-end justify-between text-[13px] leading-none font-black text-muted">
                    <span>{axisLabels.first}</span>
                    {axisLabels.last ? <span>{axisLabels.last}</span> : null}
                </div>
            ) : null}
        </div>
    );
}
