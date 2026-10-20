#!/usr/bin/env bash
# Installe ou met à jour AgriFon sur un hébergement cPanel avec « Setup Node.js App »
# (CloudLinux). À lancer sur le serveur, dans le dossier du dépôt cloné :
#
#   git clone https://github.com/Magloire04/demo_agriculture.git ~/agrifon-app
#   cd ~/agrifon-app && bash scripts/deployer.sh agrifon.bytechnum.com
#
# Relancer la même commande pour mettre à jour : .env et stockage/ sont conservés.

set -euo pipefail

DOMAINE=${1:?"Usage : bash scripts/deployer.sh <domaine>"}
RACINE=$(cd "$(dirname "$0")/.." && pwd)
DOSSIER_APP=${RACINE#"$HOME"/} # cloudlinux-selector attend un chemin relatif au dossier personnel

etape() { printf '\n== %s\n' "$*"; }
echec() {
  printf '\nÉCHEC : %s\n' "$*" >&2
  exit 1
}
selecteur() { cloudlinux-selector "$@" --json --interpreter=nodejs; }

[ "$DOSSIER_APP" != "$RACINE" ] || echec "le dépôt doit être cloné dans votre dossier personnel ($HOME)."
command -v cloudlinux-selector >/dev/null ||
  echec "cloudlinux-selector introuvable. Créer l'application dans cPanel > Setup Node.js App (dossier $DOSSIER_APP, fichier de démarrage app.cjs)."

etape "Mise à jour du code"
git -C "$RACINE" pull --ff-only

etape "Configuration (.env)"
if [ -f "$RACINE/.env" ]; then
  echo ".env présent, conservé."
else
  ASR_ID=${ASR_ID:-}
  ASR_MDP=${ASR_MDP:-}
  [ -n "$ASR_ID" ] || read -rp "Identifiant de l'API (ASR_ID) : " ASR_ID
  [ -n "$ASR_MDP" ] || { read -rsp "Mot de passe de l'API (ASR_MDP) : " ASR_MDP && echo; }
  (umask 077 && printf 'ASR_ID=%s\nASR_MDP=%s\n' "$ASR_ID" "$ASR_MDP" >"$RACINE/.env")
  echo ".env créé, lisible par vous seul."
fi

etape "Application Node.js"
APPS=$(selecteur get)
if grep -q "\"$DOSSIER_APP\"" <<<"$APPS"; then
  echo "Application déjà déclarée pour ~/$DOSSIER_APP."
else
  # Version de Node.js la plus récente proposée par l'hébergeur, 20.12 au minimum.
  VERSION=$(grep -oE '"[0-9]+\.[0-9]+\.[0-9]+"' <<<"$APPS" | tr -d '"' | sort -uV |
    awk -F. '$1 > 20 || ($1 == 20 && $2 >= 12)' | tail -1)
  [ -n "$VERSION" ] || {
    echo "$APPS"
    echec "aucune version de Node.js 20.12 ou plus récente n'est proposée."
  }
  echo "Node.js $VERSION, domaine $DOMAINE, dossier ~/$DOSSIER_APP"
  creer() {
    selecteur create --version="${VERSION%%.*}" --app-root="$DOSSIER_APP" --domain="$DOMAINE" \
      --app-uri="$1" --app-mode=production --startup-file=app.cjs
  }
  # L'adresse racine s'écrit vide ou « / » selon les versions du sélecteur.
  creer "" || creer "/" || echec "la création de l'application a été refusée (message ci-dessus)."
fi

etape "Redémarrage"
selecteur restart --app-root="$DOSSIER_APP"

etape "Vérification"
for _ in 1 2 3 4 5; do
  if curl -fsS --max-time 20 "https://$DOMAINE/api/etat" 2>/dev/null; then
    printf '\n\nAgriFon est en ligne : https://%s\n' "$DOMAINE"
    exit 0
  fi
  sleep 3
done
echec "https://$DOMAINE/api/etat ne répond pas. Voir ~/$DOSSIER_APP/stderr.log et cPanel > Setup Node.js App."
