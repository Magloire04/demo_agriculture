#!/usr/bin/env bash
# Met à jour les prix réels sur le serveur : à lancer à la main ou par une tâche
# planifiée de cPanel (« Cron Jobs »), par exemple chaque lundi :
#
#   bash ~/agrifon-app/scripts/importer-prix.sh >> ~/agrifon-app/stockage/import-prix.log 2>&1
#
# Le serveur relit les nouveaux prix tout seul, sans redémarrage. Lance ensuite la
# préparation de la voix des réponses (scripts/voix/preparer-phrases.js).

set -euo pipefail

RACINE=$(cd "$(dirname "$0")/.." && pwd)

# Sur cPanel, node se trouve dans l'environnement de l'application (~/nodevenv/<dossier>/<version>).
if ! command -v node >/dev/null; then
  ACTIVATE=$(find "$HOME/nodevenv/${RACINE#"$HOME"/}" -path '*/bin/activate' 2>/dev/null | sort -V | tail -1)
  if [ -z "$ACTIVATE" ]; then
    echo "node introuvable : déclarer d'abord l'application (scripts/deployer.sh)." >&2
    exit 1
  fi
  set +u
  # shellcheck disable=SC1090
  source "$ACTIVATE"
  set -u
fi

echo "== $(date '+%Y-%m-%d %H:%M') import des prix"
cd "$RACINE"
statut=0
node scripts/importer-prix.js || statut=$?

# Voix des réponses préparée à l'avance, avec les nouveaux prix (ou ceux d'avant si
# l'import a échoué). En arrière-plan : la première fois prend plus d'une heure.
mkdir -p stockage/voix-phrases
(nohup node scripts/voix/preparer-phrases.js </dev/null >>stockage/voix-phrases/preparation.log 2>&1 &)
echo "Préparation de la voix lancée en arrière-plan (journal : stockage/voix-phrases/preparation.log)."
exit "$statut"
