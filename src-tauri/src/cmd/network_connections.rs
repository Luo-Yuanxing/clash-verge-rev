//! System-wide connection table (netstat-like) exposed to the frontend.
//!
//! The mihomo API only reports connections that flow through the core. This command
//! reads the OS socket tables instead, so the UI can show every TCP/UDP endpoint the
//! machine holds, including traffic that bypasses the core, together with the owning
//! process.

use serde::Serialize;

/// One row of the OS connection table.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemConnection {
    /// Owning process id, `0` when the table row has no owner.
    pub pid: u32,
    /// Executable name resolved from the process id, empty when unavailable.
    pub process: String,
    /// `tcp` or `udp`.
    pub protocol: &'static str,
    /// `ipv4` or `ipv6`.
    pub family: &'static str,
    pub local_address: String,
    pub local_port: u16,
    pub remote_address: String,
    pub remote_port: u16,
    /// TCP state name (`ESTABLISHED`, `LISTEN`, ...); `-` for UDP rows.
    pub state: &'static str,
}

/// Snapshot of the OS connection table.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemConnectionSnapshot {
    pub connections: Vec<SystemConnection>,
    /// Tables that could not be read, as `"<protocol>/<family>: <reason>"`.
    pub unavailable: Vec<String>,
}

#[tauri::command]
pub async fn get_system_connections() -> SystemConnectionSnapshot {
    tauri::async_runtime::spawn_blocking(collect_system_connections)
        .await
        .unwrap_or_else(|error| SystemConnectionSnapshot {
            connections: Vec::new(),
            unavailable: vec![format!("connection table task failed: {error}")],
        })
}

fn collect_system_connections() -> SystemConnectionSnapshot {
    #[cfg(windows)]
    {
        windows::collect()
    }
    #[cfg(not(windows))]
    {
        SystemConnectionSnapshot {
            connections: Vec::new(),
            unavailable: vec!["system connection table is only implemented on Windows".to_owned()],
        }
    }
}

#[cfg(windows)]
mod windows {
    use std::{
        collections::HashMap,
        mem::{size_of, size_of_val},
        net::{Ipv4Addr, Ipv6Addr},
        ptr::null_mut,
    };

    use windows_sys::Win32::{
        Foundation::{CloseHandle, ERROR_INSUFFICIENT_BUFFER, INVALID_HANDLE_VALUE},
        NetworkManagement::IpHelper::{
            GetExtendedTcpTable, GetExtendedUdpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID,
            MIB_UDP6ROW_OWNER_PID, MIB_UDPROW_OWNER_PID, TCP_TABLE_OWNER_PID_ALL,
            UDP_TABLE_OWNER_PID,
        },
        Networking::WinSock::{AF_INET, AF_INET6},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
            TH32CS_SNAPPROCESS,
        },
    };

    use super::{SystemConnection, SystemConnectionSnapshot};

    /// TCP states defined by `MIB_TCP_STATE`.
    const TCP_STATES: [&str; 13] = [
        "-",
        "CLOSED",
        "LISTEN",
        "SYN_SENT",
        "SYN_RCVD",
        "ESTABLISHED",
        "FIN_WAIT1",
        "FIN_WAIT2",
        "CLOSE_WAIT",
        "CLOSING",
        "LAST_ACK",
        "TIME_WAIT",
        "DELETE_TCB",
    ];

    /// Which OS socket table to read.
    #[derive(Clone, Copy)]
    enum Table {
        Tcp,
        Udp,
    }

    const fn port(raw: u32) -> u16 {
        u16::from_be(raw as u16)
    }

    fn ipv4(raw: u32) -> String {
        Ipv4Addr::from(u32::from_be(raw)).to_string()
    }

    fn ipv6(bytes: [u8; 16]) -> String {
        Ipv6Addr::from(bytes).to_string()
    }

    fn tcp_state(raw: u32) -> &'static str {
        TCP_STATES.get(raw as usize).copied().unwrap_or("UNKNOWN")
    }

    /// Reads an `IpHelper` table through the documented two-call size negotiation.
    ///
    /// The returned buffer starts with the row count, followed by the rows themselves.
    fn read_table(family: u32, table: Table) -> Result<Vec<u32>, &'static str> {
        let mut byte_count = 0u32;
        // SAFETY: a null table pointer is the documented size-query form and
        // `byte_count` is a valid out-parameter.
        let status = unsafe { call(&raw mut byte_count, null_mut(), family, table) };
        if status != ERROR_INSUFFICIENT_BUFFER {
            return Err("size query failed");
        }

        loop {
            let word_count = (byte_count as usize).div_ceil(size_of::<u32>());
            let mut buffer = vec![0u32; word_count];
            // SAFETY: `buffer` holds at least `byte_count` writable bytes and the API
            // rewrites `byte_count` when the table grows between the two calls.
            let status = unsafe {
                call(
                    &raw mut byte_count,
                    buffer.as_mut_ptr().cast(),
                    family,
                    table,
                )
            };
            match status {
                0 => return Ok(buffer),
                ERROR_INSUFFICIENT_BUFFER => {}
                _ => return Err("read failed"),
            }
        }
    }

    /// # Safety
    /// `size` must be a writable `u32`; `buffer` must be null or hold `*size` writable bytes.
    unsafe fn call(size: *mut u32, buffer: *mut core::ffi::c_void, family: u32, table: Table) -> u32 {
        // SAFETY: upheld by the caller.
        unsafe {
            match table {
                Table::Tcp => GetExtendedTcpTable(buffer, size, 0, family, TCP_TABLE_OWNER_PID_ALL, 0),
                Table::Udp => GetExtendedUdpTable(buffer, size, 0, family, UDP_TABLE_OWNER_PID, 0),
            }
        }
    }

    /// Views the rows following the leading row count.
    ///
    /// Returns an empty slice when the buffer does not describe `row_count` whole rows.
    ///
    /// # Safety
    /// `buffer` must come from an OS socket table whose rows are `Row`.
    const unsafe fn rows<Row>(buffer: &[u32]) -> &[Row] {
        let Some((&row_count, rest)) = buffer.split_first() else {
            return &[];
        };
        let row_count = row_count as usize;
        if size_of_val(rest) < row_count * size_of::<Row>() {
            return &[];
        }
        // SAFETY: `rest` covers `row_count` whole rows and the table buffer is aligned
        // for every row type the API returns.
        unsafe { std::slice::from_raw_parts(rest.as_ptr().cast::<Row>(), row_count) }
    }

    /// Maps every live process id to its executable name through one toolhelp snapshot.
    fn process_names() -> HashMap<u32, String> {
        let mut names = HashMap::new();
        // SAFETY: the returned handle is validated before use and closed on every path.
        let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
        if snapshot == INVALID_HANDLE_VALUE {
            return names;
        }

        let mut entry = PROCESSENTRY32W {
            dwSize: size_of::<PROCESSENTRY32W>() as u32,
            ..Default::default()
        };
        // SAFETY: `entry` is a correctly sized out-parameter for a live snapshot.
        let mut has_entry = unsafe { Process32FirstW(snapshot, &raw mut entry) } != 0;
        while has_entry {
            names.insert(entry.th32ProcessID, entry_name(&entry));
            // SAFETY: same contract as `Process32FirstW`.
            has_entry = unsafe { Process32NextW(snapshot, &raw mut entry) } != 0;
        }

        // SAFETY: `snapshot` is a live handle owned by this function and is not reused.
        unsafe { CloseHandle(snapshot) };
        names
    }

    fn entry_name(entry: &PROCESSENTRY32W) -> String {
        let end = entry
            .szExeFile
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(entry.szExeFile.len());
        String::from_utf16_lossy(&entry.szExeFile[..end])
    }

    fn owner_name(names: &HashMap<u32, String>, pid: u32) -> String {
        names.get(&pid).cloned().unwrap_or_default()
    }

    pub fn collect() -> SystemConnectionSnapshot {
        let names = process_names();
        let mut connections = Vec::new();
        let mut unavailable = Vec::new();

        let families = [
            (u32::from(AF_INET), "ipv4"),
            (u32::from(AF_INET6), "ipv6"),
        ];
        for (family, family_name) in families {
            collect_tcp(&names, family, family_name, &mut connections, &mut unavailable);
            collect_udp(&names, family, family_name, &mut connections, &mut unavailable);
        }

        SystemConnectionSnapshot {
            connections,
            unavailable,
        }
    }

    fn collect_tcp(
        names: &HashMap<u32, String>,
        family: u32,
        family_name: &'static str,
        connections: &mut Vec<SystemConnection>,
        unavailable: &mut Vec<String>,
    ) {
        let table = match read_table(family, Table::Tcp) {
            Ok(table) => table,
            Err(reason) => {
                unavailable.push(format!("tcp/{family_name}: {reason}"));
                return;
            }
        };

        if family == u32::from(AF_INET) {
            // SAFETY: `TCP_TABLE_OWNER_PID_ALL` over IPv4 yields `MIB_TCPROW_OWNER_PID` rows.
            for row in unsafe { rows::<MIB_TCPROW_OWNER_PID>(&table) } {
                connections.push(SystemConnection {
                    pid: row.dwOwningPid,
                    process: owner_name(names, row.dwOwningPid),
                    protocol: "tcp",
                    family: family_name,
                    local_address: ipv4(row.dwLocalAddr),
                    local_port: port(row.dwLocalPort),
                    remote_address: ipv4(row.dwRemoteAddr),
                    remote_port: port(row.dwRemotePort),
                    state: tcp_state(row.dwState),
                });
            }
            return;
        }

        // SAFETY: `TCP_TABLE_OWNER_PID_ALL` over IPv6 yields `MIB_TCP6ROW_OWNER_PID` rows.
        for row in unsafe { rows::<MIB_TCP6ROW_OWNER_PID>(&table) } {
            connections.push(SystemConnection {
                pid: row.dwOwningPid,
                process: owner_name(names, row.dwOwningPid),
                protocol: "tcp",
                family: family_name,
                local_address: ipv6(row.ucLocalAddr),
                local_port: port(row.dwLocalPort),
                remote_address: ipv6(row.ucRemoteAddr),
                remote_port: port(row.dwRemotePort),
                state: tcp_state(row.dwState),
            });
        }
    }

    fn collect_udp(
        names: &HashMap<u32, String>,
        family: u32,
        family_name: &'static str,
        connections: &mut Vec<SystemConnection>,
        unavailable: &mut Vec<String>,
    ) {
        let table = match read_table(family, Table::Udp) {
            Ok(table) => table,
            Err(reason) => {
                unavailable.push(format!("udp/{family_name}: {reason}"));
                return;
            }
        };

        if family == u32::from(AF_INET) {
            // SAFETY: `UDP_TABLE_OWNER_PID` over IPv4 yields `MIB_UDPROW_OWNER_PID` rows.
            for row in unsafe { rows::<MIB_UDPROW_OWNER_PID>(&table) } {
                connections.push(udp_row(
                    names,
                    family_name,
                    row.dwOwningPid,
                    ipv4(row.dwLocalAddr),
                    port(row.dwLocalPort),
                ));
            }
            return;
        }

        // SAFETY: `UDP_TABLE_OWNER_PID` over IPv6 yields `MIB_UDP6ROW_OWNER_PID` rows.
        for row in unsafe { rows::<MIB_UDP6ROW_OWNER_PID>(&table) } {
            connections.push(udp_row(
                names,
                family_name,
                row.dwOwningPid,
                ipv6(row.ucLocalAddr),
                port(row.dwLocalPort),
            ));
        }
    }

    /// UDP rows are connectionless, so there is no peer to report.
    fn udp_row(
        names: &HashMap<u32, String>,
        family: &'static str,
        pid: u32,
        local_address: String,
        local_port: u16,
    ) -> SystemConnection {
        SystemConnection {
            pid,
            process: owner_name(names, pid),
            protocol: "udp",
            family,
            local_address,
            local_port,
            remote_address: "*".to_owned(),
            remote_port: 0,
            state: "-",
        }
    }
}
