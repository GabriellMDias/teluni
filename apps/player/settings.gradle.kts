// The Teluni Android TV player (docs/project/player-design.md). `core` holds
// every rule on the plain JVM; `app` supplies Android platform adapters and rendering.
pluginManagement {
    repositories {
        google()
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "teluni-player"

include(":core")
include(":app")
