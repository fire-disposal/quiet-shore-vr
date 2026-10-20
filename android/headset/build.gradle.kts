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
        versionCode = 26
        versionName = "0.8.5"
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

tasks.named("preBuild") {
    dependsOn(syncWebAsset)
}
