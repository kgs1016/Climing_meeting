// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
// ⚠️ 윈도우에서 `cap sync` 를 돌리면 경로가 역슬래시(\)로 다시 써질 수 있다.
//    역슬래시면 맥(CI) 빌드가 깨진다 — 커밋 전에 슬래시(/)인지 확인할 것.
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.5.0"),
        .package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app"),
        .package(name: "CapacitorBrowser", path: "../../../node_modules/@capacitor/browser"),
        .package(name: "CapacitorCamera", path: "../../../node_modules/@capacitor/camera"),
        .package(name: "CapacitorPushNotifications", path: "../../../node_modules/@capacitor/push-notifications")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorBrowser", package: "CapacitorBrowser"),
                .product(name: "CapacitorCamera", package: "CapacitorCamera"),
                .product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications")
            ]
        )
    ]
)
