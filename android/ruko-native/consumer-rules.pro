# React Native reaches native modules reflectively, so their entry points must
# survive minification.
-keep class com.ruko.nativemodule.bridge.** { *; }

# The system instantiates these by name from the manifest.
-keep class com.ruko.nativemodule.accessibility.RukoAccessibilityService { *; }
-keep class com.ruko.nativemodule.notifications.RukoNotificationListenerService { *; }
-keep class com.ruko.nativemodule.monitoring.RukoForegroundService { *; }
