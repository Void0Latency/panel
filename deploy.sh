#!/bin/bash

# VoidLatency Panel Deployer
# Version: 2.9.4

set -e

echo "🚀 VoidLatency Panel Deployer v2.9.4"
echo "========================================"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${YELLOW}⚠️  Wrangler not found. Installing...${NC}"
    npm install -g wrangler
fi

# Check if logged in
echo -e "${BLUE}🔍 Checking Cloudflare login...${NC}"
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}⚠️  Not logged in to Cloudflare${NC}"
    wrangler login
fi

# Create D1 Database
echo -e "${BLUE}📦 Creating D1 Database...${NC}"
DB_NAME="voidlatency-db"
if ! wrangler d1 list | grep -q "$DB_NAME"; then
    wrangler d1 create "$DB_NAME"
else
    echo -e "${GREEN}✅ Database already exists${NC}"
fi

# Get database ID
DB_ID=$(wrangler d1 list | grep -A1 "$DB_NAME" | grep "id" | awk -F'"' '{print $4}')

# Update wrangler.toml with database ID
sed -i.bak "s/database_id = \"\"/database_id = \"$DB_ID\"/" wrangler.toml

# Run migrations
echo -e "${BLUE}🔄 Running migrations...${NC}"
wrangler d1 execute "$DB_NAME" --file=./schema.sql

# Deploy
echo -e "${BLUE}☁️  Deploying to Cloudflare Workers...${NC}"
wrangler deploy

# Get deployment URL
WORKER_URL=$(wrangler deploy | grep -o 'https://[^ ]*\.workers\.dev')

echo ""
echo -e "${GREEN}✅ Deployment Complete! 🎉${NC}"
echo ""
echo -e "${BLUE}📌 Panel URL: ${GREEN}$WORKER_URL/panel${NC}"
echo -e "${BLUE}🔑 Login: ${GREEN}$WORKER_URL/login${NC}"
echo ""
echo -e "${YELLOW}📝 Next Steps:${NC}"
echo "1. Open the panel URL"
echo "2. Set up admin password"
echo "3. Start adding users"
echo ""
echo -e "${BLUE}🔗 Links:${NC}"
echo "   GitHub: https://github.com/Void0Latency/panel"
echo "   Telegram: https://t.me/VoidLatency"
