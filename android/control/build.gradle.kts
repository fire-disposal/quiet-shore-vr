plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.quietshore.control"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.quietshore.control"
        minSdk = 26
        targetSdk = 33
        versionCode = 26
        versionName = "0.8.9"
    }

    buildFeatures {
        compose = true
        buildConfig = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

}

dependencies {
    implementation(project(":protocol"))

    val composeBom = platform("androidx.compose:compose-bom:2025.06.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("no.nordicsemi.android:ble:2.11.0")
    implementation("androidx.webkit:webkit:1.13.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
}

val syncControllerAsset = tasks.register<Copy>("syncControllerAsset") {
    val repoRoot = rootProject.projectDir.parentFile
    from(repoRoot.resolve("dist/controller.html"))
    into(layout.projectDirectory.dir("src/main/assets"))
    rename { "controller.html" }
    // Always refresh: Gradle's up-to-date check on a single copied file has
    // silently kept an older page inside the APK.
    outputs.upToDateWhen { false }
}

tasks.named("preBuild") {
    dependsOn(syncControllerAsset)
}
