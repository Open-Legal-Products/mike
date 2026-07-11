#!/bin/sh
set -e

# Substitute placeholder tokens in kong.yml and write to /tmp (always writable)
if [ -n "$SUPABASE_ANON_KEY" ] && [ -n "$SUPABASE_SERVICE_KEY" ]; then
  sed "s/__ANON_KEY__/$SUPABASE_ANON_KEY/g; s/__SERVICE_KEY__/$SUPABASE_SERVICE_KEY/g" /var/lib/kong/kong.yml > /tmp/kong.yml
else
  cp /var/lib/kong/kong.yml /tmp/kong.yml
fi

# Call the original Kong Docker entrypoint (handles docker-start command properly)
exec /docker-entrypoint.sh kong docker-start
