import AppKit

let application = NSApplication.shared
let delegue = BarreDeMenus()
application.delegate = delegue
// Une icône dans le Dock tant que l'appli tourne, en plus de celle de la barre de menus ; pas de fenêtre.
application.setActivationPolicy(.regular)
application.run()
