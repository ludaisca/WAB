#!/bin/sh
set -e

echo "=== WAB Production Startup ==="

echo "1. Generating Prisma client..."
npx prisma generate

echo "2. Running database migrations..."
if [ -d "prisma/migrations" ]; then
  npx prisma migrate deploy
else
  echo "No migrations found, using db push (development mode)"
  npx prisma db push --skip-generate
fi

echo "3. Starting application..."
exec npm start
