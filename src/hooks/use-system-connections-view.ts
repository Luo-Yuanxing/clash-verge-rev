import { useMemo } from 'react'

import { mapSystemConnections } from '@/utils/system-connections'

export const useSystemConnectionViews = (
  items: ISystemConnectionsItem[],
  coreConnections: IConnectionsItem[],
) =>
  useMemo(
    () => ({ connections: mapSystemConnections(items, coreConnections) }),
    [items, coreConnections],
  )
