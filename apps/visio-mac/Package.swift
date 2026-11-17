// swift-tools-version:6.0
import PackageDescription

// Petite appli de la barre de menus : enregistre le micro et le son du Mac pendant une visio et
// l'envoie à l'OS, qui transcrit et résume. Le noyau (VisioCore) n'a pas d'interface : il se teste seul.
let package = Package(
    name: "VisioMac",
    platforms: [.macOS(.v15)],
    targets: [
        .target(name: "VisioCore"),
        .executableTarget(name: "VisioMac", dependencies: ["VisioCore"]),
        .testTarget(name: "VisioCoreTests", dependencies: ["VisioCore"]),
    ],
    swiftLanguageModes: [.v5]
)
