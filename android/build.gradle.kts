plugins {
    // AGP 9.x is the line that supports Gradle 9, which this build needs:
    // the machine has JDK 26 and Gradle 8.x refuses to run on it.
    id("com.android.library") version "9.3.2" apply false
    kotlin("android") version "2.2.21" apply false
    kotlin("jvm") version "2.2.21" apply false
}

allprojects {
    group = "com.ruko"
    version = "1.0.0"
}
