plugins {
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
}

// Every configuration is locked; `--write-locks` refreshes the lockfiles.
subprojects {
    dependencyLocking {
        lockAllConfigurations()
    }
}
