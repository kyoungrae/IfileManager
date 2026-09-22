#!/bin/sh
# Install/update the per-user macOS LaunchAgent that records actual disk usage.
set -eu

repository=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
agent_name=com.ifilemanager.storage-stats
agent_path="$HOME/Library/LaunchAgents/$agent_name.plist"
user_id=$(id -u)

test -f "$repository/.env"
storage_path=$(/usr/bin/sed -n -E 's/^REMOVABLE_DISK_PATH=(.*)$/\1/p' "$repository/.env" | /usr/bin/tail -n 1)
case "$storage_path" in
  \"*\") storage_path=${storage_path#\"}; storage_path=${storage_path%\"} ;;
esac
test -n "$storage_path"
/bin/mkdir -p "$HOME/Library/LaunchAgents"
/usr/bin/sed -e "s|__IFILE_MANAGER_REPOSITORY__|$repository|g" -e "s|__IFILE_MANAGER_STORAGE_DIRECTORY__|$storage_path/ifile-manager|g" "$repository/launchd/$agent_name.plist" > "$agent_path"
/bin/chmod 644 "$agent_path"
/bin/sh "$repository/scripts/update-storage-stats.sh" "$repository/.env"
/bin/launchctl bootout "gui/$user_id" "$agent_path" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "gui/$user_id" "$agent_path"
echo "Installed $agent_name; actual storage stats refresh only when managed files change."
