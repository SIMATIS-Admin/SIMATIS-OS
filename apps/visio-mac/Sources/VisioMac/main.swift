import AppKit

let application = NSApplication.shared
let delegue = BarreDeMenus()
application.delegate = delegue
// Pas d'icône dans le Dock ni de fenêtre : seulement l'icône de la barre de menus.
application.setActivationPolicy(.accessory)
application.run()
