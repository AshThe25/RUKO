plugins {
    // AGP 9.x is the line that supports Gradle 9, which this build needs: the
    // machine has JDK 26 and Gradle 8.x refuses to run on it.
    //
    // Note: AGP 9 has built-in Kotlin support, so the separate
    // org.jetbrains.kotlin.android plugin must NOT be applied to Android
    // modules — AGP fails the build if it is. Only :ruko-core (plain JVM)
    // still needs the Kotlin plugin.
    id("com.android.library") version "9.3.2" apply false
    id("com.android.application") version "9.3.2" apply false
    kotlin("jvm") version "2.2.21" apply false
}

allprojects {
    group = "com.ruko"
    version = "1.0.0"
}
