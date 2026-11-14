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
        versionCode = 213
        versionName = "2.1.2"
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

    /*
     * The upload cycle. WorkManager is the one scheduler that survives a
     * reboot, honours a network constraint, and coalesces a periodic job with a
     * one-shot into the app's single job queue — a hand-rolled `Handler` timer
     * dies with the process, and the tablet is powered off between clinics.
     */
    implementation("androidx.work:work-runtime-ktx:2.10.5")

    testImplementation("org.junit.jupiter:junit-jupiter:6.0.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.0.3")
    testImplementation("com.vaadin.external.google:android-json:0.0.20131108.vaadin1")

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

/*
 * The questionnaire registry is a build input, not a runtime message.
 *
 * `build.mjs` emits `dist/questionnaires.json` from the page's own registry and
 * the headset APK serves the same file to the page. Copying it here means the
 * tablet renders exactly the instruments the page runs, from its own assets —
 * and it means no question's wording ever crosses BLE, which only ever carries
 * an id, an index and an answer value.
 */
val syncQuestionnaireAsset = tasks.register<Copy>("syncQuestionnaireAsset") {
    val repoRoot = rootProject.projectDir.parentFile
    from(repoRoot.resolve("dist/questionnaires.json"))
    into(layout.projectDirectory.dir("src/main/assets"))
    // Always refresh: a stale registry inside the APK is a sheet describing
    // questions the page no longer asks.
    outputs.upToDateWhen { false }
}

tasks.named("preBuild") {
    dependsOn(syncMirrorAsset, syncQuestionnaireAsset)
}
