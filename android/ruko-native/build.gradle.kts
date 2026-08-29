plugins {
    id("com.android.library")
}

// AGP 9 (the standalone android/ build) bundles Kotlin support and fails if the
// Kotlin plugin is also applied. AGP 8.6 -- which mobile/ is pinned to, because
// React Native 0.76 does not support AGP 9 -- has no built-in Kotlin at all and
// silently skips .kt sources without it. So it is applied only in that build.
if (rootProject.name == "RukoMobile") {
    apply(plugin = "org.jetbrains.kotlin.android")
}

android {
    namespace = "com.ruko.nativemodule"

    // API 35 (Android 15) is the stable target. The iQOO 15 is expected to run
    // Android 16 (API 36); targeting 35 is fully forward-compatible and avoids
    // pinning the whole team to a newer AGP than mobile/ is on. Revisit once
    // scripts/probe-device.sh confirms the device's actual SDK level.
    compileSdk = 35

    defaultConfig {
        // 26 covers NotificationListenerService, foreground services and the
        // AudioRecord behaviour Ruko relies on, without dragging in shims for
        // devices nobody in this market still uses.
        minSdk = 26
        // AGP 9 removed targetSdk from library modules: the consuming app
        // decides it, which is the correct place for that decision anyway.
        consumerProguardFiles("consumer-rules.pro")
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    // Every decision Ruko makes lives here, free of Android APIs and unit
    // tested on the JVM. This module is the thin shell around it.
    implementation(project(":ruko-core"))

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    // compileOnly: mobile/ owns the React Native version. Declaring it as a
    // hard dependency here would let this module drag a second, conflicting
    // copy of RN into the app.
    compileOnly("com.facebook.react:react-android:0.76.5")

    testImplementation(kotlin("test"))
}
