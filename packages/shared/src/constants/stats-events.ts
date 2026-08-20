// Socket events for the live analytics dashboard, scoped to its own "/stats"
// namespace. Read-only: the dashboard never sends anything back except the
// initial passcode used to authenticate the connection.
export const STATS_EVENTS = {
  SNAPSHOT: 'stats-snapshot',
  AUTH_ERROR: 'stats-auth-error',
} as const;
