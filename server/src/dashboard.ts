import type { Pool } from 'pg';

export interface Ranking { id: string; name: string; total: number }
export interface DashboardData {
  dailyTotal: number; monthlyTotal: number; open: number; assigned: number; pendingAcceptance: number;
  assignedRanking: Ranking[]; resolvedRanking: Ranking[];
  monthlySeries: { month: number; opened: number; resolved: number }[];
}

export async function dashboard(pool: Pool, year: number, month: number): Promise<DashboardData> {
  // A single statement gives all indicators the same database snapshot.
  const result = await pool.query<{ data: DashboardData }>(`
    WITH bounds AS (
      SELECT make_date($1, $2, 1)::timestamp AT TIME ZONE 'America/Sao_Paulo' AS month_start,
        (make_date($1, $2, 1) + INTERVAL '1 month') AT TIME ZONE 'America/Sao_Paulo' AS month_end,
        make_date($1, 1, 1)::timestamp AT TIME ZONE 'America/Sao_Paulo' AS year_start,
        (make_date($1, 1, 1) + INTERVAL '1 year') AT TIME ZONE 'America/Sao_Paulo' AS year_end,
        (NOW() AT TIME ZONE 'America/Sao_Paulo')::date::timestamp AT TIME ZONE 'America/Sao_Paulo' AS day_start,
        ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo' AS day_end
    ), assigned_rank AS (
      SELECT technician_id AS id, technician_name AS name, COUNT(*)::int AS total
      FROM orders WHERE status='ASSIGNED' GROUP BY technician_id, technician_name
      ORDER BY total DESC, name, id LIMIT 5
    ), resolved_rank AS (
      SELECT resolved_by_id AS id, resolved_by_name AS name, COUNT(*)::int AS total
      FROM orders, bounds WHERE status='RESOLVED' AND resolved_at >= month_start AND resolved_at < month_end
      GROUP BY resolved_by_id, resolved_by_name ORDER BY total DESC, name, id LIMIT 5
    ), opened_months AS (
      SELECT EXTRACT(MONTH FROM created_at AT TIME ZONE 'America/Sao_Paulo')::int AS month, COUNT(*)::int AS total
      FROM orders, bounds WHERE created_at >= year_start AND created_at < year_end GROUP BY 1
    ), resolved_months AS (
      SELECT EXTRACT(MONTH FROM resolved_at AT TIME ZONE 'America/Sao_Paulo')::int AS month, COUNT(*)::int AS total
      FROM orders, bounds WHERE status='RESOLVED' AND resolved_at >= year_start AND resolved_at < year_end GROUP BY 1
    )
    SELECT json_build_object(
      'dailyTotal', (SELECT COUNT(*)::int FROM orders, bounds WHERE created_at >= day_start AND created_at < day_end),
      'monthlyTotal', (SELECT COUNT(*)::int FROM orders, bounds WHERE created_at >= month_start AND created_at < month_end),
      'open', (SELECT COUNT(*)::int FROM orders WHERE status='OPEN'),
      'assigned', (SELECT COUNT(*)::int FROM orders WHERE status='ASSIGNED'),
      'pendingAcceptance', (SELECT COUNT(*)::int FROM orders WHERE acceptance='PENDING'),
      'assignedRanking', COALESCE((SELECT json_agg(r) FROM assigned_rank r), '[]'::json),
      'resolvedRanking', COALESCE((SELECT json_agg(r) FROM resolved_rank r), '[]'::json),
      'monthlySeries', (SELECT json_agg(json_build_object('month', m, 'opened', COALESCE(o.total,0), 'resolved', COALESCE(r.total,0)) ORDER BY m)
        FROM generate_series(1,12) m LEFT JOIN opened_months o ON o.month=m LEFT JOIN resolved_months r ON r.month=m)
    ) AS data`, [year, month]);
  return result.rows[0].data;
}
