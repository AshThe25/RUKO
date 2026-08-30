plugins {
    id("com.android.application")
}

/**
 * `paynow` — a self-contained UPI app used to demonstrate Ruko.
 *
 * It deliberately depends on NOTHING from Ruko. There is no shared module, no
 * broadcast, no private channel. PayNow simply draws a payment screen and posts
 * ordinary message notifications, exactly as a real UPI app does; Ruko has to
 * earn the detection through the accessibility tree and the notification
 * listener like it would with PhonePe or GPay.
 *
 * That independence is the whole point. A demo where the two halves are wired
 * together proves nothing about whether the detection works.
 */
android {
    namespace = "com.ruko.paynow"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.ruko.paynow"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key on purpose: this is a demo app that has
            // to be installable from a link, not something shipped to a store.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
}
