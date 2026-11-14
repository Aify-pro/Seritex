#!/usr/bin/env bash
# Crée une branche et un worktree pour une tâche d'un module, afin que
# plusieurs sessions Claude Code travaillent en parallèle sans se gêner.
#
#   scripts/worktree-module.sh <module> <sujet> [--sans-npm]
#
#   module : patronage | imbrication | confection
#   sujet  : quelques mots en kebab-case (ex. sens-du-fil, equilibrage)
#
# Résultat :
#   branche  feat/<module>-<sujet>, partie de origin/main à jour
#            (feat/patronnage-<sujet> pour le patronage, graphie du code)
#   dossier  <dossier des projets>/Seritex-<module>-<sujet>
#
# Le script ne supprime rien, ne pousse rien, ne touche pas aux worktrees
# existants : il refuse si la branche ou le dossier existe déjà.
set -euo pipefail

usage() {
  sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

[ $# -ge 2 ] || usage
module="$1"
sujet="$2"
sans_npm="${3:-}"

case "$module" in
  patronage|imbrication|confection) ;;
  *) echo "Module inconnu : $module (patronage, imbrication ou confection)" >&2; exit 1 ;;
esac

if ! [[ "$sujet" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
  echo "Sujet invalide : « $sujet » (minuscules, chiffres et tirets, ex. sens-du-fil)" >&2
  exit 1
fi

# Dépôt principal (fonctionne aussi depuis un autre worktree).
depot_principal="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
dossier_projets="$(dirname "$depot_principal")"
# Le code et l'historique Git écrivent « patronnage » (branches feat/patronnage-…).
prefixe="$module"
[ "$module" = "patronage" ] && prefixe="patronnage"
branche="feat/${prefixe}-${sujet}"
dossier="${dossier_projets}/Seritex-${prefixe}-${sujet}"

echo "→ Mise à jour de origin/main"
git -C "$depot_principal" fetch --quiet origin main

if git -C "$depot_principal" show-ref --verify --quiet "refs/heads/${branche}"; then
  echo "La branche locale ${branche} existe déjà. Rien n'est fait." >&2
  git -C "$depot_principal" worktree list | grep -F "[${branche}]" >&2 || true
  exit 1
fi
if git -C "$depot_principal" ls-remote --exit-code --heads origin "$branche" >/dev/null 2>&1; then
  echo "La branche ${branche} existe déjà sur GitHub. Rien n'est fait." >&2
  exit 1
fi
if [ -e "$dossier" ]; then
  echo "Le dossier ${dossier} existe déjà. Rien n'est fait." >&2
  exit 1
fi

echo "→ Création du worktree ${dossier} sur ${branche} (depuis origin/main)"
git -C "$depot_principal" worktree add --quiet -b "$branche" "$dossier" origin/main
# Pas de suivi automatique de origin/main : le premier push fixera origin/<branche>.
git -C "$dossier" branch --quiet --unset-upstream 2>/dev/null || true

if [ "$sans_npm" != "--sans-npm" ]; then
  echo "→ Installation des dépendances (npm ci)"
  (cd "$dossier" && npm ci --no-audit --no-fund --loglevel=error)
fi

if [ ! -d "${dossier}/.claude/agents" ]; then
  echo "⚠ ${dossier}/.claude/agents n'existe pas : la PR qui crée les sous-agents n'est pas encore fusionnée sur main." >&2
fi

cat <<EOF

Worktree prêt.
  Dossier : ${dossier}
  Branche : ${branche}

Pour lancer la session exécutante :
  cd "${dossier}" && claude

Premier message conseillé :
  Tu es la session exécutante du module ${module}. Lis CLAUDE.md, puis
  /Users/seritex/Projects/seritex-coordination/README.md et ta tâche dans
  /Users/seritex/Projects/seritex-coordination/taches/${module}.md.
  Fais-la avec le sous-agent dev-${module} et le testeur, puis écris ton
  rapport dans rapports/${module}.md. Ne modifie que ce worktree.

Quand la PR sera fusionnée, le worktree se retire avec :
  git -C "${depot_principal}" worktree remove "${dossier}"
EOF
