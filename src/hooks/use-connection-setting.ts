import { useLocalStorage } from 'foxact/use-local-storage'

import { DEFAULT_HISTORY_WINDOW_MS } from './use-connection-data'

export const HISTORY_WINDOW_OPTIONS = [
  60 * 1_000,
  5 * 60 * 1_000,
  10 * 60 * 1_000,
  30 * 60 * 1_000,
  60 * 60 * 1_000,
]

const defaultConnectionSetting: IConnectionSetting = {
  layout: 'table',
  historyWindowMs: DEFAULT_HISTORY_WINDOW_MS,
}

export const useConnectionSetting = () =>
  useLocalStorage<IConnectionSetting>(
    'connections-setting',
    defaultConnectionSetting,
    {
      serializer: JSON.stringify,
      deserializer: JSON.parse,
    },
  )
