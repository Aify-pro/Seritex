#!/bin/sh
# Lance immediatement une synchronisation NAS -> Supabase, en dehors de la
# planification DSM (test manuel, ou synchro a la demande).
#
# A executer depuis le NAS, dans le dossier ou ce projet a ete copie
# (ex. /volume1/docker/sage-nas-sync) :
#   sudo ./run-sync.sh
#
# Suppose que l'image a deja ete construite une fois : docker build -t sage-nas-sync .

set -eu
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "Fichier .env introuvable dans $(pwd) — copiez .env.example en .env et completez-le d'abord." >&2
  exit 1
fi

docker run --rm --env-file .env --network host sage-nas-sync
