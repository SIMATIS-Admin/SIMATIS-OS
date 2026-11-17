import AppKit

// Le programme démarre sur le fil principal : on le dit au compilateur pour créer l'appli.
MainActor.assumeIsolated {
    let application = NSApplication.shared
    let delegue = BarreDeMenus()
    application.delegate = delegue
    // Une icône dans le Dock tant que l'appli tourne, en plus de celle de la barre de menus.
    application.setActivationPolicy(.regular)
    application.run()
}
