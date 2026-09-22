#!/bin/sh
# Install/update the per-user macOS LaunchAgent that records actual disk usage.
set -eu

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
agent_name=com.ifilemanager.storage-stats
agent_path="$HOME/Library/LaunchAgents/$agent_name.plist"
user_id=$(id -u)

test -f "$repository/.env"
/bin/mkdir -p "$HOME/Library/LaunchAgents"
/usr/bin/sed "s|__IFILE_MANAGER_REPOSITORY__|$repository|g" "$repository/launchd/$agent_name.plist" > "$agent_path"
/bin/chmod 644 "$agent_path"
/bin/sh "$repository/scripts/update-storage-stats.sh" "$repository/.env"
/bin/launchctl bootout "gui/$user_id" "$agent_path" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$user_id" "$agent_path"
/bin/launchctl kickstart -k "gui/$user_id/$agent_name"
echo "Installed $agent_name; actual storage stats refresh every 60 seconds."
