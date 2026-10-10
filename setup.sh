#!/usr/bin/env bash
set -euo pipefail

# wa-bridge — First-time setup
# Usage: ./setup.sh

echo "=== wa-bridge Setup ==="
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js >= 18 is required."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required."; exit 1; }

# Check Node version
NODE_VERSION=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "Error: Node.js >= 18 is required (found v$(node -v))."
  exit 1
fi

echo "✓ Node.js $(node -v)"
echo "✓ npm $(npm -v)"

# Environment
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "Created .env from .env.example"
  echo "→ Edit .env with your LLM endpoint and API key"
fi

# Dependencies
echo ""
echo "Installing dependencies..."
npm install
echo "✓ Dependencies installed"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env with your configuration"
echo "  2. Run: npm start"
echo "  3. Scan the QR code with your WhatsApp app"
echo ""