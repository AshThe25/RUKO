pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "ruko-android"

// `ruko-core` is pure Kotlin/JVM. It holds every decision Ruko makes that does
// not need an Android API, so it compiles and unit-tests on any machine —
// including CI and a laptop with no Android SDK.
include(":ruko-core")

// `ruko-native` is the Android library: services, the React Native bridge and
// the runtime shells. It needs the Android SDK, so it is only wired in when one
// is actually present. This keeps `./gradlew test` green everywhere while the
// full build stays one `local.properties` away.
val androidSdkAvailable =
    System.getenv("ANDROID_HOME") != null ||
        System.getenv("ANDROID_SDK_ROOT") != null ||
        file("local.properties").let { it.exists() && it.readText().contains("sdk.dir") }

if (androidSdkAvailable) {
    include(":ruko-native")
    // The installable harness: RukoPayDemo plus an engineering screen that
    // reports what the device genuinely supports. Not the product UI.
    include(":ruko-devapp")
} else {
    logger.lifecycle(
        "[ruko] No Android SDK detected — building :ruko-core only. " +
            "Set ANDROID_HOME or create android/local.properties to include :ruko-native.",
    )
}
