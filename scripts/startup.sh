#!/bin/sh
set -e

echo "=== WAB Production Startup ==="

echo "1. Generating Prisma client..."
npx prisma generate

echo "2. Running database migrations..."
npx prisma db push --skip-generate

echo "3. Starting application..."
exec npm start
