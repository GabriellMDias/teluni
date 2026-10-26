import java.net.URI

plugins {
    alias(libs.plugins.android.application)
}

// Client-visible installation address, selected by the artifact builder.
val playerApiEndpoint = providers.gradleProperty("teluniPlayerApiEndpoint").orElse("").get()
if (playerApiEndpoint.isNotEmpty()) {
    val endpoint = URI(playerApiEndpoint)
    require(endpoint.scheme == "https" && endpoint.host != null && endpoint.rawUserInfo == null &&
        endpoint.rawQuery == null && endpoint.rawFragment == null && endpoint.normalize() == endpoint &&
        (endpoint.port == -1 || endpoint.port in 1..65535)) {
        "teluniPlayerApiEndpoint must be an HTTPS API address without credentials, query, fragment or traversal"
    }
}

android {
    namespace = "app.teluni.player"
    compileSdk = 37
    defaultConfig {
        applicationId = "app.teluni.player"
        minSdk = 26
        targetSdk = 37
        versionCode = 2
        versionName = "0.1.1"
        buildConfigField("String", "API_ENDPOINT", "\"${URI(playerApiEndpoint).toASCIIString()}\"")
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
