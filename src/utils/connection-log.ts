import type { ConnectionHistoryItem } from '@/hooks/use-connection-data'

/** `[TCP] 127.0.0.1:52341(chrome.exe) --> www.google.com:443 match DomainSuffix(google.com) using Proxy[HK-01]` */
const CONNECTION_LINE =
  /^\[(TCP|UDP)]\s+(\S+?)(?:\(([^)]*)\))?\s+-->\s+(\S+)\s+match\s+(\S+?)(?:\((.*?)\))?\s+using\s+(.+?)\s*$/

/**
 * `[TCP] dial DIRECT (match Match/) 127.0.0.1:52341 --> web.telegram.org:443 error: connect failed: ...`
 *
 * The core logs this line for every failed dial attempt and only emits the
 * `match ... using ...` line once a dial succeeded, so a failed dial never has
 * a connection record of its own. Every attempt of one dial is reported in a
 * single message, which is why the reason spans lines.
 */
const DIAL_ERROR_LINE =
  /\[(TCP|UDP)]\s+dial\s+(.+?)\s+(?:\(match\s+([^/)]+)\/([^)]*)\)\s+)?(\S+?)(?:\(([^)]*)\))?\s+-->\s+(\S+)\s+error:\s*([\s\S]*)$/

/** The core wraps the message in key=value pairs: `time="..." level=info msg="[TCP] ..."` */
const LOG_MESSAGE = /\bmsg="([\s\S]*?)"\s*$/
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

interface ParsedLine {
  network: string
  source: string
  process: string
  destination: string
  rule: string
  rulePayload: string
  chains: string[]
  failed?: boolean
  dialError?: string
}

const createItem = (
  line: ParsedLine,
  startAt: number,
): ConnectionHistoryItem => {
  const [sourceIP, sourcePort] = splitHostPort(line.source)
  const [host, destinationPort] = splitHostPort(line.destination)

  sequence += 1

  return {
    id: `log-${startAt}-${sequence}`,
    metadata: {
      network: line.network,
      type: '',
      host,
      sourceIP,
      sourcePort,
      destinationPort,
      destinationIP: '',
      remoteDestination: '',
      process: line.process,
      processPath: '',
    },
    upload: 0,
    download: 0,
    start: new Date(startAt).toISOString(),
    chains: line.chains,
    rule: line.rule,
    rulePayload: line.rulePayload,
    startAt,
    lastSeen: startAt,
    active: false,
    ...(line.failed ? { failed: true, dialError: line.dialError } : {}),
  }
}

/** The core logs nanoseconds, which Date.parse does not accept consistently. */
const startTimeOf = (payload: string, receivedAt: number) => {
  const timeText = LOG_TIME.exec(payload)?.[1]
  return (
    (timeText ? Date.parse(timeText.replace(/(\.\d{3})\d+/, '$1')) : Number.NaN) ||
    receivedAt
  )
}

/**
 * Turn one core log line into a connection record.
 *
 * The core log is the only place where short lived connections show up: the
 * connections API only reports a snapshot once per second, so anything that
 * opens and closes in between never appears in it. The same goes for a dial
 * that failed, which the core reports as an error line only.
 */
export const parseConnectionLogLine = (
  payload: string,
  receivedAt: number,
): ConnectionHistoryItem | null => {
  const message = LOG_MESSAGE.exec(payload)?.[1] ?? payload
  const startAt = startTimeOf(payload, receivedAt)

  const dialErrorMatch = DIAL_ERROR_LINE.exec(message)
  if (dialErrorMatch) {
    const [
      ,
      network,
      outbound,
      rule,
      rulePayload,
      source,
      process,
      destination,
      error,
    ] = dialErrorMatch

    return createItem(
      {
        network: network.toLowerCase(),
        source,
        process: process ?? '',
        destination,
        rule: rule ?? '',
        rulePayload: rulePayload ?? '',
        chains: parseChains(outbound),
        failed: true,
        // 未闭合的引号只可能来自兜底路径，去掉它免得混进失败原因里
        dialError: error.trim().replace(/"$/, ''),
      },
      startAt,
    )
  }

  const match = CONNECTION_LINE.exec(message)
  if (!match) return null

  const [, network, source, process, destination, rule, rulePayload, outbound] =
    match

  return createItem(
    {
      network: network.toLowerCase(),
      source,
      process: process ?? '',
      destination,
      rule: rule ?? '',
      rulePayload: rulePayload ?? '',
      chains: parseChains(outbound),
    },
    startAt,
  )
}
