import { getSystemConnections } from '@/services/cmds'
import { useQuery } from '@/services/query-client'

const SYSTEM_CONNECTIONS_REFETCH_INTERVAL_MS = 2_000

/**
 * Polls the OS socket table so the connections page can show traffic that never
 * reaches the mihomo core.
 *
 * Polling only runs while the page is visible, mirroring the websocket-backed
 * connection stream, which is also suspended for hidden windows.
 */
export const useSystemConnections = (options: { enabled?: boolean } = {}) => {
  const enabled = options.enabled ?? true

  return useQuery<ISystemConnections>({
    queryKey: ['getSystemConnections'],
    queryFn: getSystemConnections,
    enabled,
    refetchInterval: enabled ? SYSTEM_CONNECTIONS_REFETCH_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}
