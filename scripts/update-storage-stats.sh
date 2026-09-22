#!/bin/sh
# Runs on the macOS host, not in Docker. Docker Desktop virtualizes statfs() for
# bind mounts, so this script records the removable drive's real df values.
set -eu

env_file=${1:?Pass the absolute IFileManager .env path as the first argument}
storage_path=$(/usr/bin/sed -n -E 's/^REMOVABLE_DISK_PATH=(.*)$/\1/p' "$env_file" | /usr/bin/tail -n 1)

case "$storage_path" in
  \"*\") storage_path=${storage_path#\"}; storage_path=${storage_path%\"} ;;
esac

if [ -z "$storage_path" ] || [ ! -d "$storage_path/ifile-manager" ]; then
  echo 'The configured removable storage path is unavailable.' >&2
  exit 1
fi

set -- $(/bin/df -k "$storage_path" | /usr/bin/awk 'NR == 2 { print $2, $3, $4 }')
total_blocks=${1:-}
used_blocks=${2:-}
free_blocks=${3:-}
for value in "$total_blocks" "$used_blocks" "$free_blocks"; do
  case "$value" in ''|*[!0-9]*) echo 'Could not parse df output.' >&2; exit 1 ;; esac
done

target_directory=/tmp/ifile-manager
target="$target_directory/storage-stats.json"
temporary="$target_directory/storage-stats.$$.tmp"
updated_at=$(/bin/date -u '+%Y-%m-%dT%H:%M:%SZ')

umask 022
/bin/mkdir -p "$target_directory"
printf '{"totalBytes":%s,"usedBytes":%s,"freeBytes":%s,"updatedAt":"%s"}\n' \
  "$((total_blocks * 1024))" "$((used_blocks * 1024))" "$((free_blocks * 1024))" "$updated_at" > "$temporary"
/bin/chmod 644 "$temporary"
/bin/mv -f "$temporary" "$target"
