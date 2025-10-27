import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { format } from "date-fns";

import type { QcmSeriesPoint } from "@/types";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

const SERIES_LABELS: Record<string, string> = {
  content: "Content",
  node: "Node",
  social: "Social",
};

const SERIES_COLORS: Record<string, string> = {
  content: "hsl(326,71%,62%)",
  node: "hsl(174,59%,56%)",
  social: "hsl(208,88%,62%)",
};

interface QCMChartProps {
  series: Record<string, QcmSeriesPoint[]>;
  isLoading?: boolean;
  emptyMessage?: string;
}

interface ChartDatum {
  timestamp: string;
  label: string;
  [seriesName: string]: string | number;
}

export function QCMChart({ series, isLoading, emptyMessage = "No activity spikes recorded yet" }: QCMChartProps) {
  const keys = useMemo(() => Object.keys(series).filter((key) => series[key]?.length), [series]);

  const chartConfig = useMemo(() => {
    if (!keys.length) {
      return {};
    }

    return keys.reduce<Record<string, { label: string; color: string }>>((acc, key) => {
      acc[key] = {
        label: SERIES_LABELS[key] ?? key,
        color: SERIES_COLORS[key] ?? "hsl(245,70%,62%)",
      };
      return acc;
    }, {});
  }, [keys]);

  const data = useMemo(() => {
    const grouped = new Map<string, ChartDatum>();

    for (const key of keys) {
      const points = [...(series[key] ?? [])].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      for (const point of points) {
        const existing = grouped.get(point.recordedAt);
        let label: string;
        try {
          label = format(new Date(point.recordedAt), "MMM d");
        } catch (error) {
          console.warn("[QCMChart] Failed to format timestamp", error);
          label = point.recordedAt;
        }
        if (!existing) {
          grouped.set(point.recordedAt, {
            timestamp: point.recordedAt,
            label,
            [key]: point.value,
          });
        } else {
          existing[key] = point.value;
        }
      }
    }

    return Array.from(grouped.values()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [keys, series]);

  if (isLoading) {
    return (
      <div className="h-64 w-full animate-pulse rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.45)]" />
    );
  }

  if (!keys.length || !data.length) {
    return (
      <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-12 text-center text-sm text-foreground/60 backdrop-blur-xl">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ChartContainer config={chartConfig} className="h-[320px] w-full rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.45)] p-4 backdrop-blur-xl">
      <AreaChart data={data} margin={{ top: 16, right: 16, left: 8, bottom: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsla(245,70%,80%,0.12)" />
        <XAxis dataKey="label" stroke="hsla(245,70%,80%,0.4)" tickLine={false} axisLine={false} />
        <YAxis stroke="hsla(245,70%,80%,0.4)" tickLine={false} axisLine={false} width={48} />
        <ChartTooltip content={<ChartTooltipContent indicator="dot" />} cursor={{ stroke: "hsla(245,70%,80%,0.25)" }} />
        <ChartLegend content={<ChartLegendContent />} />
        {keys.map((key) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            stroke={`var(--color-${key})`}
            fill={`var(--color-${key})`}
            fillOpacity={0.18}
            strokeWidth={2}
            dot={{ strokeWidth: 1, r: 3 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
