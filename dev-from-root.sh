#!/usr/bin/env bash
ROOT="$(cd "$(dirname "$0")" && pwd)"
export PATH="$ROOT/node_modules/.bin:$ROOT/apps/api/node_modules/.bin:$ROOT/apps/web/node_modules/.bin:$PATH"
export CI=true

echo "Starting Avicenna dev..."
echo "- API  -> http://localhost:3001"
echo "- Web  -> http://localhost:3000"
echo ""

# Kill existing if any
pkill -f "nest start" 2>/dev/null
pkill -f "next dev" 2>/dev/null
pkill -f "tsup" 2>/dev/null

# Start services
cd "$ROOT/packages/contracts" && npx tsup --watch > /tmp/avicenna-contracts.log 2>&1 &
cd "$ROOT/apps/api" && npx @nestjs/cli start --watch > /tmp/avicenna-api.log 2>&1 &
cd "$ROOT/apps/web" && npx next dev > /tmp/avicenna-web.log 2>&1 &

echo "Logs:"
echo "  tail -f /tmp/avicenna-contracts.log"
echo "  tail -f /tmp/avicenna-api.log"
echo "  tail -f /tmp/avicenna-web.log"
echo ""
echo "Press Ctrl+C to stop all"

trap "pkill -f 'nest start'; pkill -f 'next dev'; pkill -f 'tsup'; exit" INT TERM
wait
