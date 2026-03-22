import {
  ResponsiveContainer,
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Bar,
  Line,
  CartesianGrid,
} from 'recharts';
import type { DailyForecast } from '../types';

function shortDate(isoDay: string) {
  const [, m, d] = isoDay.split('-');
  return `${m}/${d}`;
}

type Props = { daily: DailyForecast[] };

export function ForecastChart({ daily }: Props) {
  const data = daily.map((d) => ({
    label: shortDate(d.date),
    high: d.tempMax ?? null,
    low: d.tempMin ?? null,
    rainChance: d.pop != null ? Math.round(d.pop * 100) : null,
    wind: d.windSpeed != null ? Math.round(d.windSpeed) : null,
  }));

  return (
    <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
          <XAxis dataKey="label" stroke="#94a3b8" tick={{ fill: '#94a3b8', fontSize: 12 }} />
          <YAxis
            yAxisId="temp"
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            label={{ value: '°F', angle: -90, position: 'insideLeft', fill: '#94a3b8' }}
          />
          <YAxis
            yAxisId="pct"
            orientation="right"
            stroke="#94a3b8"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            domain={[0, 100]}
            label={{ value: '% / mph', angle: 90, position: 'insideRight', fill: '#94a3b8' }}
          />
          <Tooltip
            contentStyle={{
              background: '#111a2e',
              border: '1px solid rgba(148,163,184,0.25)',
              borderRadius: 8,
            }}
            labelStyle={{ color: '#e2e8f0' }}
          />
          <Legend />
          <Bar yAxisId="temp" dataKey="high" name="High °F" fill="#38bdf8" radius={[4, 4, 0, 0]} />
          <Bar yAxisId="temp" dataKey="low" name="Low °F" fill="#6366f1" radius={[4, 4, 0, 0]} />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="rainChance"
            name="Rain chance %"
            stroke="#f472b6"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="wind"
            name="Wind (mph)"
            stroke="#34d399"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
