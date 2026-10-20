// The Teluni Android TV player (docs/project/player-design.md). `core` holds
// every rule on the plain JVM; the Android `app` module joins in increment 2.
pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
    }
}

rootProject.name = "teluni-player"

include(":core")
