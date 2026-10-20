import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

// Bytecode and APIs of Java 17, which Android (minSdk 26) runs through D8;
// core uses only java.time, java.nio.file and java.security from the JDK.
java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    explicitApi()
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
        freeCompilerArgs.add("-Xjdk-release=17")
        allWarningsAsErrors.set(true)
    }
}

dependencies {
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.nimbus.jose.jwt)

    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(kotlin("test"))
    testRuntimeOnly(libs.junit.platform.launcher)
}

// The repository's shared fixtures stay where the API owns them.
val repository = rootDir.resolve("../..").canonicalFile
tasks.test {
    useJUnitPlatform()
    systemProperty(
        "teluni.scheduleFixtures",
        repository.resolve("apps/api/test/programming/schedule-fixtures.json").path,
    )
    systemProperty(
        "teluni.conformance",
        repository.resolve("apps/api/test/publications/conformance.json").path,
    )
    systemProperty("teluni.openapi", repository.resolve("docs/generated/api/openapi.json").path)
    inputs.file(repository.resolve("apps/api/test/programming/schedule-fixtures.json"))
    inputs.file(repository.resolve("apps/api/test/publications/conformance.json"))
    inputs.file(repository.resolve("docs/generated/api/openapi.json"))
}
