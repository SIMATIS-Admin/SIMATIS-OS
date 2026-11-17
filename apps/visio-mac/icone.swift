import AppKit

// Dessine l'icône de l'appli (carré blanc arrondi, point rouge, petit « S » en bas à droite) et
// l'écrit sous forme de dossier .iconset, que build.sh convertit en .icns.
let sortie = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Icone.iconset"
try FileManager.default.createDirectory(atPath: sortie, withIntermediateDirectories: true)

func dessiner(_ taille: Int) -> Data {
    let t = CGFloat(taille)
    let image = NSImage(size: NSSize(width: t, height: t))
    image.lockFocus()
    // Carré arrondi blanc, avec une marge comme les icônes macOS.
    let marge = t * 0.06
    let carre = NSRect(x: marge, y: marge, width: t - 2 * marge, height: t - 2 * marge)
    let fond = NSBezierPath(roundedRect: carre, xRadius: t * 0.2, yRadius: t * 0.2)
    NSColor.white.setFill()
    fond.fill()
    NSColor(white: 0.85, alpha: 1).setStroke()
    fond.lineWidth = max(1, t * 0.008)
    fond.stroke()
    // Point rouge au centre.
    let d = t * 0.42
    let point = NSBezierPath(ovalIn: NSRect(x: (t - d) / 2, y: (t - d) / 2 + t * 0.03, width: d, height: d))
    NSColor(red: 0.89, green: 0.16, blue: 0.20, alpha: 1).setFill()
    point.fill()
    // Petit « S » stylisé, en bas à droite.
    let police = NSFont.systemFont(ofSize: t * 0.2, weight: .black)
    let descripteur = police.fontDescriptor.withDesign(.rounded) ?? police.fontDescriptor
    let ronde = NSFont(descriptor: descripteur, size: t * 0.2) ?? police
    let attributs: [NSAttributedString.Key: Any] = [.font: ronde, .foregroundColor: NSColor(red: 0.12, green: 0.14, blue: 0.2, alpha: 1)]
    let s = NSAttributedString(string: "S", attributes: attributs)
    let mesure = s.size()
    s.draw(at: NSPoint(x: carre.maxX - mesure.width - t * 0.08, y: carre.minY + t * 0.07))
    image.unlockFocus()
    let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
    return rep.representation(using: .png, properties: [:])!
}

for (nom, taille) in [("16", 16), ("16@2x", 32), ("32", 32), ("32@2x", 64), ("128", 128), ("128@2x", 256),
                      ("256", 256), ("256@2x", 512), ("512", 512), ("512@2x", 1024)] {
    let nomFichier = nom.hasSuffix("@2x") ? "icon_\(nom.replacingOccurrences(of: "@2x", with: ""))x\(nom.replacingOccurrences(of: "@2x", with: ""))@2x.png" : "icon_\(nom)x\(nom).png"
    try dessiner(taille).write(to: URL(fileURLWithPath: "\(sortie)/\(nomFichier)"))
}
print("Icône dessinée : \(sortie)")
