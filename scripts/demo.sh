#!/usr/bin/env bash
#
# Run the whole Ruko demo end to end, on a connected phone.
#
#   bash scripts/demo.sh            # the KYC bank scam (default)
#   bash scripts/demo.sh grooming   # grooming into sextortion
#   bash scripts/demo.sh game       # a child's repeated game top-ups
#
# WHY THIS EXISTS: the demo has a setup order that is easy to get wrong and
# fails silently when you do. Re-installing Ruko clears its accessibility
# grant, and force-stopping it kills the accessibility service without
# rebinding — in both cases Ruko keeps running and looks fine while seeing
# nothing at all. This script does the steps in the order that works, and
# stops with a real reason when a step genuinely failed.
set -uo pipefail

SCENARIO="${1:-kyc}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUKO_PKG="com.rukomobile"
PAY_PKG="com.ruko.paynow"

say() { printf "\n\033[1m› %s\033[0m\n" "$*"; }
warn() { printf "\033[33m  ! %s\033[0m\n" "$*"; }
die() { printf "\n\033[31m✗ %s\033[0m\n\n" "$*" >&2; exit 1; }

command -v adb >/dev/null || die "adb is not on PATH. Try: export PATH=\"\$HOME/Library/Android/sdk/platform-tools:\$PATH\""
[ -n "$(adb devices | sed -n '2p')" ] || die "No phone connected. Plug it in and accept the USB debugging prompt."

# The taps below were measured on the iQOO's 1440x3168 screen. Scaling keeps
# them landing on the right controls on a differently sized device rather than
# tapping blindly into empty space.
read -r SW SH <<<"$(adb shell wm size | tail -1 | sed 's/.*: //' | tr 'x' ' ')"
SW="${SW:-1440}"; SH="${SH:-3168}"
tap() { adb shell input tap $(( $1 * SW / 1440 )) $(( $2 * SH / 3168 )) >/dev/null; }
swipe_up() { adb shell input swipe $(( 720 * SW / 1440 )) $(( 2400 * SH / 3168 )) $(( 720 * SW / 1440 )) $(( 900 * SH / 3168 )) 300 >/dev/null; }
swipe_down() { adb shell input swipe $(( 720 * SW / 1440 )) $(( 900 * SH / 3168 )) $(( 720 * SW / 1440 )) $(( 2400 * SH / 3168 )) 300 >/dev/null; }

# ---------------------------------------------------------------- install

RUKO_APK="$ROOT/mobile/android/app/build/outputs/apk/release/app-release.apk"
PAY_APK="$ROOT/android/paynow/build/outputs/apk/release/paynow-release.apk"

say "Installing"
if [ -f "$RUKO_APK" ]; then
  adb install -r "$RUKO_APK" >/dev/null 2>&1 && echo "  Ruko installed" || warn "Ruko install failed — keeping what is on the phone"
else
  warn "No Ruko APK built. Using whatever is installed."
fi
if [ -f "$PAY_APK" ]; then
  adb install -r "$PAY_APK" >/dev/null 2>&1 && echo "  PayNow installed" || warn "PayNow install failed"
else
  warn "No PayNow APK built. Using whatever is installed."
fi
adb shell pm list packages | grep -q "$PAY_PKG" || die "PayNow is not installed and no APK was found to install."

# ------------------------------------------------------------ permissions
# Must come AFTER installing: a re-install clears the accessibility grant.

say "Granting permissions"
bash "$ROOT/scripts/grant-ruko.sh" >/dev/null 2>&1
adb shell pm grant "$PAY_PKG" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1
sleep 3

BOUND="$(adb shell dumpsys accessibility 2>/dev/null | sed -n '/Bound services/,/Enabled services/p' | grep -c 'label=Ruko')"
if [ "${BOUND:-0}" -lt 1 ]; then
  die "Ruko's accessibility service is not bound, so it cannot see payment screens.
   On this phone that usually means the OEM's 'Restricted setting' is blocking a
   sideloaded app. Open Settings > Accessibility > Ruko and enable it by hand."
fi
echo "  accessibility bound, overlay allowed, notifications allowed"

# ------------------------------------------------------------------- run
# Ruko is started first and deliberately NOT force-stopped afterwards, because
# force-stopping it kills the accessibility service for good.

say "Starting Ruko"
adb shell am start -n "$RUKO_PKG/.MainActivity" >/dev/null 2>&1
sleep 13

say "Opening PayNow"
adb shell am force-stop "$PAY_PKG" >/dev/null 2>&1
adb shell am start -n "$PAY_PKG/.HomeActivity" >/dev/null 2>&1
sleep 3

case "$SCENARIO" in
  kyc)      CHAT_Y=2278; PAYEE_Y=1338; AMOUNT="500" ;;
  grooming) CHAT_Y=2560; PAYEE_Y=2229; AMOUNT="2000" ;;
  game)     CHAT_Y=2840; PAYEE_Y=2520; AMOUNT="500" ;;
  *) die "Unknown scenario '$SCENARIO'. Use: kyc | grooming | game" ;;
esac

say "Playing the conversation — the scammer's messages arrive as real notifications"
swipe_up; sleep 2
tap 711 "$CHAT_Y"; sleep 19
adb logcat -d 2>/dev/null | grep "RukoNotif" | grep "kept" | tail -4 | sed 's/^/  /'

say "Making the payment PayNow was pushed towards"
adb shell input keyevent KEYCODE_BACK >/dev/null; sleep 2
swipe_down; sleep 2
tap 711 "$PAYEE_Y"; sleep 3
# Type the amount on PayNow's own keypad.
for (( i=0; i<${#AMOUNT}; i++ )); do
  case "${AMOUNT:$i:1}" in
    0) tap 717 2631 ;; 1) tap 288 1106 ;; 2) tap 717 1106 ;; 3) tap 1147 1106 ;;
    4) tap 288 1615 ;; 5) tap 717 1615 ;; 6) tap 1147 1615 ;;
    7) tap 288 2124 ;; 8) tap 717 2124 ;; 9) tap 1147 2124 ;;
  esac
  sleep 1
done
sleep 1
tap 717 2990   # Proceed to Pay
sleep 12

say "What Ruko did"
adb logcat -d 2>/dev/null | grep -E "RukoPay|RukoBridge" | tail -4 | sed 's/^/  /'
# Look for the overlay WINDOW, not the foreground activity.
#
# The interruption is drawn as a TYPE_APPLICATION_OVERLAY window on top of the
# payment app, which deliberately leaves the payment app resumed underneath --
# that is what lets the pending payment survive. So topResumedActivity stays
# PayNow even when Ruko has taken the screen, and checking it reported a
# successful interception as a failure.
OVERLAY="$(adb shell dumpsys window windows 2>/dev/null | grep -c "$RUKO_PKG")"
echo
if [ "${OVERLAY:-0}" -gt 0 ]; then
  printf "\033[32m✓ Ruko is on screen over the payment. Nothing has been paid.\033[0m\n"
else
  printf "\033[33m! No Ruko window over the payment — it did not interrupt this one.\033[0m\n"
  echo "  Open Ruko to see the score and which evidence it had."
fi
echo
