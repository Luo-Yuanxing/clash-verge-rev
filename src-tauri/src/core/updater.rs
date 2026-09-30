/// A build with a `+` suffix (e.g. `2.0.0+20250101`) becomes stable when the server
/// publishes the bare version, so such builds are treated as upgradable.
pub fn is_build_to_stable(current: &str, remote: &str) -> bool {
    let Some((base, build)) = current.trim_start_matches('v').split_once('+') else {
        return false;
    };
    !build.is_empty() && !base.contains('-') && base == remote.trim_start_matches('v')
}
