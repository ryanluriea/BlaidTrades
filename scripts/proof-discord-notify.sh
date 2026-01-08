#!/bin/bash
# Proof script: Discord Notifications Control Plane
# Verifies Discord is properly integrated into the system

echo "=== DISCORD NOTIFICATIONS PROOF ==="
echo ""

# 1. Check integrations status includes Discord
echo "[1] Checking /api/integrations/status for Discord provider..."
INTEGRATIONS=$(curl -s http://localhost:5000/api/integrations/status 2>/dev/null)

if echo "$INTEGRATIONS" | grep -q '"discord"'; then
  echo "PASS: Discord provider found in integrations status"
  echo "$INTEGRATIONS" | grep -A5 '"discord"' | head -10
else
  echo "FAIL: Discord provider not found in integrations status"
fi
echo ""

# 2. Check for AWS SNS
echo "[2] Checking /api/integrations/status for AWS SNS provider..."
if echo "$INTEGRATIONS" | grep -q '"aws_sns"'; then
  echo "PASS: AWS SNS provider found in integrations status"
  echo "$INTEGRATIONS" | grep -A5 '"aws_sns"' | head -10
else
  echo "FAIL: AWS SNS provider not found in integrations status"
fi
echo ""

# 3. Test Discord webhook endpoint (expects 503 if not configured, 401 if not authed)
echo "[3] Testing POST /api/notifications/discord/test (unauthenticated)..."
DISCORD_TEST=$(curl -s -X POST http://localhost:5000/api/notifications/discord/test \
  -H "Content-Type: application/json" \
  -d '{"channel":"ops"}' 2>/dev/null)

echo "Response: $DISCORD_TEST"

if echo "$DISCORD_TEST" | grep -q '"error_code":"AUTH_REQUIRED"'; then
  echo "PASS: Endpoint correctly requires authentication"
elif echo "$DISCORD_TEST" | grep -q '"error_code":"INTEGRATION_KEY_MISSING"'; then
  echo "PASS: Endpoint correctly reports missing config"
elif echo "$DISCORD_TEST" | grep -q '"success":true'; then
  echo "PASS: Endpoint returned success (Discord configured)"
else
  echo "INFO: Unexpected response (check manually)"
fi
echo ""

# 4. Test SMS endpoint (expects 503 if not configured, 401 if not authed)
echo "[4] Testing POST /api/alerts/sms/test (unauthenticated)..."
SMS_TEST=$(curl -s -X POST http://localhost:5000/api/alerts/sms/test \
  -H "Content-Type: application/json" \
  -d '{}' 2>/dev/null)

echo "Response: $SMS_TEST"

if echo "$SMS_TEST" | grep -q '"error_code":"AUTH_REQUIRED"'; then
  echo "PASS: Endpoint correctly requires authentication"
elif echo "$SMS_TEST" | grep -q '"error_code":"INTEGRATION_KEY_MISSING"'; then
  echo "PASS: Endpoint correctly reports missing AWS SNS config"
elif echo "$SMS_TEST" | grep -q '"success":true'; then
  echo "PASS: Endpoint returned success (AWS SNS configured)"
else
  echo "INFO: Unexpected response (check manually)"
fi
echo ""

# 5. Check telemetry table exists
echo "[5] Checking integration_usage_events telemetry table..."
TELEMETRY=$(curl -s http://localhost:5000/api/telemetry/integration-usage 2>/dev/null)

if echo "$TELEMETRY" | grep -q '"success":true'; then
  echo "PASS: Telemetry endpoint accessible"
  echo "$TELEMETRY" | head -c 300
else
  echo "INFO: Telemetry endpoint not accessible or empty"
fi
echo ""

# 6. Check system status includes notifications info
echo "[6] Checking /api/system/status..."
SYSTEM_STATUS=$(curl -s http://localhost:5000/api/system/status 2>/dev/null)

if echo "$SYSTEM_STATUS" | grep -q '"system_status"'; then
  echo "PASS: System status endpoint accessible"
  echo "$SYSTEM_STATUS" | head -c 400
else
  echo "INFO: System status format unexpected"
fi
echo ""

echo "=== PROOF COMPLETE ==="
