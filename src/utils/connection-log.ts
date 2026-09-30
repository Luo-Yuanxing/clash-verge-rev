import type { ConnectionHistoryItem } from '@/hooks/use-connection-data'

/** `[TCP] 127.0.0.1:52341(chrome.exe) --> www.google.com:443 match DomainSuffix(google.com) using Proxy[HK-01]` */
const CONNECTION_LINE =
  /^\[(TCP|UDP)]\s+(\S+?)(?:\(([^)]*)\))?\s+-->\s+(\S+)\s+match\s+(\S+?)(?:\((.*?)\))?\s+using\s+(.+?)\s*$/

/** The core wraps the message in key=value pairs: `time="..." level=info msg="[TCP] ..."` */
const LOG_MESSAGE = /\bmsg="(.*)"\s*$/
const LOG_TIME = /\btime="([^"]+)"/

let sequence = 0

const stripBrackets = (value: string) => value.replace(/^\[|\]$/g, '')

const splitHostPort = (value: string): [string, string] => {
  const index = value.lastIndexOf(':')
  if (index === -1) return [stripBrackets(value), '']
  return [stripBrackets(value.slice(0, index)), value.slice(index + 1)]
}

/** `DIRECT` | `Reject` | `Proxy[HK-01]` | `Group[A -> B]` */
const parseChains = (outbound: string): string[] => {
  const match = /^([A-Za-z][\w-]*)\[(.*)]$/.exec(outbound)
  if (!match) return [outbound]

  const [, group, chain] = match
  const hops = chain
    .split(' -> ')
    .map((hop) => hop.trim())
    .filter(Boolean)

  return [group, ...hops]
}

/**
 * Turn one core log line into a connection record.
 *
 * The line is the only place where short lived connections show up: the
 * connections API only reports a snapshot once per second, so anything that
 * opens and closes in between never appears in it.
 */
export const parseConnectionLogLine = (
  payload: string,
  receivedAt: number,
): ConnectionHistoryItem | null => {
  const message = LOG_MESSAGE.exec(payload)?.[1] ?? payload
  const match = CONNECTION_LINE.exec(message)
  if (!match) return null

  const [, network, source, process, destination, rule, rulePayload, outbound] =
    match

  const [sourceIP, sourcePort] = splitHostPort(source)
  const [host, destinationPort] = splitHostPort(destination)
  const timeText = LOG_TIME.exec(payload)?.[1]
  // The core logs nanoseconds, which Date.parse does not accept consistently.
  const startAt =
    (timeText
      ? Date.parse(timeText.replace(/(\.\d{3})\d+/, '$1'))
      : Number.NaN) || receivedAt

  sequence += 1

  return {
    id: `log-${startAt}-${sequence}`,
    metadata: {
      network: network.toLowerCase(),
      type: '',
      host,
      sourceIP,
      sourcePort,
      destinationPort,
      destinationIP: '',
      remoteDestination: '',
      process: process ?? '',
      processPath: '',
    },
    upload: 0,
    download: 0,
    start: new Date(startAt).toISOString(),
    chains: parseChains(outbound),
    rule: rule ?? '',
    rulePayload: rulePayload ?? '',
    startAt,
    lastSeen: startAt,
    active: false,
  }
}
