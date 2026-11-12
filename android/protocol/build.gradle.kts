plugins {
    id("org.jetbrains.kotlin.jvm")
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    // Android ships org.json; compiling here against the same package keeps the
    // protocol module free of Android types while letting it parse the JSON
    // channel's one shared document. Runtime comes from the platform.
    compileOnly("com.vaadin.external.google:android-json:0.0.20131108.vaadin1")
    testImplementation("com.vaadin.external.google:android-json:0.0.20131108.vaadin1")
    testImplementation("org.junit.jupiter:junit-jupiter:6.0.3")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.0.3")
}

tasks.test {
    useJUnitPlatform()
}
