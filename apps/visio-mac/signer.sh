#!/bin/sh
# Signe l'appli avec un certificat local STABLE : macOS reconnaît alors l'appli après chaque
# reconstruction et garde ses autorisations (micro, son du système). Le certificat et sa clé vivent
# dans un trousseau à part (~/Library/Keychains/visio-simatis.keychain-db), hors du dépôt.
set -e
APP="$1"
NOM="Visio SIMATIS (local)"
TROUSSEAU="$HOME/Library/Keychains/visio-simatis.keychain-db"
# Mot de passe du trousseau local : tiré au hasard à la création, gardé hors du dépôt.
FICHIER_MDP="$HOME/.config/visio-simatis/trousseau"
if [ ! -f "$FICHIER_MDP" ]; then
  mkdir -p "$(dirname "$FICHIER_MDP")"
  (umask 077; /usr/bin/openssl rand -hex 16 > "$FICHIER_MDP")
fi
MDP=$(cat "$FICHIER_MDP")
if [ ! -f "$TROUSSEAU" ]; then
  D=$(mktemp -d)
  cat > "$D/openssl.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NOM
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
  /usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$D/openssl.cnf" \
    -keyout "$D/cle.pem" -out "$D/cert.pem" 2>/dev/null
  /usr/bin/openssl pkcs12 -export -inkey "$D/cle.pem" -in "$D/cert.pem" -out "$D/id.p12" -passout pass:"$MDP" 2>/dev/null
  security create-keychain -p "$MDP" "$TROUSSEAU"
  security set-keychain-settings "$TROUSSEAU"
  security unlock-keychain -p "$MDP" "$TROUSSEAU"
  security import "$D/id.p12" -k "$TROUSSEAU" -P "$MDP" -T /usr/bin/codesign >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$MDP" "$TROUSSEAU" >/dev/null
  rm -rf "$D"
  echo "Certificat local créé : $NOM"
fi
security unlock-keychain -p "$MDP" "$TROUSSEAU"
codesign --force --deep --sign "$NOM" --keychain "$TROUSSEAU" "$APP"
