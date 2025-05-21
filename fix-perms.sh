#!/bin/sh
set -e

# Fix permissions on log directory
chown -R node:node /app/log

# Continue with the original command
exec "$@"
