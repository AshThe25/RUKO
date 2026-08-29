plugins {
    id("com.android.application")
}

/**
 * `ruko-devapp` — the on-device harness for the native layer.
 *
 * This is NOT the Ruko product UI. That is Aishwarya's React Native app in
 * `mobile/`. This module exists so the Android layer can be installed and
 * exercised on the physical iQOO 15 on its own: it hosts RukoPayDemo and an
 * engineering screen that reports what the device genuinely supports.
 *
 * Every value it shows is measured or probed. Nothing is illustrative.
 */
android {
    namespace = "com.ruko.devapp"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ruko.devapp"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0-harness"
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        viewBinding = false
    }

    packaging {
        resources.excludes += "/META-INF/{AL2.0,LGPL2.1}"
    }

    // ruko-native declares React Native as compileOnly so it inherits mobile/'s
    // version. This harness has no RN at all, and never loads the bridge, so
    // the missing classes are expected rather than a build failure.
    lint {
        disable += "MissingClass"
    }
}

dependencies {
    implementation(project(":ruko-core"))
    implementation(project(":ruko-native"))
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
