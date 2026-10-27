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
        versionCode = 92
        versionName = "0.9.63"
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
    testImplementation("org.junit.jupiter:junit-jupiter:6.0.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.0.3")

    val composeBom = platform("androidx.compose:compose-bom:2025.06.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("no.nordicsemi.android:ble:2.11.0")
    debugImplementation("androidx.compose.ui:ui-tooling")
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

val syncMirrorAsset = tasks.register<Copy>("syncMirrorAsset") {
    val repoRoot = rootProject.projectDir.parentFile
    from(repoRoot.resolve("dist/mirror.html"))
    into(layout.projectDirectory.dir("src/main/assets"))
    // Always refresh: a single copied file silently kept an older page inside
    // the APK once already.
    outputs.upToDateWhen { false }
}

tasks.named("preBuild") {
    dependsOn(syncMirrorAsset)
}
