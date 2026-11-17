#!/bin/sh
# Lance les tests du noyau. Avec les seuls « Command Line Tools » (sans Xcode), la bibliothèque
# Swift Testing n'est pas dans les chemins par défaut : on les donne explicitement.
set -e
cd "$(dirname "$0")"
OUTILS=/Library/Developer/CommandLineTools/Library/Developer
exec swift test \
  -Xswiftc -F"$OUTILS/Frameworks" -Xlinker -F"$OUTILS/Frameworks" \
  -Xlinker -rpath -Xlinker "$OUTILS/Frameworks" -Xlinker -rpath -Xlinker "$OUTILS/usr/lib" "$@"
