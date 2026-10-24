plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "app.teluni.player"
    compileSdk = 37
    defaultConfig {
        applicationId = "app.teluni.player"
        minSdk = 26
        targetSdk = 37
        versionCode = 1
        versionName = "0.1.0"
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
    lint { warningsAsErrors = true }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        allWarningsAsErrors.set(true)
    }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.media3.exoplayer)
    implementation(libs.media3.ui)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    testImplementation(libs.junit4)
    testImplementation(libs.robolectric)
}

// Robolectric's platform must pass Gradle's locks and checksum verification too.
val robolectricSdk = configurations.create("robolectricSdk")
dependencies { add(robolectricSdk.name, libs.robolectric.android) }
val prepareTestSdk = tasks.register<Copy>("prepareTestSdk") {
    from(robolectricSdk)
    into(layout.buildDirectory.dir("robolectric-sdk"))
}
tasks.withType<Test>().configureEach {
    dependsOn(prepareTestSdk)
    systemProperty("robolectric.offline", "true")
    systemProperty("robolectric.dependency.dir", layout.buildDirectory.dir("robolectric-sdk").get().asFile.absolutePath)
    val conformance = rootDir.resolve("../api/test/publications/conformance.json").canonicalFile
    systemProperty("teluni.conformance", conformance.path)
    inputs.file(conformance)
}
