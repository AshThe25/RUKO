#!/usr/bin/env bash
# Grant every permission Ruko's detection chain needs, on the connected device.
#
# Run this after EVERY `adb install` of Ruko. Reinstalling drops both the
# accessibility grant and the notification-listener binding, and neither comes
# back on its own -- the setting still lists the service while nothing is
# actually bound, which looks exactly like a code bug and is not one.
set -euo pipefail

RUKO=com.rukomobile
A11Y="$RUKO/com.ruko.nativemodule.accessibility.RukoAccessibilityService"
NOTIF="$RUKO/com.ruko.nativemodule.notifications.RukoNotificationListenerService"

adb shell appops set "$RUKO" SYSTEM_ALERT_WINDOW allow
for p in RECORD_AUDIO READ_PHONE_STATE POST_NOTIFICATIONS READ_CONTACTS READ_CALL_LOG; do
  adb shell pm grant "$RUKO" "android.permission.$p" 2>/dev/null || true
done

adb shell settings put secure enabled_accessibility_services "$A11Y"
adb shell settings put secure accessibility_enabled 1

# Toggle rather than just allow: after a reinstall the listener is allowed but
# unbound, and only a disallow/allow cycle makes the system rebind it. Skipping
# this is why the notification family reported nothing while the listener had
# genuinely never received a single notification.
adb shell cmd notification disallow_listener "$NOTIF" >/dev/null 2>&1 || true
sleep 1
adb shell cmd notification allow_listener "$NOTIF"

adb shell pm grant com.ruko.paynow android.permission.POST_NOTIFICATIONS 2>/dev/null || true

echo
echo "Accessibility bound:"
adb shell dumpsys accessibility | grep -o "$RUKO[^,}]*" | head -2
echo "Overlay: $(adb shell appops get "$RUKO" SYSTEM_ALERT_WINDOW)"
sleep 1
echo "Notification listener allowed:"
adb shell settings get secure enabled_notification_listeners | tr ':' '\n' | grep ruko || echo "  NOT SET"
