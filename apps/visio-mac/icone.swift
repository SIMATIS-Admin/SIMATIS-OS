import AppKit

// Dessine l'icône de l'appli (carré blanc arrondi, micro avec pastille rouge d'enregistrement, logo SIMATIS en bas à droite) et
// l'écrit sous forme de dossier .iconset, que build.sh convertit en .icns. Argument 2 : le logo SIMATIS (PNG).
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
    // Micro : capsule, arceau, pied et socle.
    let encre = NSColor(red: 0.12, green: 0.18, blue: 0.30, alpha: 1)
    encre.setFill()
    encre.setStroke()
    let cx = t * 0.44
    let capsule = NSBezierPath(roundedRect: NSRect(x: cx - t * 0.10, y: t * 0.42, width: t * 0.20, height: t * 0.32),
                               xRadius: t * 0.10, yRadius: t * 0.10)
    capsule.fill()
    let arceau = NSBezierPath()
    arceau.lineWidth = t * 0.035
    arceau.lineCapStyle = .round
    arceau.appendArc(withCenter: NSPoint(x: cx, y: t * 0.50), radius: t * 0.16, startAngle: 180, endAngle: 360)
    arceau.stroke()
    let pied = NSBezierPath()
    pied.lineWidth = t * 0.035
    pied.lineCapStyle = .round
    pied.move(to: NSPoint(x: cx, y: t * 0.34))
    pied.line(to: NSPoint(x: cx, y: t * 0.27))
    pied.move(to: NSPoint(x: cx - t * 0.09, y: t * 0.27))
    pied.line(to: NSPoint(x: cx + t * 0.09, y: t * 0.27))
    pied.stroke()
    // Pastille rouge d'enregistrement, en haut à droite du micro.
    let r = t * 0.085
    let pastille = NSBezierPath(ovalIn: NSRect(x: cx + t * 0.16, y: t * 0.68, width: 2 * r, height: 2 * r))
    NSColor(red: 0.89, green: 0.16, blue: 0.20, alpha: 1).setFill()
    pastille.fill()
    // Le logo SIMATIS, en bas à droite.
    if CommandLine.arguments.count > 2, let logo = NSImage(contentsOfFile: CommandLine.arguments[2]) {
        let h = t * 0.34
        let l = h * logo.size.width / logo.size.height
        logo.draw(in: NSRect(x: carre.maxX - l - t * 0.05, y: carre.minY + t * 0.05, width: l, height: h),
                  from: .zero, operation: .sourceOver, fraction: 1)
    }
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
