#!/bin/sh
# Construit « Visio SIMATIS.app » ; avec --installer, la copie dans ~/Applications.
set -e
cd "$(dirname "$0")"
swift build -c release
APP=".build/Visio SIMATIS.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/VisioMac "$APP/Contents/MacOS/VisioMac"
# Icône : dessinée par icone.swift, convertie en .icns.
rm -rf .build/Icone.iconset
swift icone.swift .build/Icone.iconset >/dev/null
iconutil -c icns .build/Icone.iconset -o "$APP/Contents/Resources/Icone.icns"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>os.simatis.visio</string>
  <key>CFBundleName</key><string>Visio SIMATIS</string>
  <key>CFBundleExecutable</key><string>VisioMac</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>0.1</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <key>CFBundleIconFile</key><string>Icone</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>Visio SIMATIS enregistre votre voix pendant une visio, pour la transcrire dans l'OS.</string>
  <key>NSAudioCaptureUsageDescription</key>
  <string>Visio SIMATIS enregistre le son de la visio pour la transcrire dans l'OS.</string>
</dict>
</plist>
PLIST
# Signature locale (sans compte développeur) : macOS redemande les autorisations après chaque reconstruction.
codesign --force --deep --sign - "$APP"
if [ "$1" = "--installer" ]; then
  mkdir -p "$HOME/Applications"
  rm -rf "$HOME/Applications/Visio SIMATIS.app"
  cp -R "$APP" "$HOME/Applications/"
  echo "Installée : $HOME/Applications/Visio SIMATIS.app"
  echo "Si macOS dit « autorisé » mais que l'enregistrement refuse, réinitialisez les autorisations de l'appli (voir docs/EXPLOITATION.md)."
else
  echo "Construite : $APP"
fi
