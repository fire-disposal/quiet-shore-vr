plugins {
    id("com.android.application")
}

android {
    namespace = "com.quietshore.portal"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.quietshore.portal"
        minSdk = 26
        targetSdk = 33
        versionCode = 48
        versionName = "0.9.15"
    }

    buildFeatures {
        buildConfig = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

}

dependencies {
    implementation(project(":protocol"))
}

val syncWebAsset = tasks.register<Copy>("syncWebAsset") {
    val repoRoot = rootProject.projectDir.parentFile
    from(repoRoot.resolve("dist/standalone.html"))
    into(layout.projectDirectory.dir("src/main/assets"))
    rename { "index.html" }
    // Always refresh: Gradle's up-to-date check on a single copied file has
    // silently kept an older page inside the APK.
    outputs.upToDateWhen { false }
}

// Sync (not Copy) so a cue deleted from voice/ disappears from the APK too.
val syncVoiceAssets = tasks.register<Sync>("syncVoiceAssets") {
    val repoRoot = rootProject.projectDir.parentFile
    from(repoRoot.resolve("dist/voice"))
    into(layout.projectDirectory.dir("src/main/assets/voice"))
    // Voice clips are immutable per id; refreshing keeps a regenerated clip
    // from being shadowed by an older copy inside the APK.
    outputs.upToDateWhen { false }
}

tasks.named("preBuild") {
    dependsOn(syncWebAsset, syncVoiceAssets)
}
