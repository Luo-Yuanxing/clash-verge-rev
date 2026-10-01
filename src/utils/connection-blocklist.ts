/**
 * 连接历史黑名单：按主机名严格匹配。
 *
 * 只影响历史列表的渲染，命中即隐藏该行；匹配是整串相等，
 * 因此黑名单里的 `api.example.com` 不会隐藏 `www.example.com` 或 `example.com`。
 */

/** 带端口的方括号 IPv6，例如 [::1]:443 */
const BRACKETED_HOST = /^\[([^\]]+)\](?::\d+)?$/u

/** 形如 example.com:443 / 127.0.0.1:8080 的带端口主机 */
const HOST_WITH_PORT = /^(.*?):(\d+)$/u

/** 去掉端口、统一小写并去掉尾部点，得到匹配用的主机名 */
export const normalizeBlockHost = (raw: string) => {
  let host = (raw ?? '').trim().toLowerCase()
  if (!host) return ''

  const bracketed = BRACKETED_HOST.exec(host)
  if (bracketed) {
    // 方括号 IPv6 一定带括号，端口直接丢掉
    host = bracketed[1]
  } else {
    const withPort = HOST_WITH_PORT.exec(host)
    // 裸 IPv6 本身含多个冒号，结尾的数字不是端口，不能剥
    if (withPort && withPort[1].split(':').length <= 2) host = withPort[1]
  }

  return host.replace(/\.+$/u, '')
}

/** 规范化整个黑名单：去空、去重并保持原顺序 */
export const normalizeBlocklist = (list?: string[]) => {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const entry of list ?? []) {
    const host = normalizeBlockHost(entry)
    if (!host || seen.has(host)) continue
    seen.add(host)
    normalized.push(host)
  }

  return normalized
}

/** 生成严格匹配的判定函数，主机名先规范化再比较 */
export const createBlocklistMatcher = (list?: string[]) => {
  const hosts = new Set(normalizeBlocklist(list))
  return (host: string) => {
    const value = normalizeBlockHost(host)
    return Boolean(value) && hosts.has(value)
  }
}
