/**
 * Shared Marketing chart wrappers over Recharts (already in the project).
 * Keep vendor-specific usage out of feature pages.
 *
 * Important: always wrap ResponsiveContainer in a fixed-height, overflow-hidden
 * box. Unclipped chart/legend overflow is a common cause of huge empty page scroll.
 */

import React from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const COLORS = ['#0f766e', '#0369a1', '#b45309', '#be123c', '#7c3aed', '#15803d', '#475569', '#c2410c'];

type SeriesKey = { dataKey: string; name: string; color?: string };

type CommonProps = {
  data: Record<string, string | number>[];
  height?: number;
  ariaLabel: string;
  description?: string;
};

function ChartFrame({
  height,
  ariaLabel,
  description,
  children,
}: {
  height: number;
  ariaLabel: string;
  description?: string;
  children: React.ReactElement;
}) {
  return (
    <div role="img" aria-label={ariaLabel} className="w-full min-w-0">
      {description ? <p className="sr-only">{description}</p> : null}
      <div className="w-full min-w-0 overflow-hidden" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" debounce={50}>
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function MarketingLineChart({
  data,
  series,
  xKey = 'period',
  height = 280,
  ariaLabel,
  description,
}: CommonProps & { series: SeriesKey[]; xKey?: string }) {
  return (
    <ChartFrame height={height} ariaLabel={ariaLabel} description={description}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={40} />
        <Tooltip />
        <Legend />
        {series.map((s) => (
          <Line
            key={s.dataKey}
            type="monotone"
            dataKey={s.dataKey}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

export function MarketingBarChart({
  data,
  series,
  xKey = 'label',
  height = 280,
  ariaLabel,
  description,
}: CommonProps & { series: SeriesKey[]; xKey?: string }) {
  return (
    <ChartFrame height={height} ariaLabel={ariaLabel} description={description}>
      <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: '#64748b' }} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} width={40} />
        <Tooltip />
        <Legend />
        {series.map((s, i) => (
          <Bar
            key={s.dataKey}
            dataKey={s.dataKey}
            name={s.name}
            fill={s.color || COLORS[i % COLORS.length]}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

export function MarketingPieChart({
  data,
  nameKey = 'label',
  valueKey = 'count',
  height = 260,
  ariaLabel,
  description,
}: CommonProps & { nameKey?: string; valueKey?: string }) {
  const filtered = data.filter((row) => Number(row[valueKey]) > 0);
  return (
    <ChartFrame height={height} ariaLabel={ariaLabel} description={description}>
      <PieChart>
        <Pie
          data={filtered}
          dataKey={valueKey}
          nameKey={nameKey}
          cx="50%"
          cy="50%"
          innerRadius={50}
          outerRadius={90}
          paddingAngle={2}
          isAnimationActive={false}
        >
          {filtered.map((_, index) => (
            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ChartFrame>
  );
}
